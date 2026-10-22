const express = require('express');
const mysql = require('mysql2/promise');
const app = express();
const port = 3000;
// Create the connection pool. The pool-specific settings are the defaults
const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  database: 'adso_68_node_nuevo',
  waitForConnections: true,
  connectionLimit: 10,
  maxIdle: 10, // max idle connections, the default value is the same as `connectionLimit`
  idleTimeout: 60000, // idle connections timeout, in milliseconds, the default value 60000
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

// Tipo,  ruta,  peticion   respuesta
app.get('/api/login', async (req, res) => {
  const { usuario, clave } = req.query; // { usuario: "xxxxxx", clave: "123"}
  try {
    const [rows, fields] = await pool.query('SELECT * FROM usuarios WHERE usuario = ? AND clave = ?',
      [usuario, clave]
    )
    if (rows.length === 0) {
      res.send('Usuario o clave incorrectos');
      return;
    }
    res.send('Bienvenido ' + rows[0].usuario);
  } catch (error) {
    console.error(error);
    res.status(500).send('Error en la consulta a la base de datos');
  }
});

app.get('/api/register', async (req, res) => {
  const { usuario, clave } = req.query; // { usuario: "xxxxxx", clave: "123"}

  try {
    const [rows, fields] = await pool.query('SELECT * FROM usuarios WHERE usuario = ?',
      [usuario]
    )
    if (rows.length > 0) {
      res.send('El usuario ya existe');
      return;
    }
  } catch (error) {
    console.error(error);
    res.status(500).send('Error en la consulta a la base de datos');
  }

  try {
    await pool.query('INSERT INTO usuarios (usuario, clave) VALUES (?, ?)',
      [usuario, clave]
    );
    res.send('Usuario registrado correctamente');
  } catch (error) {
    console.error(error);
    res.status(500).send('Error en la consulta a la base de datos');
  }
});
app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});