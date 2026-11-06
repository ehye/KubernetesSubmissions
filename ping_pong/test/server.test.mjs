import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { createApp, parsePort } from '../dist/server.js';

async function temporaryCounter(t) {
  const directory = await mkdtemp(join(tmpdir(), 'ping-pong-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return join(directory, 'pingpong-count.txt');
}

async function startApp(t, counterPath) {
  counterPath ??= await temporaryCounter(t);
  const server = createApp(counterPath);
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
  const counterPath = await temporaryCounter(t);
  const base = await startApp(t, counterPath);
  for (let count = 0; count < 3; count++) {
    const response = await fetch(`${base}/pingpong`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(await response.text(), `pong ${count}`);
  }
  const response = await fetch(`${base}/pingpong?example=1`);
  assert.equal(await response.text(), 'pong 3');
  assert.equal(await readFile(counterPath, 'utf8'), '4\n');
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

test('application recreation restores the count from the shared file', { timeout: 5000 }, async t => {
  const counterPath = await temporaryCounter(t);
  const first = await startApp(t, counterPath);
  assert.equal(await (await fetch(`${first}/pingpong`)).text(), 'pong 0');
  assert.equal(await (await fetch(`${first}/pingpong`)).text(), 'pong 1');
  const second = await startApp(t, counterPath);
  assert.equal(await (await fetch(`${second}/pingpong`)).text(), 'pong 2');
  assert.equal(await readFile(counterPath, 'utf8'), '3\n');
});

test('concurrent requests receive distinct counter values', { timeout: 5000 }, async t => {
  const counterPath = await temporaryCounter(t);
  const base = await startApp(t, counterPath);
  const bodies = await Promise.all(Array.from({ length: 10 }, async () => {
    const response = await fetch(`${base}/pingpong`);
    assert.equal(response.status, 200);
    return response.text();
  }));
  const counts = bodies.map(body => Number(body.slice(5))).sort((a, b) => a - b);
  assert.deepEqual(counts, Array.from({ length: 10 }, (_, i) => i));
  assert.equal(await readFile(counterPath, 'utf8'), '10\n');
});

test('invalid persisted data is not reset and a failed update does not poison the queue', { timeout: 5000 }, async t => {
  const counterPath = await temporaryCounter(t);
  await writeFile(counterPath, 'invalid\n');
  t.mock.method(console, 'error', () => {});
  const base = await startApp(t, counterPath);
  const response = await fetch(`${base}/pingpong`);
  assert.equal(response.status, 500);
  assert.equal(await response.text(), 'Unable to update ping-pong count');
  assert.equal(await readFile(counterPath, 'utf8'), 'invalid\n');
  await writeFile(counterPath, '5\n');
  assert.equal(await (await fetch(`${base}/pingpong`)).text(), 'pong 5');
  assert.equal(await readFile(counterPath, 'utf8'), '6\n');
});

test('failed writes return 500 and do not consume a count', { timeout: 5000 }, async t => {
  const counterPath = await temporaryCounter(t);
  const temporaryPath = `${counterPath}.${process.pid}.tmp`;
  // A directory at the temporary-file path forces writeFile to fail.
  await mkdir(temporaryPath);
  t.mock.method(console, 'error', () => {});
  const base = await startApp(t, counterPath);
  const failed = await fetch(`${base}/pingpong`);
  assert.equal(failed.status, 500);
  await failed.text();
  await assert.rejects(readFile(counterPath), { code: 'ENOENT' });
  await rm(temporaryPath, { recursive: true });
  assert.equal(await (await fetch(`${base}/pingpong`)).text(), 'pong 0');
  assert.equal(await readFile(counterPath, 'utf8'), '1\n');
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  test(`starts and shuts down cleanly on ${signal}`, { timeout: 5000 }, async t => {
    const counterPath = await temporaryCounter(t);
    const child = spawn(process.execPath, ['dist/index.js'], {
      cwd: new URL('../', import.meta.url),
      env: { ...process.env, PORT: '0', COUNTER_FILE: counterPath },
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
    assert.equal(await readFile(counterPath, 'utf8'), '1\n');
  });
}

test('process restart resumes counting without losing persisted requests', { timeout: 10_000 }, async t => {
  const counterPath = await temporaryCounter(t);
  for (let count = 0; count < 2; count++) {
    const child = spawn(process.execPath, ['dist/index.js'], {
      cwd: new URL('../', import.meta.url),
      env: { ...process.env, PORT: '0', COUNTER_FILE: counterPath },
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
    assert.equal(await response.text(), `pong ${count}`);
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    assert.deepEqual(await exited, [0, null]);
  }
  assert.equal(await readFile(counterPath, 'utf8'), '2\n');
});
