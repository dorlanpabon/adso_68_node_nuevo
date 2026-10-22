const pool = require('../config/db');
const { respuestaOk, respuestaError } = require('../utils/respuesta');
const { esTexto, esEntero, esEnteroPositivo, paginar } = require('../utils/validaciones');

const ESTADOS_PEDIDO = ['pendiente', 'confirmado', 'entregado', 'facturado', 'cancelado'];

// Transiciones válidas del ciclo de vida: "facturado" se asigna solo al
// generar la factura y no se puede elegir desde el endpoint de estado.
const TRANSICIONES = {
  pendiente: ['confirmado', 'cancelado'],
  confirmado: ['entregado', 'cancelado'],
  entregado: [],
  facturado: [],
  cancelado: [],
};
const ESTADOS_ADMITIDOS = [...new Set(Object.values(TRANSICIONES).flat())];

// Devuelve el pedido con sus líneas (items) y el nombre del producto
async function obtenerPedidoCompleto(pedidoId) {
  const [cabecera] = await pool.query(
    `SELECT p.*, u.usuario AS registrado_por
       FROM pedidos p
       LEFT JOIN usuarios u ON u.id = p.usuario_id
      WHERE p.id = ?`,
    [pedidoId]
  );
  if (cabecera.length === 0) return null;

  const [detalle] = await pool.query(
    `SELECT d.id, d.producto_id, prod.nombre AS producto, d.cantidad, d.precio_unitario, d.subtotal
       FROM pedido_detalle d
       JOIN productos prod ON prod.id = d.producto_id
      WHERE d.pedido_id = ?`,
    [pedidoId]
  );
  return { ...cabecera[0], items: detalle };
}

// Crea un pedido en una transacción: valida stock, descuenta inventario
// y registra los movimientos (kardex) de salida. Si algo falla, se revierte todo.
async function crearPedido(req, res) {
  const { cliente, items } = req.body ?? {};

  const errores = [];
  if (!esTexto(cliente, 2, 100)) {
    errores.push('El campo cliente es obligatorio (2 a 100 caracteres).');
  }
  if (!Array.isArray(items) || items.length === 0) {
    errores.push('El campo items debe ser un arreglo con al menos un producto.');
  } else {
    items.forEach((item, i) => {
      if (!item || !esEnteroPositivo(item.producto_id)) {
        errores.push(`items[${i}].producto_id debe ser un id válido.`);
      }
      if (!item || !esEntero(item.cantidad, 1)) {
        errores.push(`items[${i}].cantidad debe ser un entero mayor a 0.`);
      }
    });
  }
  if (errores.length > 0) {
    return respuestaError(res, 400, 'Datos inválidos', errores);
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Bloquea las filas de los productos (FOR UPDATE) para que el stock
    // no pueda cambiar mientras calculamos el pedido
    const ids = items.map((i) => Number(i.producto_id));
    const [productos] = await conn.query(
      'SELECT id, nombre, precio, stock, estado FROM productos WHERE id IN (?) FOR UPDATE',
      [ids]
    );
    const porId = new Map(productos.map((p) => [p.id, p]));

    const fallos = [];
    let total = 0;
    for (const item of items) {
      const producto = porId.get(Number(item.producto_id));
      if (!producto) {
        fallos.push(`El producto ${item.producto_id} no existe`);
      } else if (producto.estado !== 1) {
        fallos.push(`El producto "${producto.nombre}" está inactivo`);
      } else if (producto.stock < Number(item.cantidad)) {
        fallos.push(
          `Stock insuficiente de "${producto.nombre}" (solicitas ${Number(item.cantidad)}, disponible ${producto.stock})`
        );
      } else {
        total += Number(producto.precio) * Number(item.cantidad);
      }
    }
    if (fallos.length > 0) {
      await conn.rollback();
      return respuestaError(res, 409, 'No se pudo crear el pedido', fallos);
    }

    // 1) Cabecera del pedido
    const [nuevo] = await conn.query(
      "INSERT INTO pedidos (cliente, usuario_id, estado, total) VALUES (?, ?, 'pendiente', ?)",
      [cliente.trim(), req.usuario.id, total]
    );
    const pedidoId = nuevo.insertId;

    // 2) Líneas del pedido + descuento de stock + kardex
    for (const item of items) {
      const producto = porId.get(Number(item.producto_id));
      const cantidad = Number(item.cantidad);
      const stockNuevo = producto.stock - cantidad;

      await conn.query(
        'INSERT INTO pedido_detalle (pedido_id, producto_id, cantidad, precio_unitario, subtotal) VALUES (?, ?, ?, ?, ?)',
        [pedidoId, producto.id, cantidad, producto.precio, Number(producto.precio) * cantidad]
      );
      await conn.query('UPDATE productos SET stock = stock - ? WHERE id = ?', [cantidad, producto.id]);
      await conn.query(
        'INSERT INTO inventario (producto_id, tipo, cantidad, stock_anterior, stock_nuevo, referencia, usuario_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [producto.id, 'salida', -cantidad, producto.stock, stockNuevo, `Pedido #${pedidoId}`, req.usuario.id]
      );
    }

    await conn.commit();
    const pedido = await obtenerPedidoCompleto(pedidoId);
    return respuestaOk(res, 201, 'Pedido creado correctamente', pedido);
  } catch (error) {
    await conn.rollback().catch(() => {});
    console.error('[ERROR crear pedido]', error);
    return respuestaError(res, 500, 'Error al crear el pedido');
  } finally {
    conn.release();
  }
}

