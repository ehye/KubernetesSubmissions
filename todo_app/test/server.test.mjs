import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { createApp, parsePort } from '../dist/server.js';

test('PORT defaults to 3000 and accepts configured ports', () => {
  assert.equal(parsePort(undefined), 3000);
  assert.equal(parsePort('8080'), 8080);
  assert.equal(parsePort('65535'), 65535);
  assert.equal(parsePort('0'), 0);
});

test('rejects invalid PORT values', () => {
  for (const value of ['', ' ', '-1', '65536', '3.5', '8080abc', 'NaN', 'Infinity']) {
    assert.throws(() => parsePort(value), /PORT must be an integer/);
  }
});

test('serves an HTML page for GET / and preserves other responses', { timeout: 5000 }, async t => {
  const server = createApp();
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  server.listen(0, '0.0.0.0');
  await once(server, 'listening');
  const response = await fetch(`http://127.0.0.1:${server.address().port}/`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
  const html = await response.text();
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<title>Todo app<\/title>/);
  assert.match(html, /<h1>Todo app<\/h1>/);
  assert.match(html, /<h1>Todo app<\/h1>\s*<img src="\/image"/);
  assert.match(html, /max-width: 100%/);
  assert.match(html, /margin: 24px auto/);
  assert.match(html, /<label for="todo-input">New todo<\/label>/);
  assert.match(html, /<input[^>]*id="todo-input"[^>]*maxlength="140"[^>]*aria-describedby="todo-limit"/);
  assert.match(html, /<form id="todo-form" class="todo-controls">/);
  assert.match(html, /<button id="todo-send" type="submit">Send<\/button>/);
  assert.match(html, /<small id="todo-limit">Maximum 140 characters\.<\/small>/);
  assert.match(html, /<img[^>]*>\s*<section class="todo-panel"/);
  assert.match(html, /<ul id="todo-list"><\/ul>/);
  assert.match(html, /id="todo-status" role="status" aria-live="polite"/);
  assert.match(html, /fetch\('\/todos'/);
  assert.doesNotMatch(html, /<li>/);

  const rootWithQuery = await fetch(`http://127.0.0.1:${server.address().port}/?example=1`);
  assert.equal(await rootWithQuery.text(), html);

  for (const [path, method] of [['/unknown', 'GET'], ['/', 'POST']]) {
    const other = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method });
    assert.equal(other.status, 200);
    assert.equal(other.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.equal(await other.text(), 'Todo app\n');
  }
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  test(`logs the actual listening port and exits cleanly on ${signal}`, { timeout: 5000 }, async t => {
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
    assert.ok(match, `Unexpected startup message: ${line}`);
    assert.ok(Number(match[1]) > 0);
    const response = await fetch(`http://127.0.0.1:${match[1]}/`);
    assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.match(await response.text(), /<h1>Todo app<\/h1>/);
    const exited = once(child, 'exit');
    child.kill(signal);
    assert.deepEqual(await exited, [0, null]);
  });
}

test('invalid PORT exits unsuccessfully without a startup message', { timeout: 5000 }, async () => {
  const child = spawn(process.execPath, ['dist/index.js'], {
    cwd: new URL('../', import.meta.url),
    env: { ...process.env, PORT: 'invalid' },
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  const [code] = await once(child, 'close');
  assert.equal(code, 1);
  assert.equal(stdout, '');
  assert.match(stderr, /PORT must be an integer/);
});
