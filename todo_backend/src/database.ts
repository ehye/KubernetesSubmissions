import pg from 'pg';
import type { TodoAction } from './status-publisher.js';

export interface Todo {
  id: string;
  text: string;
  done: boolean;
}

export interface TodoStore {
  checkReady(): Promise<void>;
  list(): Promise<Todo[]>;
  create(todo: Todo): Promise<Todo>;
  markDone(id: string): Promise<Todo | undefined>;
}

export function createDatabase(env: NodeJS.ProcessEnv, publish?: (action: TodoAction) => void) {
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

  // Share schema setup across requests, but allow a retry after a database outage.
  let schemaReady: Promise<void> | undefined;
  function ensureSchema() {
    return schemaReady ??= pool.query(`CREATE TABLE IF NOT EXISTS todos (
        position BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
        id UUID PRIMARY KEY,
        text TEXT NOT NULL CHECK (length(btrim(text)) > 0)
      ); ALTER TABLE todos ADD COLUMN IF NOT EXISTS done BOOLEAN NOT NULL DEFAULT FALSE`).then(() => {}).catch(error => {
        schemaReady = undefined;
        throw error;
      });
  }

  return {
    async checkReady() {
      await ensureSchema();
      await pool.query('SELECT 1');
    },
    async list(): Promise<Todo[]> {
      await ensureSchema();
      const result = await pool.query<Todo>('SELECT id, text, done FROM todos ORDER BY position');
      return result.rows;
    },
    async create(todo: Todo): Promise<Todo> {
      await ensureSchema();
      const result = await pool.query<Todo>(
        'INSERT INTO todos (id, text) VALUES ($1, $2) RETURNING id, text, done',
        [todo.id, todo.text],
      );
      publish?.('created');
      return result.rows[0];
    },
    async markDone(id: string): Promise<Todo | undefined> {
      await ensureSchema();
      const result = await pool.query<Todo>(
        'UPDATE todos SET done = TRUE WHERE id = $1 AND NOT done RETURNING id, text, done', [id],
      );
      if (result.rows[0]) {
        publish?.('updated');
        return result.rows[0];
      }
      // An already-completed Todo is a successful PUT, but not another event.
      return (await pool.query<Todo>('SELECT id, text, done FROM todos WHERE id = $1', [id])).rows[0];
    },
    close: () => pool.end(),
  };
}
