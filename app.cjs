require('dotenv').config();
const express = require('express');
const rutas = require('./src/routes');
const { noEncontrado, manejadorErrores } = require('./src/middleware/error');

const app = express();
const port = Number(process.env.PORT) || 3000;

// Middleware para parsear JSON
app.use(express.json());

// Registro simple de peticiones en consola
app.use((req, res, next) => {
  res.on('finish', () => console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode}`));
  next();
});

// Todas las rutas cuelgan de /api
app.use('/api', rutas);

// Rutas inexistentes y manejador global de errores (siempre al final)
app.use(noEncontrado);
app.use(manejadorErrores);

app.listen(port, () => {
  console.log(`API escuchando en http://localhost:${port}/api`);
  console.log('Prueba rápida: GET http://localhost:' + port + '/api/auth/perfil (con token)');
});
