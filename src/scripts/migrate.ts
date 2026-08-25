import fs from 'fs';
import path from 'path';
import pool from '../config/db';

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'db', 'migrations');

async function main(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const { rows } = await pool.query<{ name: string }>(
    'SELECT name FROM schema_migrations',
  );
  const applied = new Set(rows.map(r => r.name));

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [
        file,
      ]);
      await client.query('COMMIT');
      console.log(`applied ${file}`);
      ran += 1;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  console.log(
    ran ? `done - ${ran} migration(s) applied` : 'already up to date',
  );
}

main()
  .catch((err: Error) => {
    console.error(`migration failed: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    void pool.end();
  });
