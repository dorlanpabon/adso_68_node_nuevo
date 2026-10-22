const pool = require('../config/db');
const { respuestaOk, respuestaError } = require('../utils/respuesta');
const { esTexto, esDecimal, esEntero, esEnteroPositivo, paginar } = require('../utils/validaciones');

// Inserta un producto (solo admin). Acepta stock inicial y categoría.
async function crearProducto(req, res) {
  const { nombre, descripcion, precio, stock, categoria } = req.body ?? {};

  const errores = [];
  if (!esTexto(nombre, 2, 100)) {
    errores.push('El campo nombre es obligatorio (2 a 100 caracteres).');
  }
  if (!esDecimal(precio, 0)) {
    errores.push('El campo precio debe ser un número mayor o igual a 0.');
  }

  let stockNum = 0;
  if (stock !== undefined && stock !== null && stock !== '') {
    if (!esEntero(stock, 0)) {
      errores.push('El campo stock debe ser un número entero mayor o igual a 0.');
    } else {
      stockNum = Number(stock);
    }
  }

  let categoriaVal = null;
  if (categoria !== undefined && categoria !== null && categoria !== '') {
    if (!esTexto(categoria, 1, 50)) {
      errores.push('El campo categoria debe tener entre 1 y 50 caracteres.');
    } else {
      categoriaVal = categoria.trim();
    }
  }

  if (errores.length > 0) {
    return respuestaError(res, 400, 'Datos inválidos', errores);
  }

  try {
    const [resultado] = await pool.query(
      'INSERT INTO productos (nombre, descripcion, precio, stock, categoria) VALUES (?, ?, ?, ?, ?)',
      [nombre.trim(), descripcion?.trim() || null, Number(precio), stockNum, categoriaVal]
    );
    const [creado] = await pool.query('SELECT * FROM productos WHERE id = ?', [resultado.insertId]);
    return respuestaOk(res, 201, 'Producto creado correctamente', creado[0]);
  } catch (error) {
    console.error('[ERROR crear producto]', error);
    return respuestaError(res, 500, 'Error al crear el producto');
  }
}

// Lista productos con filtros opcionales y paginación:
// GET /api/productos?nombre=arroz&categoria=foods&estado=1&pagina=1&limite=10
async function listarProductos(req, res) {
  const { pagina, limite, offset } = paginar(req.query);

  const filtros = [];
  const valores = [];

  if (esTexto(req.query.nombre, 1)) {
    filtros.push('nombre LIKE ?');
    valores.push(`%${req.query.nombre.trim()}%`);
  }
  if (esTexto(req.query.categoria, 1)) {
    filtros.push('categoria = ?');
    valores.push(req.query.categoria.trim());
  }
  if (req.query.estado !== undefined && req.query.estado !== '') {
    const estado = Number(req.query.estado);
    if (![0, 1].includes(estado)) {
      return respuestaError(res, 400, 'El filtro estado debe ser 0 (inactivo) o 1 (activo).');
    }
    filtros.push('estado = ?');
    valores.push(estado);
  }

  const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';

  try {
    const [filas] = await pool.query(
      `SELECT * FROM productos ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...valores, limite, offset]
    );
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM productos ${where}`, valores);

    return respuestaOk(res, 200, 'Productos obtenidos', {
      productos: filas,
      paginacion: { pagina, limite, total, paginas: Math.ceil(total / limite) },
    });
  } catch (error) {
    console.error('[ERROR listar productos]', error);
    return respuestaError(res, 500, 'Error al listar los productos');
  }
}

// Consulta un producto por id (requiere autenticación)
async function consultarProducto(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return respuestaError(res, 400, 'El id debe ser un número entero positivo.');
  }

  try {
    const [filas] = await pool.query('SELECT * FROM productos WHERE id = ?', [id]);
    if (filas.length === 0) {
      return respuestaError(res, 404, `No existe el producto con id ${id}`);
    }
    return respuestaOk(res, 200, 'Producto encontrado', filas[0]);
  } catch (error) {
    console.error('[ERROR consultar producto]', error);
    return respuestaError(res, 500, 'Error al consultar el producto');
  }
}

