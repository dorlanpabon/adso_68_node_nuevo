const pool = require('../config/db');
const { respuestaOk, respuestaError } = require('../utils/respuesta');
const { esTexto, esEntero, esEnteroPositivo, paginar } = require('../utils/validaciones');

const TIPOS_MOVIMIENTO = ['entrada', 'salida', 'ajuste'];

// Stock actual por producto: GET /api/inventario?nombre=arroz&minimo=10
// Con ?minimo=N se muestran solo los productos con stock <= N (alertas)
async function consultarStock(req, res) {
  const filtros = [];
  const whereVal = [];
  const havingVal = [];

  if (esTexto(req.query.nombre, 1)) {
    filtros.push('p.nombre LIKE ?');
    whereVal.push(`%${req.query.nombre.trim()}%`);
  }
  if (req.query.minimo !== undefined && req.query.minimo !== '') {
    if (!esEntero(req.query.minimo, 0)) {
      return respuestaError(res, 400, 'El filtro minimo debe ser un entero mayor o igual a 0.');
    }
    filtros.push('HAVING p.stock <= ?');
    havingVal.push(Number(req.query.minimo));
  }

  const where = filtros.filter((f) => !f.startsWith('HAVING')).join(' AND ');
  const having = filtros.filter((f) => f.startsWith('HAVING')).join(' ');

  try {
    const [filas] = await pool.query(
      `SELECT p.id, p.nombre, p.categoria, p.stock, p.estado, MAX(i.creado_en) AS ultimo_movimiento
         FROM productos p
         LEFT JOIN inventario i ON i.producto_id = p.id
         ${where ? `WHERE ${where}` : ''}
        GROUP BY p.id
        ${having}
        ORDER BY p.stock ASC`,
      [...whereVal, ...havingVal]
    );
    return respuestaOk(res, 200, 'Stock actual por producto', { stock: filas, total: filas.length });
  } catch (error) {
    console.error('[ERROR consultar stock]', error);
    return respuestaError(res, 500, 'Error al consultar el stock');
  }
}

