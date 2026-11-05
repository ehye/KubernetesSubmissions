import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import { createApp, createLogger } from '../dist/server.js';

const logPattern = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z): ([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;

async function startLogger(t, lineCount) {
  const child = spawn(process.execPath, ['dist/index.js'], {
    cwd: new URL('../', import.meta.url),
    env: { ...process.env, PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  });

  const lines = await new Promise((resolve, reject) => {
    let output = '';
    let errors = '';
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for logs')), 12_000);
    child.stderr.setEncoding('utf8').on('data', chunk => { errors += chunk; });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => {
      clearTimeout(timeout);
      reject(new Error(`Logger exited early (${code}): ${errors}`));
    });
    child.stdout.setEncoding('utf8').on('data', chunk => {
      output += chunk;
      const completeLines = output.split('\n').slice(0, -1);
      if (completeLines.length >= lineCount) {
        clearTimeout(timeout);
        resolve(completeLines.slice(0, lineCount));
      }
    });
  });

  return { child, lines };
}

async function stopLogger(child, signal) {
  const exited = once(child, 'exit');
  child.kill(signal);
  assert.deepEqual(await exited, [0, null]);
}

test('logs the same UUID every five seconds and shuts down on SIGTERM', { timeout: 15_000 }, async t => {
  const { child, lines } = await startLogger(t, 2);
  const matches = lines.map(line => {
    const match = logPattern.exec(line);
    assert.ok(match, `Unexpected log format: ${line}`);
    return match;
  });
  assert.equal(matches[0][2], matches[1][2]);
  const elapsed = Date.parse(matches[1][1]) - Date.parse(matches[0][1]);
  assert.ok(elapsed >= 4_900 && elapsed < 7_000, `Unexpected interval: ${elapsed}ms`);
  await stopLogger(child, 'SIGTERM');
});

test('generates a fresh UUID on restart and shuts down on SIGINT', { timeout: 15_000 }, async t => {
  const first = await startLogger(t, 1);
  await stopLogger(first.child, 'SIGINT');
  const second = await startLogger(t, 1);
  await stopLogger(second.child, 'SIGINT');
  const firstMatch = logPattern.exec(first.lines[0]);
  const secondMatch = logPattern.exec(second.lines[0]);
  assert.ok(firstMatch);
  assert.ok(secondMatch);
  assert.notEqual(firstMatch[2], secondMatch[2]);
});

test('GET / returns the latest logged status without changing it', { timeout: 5000 }, async t => {
  const logger = createLogger();
  const output = t.mock.method(console, 'log', () => {});
  t.mock.method(Date.prototype, 'toISOString', () => '2026-11-05T12:00:00.000Z');
  logger.log();
  const firstStatus = output.mock.calls.at(-1).arguments[0];
  const server = createApp(logger.getStatus);
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  server.listen(0, '0.0.0.0');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/`;

  for (let i = 0; i < 2; i++) {
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(await response.text(), `${firstStatus}\n`);
  }
  assert.equal(output.mock.callCount(), 1);

  t.mock.method(Date.prototype, 'toISOString', () => '2026-11-05T12:00:05.000Z');
  logger.log();
  const nextStatus = output.mock.calls.at(-1).arguments[0];
  assert.notEqual(firstStatus, nextStatus);
  assert.equal(logPattern.exec(firstStatus)[2], logPattern.exec(nextStatus)[2]);
  const response = await fetch(url);
  assert.equal(await response.text(), `${nextStatus}\n`);
});
