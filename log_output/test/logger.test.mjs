import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

async function startProcess(t, entry, filePath, lineCount = 1) {
  const child = spawn(process.execPath, [`dist/${entry}.js`], {
    cwd: new URL('../', import.meta.url),
    env: { ...process.env, LOG_FILE: filePath, COUNTER_FILE: join(dirname(filePath), 'pingpong-count.txt'), PORT: '0' },
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

async function startReader(t, filePath) {
  const reader = await startProcess(t, 'index', filePath);
  const match = /^Server started in port (\d+)$/.exec(reader.lines[0]);
  assert.ok(match, reader.lines[0]);
  return { ...reader, url: `http://127.0.0.1:${match[1]}/` };
}

test('writer replaces the file every five seconds with the same UUID', { timeout: 15_000 }, async t => {
  const filePath = await temporaryFile(t);
  const { child, lines } = await startProcess(t, 'writer', filePath, 2);
  const matches = lines.map(line => {
    const match = logPattern.exec(line);
    assert.ok(match, line);
    return match;
  });
  assert.equal(matches[0][2], matches[1][2]);
  const elapsed = Date.parse(matches[1][1]) - Date.parse(matches[0][1]);
  assert.ok(elapsed >= 4_900 && elapsed < 7_000, `Unexpected interval: ${elapsed}ms`);
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

test('reader returns 503 before the first write, then reads only the latest line', { timeout: 5000 }, async t => {
  const filePath = await temporaryFile(t);
  const server = createApp(filePath);
  t.after(() => { server.closeAllConnections(); server.close(); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/`;

  const missing = await fetch(url);
  assert.equal(missing.status, 503);
  assert.equal(missing.headers.get('retry-after'), '1');
  await missing.text();
  // The reader must not create the writer's file.
  await assert.rejects(readFile(filePath), { code: 'ENOENT' });

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
  assert.equal(latest.trim().split('\n').length, 1);
  assert.equal(logPattern.exec(latest.trim())[2], logPattern.exec(first.trim())[2]);
  assert.equal(await (await fetch(url)).text(), `${latest.trimEnd()}.\nPing / Pongs: 0\n`);
});

test('atomic replacement never exposes an incomplete file', { timeout: 5000 }, async t => {
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

test('reader reports other file errors without exposing paths', { timeout: 5000 }, async t => {
  const filePath = await temporaryFile(t);
  await writeFile(filePath, 'not a directory');
  t.mock.method(console, 'error', () => {});
  const server = createApp(join(filePath, 'child.txt'));
  t.after(() => { server.closeAllConnections(); server.close(); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const response = await fetch(`http://127.0.0.1:${server.address().port}/`);
  assert.equal(response.status, 500);
  assert.equal(await response.text(), 'Unable to read log output\n');
});

test('separate processes share the file and reader restart preserves its content', { timeout: 15_000 }, async t => {
  const filePath = await temporaryFile(t);
  const firstReader = await startReader(t, filePath);
  const missing = await fetch(firstReader.url);
  assert.equal(missing.status, 503);
  await missing.text();
  const writer = await startProcess(t, 'writer', filePath);
  const expected = `${writer.lines[0]}.\nPing / Pongs: 0\n`;
  assert.equal(await (await fetch(firstReader.url)).text(), expected);
  await stopProcess(firstReader.child, 'SIGINT');
  const secondReader = await startReader(t, filePath);
  assert.equal(await (await fetch(secondReader.url)).text(), expected);
  await stopProcess(writer.child);
  // The last line remains readable even while the writer is stopped.
  assert.equal(await (await fetch(secondReader.url)).text(), expected);
  await stopProcess(secondReader.child);
});

test('GET / reads the persisted ping-pong total without changing it', { timeout: 5000 }, async t => {
  const filePath = await temporaryFile(t);
  const counterPath = join(dirname(filePath), 'pingpong-count.txt');
  const line = '2020-03-30T12:15:17.705Z: 8523ecb1-c716-4cb6-a044-b9e83bb98e43';
  await writeFile(filePath, `${line}\n`);
  await writeFile(counterPath, '3\n');
  const reader = await startReader(t, filePath);
  for (let i = 0; i < 2; i++) {
    const response = await fetch(reader.url);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), `${line}.\nPing / Pongs: 3\n`);
  }
  assert.equal(await readFile(counterPath, 'utf8'), '3\n');
  await writeFile(counterPath, '4\n');
  assert.equal(await (await fetch(reader.url)).text(), `${line}.\nPing / Pongs: 4\n`);
  await stopProcess(reader.child);
});

test('invalid ping-pong totals return an error instead of zero', { timeout: 5000 }, async t => {
  const filePath = await temporaryFile(t);
  const counterPath = join(dirname(filePath), 'pingpong-count.txt');
  await writeFile(filePath, 'timestamp: uuid\n');
  const server = createApp(filePath, counterPath);
  t.mock.method(console, 'error', () => {});
  t.after(() => { server.closeAllConnections(); server.close(); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  for (const invalid of ['', '-1', '3.5', 'not a number']) {
    await writeFile(counterPath, invalid);
    const response = await fetch(`http://127.0.0.1:${server.address().port}/`);
    assert.equal(response.status, 500);
    assert.equal(await response.text(), 'Unable to read log output\n');
    assert.equal(await readFile(counterPath, 'utf8'), invalid);
  }
});
