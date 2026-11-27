import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { load } from 'cheerio';
import { mirror } from '../src/mirror.js';

test('mirrors redirected HTML and relative images once, preserving bytes and removing remote image overrides', async t => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=', 'base64');
  let hits = 0;
  const server = createServer((req, res) => {
    if (req.url === '/') return res.writeHead(302, { location: '/pages/test' }).end();
    if (req.url === '/pages/test') return res.end('<base href="../assets/"><h1>Local copy</h1><picture><source srcset="remote.webp"><img src="dot.png" srcset="other.png 2x"></picture><img src="./dot.png"><img src="missing">');
    if (req.url === '/assets/dot.png') { hits++; return res.writeHead(200, { 'content-type': 'image/png' }).end(png); }
    res.writeHead(404).end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const dir = await mkdtemp(path.join(tmpdir(), 'dummysite-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mirror(`http://127.0.0.1:${server.address().port}`, dir);
  const $ = load(await readFile(path.join(dir, 'index.html'), 'utf8'));
  assert.equal($('h1').text(), 'Local copy');
  assert.equal($('base,source,[srcset]').length, 0);
  const src = $('img').first().attr('src');
  assert.match(src, /^images\/[0-9a-f]{64}\.png$/);
  assert.equal($('img').eq(1).attr('src'), src);
  assert.equal($('img').last().attr('src'), undefined);
  assert.deepEqual(await readFile(path.join(dir, src)), png);
  assert.equal((await readdir(path.join(dir, 'images'))).length, 1);
  assert.equal(hits, 1);
});
