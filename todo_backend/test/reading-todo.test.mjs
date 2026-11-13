import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { createReadingTodo, loadReadingTodoConfig } from '../dist/reading-todo.js';

async function setup(t, state = {}) {
  const posts = [];
  const wikiRequests = [];
  const server = createServer(async (request, response) => {
    if (request.url === '/wiki/Special:Random') {
      wikiRequests.push(request.headers);
      if (state.stallWikipedia) return;
      if (state.wikipediaStatus) {
        response.writeHead(state.wikipediaStatus);
        response.end('Unavailable');
        return;
      }
      if (state.noRedirect) {
        response.end('Random page without article');
        return;
      }
      response.writeHead(302, { Location: state.articlePaths?.shift() ?? state.articlePath ?? '/wiki/Example_article' });
      response.end();
      return;
    }
    if (request.url === '/todos') {
      let body = '';
      for await (const chunk of request) body += chunk;
      posts.push({ method: request.method, contentType: request.headers['content-type'], body: JSON.parse(body) });
      if (state.stallBackend) return;
      response.writeHead(state.backendStatus ?? 201, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ id: 'test-id', ...posts.at(-1).body }));
      return;
    }
    response.end('Article content');
  });
  t.after(() => { server.closeAllConnections(); server.close(); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const config = {
    randomUrl: `${base}/wiki/Special:Random`, todoApiUrl: `${base}/todos`,
    language: 'en-US', userAgent: 'TodoReadingReminderTest/1.0', timeoutMs: 1000,
  };
  return { base, config, posts, wikiRequests };
}

test('resolves a random article using en-US and posts its URL as plain todo text', async t => {
  const { base, config, posts, wikiRequests } = await setup(t);
  const text = await createReadingTodo(config);
  assert.equal(text, `Read ${base}/wiki/Example_article`);
  assert.equal(wikiRequests[0]['accept-language'], 'en-US');
  assert.equal(wikiRequests[0]['user-agent'], config.userAgent);
  assert.deepEqual(posts, [{ method: 'POST', contentType: 'application/json', body: { text } }]);
  assert.doesNotMatch(text, /Special:Random|<a|href=/);
});

test('does not create a todo when Wikipedia fails or does not return an article', async t => {
  for (const state of [{ wikipediaStatus: 503 }, { noRedirect: true }, { articlePath: '/not-an-article' }]) {
    const { config, posts } = await setup(t, state);
    await assert.rejects(createReadingTodo(config), /Wikipedia/);
    assert.equal(posts.length, 0);
  }
});

test('redirects to another origin are rejected', async t => {
  const other = await setup(t);
  const { config, posts } = await setup(t, { articlePath: `${other.base}/wiki/Other` });
  await assert.rejects(createReadingTodo(config), /did not redirect to an article/);
  assert.equal(posts.length, 0);
});

test('overlong URLs select another article until the full todo fits, then POST once', async t => {
  const { base, config, posts, wikiRequests } = await setup(t, {
    articlePaths: ['/wiki/' + 'A'.repeat(150), '/wiki/' + 'B'.repeat(150), '/wiki/Short_article'],
  });
  const text = await createReadingTodo(config);
  assert.equal(text, `Read ${base}/wiki/Short_article`);
  assert.equal(wikiRequests.length, 3);
  assert.ok(wikiRequests.every(headers => headers['accept-language'] === 'en-US'));
  assert.deepEqual(posts.map(post => post.body), [{ text }]);
});

test('a todo of exactly 140 characters is accepted', async t => {
  const state = {};
  const { base, config, posts } = await setup(t, state);
  state.articlePath = '/wiki/' + 'A'.repeat(140 - `Read ${base}/wiki/`.length);
  const text = await createReadingTodo(config);
  assert.equal(text.length, 140);
  assert.equal(posts.length, 1);
});

test('backend failures fail the job and are not retried', async t => {
  for (const backendStatus of [400, 503]) {
    const { config, posts } = await setup(t, { backendStatus });
    await assert.rejects(createReadingTodo(config), new RegExp(`HTTP ${backendStatus}`));
    assert.equal(posts.length, 1);
  }
});

test('Wikipedia and backend requests use the configured timeout', async t => {
  for (const state of [{ stallWikipedia: true }, { stallBackend: true }]) {
    const { config, posts } = await setup(t, state);
    await assert.rejects(createReadingTodo({ ...config, timeoutMs: 50 }), /timeout|aborted/i);
    assert.equal(posts.length, state.stallWikipedia ? 0 : 1);
  }
});

test('reading job configuration requires explicit URLs, language, user agent, and timeout', () => {
  const env = {
    WIKIPEDIA_RANDOM_URL: 'https://en.wikipedia.org/wiki/Special:Random',
    TODO_API_URL: 'http://todo-backend-svc:2345/todos', WIKIPEDIA_LANGUAGE: 'en-US',
    WIKIPEDIA_USER_AGENT: 'Test/1.0', REQUEST_TIMEOUT_MS: '1000',
  };
  assert.equal(loadReadingTodoConfig(env).timeoutMs, 1000);
  for (const name of Object.keys(env)) {
    assert.throws(() => loadReadingTodoConfig({ ...env, [name]: '' }), new RegExp(name));
  }
  for (const name of ['WIKIPEDIA_RANDOM_URL', 'TODO_API_URL']) {
    assert.throws(() => loadReadingTodoConfig({ ...env, [name]: 'file:///etc/passwd' }), new RegExp(name));
  }
  for (const value of ['0', '-1', 'NaN', '1.5', '2147483648']) {
    assert.throws(() => loadReadingTodoConfig({ ...env, REQUEST_TIMEOUT_MS: value }), /REQUEST_TIMEOUT_MS/);
  }
});

test('job entry point exits unsuccessfully when configuration is missing', () => {
  const result = spawnSync(process.execPath, ['dist/reading-job.js'], {
    cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 5000,
    env: { ...process.env, REQUEST_TIMEOUT_MS: '' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /REQUEST_TIMEOUT_MS is required/);
});

test('job entry point reports success or failure with the correct exit code', { timeout: 5000 }, async t => {
  for (const backendStatus of [201, 503]) {
    const { config, posts } = await setup(t, { backendStatus });
    const child = spawn(process.execPath, ['dist/reading-job.js'], {
      cwd: new URL('../', import.meta.url),
      env: {
        ...process.env, WIKIPEDIA_RANDOM_URL: config.randomUrl,
        TODO_API_URL: config.todoApiUrl, WIKIPEDIA_LANGUAGE: config.language,
        WIKIPEDIA_USER_AGENT: config.userAgent, REQUEST_TIMEOUT_MS: String(config.timeoutMs),
      },
    });
    t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    const [code] = await once(child, 'close');
    assert.equal(posts.length, 1);
    assert.equal(code, backendStatus === 201 ? 0 : 1);
    if (backendStatus === 201) assert.match(stdout, /^Created todo: Read http:/);
    else assert.match(stderr, /HTTP 503/);
  }
});
