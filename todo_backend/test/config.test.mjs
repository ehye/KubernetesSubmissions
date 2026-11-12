import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../dist/config.js';

test('backend host and shutdown timeout are required and validated', () => {
  const env = { HOST: '127.0.0.1', SHUTDOWN_TIMEOUT_MS: '50' };
  assert.deepEqual(loadConfig(env), { host: '127.0.0.1', shutdownTimeoutMs: 50 });
  assert.throws(() => loadConfig({ ...env, HOST: '' }), /HOST/);
  for (const value of [undefined, '', '0', '-1', '1.5', '2147483648']) {
    assert.throws(() => loadConfig({ ...env, SHUTDOWN_TIMEOUT_MS: value }), /SHUTDOWN_TIMEOUT_MS/);
  }
});
