const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { respuestaOk, respuestaError } = require('../utils/respuesta');
const { esTexto } = require('../utils/validaciones');
const { obtenerSecreto } = require('../middleware/auth');

// Al registrarse siempre se crea un "vendedor"; el rol "admin" solo se
// asigna manualmente en la base de datos (buena práctica de seguridad).
const ROL_DEFECTO = 'vendedor';

// Registro de usuario (público)
async function registrarse(req, res) {
  const { nombre, usuario, clave } = req.body ?? {};

  const errores = [];
  if (!esTexto(nombre, 2, 100)) {
    errores.push('El campo nombre es obligatorio (2 a 100 caracteres).');
  }
  if (!esTexto(usuario, 3, 50) || !/^[a-zA-Z0-9_.-]+$/.test(usuario)) {
    errores.push('El campo usuario debe tener de 3 a 50 caracteres (letras, números, punto, guion o guion bajo).');
  }
  if (!esTexto(clave, 6, 72)) {
    errores.push('El campo clave es obligatorio (mínimo 6 caracteres).');
  }
  if (errores.length > 0) {
    return respuestaError(res, 400, 'Datos inválidos', errores);
  }

  try {
    const [existe] = await pool.query(
      'SELECT id FROM usuarios WHERE usuario = ? LIMIT 1',
      [usuario.trim()]
    );
    if (existe.length > 0) {
      return respuestaError(res, 409, 'El usuario ya existe. Prueba con otro nombre de usuario.');
    }

    // Nunca se guarda la clave en texto plano: se cifra con bcrypt
    const hash = await bcrypt.hash(clave, 10);
    const [resultado] = await pool.query(
      'INSERT INTO usuarios (nombre, usuario, clave, rol) VALUES (?, ?, ?, ?)',
      [nombre.trim(), usuario.trim(), hash, ROL_DEFECTO]
    );

    const [creado] = await pool.query(
      'SELECT id, nombre, usuario, rol FROM usuarios WHERE id = ?',
      [resultado.insertId]
    );

    // Se entrega un token listo para usar, como en el login
    const token = jwt.sign(
      { id: creado[0].id, usuario: creado[0].usuario, rol: creado[0].rol },
      obtenerSecreto(),
      { expiresIn: '8h' }
    );

    return respuestaOk(res, 201, 'Usuario registrado correctamente', {
      usuario: creado[0],
      token,
    });
  } catch (error) {
    console.error('[ERROR registro]', error);
    return respuestaError(res, 500, 'Error al registrar el usuario');
  }
}

// Inicio de sesión (público): valida credenciales y devuelve un JWT
async function iniciarSesion(req, res) {
  const { usuario, clave } = req.body ?? {};
  if (!esTexto(usuario, 1, 50) || !esTexto(clave, 1, 72)) {
    return respuestaError(res, 400, 'Envía los campos usuario y clave en el cuerpo JSON.');
  }

  try {
    const [filas] = await pool.query(
      'SELECT id, nombre, usuario, clave, rol FROM usuarios WHERE usuario = ? LIMIT 1',
      [usuario.trim()]
    );
    const u = filas[0];

    // Mensaje único para no revelar si el usuario existe o la clave falló
    if (!u || !(await bcrypt.compare(clave, u.clave))) {
      return respuestaError(res, 401, 'Usuario o clave incorrectos.');
    }

    const token = jwt.sign(
      { id: u.id, usuario: u.usuario, rol: u.rol },
      obtenerSecreto(),
      { expiresIn: '8h' } // expira en 8 horas
    );

    return respuestaOk(res, 200, `Bienvenido ${u.nombre}`, {
      token,
      usuario: { id: u.id, nombre: u.nombre, usuario: u.usuario, rol: u.rol },
    });
  } catch (error) {
    console.error('[ERROR login]', error);
    return respuestaError(res, 500, 'Error al iniciar sesión');
  }
}

// Perfil del usuario autenticado (requiere token)
async function perfil(req, res) {
  try {
    const [filas] = await pool.query(
      'SELECT id, nombre, usuario, rol, creado_en FROM usuarios WHERE id = ?',
      [req.usuario.id]
    );
    if (filas.length === 0) {
      return respuestaError(res, 404, 'El usuario del token ya no existe.');
    }
    return respuestaOk(res, 200, 'Perfil del usuario autenticado', filas[0]);
  } catch (error) {
    console.error('[ERROR perfil]', error);
    return respuestaError(res, 500, 'Error al consultar el perfil');
  }
}

module.exports = { registrarse, iniciarSesion, perfil };
