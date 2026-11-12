import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { createApp, parsePort } from '../dist/server.js';
import { createDatabase } from '../dist/counter.js';
import pg from 'pg';

const databaseTests = { skip: process.env.TEST_DATABASE !== '1', timeout: 15_000 };

async function resetDatabase() {
  const database = createDatabase(process.env);
  try { await database.initialize(); } finally { await database.close(); }
  const pool = new pg.Pool();
  try { await pool.query('UPDATE ping_counter SET value = 0 WHERE id = 1'); }
  finally { await pool.end(); }
}

async function startApp(t, counter) {
  if (!counter) {
    // HTTP unit-test fixture only; production always uses PostgreSQL.
    let value = 0n;
    counter = { read: async () => String(value), increment: async () => String(value++) };
  }
  const server = createApp(counter);
  t.after(() => { server.closeAllConnections(); server.close(); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

async function startProcess(t) {
  const child = spawn(process.execPath, ['dist/index.js'], {
    cwd: new URL('../', import.meta.url),
    env: { ...process.env, PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    }
  });
  const output = createInterface({ input: child.stdout });
  t.after(() => output.close());
  const [line] = await once(output, 'line');
  const match = /^Server started in port (\d+)$/.exec(line);
  assert.ok(match, line);
  return { child, base: `http://127.0.0.1:${match[1]}` };
}

async function stopProcess(child, signal = 'SIGTERM') {
  const exited = once(child, 'exit');
  child.kill(signal);
  assert.deepEqual(await exited, [0, null]);
}

test('validates PORT and defaults to 3000', () => {
  assert.equal(parsePort(undefined), 3000);
  assert.equal(parsePort('8080'), 8080);
  assert.equal(parsePort('0'), 0);
  for (const value of ['', ' ', '-1', '65536', '3.5', '3000abc', 'NaN']) {
    assert.throws(() => parsePort(value), /PORT must be an integer/);
  }
});

test('GET /pings returns zero initially and never increments the total', { timeout: 5000 }, async t => {
  const base = await startApp(t);
  for (const path of ['/pings', '/pings', '/pings?example=1']) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(await response.text(), '0');
  }
});

test('GET /pingpong increments the total exposed by /pings', { timeout: 5000 }, async t => {
  const base = await startApp(t);
  for (let count = 0; count < 3; count++) {
    assert.equal(await (await fetch(`${base}/pingpong`)).text(), `pong ${count}`);
    assert.equal(await (await fetch(`${base}/pings`)).text(), String(count + 1));
  }
  assert.equal(await (await fetch(`${base}/pings`)).text(), '3');
});

test('other paths and methods do not increment the total', { timeout: 5000 }, async t => {
  const base = await startApp(t);
  const missing = await fetch(`${base}/`);
  assert.equal(missing.status, 404);
  await missing.text();
  for (const path of ['/pingpong', '/pings']) {
    const response = await fetch(`${base}${path}`, { method: 'POST' });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET');
    await response.text();
  }
  assert.equal(await (await fetch(`${base}/pings`)).text(), '0');
});

test('concurrent requests receive distinct counts', { timeout: 5000 }, async t => {
  const base = await startApp(t);
  const counts = await Promise.all(Array.from({ length: 10 }, async () => {
    const response = await fetch(`${base}/pingpong`);
    assert.equal(response.status, 200);
    return Number((await response.text()).slice(5));
  }));
  assert.deepEqual(counts.sort((a, b) => a - b), Array.from({ length: 10 }, (_, i) => i));
  assert.equal(await (await fetch(`${base}/pings`)).text(), '10');
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  test(`starts and shuts down cleanly on ${signal}`, databaseTests, async t => {
    await resetDatabase();
    const { child, base } = await startProcess(t);
    assert.equal(await (await fetch(`${base}/pingpong`)).text(), 'pong 0');
    assert.equal(await (await fetch(`${base}/pings`)).text(), '1');
    await stopProcess(child, signal);
  });
}

test('process restart preserves the database count', databaseTests, async t => {
  await resetDatabase();
  for (let run = 0; run < 2; run++) {
    const { child, base } = await startProcess(t);
    assert.equal(await (await fetch(`${base}/pings`)).text(), String(run));
    assert.equal(await (await fetch(`${base}/pingpong`)).text(), `pong ${run}`);
    await stopProcess(child);
  }
});

test('database failures return 503 and requests can recover', async t => {
  t.mock.method(console, 'error', () => {});
  let failed = true;
  const read = async () => {
    if (failed) throw new Error('offline');
    return '7';
  };
  const base = await startApp(t, { read, increment: read });
  for (const path of ['/pings', '/pingpong']) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 503);
    assert.equal(await response.text(), 'Counter database is temporarily unavailable');
  }
  failed = false;
  assert.equal(await (await fetch(`${base}/pings`)).text(), '7');
});

test('database connection settings are required', () => {
  const env = { PGHOST: 'localhost', PGPORT: '5432', PGUSER: 'test', PGDATABASE: 'test', PGPASSWORD: 'test' };
  for (const name of Object.keys(env)) {
    assert.throws(() => createDatabase({ ...env, [name]: undefined }), new RegExp(name));
  }
  assert.throws(() => createDatabase({ ...env, PGPORT: 'abc' }), /PGPORT/);
});

test('PostgreSQL initialization preserves counts and concurrent increments are atomic', databaseTests, async () => {
  await resetDatabase();
  const first = createDatabase(process.env);
  const second = createDatabase(process.env);
  try {
    const counts = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? first : second).increment()));
    assert.deepEqual(counts.map(Number).sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i));
    await second.initialize();
    assert.equal(await second.read(), '20');
    const pool = new pg.Pool();
    try { await pool.query("UPDATE ping_counter SET value = 9007199254740993 WHERE id = 1"); }
    finally { await pool.end(); }
    assert.equal(await first.increment(), '9007199254740993');
    assert.equal(await second.read(), '9007199254740994');
  } finally {
    await first.close();
    await second.close();
  }
});
