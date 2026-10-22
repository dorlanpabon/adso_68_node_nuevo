// Prueba de humo: recorre el flujo completo de la API contra http://localhost:3000
// Uso: 1) npm start (en una terminal)   2) npm run prueba (en otra)
const BASE = process.env.BASE_URL || 'http://localhost:3000/api';

const tokenVendedor = { valor: '' };
const tokenAdmin = { valor: '' };

let pruebas = 0;
let fallos = 0;

function checar(nombre, condicion, detalle = '') {
  pruebas += 1;
  if (condicion) console.log(`  PASS ${nombre}`);
  else {
    fallos += 1;
    console.log(`  FAIL ${nombre} ${detalle}`);
  }
}

async function llamar(metodo, ruta, { cuerpo, token } = {}) {
  const res = await fetch(BASE + ruta, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  let datos = null;
  try { datos = await res.json(); } catch { /* sin cuerpo */ }
  console.log(`\n${metodo} ${ruta} -> ${res.status}`);
  return { estado: res.status, datos };
}

(async () => {
  const sufijo = Date.now().toString(36);

  console.log('\n== AUTH ==');
  let r = await llamar('POST', '/auth/register', { cuerpo: { nombre: 'QA Demo', usuario: `qa_${sufijo}`, clave: 'secret123' } });
  checar('register crea usuario (201)', r.estado === 201, JSON.stringify(r.datos));
  checar('register no devuelve la clave/hash', r.datos?.data?.usuario?.clave === undefined);

  r = await llamar('POST', '/auth/register', { cuerpo: { nombre: 'QA Demo', usuario: `qa_${sufijo}`, clave: 'secret123' } });
  checar('register duplicado (409)', r.estado === 409);

  r = await llamar('POST', '/auth/register', { cuerpo: { nombre: 'x', usuario: 'aq', clave: '123' } });
  checar('register con datos inválidos (400)', r.estado === 400);

  r = await llamar('POST', '/auth/login', { cuerpo: { usuario: `qa_${sufijo}`, clave: 'incorrecta' } });
  checar('login con clave errada (401)', r.estado === 401);

  r = await llamar('POST', '/auth/login', { cuerpo: { usuario: `qa_${sufijo}`, clave: 'secret123' } });
  checar('login devuelve token (200)', r.estado === 200 && typeof r.datos?.data?.token === 'string');
  tokenVendedor.valor = r.datos?.data?.token || '';

  // El admin semilla usa admin123; si migraste usuarios antiguos puede tener otra clave
  r = await llamar('POST', '/auth/login', { cuerpo: { usuario: 'admin', clave: 'admin123' } });
  if (r.estado !== 200 || !r.datos?.data?.token) {
    r = await llamar('POST', '/auth/login', { cuerpo: { usuario: 'admin', clave: '123' } });
  }
  checar('login admin (200 + token y rol admin)', r.estado === 200 && r.datos?.data?.usuario?.rol === 'admin');
  tokenAdmin.valor = r.datos?.data?.token || '';

  r = await llamar('GET', '/auth/perfil', { token: tokenVendedor.valor });
  checar('perfil con token (200)', r.estado === 200);

  r = await llamar('GET', '/auth/perfil', {});
  checar('perfil sin token (401)', r.estado === 401);

  r = await llamar('POST', '/login', { cuerpo: { usuario: 'admin', clave: 'admin123' } });
  if (r.estado !== 200 || !r.datos?.data?.token) {
    r = await llamar('POST', '/login', { cuerpo: { usuario: 'admin', clave: '123' } });
  }
  checar('ruta antigua /api/login sigue activa (200)', r.estado === 200);

  console.log('\n== PRODUCTOS ==');
  r = await llamar('POST', '/productos', { cuerpo: { nombre: 'Panela', precio: 4500 } });
  checar('crear producto sin token (401)', r.estado === 401);

  r = await llamar('POST', '/productos', { cuerpo: { nombre: 'Panela', precio: 4500 }, token: tokenVendedor.valor });
  checar('crear producto sin rol admin (403)', r.estado === 403);

  r = await llamar('POST', '/productos', {
    cuerpo: { nombre: `Panela QA ${sufijo}`, descripcion: 'Panela redonda por unidad', precio: 4500, stock: 12, categoria: 'Dulces' },
    token: tokenAdmin.valor,
  });
  checar('crear producto (201)', r.estado === 201, JSON.stringify(r.datos));
  const panela = r.datos?.data?.id;

  r = await llamar('POST', '/productos', { cuerpo: { nombre: 'X', precio: 'hola' }, token: tokenAdmin.valor });
  checar('crear producto inválido (400)', r.estado === 400);

  r = await llamar('GET', '/productos?limite=5', { token: tokenVendedor.valor });
  checar('listar productos (200 + paginación)', r.estado === 200 && Array.isArray(r.datos?.data?.productos) && r.datos?.data?.paginacion?.total >= 1);

  r = await llamar('GET', `/productos?nombre=${encodeURIComponent(`Panela QA ${sufijo}`)}`, { token: tokenVendedor.valor });
  checar('filtro por nombre (1 resultado)', r.estado === 200 && r.datos?.data?.productos?.length === 1);

  r = await llamar('GET', `/productos/${panela}`, { token: tokenVendedor.valor });
  checar('consultar producto (200)', r.estado === 200 && r.datos?.data?.id === panela);

  r = await llamar('GET', '/productos/999999', { token: tokenVendedor.valor });
  checar('consultar producto inexistente (404)', r.estado === 404);

  r = await llamar('PUT', `/productos/${panela}`, { cuerpo: { precio: 4800 }, token: tokenAdmin.valor });
  checar('actualizar precio (200 y precio 4800)', r.estado === 200 && Number(r.datos?.data?.precio) === 4800);

  r = await llamar('POST', '/productos', {
    cuerpo: { nombre: `Cafe QA ${sufijo}`, precio: 18000, stock: 30, categoria: 'Bebidas' },
    token: tokenAdmin.valor,
  });
  const cafe = r.datos?.data?.id;

  console.log('\n== PEDIDOS ==');
  r = await llamar('POST', '/pedidos', {
    cuerpo: { cliente: 'Doña Mercedes', items: [{ producto_id: panela, cantidad: 4 }, { producto_id: cafe, cantidad: 2 }] },
    token: tokenVendedor.valor,
  });
  checar('crear pedido (201)', r.estado === 201, JSON.stringify(r.datos));
  checar('total pedido = 4*4800 + 2*18000 = 55200', Number(r.datos?.data?.total) === 55200);
  const pedido = r.datos?.data?.id;

  r = await llamar('GET', `/pedidos/${pedido}`, { token: tokenVendedor.valor });
  checar('consultar pedido (200, 2 items)', r.estado === 200 && r.datos?.data?.items?.length === 2);

  r = await llamar('GET', `/productos/${panela}`, { token: tokenVendedor.valor });
  checar('stock descontado a 8 (12 - 4)', r.datos?.data?.stock === 8);

  r = await llamar('POST', '/pedidos', {
    cuerpo: { cliente: 'Alguien', items: [{ producto_id: panela, cantidad: 999 }] },
    token: tokenVendedor.valor,
  });
  checar('pedido con stock insuficiente (409)', r.estado === 409);

  r = await llamar('PUT', `/pedidos/${pedido}/estado`, { cuerpo: { estado: 'confirmado' }, token: tokenVendedor.valor });
  checar('confirmar pedido (200)', r.estado === 200 && r.datos?.data?.estado === 'confirmado');

  r = await llamar('PUT', `/pedidos/${pedido}/estado`, { cuerpo: { estado: 'entregado' }, token: tokenVendedor.valor });
  checar('entregar pedido (200)', r.estado === 200 && r.datos?.data?.estado === 'entregado');

  r = await llamar('PUT', `/pedidos/${pedido}/estado`, { cuerpo: { estado: 'confirmado' }, token: tokenVendedor.valor });
  checar('transición inválida entregado->confirmado (409)', r.estado === 409);

  r = await llamar('DELETE', `/pedidos/${pedido}`, { token: tokenAdmin.valor });
  checar('eliminar pedido activo (409, solo cancelados)', r.estado === 409);

  console.log('\n== FACTURAS ==');
  r = await llamar('POST', '/facturas', { cuerpo: { pedido_id: pedido }, token: tokenAdmin.valor });
  checar('generar factura (201)', r.estado === 201, JSON.stringify(r.datos));
  checar('factura: subtotal 55200, iva 19% = 10488, total 65688',
    Number(r.datos?.data?.subtotal) === 55200 && Number(r.datos?.data?.iva) === 10488 && Number(r.datos?.data?.total) === 65688);
  checar('pedido quedó en estado facturado', r.datos?.data?.pedido_estado === 'facturado');
  const factura = r.datos?.data?.id;

  r = await llamar('POST', '/facturas', { cuerpo: { pedido_id: pedido }, token: tokenAdmin.valor });
  checar('facturar el mismo pedido otra vez (409)', r.estado === 409);

  r = await llamar('GET', `/facturas/${factura}`, { token: tokenVendedor.valor });
  checar('consultar factura (200, número F-XXXXXX)', r.estado === 200 && String(r.datos?.data?.numero || '').startsWith('F-'));

  r = await llamar('PUT', `/facturas/${factura}/pagar`, { token: tokenAdmin.valor });
  checar('pagar factura (200, estado pagada)', r.estado === 200 && r.datos?.data?.estado === 'pagada');

  r = await llamar('PUT', `/facturas/${factura}/pagar`, { token: tokenAdmin.valor });
  checar('pagar factura otra vez (409)', r.estado === 409);

  r = await llamar('GET', '/facturas', { token: tokenVendedor.valor });
  checar('listar facturas (>= 1)', r.estado === 200 && r.datos?.data?.facturas?.length >= 1);

  console.log('\n== INVENTARIO ==');
  r = await llamar('GET', '/inventario', { token: tokenVendedor.valor });
  checar('stock actual (>= 2 productos)', r.estado === 200 && r.datos?.data?.stock?.length >= 2);

  r = await llamar('GET', `/inventario/movimientos?producto_id=${panela}&tipo=salida`, { token: tokenVendedor.valor });
  checar('kardex: salida del pedido (>= 1)', r.estado === 200 && r.datos?.data?.movimientos?.length >= 1);

  r = await llamar('POST', '/inventario/movimientos', {
    cuerpo: { producto_id: panela, tipo: 'entrada', cantidad: 20, motivo: 'Compra proveedor' },
    token: tokenAdmin.valor,
  });
  checar('entrada de inventario (201, stock 28)', r.estado === 201 && r.datos?.data?.stock_actual === 28);

  r = await llamar('POST', '/inventario/movimientos', {
    cuerpo: { producto_id: panela, tipo: 'ajuste', cantidad: -1, motivo: 'Producto dañado' },
    token: tokenAdmin.valor,
  });
  checar('ajuste de inventario (stock 27)', r.estado === 201 && r.datos?.data?.stock_actual === 27);

  r = await llamar('POST', '/inventario/movimientos', {
    cuerpo: { producto_id: panela, tipo: 'ajuste', cantidad: 2 },
    token: tokenAdmin.valor,
  });
  checar('ajuste sin motivo (400)', r.estado === 400);

  r = await llamar('POST', '/inventario/movimientos', {
    cuerpo: { producto_id: panela, tipo: 'entrada', cantidad: 1 },
    token: tokenVendedor.valor,
  });
  checar('movimiento sin rol admin (403)', r.estado === 403);

  console.log('\n== PEDIDO CANCELADO: devuelve stock y permite eliminar ==');
  r = await llamar('POST', '/pedidos', {
    cuerpo: { cliente: 'Cancelaré este', items: [{ producto_id: cafe, cantidad: 1 }] },
    token: tokenVendedor.valor,
  });
  const pedido2 = r.datos?.data?.id;

  r = await llamar('PUT', `/pedidos/${pedido2}/estado`, { cuerpo: { estado: 'cancelado' }, token: tokenVendedor.valor });
  checar('cancelar pedido (200)', r.estado === 200 && r.datos?.data?.estado === 'cancelado');

  r = await llamar('GET', `/productos/${cafe}`, { token: tokenVendedor.valor });
  checar('stock de café restaurado a 28 (30 - 2 en pedido 1)', r.datos?.data?.stock === 28);

  r = await llamar('DELETE', `/pedidos/${pedido2}`, { token: tokenAdmin.valor });
  checar('eliminar pedido cancelado (200)', r.estado === 200);

  console.log('\n== ELIMINAR PRODUCTOS ==');
  r = await llamar('DELETE', `/productos/${panela}`, { token: tokenAdmin.valor });
  checar('eliminar producto usado en pedidos (409 con sugerencia)', r.estado === 409);

  r = await llamar('POST', '/productos', {
    cuerpo: { nombre: `Temporal QA ${sufijo}`, precio: 1000 },
    token: tokenAdmin.valor,
  });
  const temporal = r.datos?.data?.id;
  r = await llamar('DELETE', `/productos/${temporal}`, { token: tokenAdmin.valor });
  checar('eliminar producto sin referencias (200)', r.estado === 200);

  console.log(`\nRESULTADO: ${pruebas - fallos}/${pruebas} pruebas OK, ${fallos} fallas`);
  process.exit(fallos > 0 ? 1 : 0);
})().catch((e) => {
  console.error('Error ejecutando la prueba:', e);
  process.exit(1);
});
