import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';

const logPattern = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z): ([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;

async function startLogger(t, lineCount) {
  const child = spawn(process.execPath, ['dist/index.js'], {
    cwd: new URL('../', import.meta.url),
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
