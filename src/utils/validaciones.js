// Validaciones pequeñas y reutilizables (sin dependencias externas)

// Texto (string) con longitud mínima y máxima, ignorando espacios a los lados
function esTexto(valor, min = 1, max = 255) {
  return typeof valor === 'string' && valor.trim().length >= min && valor.trim().length <= max;
}

// Número decimal finito (para precios, montos)
function esDecimal(valor, min = 0) {
  const n = Number(valor);
  return Number.isFinite(n) && n >= min;
}

// Número entero que cumple un mínimo (para cantidades, stock)
function esEntero(valor, min = Number.MIN_SAFE_INTEGER) {
  const n = Number(valor);
  return Number.isInteger(n) && n >= min;
}

// Entero estrictamente mayor a 0 (para ids en la ruta o el cuerpo)
function esEnteroPositivo(valor) {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0;
}

// Extrae pagina/limite/offset de req.query para listados con paginación
function paginar(query = {}, limiteMaximo = 100) {
  const pagina = Math.max(1, Number.parseInt(query.pagina, 10) || 1);
  const limite = Math.min(limiteMaximo, Math.max(1, Number.parseInt(query.limite, 10) || 10));
  return { pagina, limite, offset: (pagina - 1) * limite };
}

module.exports = { esTexto, esDecimal, esEntero, esEnteroPositivo, paginar };
