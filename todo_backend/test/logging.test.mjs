import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createApp } from '../dist/server.js';

async function setup(t, failDatabase = false) {
  const saved = [];
  const output = t.mock.method(console, 'log', () => {});
  const server = createApp({
    list: async () => saved,
    create: async todo => {
      if (failDatabase) throw new Error('private database details');
      saved.push(todo);
      return todo;
    },
  });
  t.after(() => { server.closeAllConnections(); server.close(); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/todos`;
  const post = text => fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const logs = () => output.mock.calls.map(call => JSON.parse(call.arguments[0]));
  return { url, post, saved, output, logs };
}

test('140 characters are saved and logged; 141 characters are rejected and never saved', async t => {
  const { post, saved, logs } = await setup(t);
  const accepted = await post('a'.repeat(140));
  assert.equal(accepted.status, 201);
  const todo = await accepted.json();
  const marker = 'GRAFANA_TOO_LONG_TEST ';
  const rejectedText = marker + 'x'.repeat(141 - marker.length);
  assert.equal(rejectedText.length, 141);
  const rejected = await post(rejectedText);
  assert.equal(rejected.status, 400);
  assert.deepEqual(await rejected.json(), { error: 'Todo text must contain 1 to 140 characters' });
  assert.deepEqual(saved, [todo]);
  const [created, blocked] = logs();
  assert.equal(logs().length, 2);
  assert.equal(created.outcome, 'created');
  assert.equal(created.todoId, todo.id);
  assert.equal(created.length, 140);
  assert.equal(blocked.event, 'todo_request');
  assert.equal(blocked.outcome, 'rejected');
  assert.equal(blocked.reason, 'too_long');
  assert.equal(blocked.status, 400);
  assert.equal(blocked.text, rejectedText);
  assert.equal(blocked.length, 141);
  assert.equal(blocked.maxLength, 140);
  assert.equal(blocked.requestId, rejected.headers.get('x-request-id'));
  assert.notEqual(blocked.requestId, created.requestId);
  assert.ok(Number.isFinite(Date.parse(blocked.timestamp)));
});

test('user-provided newlines stay in one JSON log line and secrets are excluded', async t => {
  const { url, output, logs } = await setup(t);
  const text = 'Read a book\n{"event":"forged"}';
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer private-token' },
    body: JSON.stringify({ text, password: 'private-password' }),
  });
  assert.equal(response.status, 201);
  await response.json();
  assert.equal(output.mock.callCount(), 1);
  const raw = output.mock.calls[0].arguments[0];
  assert.equal(raw.split('\n').length, 1);
  assert.equal(logs()[0].text, text);
  assert.doesNotMatch(raw, /private-token|private-password|Authorization/);
});

test('malformed, oversized, missing, empty, and unsupported submissions log bounded reasons', async t => {
  const { url, logs, saved } = await setup(t);
  const requests = [
    ['{', 'application/json', 400, 'invalid_json'],
    ['x'.repeat(9000), 'application/json', 413, 'body_too_large'],
    ['{}', 'application/json', 400, 'missing_text'],
    ['{"text":"   "}', 'application/json', 400, 'empty_text'],
    ['private-body', 'text/plain', 415, 'unsupported_content_type'],
  ];
  for (const [body, contentType, status, reason] of requests) {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': contentType }, body });
    assert.equal(response.status, status);
    await response.json();
    assert.equal(logs().at(-1).reason, reason);
  }
  assert.equal(logs().length, requests.length);
  assert.deepEqual(saved, []);
  assert.ok(logs().every(log => JSON.stringify(log).length < 1000));
  assert.doesNotMatch(JSON.stringify(logs()), /private-body/);
});

test('database failures log failed outcomes without leaking internal error details', async t => {
  const { post, logs, saved } = await setup(t, true);
  const response = await post('Do not lose this');
  assert.equal(response.status, 503);
  await response.json();
  assert.equal(logs().length, 1);
  assert.equal(logs()[0].outcome, 'failed');
  assert.equal(logs()[0].reason, 'database_unavailable');
  assert.equal(logs()[0].text, 'Do not lose this');
  assert.deepEqual(saved, []);
  assert.doesNotMatch(JSON.stringify(logs()), /private database details/);
});
