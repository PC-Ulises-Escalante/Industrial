const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

(async () => {
  try {
    const SQL = await initSqlJs();
    const dbPath = path.join(__dirname, '..', 'database.sqlite');
    if (!fs.existsSync(dbPath)) {
      console.error('No se encontró la base de datos en', dbPath);
      process.exit(1);
    }
    const fileBuffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(fileBuffer);
    const res = db.exec("SELECT id, nombre, email, rol, created_at FROM users ORDER BY id DESC LIMIT 10");
    if (!res || res.length === 0) {
      console.log('No hay usuarios registrados.');
      process.exit(0);
    }
    const cols = res[0].columns;
    const values = res[0].values;
    const rows = values.map(v => {
      const r = {};
      cols.forEach((c, i) => r[c] = v[i]);
      return r;
    });
    console.log(JSON.stringify(rows, null, 2));
  } catch (err) {
    console.error('Error al leer la BD:', err);
    process.exit(1);
  }
})();
