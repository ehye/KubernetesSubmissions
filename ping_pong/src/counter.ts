import pg from 'pg';

export interface Counter {
  read(): Promise<string>;
  increment(): Promise<string>;
}

export function createDatabase(env: NodeJS.ProcessEnv) {
  for (const name of ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD']) {
    if (!env[name]?.trim()) throw new Error(`${name} is required`);
  }
  if (!/^\d+$/.test(env.PGPORT!) || Number(env.PGPORT) < 1 || Number(env.PGPORT) > 65535) {
    throw new Error('PGPORT must be an integer between 1 and 65535');
  }
  const pool = new pg.Pool({
    host: env.PGHOST, port: Number(env.PGPORT), database: env.PGDATABASE,
    user: env.PGUSER, password: env.PGPASSWORD,
    connectionTimeoutMillis: 2_000,
    statement_timeout: 2_000,
  });
  pool.on('error', () => console.error('PostgreSQL connection lost'));

  return {
    async initialize() {
      await pool.query(`CREATE TABLE IF NOT EXISTS ping_counter (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        value BIGINT NOT NULL CHECK (value >= 0)
      )`);
      await pool.query('INSERT INTO ping_counter (id, value) VALUES (1, 0) ON CONFLICT (id) DO NOTHING');
    },
    async read() {
      const result = await pool.query('SELECT value::text AS value FROM ping_counter WHERE id = 1');
      if (!result.rows[0]) throw new Error('Counter row is missing');
      return result.rows[0].value as string;
    },
    async increment() {
      // A single UPDATE locks the row, preventing lost updates across requests/Pods.
      const result = await pool.query('UPDATE ping_counter SET value = value + 1 WHERE id = 1 RETURNING (value - 1)::text AS value');
      if (!result.rows[0]) throw new Error('Counter row is missing');
      return result.rows[0].value as string;
    },
    close: () => pool.end(),
  };
}
