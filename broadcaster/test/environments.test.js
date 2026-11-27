import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { connect } from '@nats-io/transport-node';

// Use unique subjects on a test broker and a local recording webhook.
test('staging logs its events; only production posts to the webhook', {
  skip: !process.env.TEST_NATS_URL, timeout: 20000,
}, async t => {
  const calls = [];
  const receiver = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    calls.push(JSON.parse(body));
    res.writeHead(204).end();
  });
  receiver.listen(0, '127.0.0.1');
  await once(receiver, 'listening');
  t.after(() => { receiver.closeAllConnections(); receiver.close(); });
  const prefix = `test.${randomUUID()}`;
  async function until(check) {
    for (let i = 0; i < 100; i++) {
      if (check()) return;
      await delay(50);
    }
    assert.fail('Timed out waiting for test broadcaster');
  }
  async function subscriber(env, mode) {
    const childEnv = { ...process.env, NATS_URL: process.env.TEST_NATS_URL,
      NATS_SUBJECT: `${prefix}.${env}`, BROADCAST_MODE: mode };
    delete childEnv.DISCORD_WEBHOOK_URL;
    if (mode === 'discord') childEnv.DISCORD_WEBHOOK_URL = `http://127.0.0.1:${receiver.address().port}/hook`;
    const child = spawn(process.execPath, ['src/index.js'], {
      cwd: new URL('../', import.meta.url), env: childEnv, stdio: ['ignore', 'pipe', 'inherit'],
    });
    t.after(() => child.kill());
    let log = '';
    child.stdout.on('data', data => { log += data; });
    await until(() => log.includes(`Subscribed to ${prefix}.${env}`));
    return () => log;
  }
  const staging = await subscriber('staging', 'log');
  await subscriber('production', 'discord');
  const nc = await connect({ servers: process.env.TEST_NATS_URL });
  t.after(() => nc.close());
  for (const [env, message] of [['staging', 'A todo was created'], ['production', 'A todo was updated']]) {
    nc.publish(`${prefix}.${env}`, JSON.stringify({ user: 'bot', message }));
  }
  await nc.flush();
  await until(() => staging().includes('A todo was created') && calls.length > 0);
  assert.ok(!staging().includes('A todo was updated'));
  assert.deepEqual(calls, [{ username: 'bot', content: 'A todo was updated' }]);
});
