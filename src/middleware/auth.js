const jwt = require('jsonwebtoken');

// En producción define JWT_SECRET en el archivo .env
function obtenerSecreto() {
  return process.env.JWT_SECRET || 'clave-secreta-de-desarrollo-cambiar-en-.env';
}

// Verifica el header "Authorization: Bearer <token>" y agrega req.usuario
// Uso: router.get('/ruta', requerirAuth, controlador)
function requerirAuth(req, res, next) {
  const cabecera = req.headers.authorization || '';
  const [esquema, token] = cabecera.split(' ');

  if (!esquema || esquema.toLowerCase() !== 'bearer' || !token) {
    return res.status(401).json({
      ok: false,
      mensaje: 'No autenticado. Envía el header: Authorization: Bearer <token>',
    });
  }

  try {
    req.usuario = jwt.verify(token, obtenerSecreto()); // { id, usuario, rol }
    return next();
  } catch {
    return res.status(401).json({
      ok: false,
      mensaje: 'Token inválido o expirado. Vuelve a iniciar sesión.',
    });
  }
}

// Bloquea rutas según el rol del usuario autenticado.
// Uso: router.post('/', requerirAuth, requerirRol('admin'), controlador)
function requerirRol(...roles) {
  return (req, res, next) => {
    if (!req.usuario || !roles.includes(req.usuario.rol)) {
      return res.status(403).json({
        ok: false,
        mensaje: `Acceso denegado. Esta operación requiere rol: ${roles.join(' o ')}.`,
      });
    }
    return next();
  };
}

module.exports = { requerirAuth, requerirRol, obtenerSecreto };