// Lista pedidos con filtros: GET /api/pedidos?estado=pendiente&cliente=mer&pagina=1&limite=10
async function listarPedidos(req, res) {
  const { pagina, limite, offset } = paginar(req.query);

  const filtros = [];
  const valores = [];

  if (req.query.estado !== undefined && req.query.estado !== '') {
    if (!ESTADOS_PEDIDO.includes(String(req.query.estado))) {
      return respuestaError(res, 400, `El filtro estado debe ser uno de: ${ESTADOS_PEDIDO.join(', ')}`);
    }
    filtros.push('p.estado = ?');
    valores.push(String(req.query.estado));
  }
  if (esTexto(req.query.cliente, 1)) {
    filtros.push('p.cliente LIKE ?');
    valores.push(`%${req.query.cliente.trim()}%`);
  }

  const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';

  try {
    const [filas] = await pool.query(
      `SELECT p.*, u.usuario AS registrado_por
         FROM pedidos p
         LEFT JOIN usuarios u ON u.id = p.usuario_id
         ${where}
        ORDER BY p.id DESC
        LIMIT ? OFFSET ?`,
      [...valores, limite, offset]
    );
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM pedidos p ${where}`, valores);

    return respuestaOk(res, 200, 'Pedidos obtenidos', {
      pedidos: filas,
      paginacion: { pagina, limite, total, paginas: Math.ceil(total / limite) },
    });
  } catch (error) {
    console.error('[ERROR listar pedidos]', error);
    return respuestaError(res, 500, 'Error al listar los pedidos');
  }
}

// Consulta un pedido con sus líneas
async function consultarPedido(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return respuestaError(res, 400, 'El id debe ser un número entero positivo.');
  }

  try {
    const pedido = await obtenerPedidoCompleto(id);
    if (!pedido) {
      return respuestaError(res, 404, `No existe el pedido con id ${id}`);
    }
    return respuestaOk(res, 200, 'Pedido encontrado', pedido);
  } catch (error) {
    console.error('[ERROR consultar pedido]', error);
    return respuestaError(res, 500, 'Error al consultar el pedido');
  }
}

// Cambia el estado siguiendo las transiciones válidas.
// Al cancelar se restituye el stock y se registra el kardex de entrada.
async function cambiarEstadoPedido(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return respuestaError(res, 400, 'El id debe ser un número entero positivo.');
  }
  const { estado } = req.body ?? {};
  if (!ESTADOS_ADMITIDOS.includes(estado)) {
    return respuestaError(
      res,
      400,
      `El campo estado debe ser uno de: ${ESTADOS_ADMITIDOS.join(', ')}. El estado "facturado" se asigna automáticamente al generar la factura.`
    );
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [filas] = await conn.query('SELECT id, estado FROM pedidos WHERE id = ? FOR UPDATE', [id]);
    const pedido = filas[0];
    if (!pedido) {
      await conn.rollback();
      return respuestaError(res, 404, `No existe el pedido con id ${id}`);
    }
    if (!TRANSICIONES[pedido.estado].includes(estado)) {
      await conn.rollback();
      return respuestaError(res, 409, `No se puede cambiar un pedido "${pedido.estado}" a "${estado}"`);
    }

    await conn.query('UPDATE pedidos SET estado = ? WHERE id = ?', [estado, id]);

    if (estado === 'cancelado') {
      // Devuelve al stock lo que había salido y deja constancia en el kardex
      const [lineas] = await conn.query(
        `SELECT d.cantidad, p.id AS producto_id, p.stock
           FROM pedido_detalle d
           JOIN productos p ON p.id = d.producto_id
          WHERE d.pedido_id = ? FOR UPDATE`,
        [id]
      );
      for (const linea of lineas) {
        const stockNuevo = linea.stock + linea.cantidad;
        await conn.query('UPDATE productos SET stock = stock + ? WHERE id = ?', [linea.cantidad, linea.producto_id]);
        await conn.query(
          'INSERT INTO inventario (producto_id, tipo, cantidad, stock_anterior, stock_nuevo, referencia, usuario_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [linea.producto_id, 'entrada', linea.cantidad, linea.stock, stockNuevo, `Anulación pedido #${id}`, req.usuario.id]
        );
      }
    }

    await conn.commit();
    const actualizado = await obtenerPedidoCompleto(id);
    return respuestaOk(res, 200, `Pedido cambiado a "${estado}"`, actualizado);
  } catch (error) {
    await conn.rollback().catch(() => {});
    console.error('[ERROR cambiar estado pedido]', error);
    return respuestaError(res, 500, 'Error al cambiar el estado del pedido');
  } finally {
    conn.release();
  }
}

// Elimina un pedido SOLO si está cancelado (para conservar la trazabilidad
// de los pedidos activos). Las líneas se borran en cascada.
async function eliminarPedido(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return respuestaError(res, 400, 'El id debe ser un número entero positivo.');
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [filas] = await conn.query('SELECT id, estado FROM pedidos WHERE id = ? FOR UPDATE', [id]);
    const pedido = filas[0];
    if (!pedido) {
      await conn.rollback();
      return respuestaError(res, 404, `No existe el pedido con id ${id}`);
    }
    if (pedido.estado !== 'cancelado') {
      await conn.rollback();
      return respuestaError(
        res,
        409,
        'Solo se pueden eliminar pedidos cancelados. Configúralo primero con PUT /api/pedidos/' + id + ' y estado "cancelado".'
      );
    }

    await conn.query('DELETE FROM pedidos WHERE id = ?', [id]);
    await conn.commit();
    return respuestaOk(res, 200, `Pedido ${id} eliminado permanentemente`);
  } catch (error) {
    await conn.rollback().catch(() => {});
    console.error('[ERROR eliminar pedido]', error);
    return respuestaError(res, 500, 'Error al eliminar el pedido');
  } finally {
    conn.release();
  }
}

module.exports = { crearPedido, listarPedidos, consultarPedido, cambiarEstadoPedido, eliminarPedido };
