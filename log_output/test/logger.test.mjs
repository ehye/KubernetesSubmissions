import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { createLogger } from '../dist/logger.js';
import { createApp } from '../dist/server.js';

const logPattern = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z): ([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;

async function temporaryFile(t) {
  const directory = await mkdtemp(join(tmpdir(), 'log-output-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return join(directory, 'log.txt');
}

async function listen(t, server) {
  t.after(() => { server.closeAllConnections(); server.close(); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}/`;
}

async function startPings(t, state = { count: '0', status: 200 }) {
  const requests = [];
  const base = await listen(t, createServer((request, response) => {
    requests.push({ method: request.method, path: request.url });
    if (state.stall) return;
    response.writeHead(state.status, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(state.count);
  }));
  return { url: `${base}pings`, requests };
}

async function startProcess(t, entry, filePath, lineCount = 1, pingPongUrl = 'http://127.0.0.1:1/pings') {
  const child = spawn(process.execPath, [`dist/${entry}.js`], {
    cwd: new URL('../', import.meta.url),
    env: { ...process.env, LOG_FILE: filePath, PING_PONG_URL: pingPongUrl, PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    }
  });
  const lines = await new Promise((resolve, reject) => {
    let output = '';
    let errors = '';
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${entry}`)), 12_000);
    child.stderr.setEncoding('utf8').on('data', chunk => { errors += chunk; });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => {
      clearTimeout(timeout);
      reject(new Error(`${entry} exited early (${code}): ${errors}`));
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

async function stopProcess(child, signal = 'SIGTERM') {
  const exited = once(child, 'exit');
  child.kill(signal);
  assert.deepEqual(await exited, [0, null]);
}

async function startReader(t, filePath, pingPongUrl) {
  const reader = await startProcess(t, 'index', filePath, 1, pingPongUrl);
  const match = /^Server started in port (\d+)$/.exec(reader.lines[0]);
  assert.ok(match, reader.lines[0]);
  return { ...reader, url: `http://127.0.0.1:${match[1]}/` };
}

test('writer replaces the file every five seconds with the same UUID', { timeout: 15_000 }, async t => {
  const filePath = await temporaryFile(t);
  const started = performance.now();
  const { child, lines } = await startProcess(t, 'writer', filePath, 2);
  const elapsed = performance.now() - started;
  const matches = lines.map(line => {
    const match = logPattern.exec(line);
    assert.ok(match, line);
    return match;
  });
  assert.equal(matches[0][2], matches[1][2]);
  assert.notEqual(matches[0][1], matches[1][1]);
  // Use elapsed time rather than the wall clock, which can jump in a VM.
  assert.ok(elapsed >= 4_900 && elapsed < 12_000, `Unexpected interval: ${elapsed}ms`);
  assert.equal(await readFile(filePath, 'utf8'), `${lines[1]}\n`);
  await stopProcess(child);
});

test('writer restart generates a new UUID and shuts down on SIGINT', { timeout: 15_000 }, async t => {
  const filePath = await temporaryFile(t);
  const first = await startProcess(t, 'writer', filePath);
  await stopProcess(first.child, 'SIGINT');
  const second = await startProcess(t, 'writer', filePath);
  await stopProcess(second.child, 'SIGINT');
  assert.notEqual(logPattern.exec(first.lines[0])[2], logPattern.exec(second.lines[0])[2]);
  assert.equal(await readFile(filePath, 'utf8'), `${second.lines[0]}\n`);
});

test('reader returns 503 before the first write, then combines the latest line with HTTP pings', { timeout: 5000 }, async t => {
  const filePath = await temporaryFile(t);
  const upstream = await startPings(t);
  const url = await listen(t, createApp(filePath, upstream.url));
  const missing = await fetch(url);
  assert.equal(missing.status, 503);
  assert.equal(missing.headers.get('retry-after'), '1');
  await missing.text();
  await assert.rejects(readFile(filePath), { code: 'ENOENT' });
  assert.equal(upstream.requests.length, 0);

  let timestamp = '2026-11-06T12:00:00.000Z';
  t.mock.method(Date.prototype, 'toISOString', () => timestamp);
  const output = t.mock.method(console, 'log', () => {});
  const logValue = createLogger(filePath);
  await logValue();
  const first = await readFile(filePath, 'utf8');
  for (let i = 0; i < 2; i++) {
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(await response.text(), `${first.trimEnd()}.\nPing / Pongs: 0\n`);
  }
  assert.equal(output.mock.callCount(), 1);
  timestamp = '2026-11-06T12:00:05.000Z';
  await logValue();
  const latest = await readFile(filePath, 'utf8');
  assert.notEqual(latest, first);
  assert.equal(logPattern.exec(latest.trim())[2], logPattern.exec(first.trim())[2]);
  assert.equal(await (await fetch(url)).text(), `${latest.trimEnd()}.\nPing / Pongs: 0\n`);
  assert.deepEqual(upstream.requests, Array(3).fill({ method: 'GET', path: '/pings' }));
});

test('atomic replacement never exposes an incomplete log file', { timeout: 5000 }, async t => {
  const filePath = await temporaryFile(t);
  t.mock.method(console, 'log', () => {});
  const logValue = createLogger(filePath);
  await logValue();
  await Promise.all([
    (async () => { for (let i = 0; i < 30; i++) await logValue(); })(),
    (async () => {
      for (let i = 0; i < 100; i++) {
        const content = await readFile(filePath, 'utf8');
        assert.ok(logPattern.test(content.trim()), content);
        assert.equal(content.trim().split('\n').length, 1);
      }
    })(),
  ]);
});

test('reader reports file errors without calling Ping-pong', { timeout: 5000 }, async t => {
  const filePath = await temporaryFile(t);
  await writeFile(filePath, 'not a directory');
  t.mock.method(console, 'error', () => {});
  const upstream = await startPings(t);
  const url = await listen(t, createApp(join(filePath, 'child.txt'), upstream.url));
  const response = await fetch(url);
  assert.equal(response.status, 500);
  assert.equal(await response.text(), 'Unable to read log output\n');
  assert.equal(upstream.requests.length, 0);
});

test('reader process uses PING_PONG_URL and its restart preserves the log file', { timeout: 15_000 }, async t => {
  const filePath = await temporaryFile(t);
  const upstream = await startPings(t, { count: '3', status: 200 });
  const firstReader = await startReader(t, filePath, upstream.url);
  const missing = await fetch(firstReader.url);
  assert.equal(missing.status, 503);
  await missing.text();
  const writer = await startProcess(t, 'writer', filePath);
  const expected = `${writer.lines[0]}.\nPing / Pongs: 3\n`;
  assert.equal(await (await fetch(firstReader.url)).text(), expected);
  await stopProcess(firstReader.child, 'SIGINT');
  const secondReader = await startReader(t, filePath, upstream.url);
  assert.equal(await (await fetch(secondReader.url)).text(), expected);
  await stopProcess(writer.child);
  assert.equal(await (await fetch(secondReader.url)).text(), expected);
  await stopProcess(secondReader.child);
});

test('GET / reads the current HTTP total and ignores legacy counter files', { timeout: 5000 }, async t => {
  const filePath = await temporaryFile(t);
  const legacyCounter = join(dirname(filePath), 'pingpong-count.txt');
  const line = '2020-03-30T12:15:17.705Z: 8523ecb1-c716-4cb6-a044-b9e83bb98e43';
  await writeFile(filePath, `${line}\n`);
  await writeFile(legacyCounter, '9999\n');
  const state = { count: '3', status: 200 };
  const upstream = await startPings(t, state);
  const url = await listen(t, createApp(filePath, upstream.url));
  for (let i = 0; i < 2; i++) {
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), `${line}.\nPing / Pongs: 3\n`);
  }
  state.count = '4';
  assert.equal(await (await fetch(url)).text(), `${line}.\nPing / Pongs: 4\n`);
  assert.equal(await readFile(legacyCounter, 'utf8'), '9999\n');
});

test('invalid counts and upstream HTTP errors return 503 and can recover', { timeout: 5000 }, async t => {
  const filePath = await temporaryFile(t);
  await writeFile(filePath, 'timestamp: uuid\n');
  t.mock.method(console, 'error', () => {});
  const state = { count: '0', status: 200 };
  const upstream = await startPings(t, state);
  const url = await listen(t, createApp(filePath, upstream.url));
  for (const invalid of ['', '-1', '3.5', 'not a number']) {
    state.count = invalid;
    const response = await fetch(url);
    assert.equal(response.status, 503);
    assert.equal(await response.text(), 'Ping-pong is temporarily unavailable\n');
  }
  state.count = '3';
  state.status = 500;
  const failed = await fetch(url);
  assert.equal(failed.status, 503);
  await failed.text();
  state.status = 200;
  const recovered = await fetch(url);
  assert.equal(recovered.status, 200);
  assert.equal(await recovered.text(), 'timestamp: uuid.\nPing / Pongs: 3\n');
});

test('an unreachable Ping-pong returns 503 rather than a false zero', { timeout: 5000 }, async t => {
  const filePath = await temporaryFile(t);
  await writeFile(filePath, 'timestamp: uuid\n');
  t.mock.method(console, 'error', () => {});
  const url = await listen(t, createApp(filePath, 'http://127.0.0.1:1/pings'));
  const response = await fetch(url);
  assert.equal(response.status, 503);
  assert.equal(await response.text(), 'Ping-pong is temporarily unavailable\n');
});

test('a stalled Ping-pong request times out', { timeout: 10_000 }, async t => {
  const filePath = await temporaryFile(t);
  await writeFile(filePath, 'timestamp: uuid\n');
  t.mock.method(console, 'error', () => {});
  const upstream = await startPings(t, { stall: true });
  const url = await listen(t, createApp(filePath, upstream.url));
  const response = await fetch(url);
  assert.equal(response.status, 503);
  assert.equal(await response.text(), 'Ping-pong is temporarily unavailable\n');
});
