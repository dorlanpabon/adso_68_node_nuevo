// Restaura la base de datos ejecutando database/adso_68_node_nuevo.sql
// Uso: npm run db:restaurar  (requiere MySQL de XAMPP encendido)
//
// Si ya existía una tabla usuarios con el esquema antiguo (id firmado,
// sin nombre/rol y claves en texto plano), se migra automáticamente:
//  - se ajusta el tipo del id para las llaves foráneas nuevas
//  - se agregan las columnas nombre y rol
//  - las claves en texto plano se cifran con bcrypt (el usuario conserva su clave)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const DB = process.env.DB_NAME || 'adso_68_node_nuevo';

async function migrarUsuariosAntiguo(conn) {
  const [tablas] = await conn.query(
    'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ? AND table_name = ?',
    [DB, 'usuarios']
  );
  if (tablas[0].n === 0) return; // instalación nueva: el SQL crea todo

  const [columnas] = await conn.query('SHOW COLUMNS FROM ??.usuarios', [DB]);
  const nombres = columnas.map((c) => c.Field);

  if (nombres.includes('nombre') && nombres.includes('rol') && nombres.includes('creado_en')) {
    return; // ya corresponde al esquema nuevo
  }

  console.log('Tabla usuarios antigua detectada: migrando...');
  await conn.query('ALTER TABLE ??.usuarios MODIFY id INT UNSIGNED NOT NULL AUTO_INCREMENT', [DB]);
  if (!nombres.includes('nombre')) {
    await conn.query('ALTER TABLE ??.usuarios ADD COLUMN nombre VARCHAR(100) NULL AFTER id', [DB]);
  }
  if (!nombres.includes('rol')) {
    await conn.query("ALTER TABLE ??.usuarios ADD COLUMN rol ENUM('admin','vendedor') NOT NULL DEFAULT 'vendedor'", [DB]);
  }
  if (!nombres.includes('creado_en')) {
    await conn.query('ALTER TABLE ??.usuarios ADD COLUMN creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP', [DB]);
  }
  await conn.query("UPDATE ??.usuarios SET nombre = usuario WHERE nombre IS NULL OR nombre = ''", [DB]);
  await conn.query('ALTER TABLE ??.usuarios MODIFY nombre VARCHAR(100) NOT NULL', [DB]);
  await conn.query("UPDATE ??.usuarios SET rol = 'admin' WHERE usuario = 'admin'", [DB]);

  // Cifra las claves que estaban en texto plano
  const [filas] = await conn.query('SELECT id, clave FROM ??.usuarios', [DB]);
  let cifradas = 0;
  for (const f of filas) {
    if (f.clave && !f.clave.startsWith('$2')) {
      const hash = await bcrypt.hash(f.clave, 10);
      await conn.query('UPDATE ??.usuarios SET clave = ? WHERE id = ?', [DB, hash, f.id]);
      cifradas += 1;
    }
  }
  console.log(`Migración completa. Claves cifradas con bcrypt: ${cifradas}`);
}

async function main() {
  const archivo = path.join(__dirname, '..', '..', 'database', 'adso_68_node_nuevo.sql');
  const sql = fs.readFileSync(archivo, 'utf8');

  // Conexión sin database: el script crea la base de datos si no existe
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  });

  try {
    const [dbs] = await conn.query('SELECT 1 FROM information_schema.schemata WHERE schema_name = ?', [DB]);
    if (dbs.length > 0) {
      await migrarUsuariosAntiguo(conn);
    } else {
      console.log(`Base "${DB}" no existía: se creará desde cero con el script SQL.`);
    }

    await conn.query(sql);
    console.log('Base de datos creada/restaurada correctamente.');
    console.log('Cuentas semilla (solo en instalación nueva): admin/admin123 y vendedor/vendedor123.');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('No se pudo restaurar la base de datos:', err.message);
  console.error('Asegúrate de que MySQL esté corriendo en el Panel de XAMPP.');
  process.exit(1);
});
