import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { createApp, parsePort } from '../dist/server.js';

async function startApp(t) {
  const server = createApp();
  t.after(() => { server.closeAllConnections(); server.close(); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

function createTodo(base, text) {
  return fetch(`${base}/todos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

async function startProcess(t) {
  const child = spawn(process.execPath, ['dist/index.js'], {
    cwd: new URL('../', import.meta.url),
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1', SHUTDOWN_TIMEOUT_MS: '10000' },
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

test('validates PORT and requires an explicit value', () => {
  assert.throws(() => parsePort(undefined), /PORT is required/);
  assert.equal(parsePort('3001'), 3001);
  assert.equal(parsePort('0'), 0);
  assert.throws(() => parsePort(''), /PORT is required/);
  for (const value of [' ', '-1', '65536', '3.5', '3000abc', 'NaN']) {
    assert.throws(() => parsePort(value), /PORT must be an integer/);
  }
});

test('GET /todos starts empty and returns JSON without caching', { timeout: 5000 }, async t => {
  const base = await startApp(t);
  const response = await fetch(`${base}/todos`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), []);
});

test('POST /todos creates trimmed text and unique IDs that GET returns', { timeout: 5000 }, async t => {
  const base = await startApp(t);
  const created = [];
  for (const text of ['  Buy groceries  ', 'Read a book']) {
    const response = await createTodo(base, text);
    assert.equal(response.status, 201);
    const todo = await response.json();
    assert.match(todo.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(todo.text, text.trim());
    created.push(todo);
  }
  assert.notEqual(created[0].id, created[1].id);
  assert.deepEqual(await (await fetch(`${base}/todos?example=1`)).json(), created);
});

test('invalid JSON, missing text, empty text, and overlong text are rejected', { timeout: 5000 }, async t => {
  const base = await startApp(t);
  const invalid = ['{', '', 'null', '[]', '{}', '{"text":4}', '{"text":null}',
    ...['', '   ', 'x'.repeat(141), ' '.repeat(141) + 'x'].map(text => JSON.stringify({ text }))];
  for (const body of invalid) {
    const response = await fetch(`${base}/todos`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    });
    assert.equal(response.status, 400, body);
    assert.equal(typeof (await response.json()).error, 'string');
  }
  assert.deepEqual(await (await fetch(`${base}/todos`)).json(), []);
});

test('accepts 140 characters and Unicode with the same limit as HTML maxlength', { timeout: 5000 }, async t => {
  const base = await startApp(t);
  for (const text of ['x'.repeat(140), '🙂'.repeat(70)]) {
    const response = await createTodo(base, text);
    assert.equal(response.status, 201);
    assert.equal((await response.json()).text, text);
  }
  const response = await createTodo(base, '🙂'.repeat(71));
  assert.equal(response.status, 400);
  await response.json();
});

test('requires JSON content type and accepts a charset parameter', { timeout: 5000 }, async t => {
  const base = await startApp(t);
  const unsupported = await fetch(`${base}/todos`, { method: 'POST', body: 'todo=Read' });
  assert.equal(unsupported.status, 415);
  await unsupported.json();
  const response = await fetch(`${base}/todos`, {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ text: 'Read a book' }),
  });
  assert.equal(response.status, 201);
  await response.json();
});

test('rejects oversized request bodies without creating a todo', { timeout: 5000 }, async t => {
  const base = await startApp(t);
  const response = await createTodo(base, 'x'.repeat(9000));
  assert.equal(response.status, 413);
  await response.json();
  assert.deepEqual(await (await fetch(`${base}/todos`)).json(), []);
});

test('unknown paths and unsupported methods do not change the list', { timeout: 5000 }, async t => {
  const base = await startApp(t);
  const missing = await fetch(`${base}/`);
  assert.equal(missing.status, 404);
  await missing.json();
  const method = await fetch(`${base}/todos`, { method: 'DELETE' });
  assert.equal(method.status, 405);
  assert.equal(method.headers.get('allow'), 'GET, POST');
  await method.json();
  assert.deepEqual(await (await fetch(`${base}/todos`)).json(), []);
});

test('concurrent creates retain every todo with distinct IDs', { timeout: 5000 }, async t => {
  const base = await startApp(t);
  const created = await Promise.all(Array.from({ length: 10 }, async (_, i) => {
    const response = await createTodo(base, `Todo ${i}`);
    assert.equal(response.status, 201);
    return response.json();
  }));
  const todos = await (await fetch(`${base}/todos`)).json();
  assert.equal(todos.length, 10);
  assert.equal(new Set(todos.map(todo => todo.id)).size, 10);
  assert.deepEqual(new Set(todos.map(todo => todo.id)), new Set(created.map(todo => todo.id)));
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  test(`shuts down cleanly on ${signal}`, { timeout: 5000 }, async t => {
    const { child, base } = await startProcess(t);
    assert.deepEqual(await (await fetch(`${base}/todos`)).json(), []);
    await stopProcess(child, signal);
  });
}

test('process restart clears the in-memory todo list', { timeout: 10_000 }, async t => {
  const first = await startProcess(t);
  const created = await createTodo(first.base, 'Temporary todo');
  assert.equal(created.status, 201);
  await created.json();
  assert.equal((await (await fetch(`${first.base}/todos`)).json()).length, 1);
  await stopProcess(first.child);
  const second = await startProcess(t);
  assert.deepEqual(await (await fetch(`${second.base}/todos`)).json(), []);
  await stopProcess(second.child);
});
