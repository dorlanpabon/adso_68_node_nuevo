require('dotenv').config();
const mysql = require('mysql2/promise');

// Pool de conexiones a MySQL (XAMPP por defecto: root sin clave)
// Las credenciales se pueden sobrescribir con un archivo .env
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'adso_68_node_nuevo',
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL_LIMIT) || 10,
  maxIdle: 10, // máximo de conexiones inactivas
  idleTimeout: 60000, // tiempo de espera de conexiones inactivas (ms)
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  // Evita que los DECIMAL (precios, totales) lleguen como strings
  decimalNumbers: true,
});

module.exports = pool;
