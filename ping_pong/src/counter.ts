import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

async function readCount(filePath: string): Promise<bigint> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0n;
    throw error;
  }

  if (!/^(0|[1-9]\d*)$/.test(content.trim())) {
    throw new Error('Invalid persisted ping-pong count');
  }
  return BigInt(content.trim());
}

export function createCounter(filePath: string) {
  let pending = Promise.resolve();

  return function increment(): Promise<bigint> {
    const update = pending.then(async () => {
      const previous = await readCount(filePath);
      await mkdir(dirname(filePath), { recursive: true });
      const temporaryPath = `${filePath}.${process.pid}.tmp`;
      await writeFile(temporaryPath, `${previous + 1n}\n`, { encoding: 'utf8', flush: true });
      await rename(temporaryPath, filePath);
      return previous;
    });
    // Serialize updates, while allowing a later request to retry after an I/O failure.
    pending = update.then(() => {}, () => {});
    return update;
  };
}