// Kardex (historial de movimientos):
// GET /api/inventario/movimientos?producto_id=3&tipo=salida&pagina=1
async function listarMovimientos(req, res) {
  const { pagina, limite, offset } = paginar(req.query, 200);

  const filtros = [];
  const valores = [];

  if (req.query.producto_id !== undefined && req.query.producto_id !== '') {
    if (!esEnteroPositivo(req.query.producto_id)) {
      return respuestaError(res, 400, 'El filtro producto_id debe ser un id válido.');
    }
    filtros.push('i.producto_id = ?');
    valores.push(Number(req.query.producto_id));
  }
  if (req.query.tipo !== undefined && req.query.tipo !== '') {
    if (!TIPOS_MOVIMIENTO.includes(String(req.query.tipo))) {
      return respuestaError(res, 400, `El filtro tipo debe ser uno de: ${TIPOS_MOVIMIENTO.join(', ')}`);
    }
    filtros.push('i.tipo = ?');
    valores.push(String(req.query.tipo));
  }

  const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';

  try {
    const [filas] = await pool.query(
      `SELECT i.*, p.nombre AS producto, u.usuario AS registrado_por
         FROM inventario i
         JOIN productos p ON p.id = i.producto_id
         LEFT JOIN usuarios u ON u.id = i.usuario_id
         ${where}
        ORDER BY i.id DESC
        LIMIT ? OFFSET ?`,
      [...valores, limite, offset]
    );
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM inventario i ${where}`,
      valores
    );

    return respuestaOk(res, 200, 'Movimientos de inventario obtenidos', {
      movimientos: filas,
      paginacion: { pagina, limite, total, paginas: Math.ceil(total / limite) },
    });
  } catch (error) {
    console.error('[ERROR listar movimientos]', error);
    return respuestaError(res, 500, 'Error al listar los movimientos');
  }
}

// Registra un movimiento manual (solo admin) y actualiza el stock:
//  - entrada: cantidad > 0, suma al stock (compra del proveedor)
//  - salida:  cantidad > 0, resta del stock (merma, venta directa)
//  - ajuste:  cantidad con signo (positiva o negativa), requiere motivo
async function registrarMovimiento(req, res) {
  const { producto_id, tipo, cantidad, motivo } = req.body ?? {};

  const errores = [];
  if (!esEnteroPositivo(producto_id)) {
    errores.push('El campo producto_id debe ser un id válido.');
  }
  if (!TIPOS_MOVIMIENTO.includes(tipo)) {
    errores.push(`El campo tipo debe ser uno de: ${TIPOS_MOVIMIENTO.join(', ')}.`);
  }
  if (!esEntero(cantidad) || Number(cantidad) === 0) {
    errores.push('El campo cantidad debe ser un entero distinto de 0 (mayor a 0 para entrada/salida, con signo para ajuste).');
  }
  let motivoVal = null;
  if (motivo !== undefined && motivo !== null && motivo !== '') {
    if (!esTexto(motivo, 1, 100)) {
      errores.push('El campo motivo debe tener entre 1 y 100 caracteres.');
    } else {
      motivoVal = motivo.trim();
    }
  } else if (tipo === 'ajuste') {
    errores.push('Los movimientos de tipo "ajuste" requieren el campo motivo.');
  }
  if (errores.length > 0) {
    return respuestaError(res, 400, 'Datos inválidos', errores);
  }

  const cant = Number(cantidad);
  if ((tipo === 'entrada' || tipo === 'salida') && cant <= 0) {
    return respuestaError(res, 400, 'Para "entrada" y "salida" la cantidad debe ser un entero mayor a 0.');
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [filas] = await conn.query(
      'SELECT id, nombre, stock FROM productos WHERE id = ? FOR UPDATE',
      [Number(producto_id)]
    );
    const producto = filas[0];
    if (!producto) {
      await conn.rollback();
      return respuestaError(res, 404, `No existe el producto con id ${producto_id}`);
    }

    const anterior = producto.stock;
    let nuevo = anterior;
    if (tipo === 'entrada') nuevo = anterior + cant;
    else if (tipo === 'salida') nuevo = anterior - cant;
    else nuevo = anterior + cant; // ajuste (con signo)

    if (nuevo < 0) {
      await conn.rollback();
      return respuestaError(
        res,
        409,
        `Stock insuficiente: "${producto.nombre}" tiene ${anterior} unidades y el movimiento lo dejaría en ${nuevo}.`,
        { stock_actual: anterior }
      );
    }

    await conn.query('UPDATE productos SET stock = ? WHERE id = ?', [nuevo, producto.id]);
    const [mov] = await conn.query(
      'INSERT INTO inventario (producto_id, tipo, cantidad, stock_anterior, stock_nuevo, referencia, usuario_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        producto.id,
        tipo,
        tipo === 'salida' ? -cant : cant, // en el kardex la salida queda con signo
        anterior,
        nuevo,
        motivoVal ?? 'Movimiento manual de inventario',
        req.usuario.id,
      ]
    );

    await conn.commit();
    const [movimientos] = await pool.query(
      'SELECT i.*, p.nombre AS producto FROM inventario i JOIN productos p ON p.id = i.producto_id WHERE i.id = ?',
      [mov.insertId]
    );
    return respuestaOk(res, 201, 'Movimiento registrado correctamente', {
      movimiento: movimientos[0],
      stock_actual: nuevo,
    });
  } catch (error) {
    await conn.rollback().catch(() => {});
    console.error('[ERROR registrar movimiento]', error);
    return respuestaError(res, 500, 'Error al registrar el movimiento');
  } finally {
    conn.release();
  }
}

module.exports = { consultarStock, listarMovimientos, registrarMovimiento };
