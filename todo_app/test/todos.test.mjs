import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { todoClientScript } from '../dist/client.js';
import { createApp, testEnv } from './helpers.mjs';

async function listen(t, server) {
  t.after(() => { server.closeAllConnections(); server.close(); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

async function backendStub(t, state = { status: 200, body: [] }) {
  const requests = [];
  const url = await listen(t, createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({ path: request.url, method: request.method, contentType: request.headers['content-type'], body });
    if (state.stall) return;
    response.writeHead(state.status, { 'Content-Type': state.contentType ?? 'application/json' });
    response.end(state.raw ?? JSON.stringify(state.body));
  }));
  return { url, requests };
}

test('GET /todos proxies the backend list over HTTP', { timeout: 5000 }, async t => {
  const todos = [{ id: 'one', text: 'Buy groceries' }];
  const backend = await backendStub(t, { status: 200, body: todos });
  const base = await listen(t, createApp({ backendUrl: backend.url }));
  const response = await fetch(`${base}/todos`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), todos);
  assert.equal(backend.requests[0].method, 'GET');
  assert.equal(backend.requests[0].path, '/todos');
});

test('POST /todos forwards JSON and preserves creation and validation statuses', { timeout: 5000 }, async t => {
  const state = { status: 201, body: { id: 'one', text: 'Read a book' } };
  const backend = await backendStub(t, state);
  const base = await listen(t, createApp({ backendUrl: backend.url }));
  const response = await fetch(`${base}/todos`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Read a book' }),
  });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), state.body);
  assert.equal(backend.requests[0].path, '/todos');
  assert.equal(backend.requests[0].method, 'POST');
  assert.equal(backend.requests[0].contentType, 'application/json');
  assert.deepEqual(JSON.parse(backend.requests[0].body), { text: 'Read a book' });
  state.status = 400;
  state.body = { error: 'Invalid JSON' };
  const invalid = await fetch(`${base}/todos`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '',
  });
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), state.body);
  assert.equal(backend.requests[1].contentType, 'application/json');
});

test('unsupported methods and oversized bodies never reach the backend', { timeout: 5000 }, async t => {
  const backend = await backendStub(t);
  const base = await listen(t, createApp({ backendUrl: backend.url }));
  const method = await fetch(`${base}/todos`, { method: 'DELETE' });
  assert.equal(method.status, 405);
  assert.equal(method.headers.get('allow'), 'GET, POST');
  await method.json();
  const large = await fetch(`${base}/todos`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(9000),
  });
  assert.equal(large.status, 413);
  await large.json();
  assert.equal(backend.requests.length, 0);
});

test('malformed backend responses return a useful JSON 503', { timeout: 5000 }, async t => {
  t.mock.method(console, 'error', () => {});
  const state = { status: 200, contentType: 'text/html', raw: '<h1>Error</h1>' };
  const backend = await backendStub(t, state);
  const base = await listen(t, createApp({ backendUrl: backend.url }));
  for (const contentType of ['text/html', 'application/json']) {
    state.contentType = contentType;
    const response = await fetch(`${base}/todos`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'Todo backend is temporarily unavailable' });
  }
});

test('unavailable backend returns 503 rather than an empty todo list', { timeout: 5000 }, async t => {
  t.mock.method(console, 'error', () => {});
  const base = await listen(t, createApp({ backendUrl: 'http://127.0.0.1:1' }));
  const response = await fetch(`${base}/todos`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'Todo backend is temporarily unavailable' });
});

test('stalled backend requests time out', { timeout: 10_000 }, async t => {
  t.mock.method(console, 'error', () => {});
  const backend = await backendStub(t, { stall: true });
  const base = await listen(t, createApp({ backendUrl: backend.url }));
  const response = await fetch(`${base}/todos`);
  assert.equal(response.status, 503);
  await response.json();
});