// Actualiza un producto parcialmente (solo admin): solo cambia lo que envías
async function actualizarProducto(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return respuestaError(res, 400, 'El id debe ser un número entero positivo.');
  }

  const cuerpo = req.body ?? {};
  const cambios = {};

  if (cuerpo.nombre !== undefined) {
    if (!esTexto(cuerpo.nombre, 2, 100)) {
      return respuestaError(res, 400, 'El campo nombre debe tener de 2 a 100 caracteres.');
    }
    cambios.nombre = cuerpo.nombre.trim();
  }
  if (cuerpo.descripcion !== undefined) {
    if (cuerpo.descripcion !== null && !esTexto(cuerpo.descripcion, 1, 65535)) {
      return respuestaError(res, 400, 'El campo descripcion no es válido.');
    }
    cambios.descripcion = cuerpo.descripcion === null ? null : String(cuerpo.descripcion).trim();
  }
  if (cuerpo.precio !== undefined) {
    if (!esDecimal(cuerpo.precio, 0)) {
      return respuestaError(res, 400, 'El campo precio debe ser un número mayor o igual a 0.');
    }
    cambios.precio = Number(cuerpo.precio);
  }
  if (cuerpo.stock !== undefined) {
    if (!esEntero(cuerpo.stock, 0)) {
      return respuestaError(res, 400, 'El campo stock debe ser un entero mayor o igual a 0.');
    }
    cambios.stock = Number(cuerpo.stock);
  }
  if (cuerpo.categoria !== undefined) {
    if (cuerpo.categoria !== null && !esTexto(cuerpo.categoria, 1, 50)) {
      return respuestaError(res, 400, 'El campo categoria debe tener entre 1 y 50 caracteres.');
    }
    cambios.categoria = cuerpo.categoria === null ? null : String(cuerpo.categoria).trim();
  }
  if (cuerpo.estado !== undefined) {
    if (!['0', '1', 0, 1, true, false].includes(cuerpo.estado)) {
      return respuestaError(res, 400, 'El campo estado debe ser 0 (inactivo) o 1 (activo).');
    }
    cambios.estado = Number(cuerpo.estado) ? 1 : 0; // útil para "desactivar" en vez de eliminar
  }

  if (Object.keys(cambios).length === 0) {
    return respuestaError(
      res,
      400,
      'No enviaste campos para actualizar. Campos permitidos: nombre, descripcion, precio, stock, categoria, estado.'
    );
  }

  const campos = Object.keys(cambios).map((c) => `${c} = ?`).join(', ');

  try {
    const [resultado] = await pool.query(`UPDATE productos SET ${campos} WHERE id = ?`, [
      ...Object.values(cambios),
      id,
    ]);
    if (resultado.affectedRows === 0) {
      return respuestaError(res, 404, `No existe el producto con id ${id}`);
    }
    const [actualizado] = await pool.query('SELECT * FROM productos WHERE id = ?', [id]);
    return respuestaOk(res, 200, 'Producto actualizado correctamente', actualizado[0]);
  } catch (error) {
    console.error('[ERROR actualizar producto]', error);
    return respuestaError(res, 500, 'Error al actualizar el producto');
  }
}

// Elimina un producto (solo admin). Si ya fue usado en pedidos o inventario
// responde 409 y sugiere desactivarlo con PUT (estado 0).
async function eliminarProducto(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return respuestaError(res, 400, 'El id debe ser un número entero positivo.');
  }

  try {
    const [resultado] = await pool.query('DELETE FROM productos WHERE id = ?', [id]);
    if (resultado.affectedRows === 0) {
      return respuestaError(res, 404, `No existe el producto con id ${id}`);
    }
    return respuestaOk(res, 200, `Producto ${id} eliminado permanentemente`);
  } catch (error) {
    // La FK bloquea borrar productos ya usados en pedidos/movimientos
    if (error?.code === 'ER_ROW_IS_REFERENCED_2') {
      return respuestaError(
        res,
        409,
        `No se puede eliminar: el producto ${id} ya se usó en pedidos o movimientos de inventario. ` +
        `Desactívalo con PUT /api/productos/${id} y el campo estado: 0.`
      );
    }
    console.error('[ERROR eliminar producto]', error);
    return respuestaError(res, 500, 'Error al eliminar el producto');
  }
}

module.exports = { crearProducto, listarProductos, consultarProducto, actualizarProducto, eliminarProducto };
