// Manejadores globales: rutas inexistentes (404) y errores no capturados (500)

function noEncontrado(req, res) {
  return res.status(404).json({
    ok: false,
    mensaje: `Ruta no encontrada: ${req.method} ${req.originalUrl}`,
  });
}

function manejadorErrores(err, req, res, _next) {
  // Body JSON malformado
  if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ ok: false, mensaje: 'El cuerpo de la petición no es JSON válido' });
  }
  console.error('[ERROR]', err);
  if (!res.headersSent) {
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor' });
  }
}

module.exports = { noEncontrado, manejadorErrores };