test('server process reads TODO_BACKEND_URL', { timeout: 5000 }, async t => {
  const backend = await backendStub(t, { status: 200, body: [{ id: 'one', text: 'Read' }] });
  const child = spawn(process.execPath, ['dist/index.js'], {
    cwd: new URL('../', import.meta.url),
    env: { ...process.env, ...testEnv, TODO_BACKEND_URL: backend.url },
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
  assert.deepEqual(await (await fetch(`http://127.0.0.1:${match[1]}/todos`)).json(), [{ id: 'one', text: 'Read' }]);
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  assert.deepEqual(await exited, [0, null]);
});

// A minimal DOM stub tests the browser behavior without adding a frontend framework.
function browser(fetch) {
  function element() {
    const node = {
      value: '', disabled: false, textContent: '', children: [], handlers: {},
      addEventListener(event, handler) { this.handlers[event] = handler; },
      replaceChildren() { this.children = []; },
      append(child) { this.children.push(child); },
      focus() { this.focused = true; },
    };
    Object.defineProperty(node, 'innerHTML', { set() { throw new Error('Unsafe HTML rendering'); } });
    return node;
  }
  const nodes = Object.fromEntries(['todo-form', 'todo-input', 'todo-send', 'todo-list', 'todo-status'].map(id => [id, element()]));
  runInNewContext(todoClientScript, {
    document: { getElementById: id => nodes[id], createElement: () => element() }, fetch,
  });
  return nodes;
}

const settle = () => new Promise(resolve => setImmediate(resolve));
const jsonResponse = (body, ok = true) => ({ ok, json: async () => body });

test('browser fetches the list and renders todo text without interpreting HTML', async () => {
  const calls = [];
  const dangerous = '<img src=x onerror="alert(1)">';
  const nodes = browser(async (url, options) => {
    calls.push({ url, options });
    return jsonResponse([{ id: 'one', text: dangerous }]);
  });
  assert.equal(nodes['todo-send'].disabled, true);
  await settle();
  assert.equal(calls[0].url, '/todos');
  assert.equal(nodes['todo-list'].children[0].textContent, dangerous);
  assert.equal(nodes['todo-send'].disabled, false);
});

test('browser Send creates a todo, reloads the list, and clears the input', async () => {
  const todos = [];
  const calls = [];
  const nodes = browser(async (url, options = {}) => {
    calls.push({ url, options });
    if (options.method === 'POST') {
      const todo = { id: 'one', text: JSON.parse(options.body).text };
      todos.push(todo);
      return jsonResponse(todo);
    }
    return jsonResponse([...todos]);
  });
  await settle();
  assert.equal(nodes['todo-status'].textContent, 'No todos yet.');
  nodes['todo-input'].value = '  Buy groceries  ';
  let prevented = false;
  const saving = nodes['todo-form'].handlers.submit({ preventDefault() { prevented = true; } });
  assert.equal(nodes['todo-input'].disabled, true);
  assert.equal(nodes['todo-send'].disabled, true);
  await saving;
  assert.equal(prevented, true);
  assert.equal(calls.length, 3);
  assert.equal(calls[1].url, '/todos');
  assert.equal(calls[1].options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[1].options.body), { text: 'Buy groceries' });
  assert.equal(nodes['todo-list'].children[0].textContent, 'Buy groceries');
  assert.equal(nodes['todo-input'].value, '');
  assert.equal(nodes['todo-input'].disabled, false);
  assert.equal(nodes['todo-send'].disabled, false);
  assert.equal(nodes['todo-status'].textContent, 'Todo added.');
});

test('browser rejects empty or overlong text without sending a POST', async () => {
  let calls = 0;
  const nodes = browser(async () => { calls++; return jsonResponse([]); });
  await settle();
  for (const text of ['', '   ', 'x'.repeat(141)]) {
    nodes['todo-input'].value = text;
    await nodes['todo-form'].handlers.submit({ preventDefault() {} });
    assert.match(nodes['todo-status'].textContent, /1 to 140/);
  }
  assert.equal(calls, 1);
});

test('browser preserves typed text on backend validation failure', async () => {
  const nodes = browser(async (_url, options = {}) => options.method === 'POST'
    ? jsonResponse({ error: 'Todo rejected' }, false) : jsonResponse([]));
  await settle();
  nodes['todo-input'].value = 'Keep this text';
  await nodes['todo-form'].handlers.submit({ preventDefault() {} });
  assert.equal(nodes['todo-input'].value, 'Keep this text');
  assert.equal(nodes['todo-status'].textContent, 'Todo rejected');
  assert.equal(nodes['todo-send'].disabled, false);
});

test('browser shows a backend error instead of hardcoded todos', async () => {
  const nodes = browser(async () => jsonResponse({ error: 'Todo backend is temporarily unavailable' }, false));
  await settle();
  assert.equal(nodes['todo-status'].textContent, 'Todo backend is temporarily unavailable');
  assert.equal(nodes['todo-list'].children.length, 0);
  assert.equal(nodes['todo-send'].disabled, false);
});
