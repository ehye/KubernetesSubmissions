import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { loadConfig } from '../dist/config.js';
import { testEnv, createImageCache } from './helpers.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('configuration requires every runtime setting and validates values', () => {
  for (const name of Object.keys(testEnv).filter(name => name !== 'PORT')) {
    assert.throws(() => loadConfig({ ...testEnv, [name]: undefined }), new RegExp(name));
    assert.throws(() => loadConfig({ ...testEnv, [name]: '' }), new RegExp(name));
  }
  for (const name of ['PICSUM_URL', 'TODO_BACKEND_URL']) {
    for (const value of ['invalid', 'file:///etc/passwd']) {
      assert.throws(() => loadConfig({ ...testEnv, [name]: value }), new RegExp(name));
    }
  }
  for (const name of ['IMAGE_CACHE_DURATION_MS', 'IMAGE_TIMEOUT_MS', 'BACKEND_TIMEOUT_MS', 'SHUTDOWN_TIMEOUT_MS', 'IMAGE_RETRY_AFTER_SECONDS']) {
    for (const value of ['0', '-1', '1.5', 'NaN', '2147483648']) {
      assert.throws(() => loadConfig({ ...testEnv, [name]: value }), new RegExp(name));
    }
  }
  assert.throws(() => loadConfig({ ...testEnv, ENABLE_SHUTDOWN_TEST: 'yes' }), /ENABLE_SHUTDOWN_TEST/);
  const config = loadConfig({ ...testEnv, IMAGE_CACHE_DURATION_MS: '1234', BACKEND_TIMEOUT_MS: '50' });
  assert.equal(config.cacheDurationMs, 1234);
  assert.equal(config.backendTimeoutMs, 50);
});

test('missing configuration exits with an actionable error', () => {
  const result = spawnSync(process.execPath, ['dist/index.js'], {
    cwd: new URL('../', import.meta.url),
    env: { ...process.env, ...testEnv, PICSUM_URL: '' },
    encoding: 'utf8', timeout: 5000,
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /PICSUM_URL is required/);
});

test('image cache respects a custom duration', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'todo-config-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let now = Date.now();
  let downloads = 0;
  const getImage = createImageCache({
    filePath: join(dir, 'image.jpg'), cacheDurationMs: 20,
    now: () => now,
    fetchImage: async () => {
      downloads++;
      return new Response('jpeg', { headers: { 'Content-Type': 'image/jpeg' } });
    },
  });
  await getImage();
  await getImage();
  assert.equal(downloads, 1);
  now += 1000;
  await getImage();
  assert.equal(downloads, 2);
});
