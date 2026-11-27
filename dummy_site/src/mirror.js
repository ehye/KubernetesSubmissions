import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { load } from 'cheerio';

const MiB = 1024 * 1024;
const types = new Map(Object.entries({
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/avif': 'avif', 'image/svg+xml': 'svg',
  'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico',
}));

function httpUrl(value, base) {
  const url = new URL(value, base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Expected an HTTP(S) URL without credentials');
  url.hash = '';
  return url;
}

async function download(url, limit) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Upstream HTTP ${response.status}`);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error('Download exceeds size limit');
    chunks.push(chunk);
  }
  return { url: response.url, type: response.headers.get('content-type')?.split(';')[0].trim(), data: Buffer.concat(chunks) };
}

export async function mirror(source, dir) {
  const page = await download(httpUrl(source), 2 * MiB);
  const $ = load(page.data.toString('utf8'));
  const base = httpUrl($('base[href]').first().attr('href') || page.url, page.url);
  $('base, picture source, meta[http-equiv="refresh" i]').remove();
  $('img').removeAttr('srcset');
  $('head').prepend('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src \'self\' data:; style-src \'unsafe-inline\'; form-action \'none\'; base-uri \'none\'">');
  await mkdir(path.join(dir, 'images'), { recursive: true });
  const seen = new Map();
  let total = 0;
  for (const img of $('img[src]').toArray()) {
    const src = $(img).attr('src');
    if (src.startsWith('data:image/')) continue;
    try {
      const url = httpUrl(src, base).href;
      if (!seen.has(url)) {
        if (seen.size >= 32 || total >= 24 * MiB) throw new Error('Image budget exhausted');
        seen.set(url, null);
        const image = await download(url, Math.min(4 * MiB, 24 * MiB - total));
        total += image.data.length;
        const ext = types.get(image.type);
        if (!ext) throw new Error('Unsupported image type');
        const file = `images/${createHash('sha256').update(url).digest('hex')}.${ext}`;
        await writeFile(path.join(dir, file), image.data);
        seen.set(url, file);
      }
      if (seen.get(url)) $(img).attr('src', seen.get(url));
      else $(img).removeAttr('src');
    } catch (err) {
      $(img).removeAttr('src');
      console.warn('Skipping image:', err.message);
    }
  }
  await writeFile(path.join(dir, 'index.html'), $.html());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await mirror(process.env.WEBSITE_URL, '/site');
