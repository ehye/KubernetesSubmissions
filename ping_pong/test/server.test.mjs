import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { createApp, parsePort } from '../dist/server.js';

async function startApp(t) {
  const server = createApp();
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  server.listen(0, '0.0.0.0');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

test('validates PORT and defaults to 3000', () => {
  assert.equal(parsePort(undefined), 3000);
  assert.equal(parsePort('8080'), 8080);
  assert.equal(parsePort('0'), 0);
  for (const value of ['', ' ', '-1', '65536', '3.5', '3000abc', 'NaN']) {
    assert.throws(() => parsePort(value), /PORT must be an integer/);
  }
});

test('GET /pingpong returns increasing counts, starting at zero', { timeout: 5000 }, async t => {
  const base = await startApp(t);
  for (let count = 0; count < 3; count++) {
    const response = await fetch(`${base}/pingpong`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(await response.text(), `pong ${count}`);
  }
  const response = await fetch(`${base}/pingpong?example=1`);
  assert.equal(await response.text(), 'pong 3');
});

test('other paths and methods do not increment the counter', { timeout: 5000 }, async t => {
  const base = await startApp(t);
  const missing = await fetch(`${base}/`);
  assert.equal(missing.status, 404);
  await missing.text();
  const post = await fetch(`${base}/pingpong`, { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET');
  await post.text();
  const response = await fetch(`${base}/pingpong`);
  assert.equal(await response.text(), 'pong 0');
});

test('each new application has its own in-memory counter', { timeout: 5000 }, async t => {
  const first = await startApp(t);
  assert.equal(await (await fetch(`${first}/pingpong`)).text(), 'pong 0');
  assert.equal(await (await fetch(`${first}/pingpong`)).text(), 'pong 1');
  const second = await startApp(t);
  assert.equal(await (await fetch(`${second}/pingpong`)).text(), 'pong 0');
});

test('concurrent requests receive distinct counter values', { timeout: 5000 }, async t => {
  const base = await startApp(t);
  const bodies = await Promise.all(Array.from({ length: 10 }, async () => {
    const response = await fetch(`${base}/pingpong`);
    return response.text();
  }));
  const counts = bodies.map(body => Number(body.slice(5))).sort((a, b) => a - b);
  assert.deepEqual(counts, Array.from({ length: 10 }, (_, i) => i));
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  test(`starts and shuts down cleanly on ${signal}`, { timeout: 5000 }, async t => {
    const child = spawn(process.execPath, ['dist/index.js'], {
      cwd: new URL('../', import.meta.url),
      env: { ...process.env, PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    t.after(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    });
    const output = createInterface({ input: child.stdout });
    t.after(() => output.close());
    const [line] = await once(output, 'line');
    const match = /^Server started in port (\d+)$/.exec(line);
    assert.ok(match, line);
    const response = await fetch(`http://127.0.0.1:${match[1]}/pingpong`);
    assert.equal(await response.text(), 'pong 0');
    const exited = once(child, 'exit');
    child.kill(signal);
    assert.deepEqual(await exited, [0, null]);
  });
}
