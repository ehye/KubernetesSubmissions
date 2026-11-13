import pg from 'pg';

export interface Todo {
  id: string;
  text: string;
}

export interface TodoStore {
  list(): Promise<Todo[]>;
  create(todo: Todo): Promise<Todo>;
}

export function createDatabase(env: NodeJS.ProcessEnv) {
  for (const name of ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD']) {
    if (!env[name]?.trim()) throw new Error(`${name} is required`);
  }
  if (!/^\d+$/.test(env.PGPORT!) || Number(env.PGPORT) < 1 || Number(env.PGPORT) > 65535) {
    throw new Error('PGPORT must be an integer between 1 and 65535');
  }
  function timeout(name: string): number {
    const value = env[name];
    if (!value || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > 2_147_483_647) {
      throw new Error(`${name} must be a positive integer no larger than 2147483647`);
    }
    return Number(value);
  }
  const pool = new pg.Pool({
    host: env.PGHOST, port: Number(env.PGPORT), database: env.PGDATABASE,
    user: env.PGUSER, password: env.PGPASSWORD,
    connectionTimeoutMillis: timeout('PGCONNECT_TIMEOUT_MS'),
    statement_timeout: timeout('PGSTATEMENT_TIMEOUT_MS'),
  });
  pool.on('error', () => console.error('PostgreSQL connection lost'));

  return {
    async initialize() {
      // The sequence gives a stable insertion order without exposing it in the API.
      await pool.query(`CREATE TABLE IF NOT EXISTS todos (
        position BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
        id UUID PRIMARY KEY,
        text TEXT NOT NULL CHECK (length(btrim(text)) > 0)
      )`);
    },
    async list(): Promise<Todo[]> {
      const result = await pool.query<Todo>('SELECT id, text FROM todos ORDER BY position');
      return result.rows;
    },
    async create(todo: Todo): Promise<Todo> {
      const result = await pool.query<Todo>(
        'INSERT INTO todos (id, text) VALUES ($1, $2) RETURNING id, text',
        [todo.id, todo.text],
      );
      return result.rows[0];
    },
    close: () => pool.end(),
  };
}
