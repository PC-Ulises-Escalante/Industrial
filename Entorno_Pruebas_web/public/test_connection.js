const { Pool } = require('pg');
require('dotenv').config();

console.log('Testing connection to:', process.env.DATABASE_URL);

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

pool.connect()
    .then(client => {
        console.log('✅ Connected successfully to PostgreSQL');
        return client.query('SELECT version()').then(res => {
            console.log('PostgreSQL version:', res.rows[0].version);
            client.release();
        });
    })
    .catch(err => {
        console.error('❌ Connection error:', err.message);
        console.error('Full error:', err);
    })
    .finally(() => {
        pool.end();
    });