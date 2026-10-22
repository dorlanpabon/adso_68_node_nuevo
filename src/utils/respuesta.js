// Helpers para dar respuestas JSON consistentes en toda la API.
// Toda respuesta mantiene la forma: { ok, mensaje, data }

function respuestaOk(res, estado, mensaje, data = null) {
  return res.status(estado).json({ ok: true, mensaje, data });
}

function respuestaError(res, estado, mensaje, data = null) {
  return res.status(estado).json({ ok: false, mensaje, data });
}

module.exports = { respuestaOk, respuestaError };
