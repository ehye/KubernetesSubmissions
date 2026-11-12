import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { createImageCache, IMAGE_CACHE_DURATION_MS, createApp, testEnv } from './helpers.mjs';

const imageOne = Buffer.from([0xff, 0xd8, 1, 0xff, 0xd9]);
const imageTwo = Buffer.from([0xff, 0xd8, 2, 0xff, 0xd9]);
const imageResponse = image => new Response(image, { headers: { 'Content-Type': 'image/jpeg' } });

async function temporaryImage(t) {
  const directory = await mkdtemp(join(tmpdir(), 'todo-image-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return join(directory, 'todo-image', 'image.jpg');
}

async function listen(t, server) {
  t.after(() => { server.closeAllConnections(); server.close(); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

test('downloads once, persists the image, and reuses it after cache recreation', async t => {
  const filePath = await temporaryImage(t);
  let downloads = 0;
  const fetchImage = async url => {
    downloads++;
    assert.equal(url.origin, new URL(testEnv.PICSUM_URL).origin);
    assert.equal(url.pathname, new URL(testEnv.PICSUM_URL).pathname);
    assert.ok(url.searchParams.has('random'));
    return imageResponse(imageOne);
  };
  const getImage = createImageCache({ filePath, fetchImage });
  assert.deepEqual(await getImage(), imageOne);
  const modified = (await stat(filePath)).mtimeMs;
  assert.deepEqual(await getImage(), imageOne);
  const restarted = createImageCache({ filePath, fetchImage });
  assert.deepEqual(await restarted(), imageOne);
  assert.equal(downloads, 1);
  assert.deepEqual(await readFile(filePath), imageOne);
  assert.equal((await stat(filePath)).mtimeMs, modified);
});

test('keeps the image for ten minutes, then persists a fresh image on request', async t => {
  const filePath = await temporaryImage(t);
  let now = Date.now();
  let downloads = 0;
  const getImage = createImageCache({
    filePath,
    now: () => now,
    fetchImage: async () => imageResponse(++downloads === 1 ? imageOne : imageTwo),
  });
  await getImage();
  const downloadedAt = (await stat(filePath)).mtimeMs;
  now = downloadedAt + IMAGE_CACHE_DURATION_MS - 1;
  assert.deepEqual(await getImage(), imageOne);
  assert.equal(downloads, 1);
  now = downloadedAt + IMAGE_CACHE_DURATION_MS;
  assert.deepEqual(await getImage(), imageTwo);
  assert.equal(downloads, 2);
  assert.deepEqual(await readFile(filePath), imageTwo);
});

test('concurrent cache misses share one download', async t => {
  const filePath = await temporaryImage(t);
  let release;
  let started;
  let downloads = 0;
  const blocked = new Promise(resolve => { release = resolve; });
  const downloadStarted = new Promise(resolve => { started = resolve; });
  const getImage = createImageCache({
    filePath,
    fetchImage: async () => {
      downloads++;
      started();
      await blocked;
      return imageResponse(imageOne);
    },
  });
  const requests = Array.from({ length: 10 }, () => getImage());
  await downloadStarted;
  assert.equal(downloads, 1);
  release();
  for (const image of await Promise.all(requests)) assert.deepEqual(image, imageOne);
  assert.equal(downloads, 1);
});

test('failed refresh preserves the existing image and its expiry timestamp', async t => {
  const filePath = await temporaryImage(t);
  let now = Date.now();
  let fail = false;
  t.mock.method(console, 'error', () => {});
  const getImage = createImageCache({
    filePath,
    now: () => now,
    fetchImage: async () => {
      if (fail) throw new Error('Picsum unavailable');
      return imageResponse(imageOne);
    },
  });
  await getImage();
  const modified = (await stat(filePath)).mtimeMs;
  now = modified + IMAGE_CACHE_DURATION_MS;
  fail = true;
  assert.deepEqual(await getImage(), imageOne);
  assert.deepEqual(await readFile(filePath), imageOne);
  assert.equal((await stat(filePath)).mtimeMs, modified);
});

test('a failed persistent write cannot replace a valid cached image', async t => {
  const filePath = await temporaryImage(t);
  let now = Date.now();
  let downloads = 0;
  t.mock.method(console, 'error', () => {});
  const getImage = createImageCache({
    filePath,
    now: () => now,
    fetchImage: async () => imageResponse(++downloads === 1 ? imageOne : imageTwo),
  });
  await getImage();
  now = (await stat(filePath)).mtimeMs + IMAGE_CACHE_DURATION_MS;
  // Prevent writing the temporary file without changing the existing image.
  await mkdir(`${filePath}.${process.pid}.tmp`);
  assert.deepEqual(await getImage(), imageOne);
  assert.deepEqual(await readFile(filePath), imageOne);
});

test('rejects invalid upstream responses without creating a cached image', async t => {
  const filePath = await temporaryImage(t);
  for (const response of [
    new Response('Unavailable', { status: 503 }),
    new Response('<html>Error</html>', { headers: { 'Content-Type': 'text/html' } }),
    imageResponse(Buffer.alloc(0)),
  ]) {
    const getImage = createImageCache({ filePath, fetchImage: async () => response });
    await assert.rejects(getImage(), /Picsum/);
    await assert.rejects(readFile(filePath), { code: 'ENOENT' });
  }
});

test('GET /image follows redirects and serves a locally cached JPEG', { timeout: 5000 }, async t => {
  const filePath = await temporaryImage(t);
  let downloads = 0;
  const upstream = await listen(t, createServer((request, response) => {
    if (request.url.startsWith('/1200')) {
      downloads++;
      response.writeHead(302, { Location: '/photo.jpg' });
      response.end();
    } else {
      response.writeHead(200, { 'Content-Type': 'image/jpeg' });
      response.end(imageOne);
    }
  }));
  const base = await listen(t, createApp({ imagePath: filePath, imageUrl: `${upstream}/1200` }));
  const page = await fetch(base);
  assert.match(await page.text(), /<h1>Todo app<\/h1>\s*<img src="\/image"/);
  assert.equal(downloads, 0);
  for (let i = 0; i < 2; i++) {
    const response = await fetch(`${base}/image`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/jpeg');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), imageOne);
  }
  assert.equal(downloads, 1);
});

test('GET /image returns 503 without a cache and can recover on retry', { timeout: 5000 }, async t => {
  const filePath = await temporaryImage(t);
  let fail = true;
  t.mock.method(console, 'error', () => {});
  const upstream = await listen(t, createServer((_request, response) => {
    response.writeHead(fail ? 503 : 200, { 'Content-Type': 'image/jpeg' });
    response.end(fail ? 'Unavailable' : imageOne);
  }));
  const base = await listen(t, createApp({ imagePath: filePath, imageUrl: upstream }));
  const failed = await fetch(`${base}/image`);
  assert.equal(failed.status, 503);
  assert.equal(failed.headers.get('retry-after'), '5');
  await failed.text();
  fail = false;
  const recovered = await fetch(`${base}/image`);
  assert.equal(recovered.status, 200);
  assert.deepEqual(Buffer.from(await recovered.arrayBuffer()), imageOne);
});

test('shutdown testing is disabled by default and requires POST when enabled', { timeout: 5000 }, async t => {
  let shutdowns = 0;
  const disabled = await listen(t, createApp({ onShutdown: () => { shutdowns++; } }));
  const rejected = await fetch(`${disabled}/_test/shutdown`, { method: 'POST' });
  assert.equal(rejected.status, 404);
  await rejected.text();
  const enabled = await listen(t, createApp({
    enableShutdownTest: true,
    onShutdown: () => { shutdowns++; },
  }));
  const get = await fetch(`${enabled}/_test/shutdown`);
  assert.equal(get.status, 405);
  assert.equal(get.headers.get('allow'), 'POST');
  await get.text();
  assert.equal(shutdowns, 0);
  const post = await fetch(`${enabled}/_test/shutdown`, { method: 'POST' });
  assert.equal(post.status, 202);
  await post.text();
  assert.equal(shutdowns, 1);
});

test('cached image survives a test crash without another upstream request', { timeout: 10_000 }, async t => {
  const filePath = await temporaryImage(t);
  let downloads = 0;
  const upstream = await listen(t, createServer((_request, response) => {
    downloads++;
    response.writeHead(200, { 'Content-Type': 'image/jpeg' });
    response.end(imageOne);
  }));

  async function startChild(enableShutdownTest) {
    const child = spawn(process.execPath, ['dist/index.js'], {
      cwd: new URL('../', import.meta.url),
      env: {
        ...process.env,
        ...testEnv,
        PORT: '0',
        IMAGE_CACHE_FILE: filePath,
        PICSUM_URL: upstream,
        ENABLE_SHUTDOWN_TEST: String(enableShutdownTest),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');
        child.kill('SIGKILL');
        await exited;
      }
    });
    const output = createInterface({ input: child.stdout });
    t.after(() => output.close());
    const [line] = await once(output, 'line');
    const match = /^Server started in port (\d+)$/.exec(line);
    assert.ok(match, line);
    return { child, base: `http://127.0.0.1:${match[1]}` };
  }

  const first = await startChild(true);
  assert.deepEqual(Buffer.from(await (await fetch(`${first.base}/image`)).arrayBuffer()), imageOne);
  const modified = (await stat(filePath)).mtimeMs;
  const crashed = once(first.child, 'exit');
  const shutdown = await fetch(`${first.base}/_test/shutdown`, { method: 'POST' });
  assert.equal(shutdown.status, 202);
  await shutdown.text();
  assert.deepEqual(await crashed, [1, null]);

  const second = await startChild(false);
  assert.deepEqual(Buffer.from(await (await fetch(`${second.base}/image`)).arrayBuffer()), imageOne);
  assert.equal(downloads, 1);
  assert.equal((await stat(filePath)).mtimeMs, modified);
  const exited = once(second.child, 'exit');
  second.child.kill('SIGTERM');
  assert.deepEqual(await exited, [0, null]);
});
