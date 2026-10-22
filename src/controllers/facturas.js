const pool = require('../config/db');
const { respuestaOk, respuestaError } = require('../utils/respuesta');
const { esTexto, esEnteroPositivo, paginar } = require('../utils/validaciones');

const IVA = 0.19; // 19% (tarifa de IVA en Colombia)

// Devuelve la factura con los datos del pedido y su detalle (items)
async function obtenerFacturaCompleta(facturaId) {
  const [filas] = await pool.query(
    `SELECT f.*, p.cliente, p.estado AS pedido_estado, u.usuario AS facturado_por
       FROM facturas f
       JOIN pedidos p ON p.id = f.pedido_id
       LEFT JOIN usuarios u ON u.id = p.usuario_id
      WHERE f.id = ?`,
    [facturaId]
  );
  if (filas.length === 0) return null;

  const [detalle] = await pool.query(
    `SELECT d.id, d.producto_id, prod.nombre AS producto, d.cantidad, d.precio_unitario, d.subtotal
       FROM pedido_detalle d
       JOIN productos prod ON prod.id = d.producto_id
      WHERE d.pedido_id = ?`,
    [filas[0].pedido_id]
  );
  return { ...filas[0], items: detalle };
}

// Genera la factura de un pedido en una transacción:
// valida que el pedido exista, no esté cancelado ni ya facturado;
// calcula subtotal, IVA (19%) y total; numeración F-000001, F-000002...
async function generarFactura(req, res) {
  const { pedido_id } = req.body ?? {};
  if (!esEnteroPositivo(pedido_id)) {
    return respuestaError(res, 400, 'Envía el campo pedido_id (id del pedido a facturar).');
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [filas] = await conn.query(
      'SELECT id, cliente, total, estado FROM pedidos WHERE id = ? FOR UPDATE',
      [Number(pedido_id)]
    );
    const pedido = filas[0];
    if (!pedido) {
      await conn.rollback();
      return respuestaError(res, 404, `No existe el pedido con id ${pedido_id}`);
    }
    if (pedido.estado === 'cancelado') {
      await conn.rollback();
      return respuestaError(res, 409, 'No se puede facturar un pedido cancelado.');
    }
    if (pedido.estado === 'facturado') {
      await conn.rollback();
      return respuestaError(res, 409, `El pedido ${pedido.id} ya tiene una factura.`);
    }

    const [detalle] = await conn.query(
      'SELECT SUM(subtotal) AS subtotal FROM pedido_detalle WHERE pedido_id = ?',
      [pedido.id]
    );
    const subtotal = Number(detalle[0].subtotal) || 0;
    const iva = Number((subtotal * IVA).toFixed(2));
    const total = Number((subtotal + iva).toFixed(2));

    const [nueva] = await conn.query(
      "INSERT INTO facturas (pedido_id, subtotal, iva, total, estado) VALUES (?, ?, ?, ?, 'emitida')",
      [pedido.id, subtotal, iva, total]
    );
    // Número de factura a partir del id: F-000001
    await conn.query("UPDATE facturas SET numero = CONCAT('F-', LPAD(id, 6, '0')) WHERE id = ?", [nueva.insertId]);
    await conn.query("UPDATE pedidos SET estado = 'facturado' WHERE id = ?", [pedido.id]);

    await conn.commit();
    const factura = await obtenerFacturaCompleta(nueva.insertId);
    return respuestaOk(res, 201, 'Factura generada correctamente', factura);
  } catch (error) {
    await conn.rollback().catch(() => {});
    console.error('[ERROR generar factura]', error);
    return respuestaError(res, 500, 'Error al generar la factura');
  } finally {
    conn.release();
  }
}

// Lista facturas: GET /api/facturas?estado=emitida&pedido_id=3&pagina=1&limite=10
async function listarFacturas(req, res) {
  const { pagina, limite, offset } = paginar(req.query);

  const filtros = [];
  const valores = [];

  if (req.query.estado !== undefined && req.query.estado !== '') {
    if (!['emitida', 'pagada'].includes(String(req.query.estado))) {
      return respuestaError(res, 400, 'El filtro estado debe ser "emitida" o "pagada".');
    }
    filtros.push('f.estado = ?');
    valores.push(String(req.query.estado));
  }
  if (req.query.pedido_id !== undefined && req.query.pedido_id !== '') {
    if (!esEnteroPositivo(req.query.pedido_id)) {
      return respuestaError(res, 400, 'El filtro pedido_id debe ser un id válido.');
    }
    filtros.push('f.pedido_id = ?');
    valores.push(Number(req.query.pedido_id));
  }

  const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';

  try {
    const [filas] = await pool.query(
      `SELECT f.*, p.cliente
         FROM facturas f
         JOIN pedidos p ON p.id = f.pedido_id
         ${where}
        ORDER BY f.id DESC
        LIMIT ? OFFSET ?`,
      [...valores, limite, offset]
    );
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM facturas f ${where}`, valores);

    return respuestaOk(res, 200, 'Facturas obtenidas', {
      facturas: filas,
      paginacion: { pagina, limite, total, paginas: Math.ceil(total / limite) },
    });
  } catch (error) {
    console.error('[ERROR listar facturas]', error);
    return respuestaError(res, 500, 'Error al listar las facturas');
  }
}

// Consulta una factura con su pedido y detalle
async function consultarFactura(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return respuestaError(res, 400, 'El id debe ser un número entero positivo.');
  }

  try {
    const factura = await obtenerFacturaCompleta(id);
    if (!factura) {
      return respuestaError(res, 404, `No existe la factura con id ${id}`);
    }
    return respuestaOk(res, 200, 'Factura encontrada', factura);
  } catch (error) {
    console.error('[ERROR consultar factura]', error);
    return respuestaError(res, 500, 'Error al consultar la factura');
  }
}

// Marca una factura como pagada (solo desde "emitida"; una factura pagada
// queda inmutable para conservar la trazabilidad contable)
async function pagarFactura(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return respuestaError(res, 400, 'El id debe ser un número entero positivo.');
  }

  try {
    const [resultado] = await pool.query(
      "UPDATE facturas SET estado = 'pagada' WHERE id = ? AND estado = 'emitida'",
      [id]
    );
    if (resultado.affectedRows === 0) {
      const [filas] = await pool.query('SELECT id, estado FROM facturas WHERE id = ?', [id]);
      if (filas.length === 0) {
        return respuestaError(res, 404, `No existe la factura con id ${id}`);
      }
      return respuestaError(
        res,
        409,
        `Solo se pueden pagar facturas en estado "emitida" (actual: "${filas[0].estado}").`
      );
    }
    const [pagada] = await pool.query('SELECT * FROM facturas WHERE id = ?', [id]);
    return respuestaOk(res, 200, 'Factura marcada como pagada', pagada[0]);
  } catch (error) {
    console.error('[ERROR pagar factura]', error);
    return respuestaError(res, 500, 'Error al pagar la factura');
  }
}

module.exports = { generarFactura, listarFacturas, consultarFactura, pagarFactura };
