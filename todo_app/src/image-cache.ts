import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

interface ImageCacheOptions {
  filePath: string;
  imageUrl: string;
  cacheDurationMs: number;
  timeoutMs: number;
  now?: () => number;
  fetchImage?: typeof fetch;
}

export function createImageCache({
  filePath,
  imageUrl,
  cacheDurationMs,
  timeoutMs,
  now = Date.now,
  fetchImage = fetch,
}: ImageCacheOptions) {
  let pending: Promise<Buffer> | undefined;

  async function loadImage(): Promise<Buffer> {
    let cached: Buffer | undefined;
    try {
      const metadata = await stat(filePath);
      const content = await readFile(filePath);
      if (content.length > 0) {
        cached = content;
        if (now() - metadata.mtimeMs < cacheDurationMs) return cached;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    try {
      const url = new URL(imageUrl);
      url.searchParams.set('random', randomUUID());
      const response = await fetchImage(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok || response.headers.get('content-type')?.split(';')[0] !== 'image/jpeg') {
        throw new Error('Picsum did not return a JPEG image');
      }
      const image = Buffer.from(await response.arrayBuffer());
      if (image.length === 0) throw new Error('Picsum returned an empty image');

      await mkdir(dirname(filePath), { recursive: true });
      const temporaryPath = `${filePath}.${process.pid}.tmp`;
      try {
        await writeFile(temporaryPath, image, { flush: true });
        // Only a complete download replaces the persistent image and its timestamp.
        await rename(temporaryPath, filePath);
      } finally {
        await rm(temporaryPath, { force: true }).catch(() => {});
      }
      return image;
    } catch (error) {
      if (cached) {
        console.error('Image refresh failed; serving the previous image:', error);
        return cached;
      }
      throw error;
    }
  }

  return async function getImage(): Promise<Buffer> {
    // Concurrent requests share one cache check/download rather than calling Picsum repeatedly.
    pending ??= loadImage();
    try {
      return await pending;
    } finally {
      pending = undefined;
    }
  };
}
