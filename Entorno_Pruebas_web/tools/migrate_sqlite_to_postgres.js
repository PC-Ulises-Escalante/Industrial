#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const PG = require(path.join(__dirname, '..', 'lib', 'pg'));

(async function main() {
  const args = process.argv.slice(2);
  const dbArgIndex = args.indexOf('--db');
  const dbPath = dbArgIndex >= 0 && args[dbArgIndex + 1]
    ? path.resolve(process.cwd(), args[dbArgIndex + 1])
    : path.join(__dirname, '..', 'database.sqlite');
  const clean = args.includes('--clean') || args.includes('-c');

  if (!process.env.DATABASE_URL) {
    console.error('ERROR: Please set DATABASE_URL environment variable before running this script.');
    process.exit(1);
  }

  if (!fs.existsSync(dbPath)) {
    console.error('ERROR: sqlite file not found at', dbPath);
    process.exit(1);
  }

  console.log('Loading sqlite from', dbPath);
  const SQL = await initSqlJs();
  const fileBuffer = fs.readFileSync(dbPath);
  const sqliteDb = new SQL.Database(fileBuffer);

  const client = await PG.getClient();

  try {
    await client.query('BEGIN');

    if (clean) {
      const trunc = [
        'conferencias_inscripciones','conferencia_qr_codes','asistencias_conferencias',
        'deportes_equipo_integrantes','asistencias_deportes','proyecto_integrantes',
        'proyectos_qr_codes','deportes_qr_codes','deportes_equipos','proyectos',
        'ponentes','users'
      ];
      console.log('Truncating target tables (RESTART IDENTITY CASCADE)');
      await client.query('TRUNCATE ' + trunc.join(',') + ' RESTART IDENTITY CASCADE');
    } else {
      const checkTables = ['users','ponentes','conferencias','proyectos','deportes_equipos'];
      for (const t of checkTables) {
        const res = await client.query(`SELECT COUNT(1)::int AS c FROM ${t}`);
        if (res.rows[0].c > 0) {
          console.error(`Table ${t} is not empty. Run with --clean to truncate before migrating.`);
          await client.query('ROLLBACK');
          process.exit(1);
        }
      }
    }

    function selectAllSqlite(table) {
      const res = sqliteDb.exec(`SELECT * FROM ${table}`);
      if (!res || res.length === 0) return [];
      const { columns, values } = res[0];
      return values.map(row => {
        const obj = {};
        columns.forEach((c, i) => { obj[c] = row[i] === undefined ? null : row[i]; });
        return obj;
      });
    }

    async function getPgColumns(table) {
      const r = await client.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
        [table]
      );
      return r.rows.map(r => r.column_name);
    }

    async function insertRows(table, rows) {
      if (!rows || rows.length === 0) {
        console.log(`No rows for ${table}`);
        return;
      }
      const pgCols = await getPgColumns(table);
      const toInsertCols = Object.keys(rows[0]).filter(c => pgCols.includes(c));
      if (toInsertCols.length === 0) { console.log(`No matching columns to insert for ${table}`); return; }
      const colList = toInsertCols.map(c => `"${c}"`).join(', ');
      for (const row of rows) {
        const vals = toInsertCols.map(c => row[c] === undefined ? null : row[c]);
        const placeholders = vals.map((_, i) => '$' + (i + 1)).join(', ');
        const q = `INSERT INTO ${table} (${colList}) VALUES (${placeholders})`;
        await client.query(q, vals);
      }
      console.log(`Inserted ${rows.length} rows into ${table}`);
    }

    const order = [
      'users','ponentes','conferencias','proyectos','deportes_equipos',
      'conferencias_inscripciones','conferencia_qr_codes','asistencias_conferencias',
      'deportes_qr_codes','asistencias_deportes','proyecto_integrantes','proyectos_qr_codes','deportes_equipo_integrantes'
    ];

    for (const t of order) {
      try {
        const rows = selectAllSqlite(t);
        await insertRows(t, rows);
      } catch (err) {
        console.warn(`Skipping table ${t} due to error:`, err.message || err);
      }
    }

    const seqTables = [
      'users','ponentes','conferencias','proyectos','deportes_equipos',
      'conferencias_inscripciones','conferencia_qr_codes','asistencias_conferencias',
      'deportes_qr_codes','asistencias_deportes','proyecto_integrantes','proyectos_qr_codes','deportes_equipo_integrantes'
    ];
    for (const t of seqTables) {
      try {
        const seqName = `${t}_id_seq`;
        await client.query('SELECT setval($1, (SELECT COALESCE(MAX(id), 1) FROM ' + t + '))', [seqName]);
      } catch (err) {
        // ignore sequence/table missing
      }
    }

    await client.query('COMMIT');
    console.log('Migration completed successfully.');
  } catch (err) {
    await client.query('ROLLBACK').catch(()=>{});
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    client.release();
  }

})().catch(err => { console.error(err); process.exit(1); });
