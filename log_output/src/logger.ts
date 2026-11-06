import { randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export function createLogger(filePath: string) {
  const value = randomUUID();
  const temporaryPath = `${filePath}.${process.pid}.tmp`;

  return async function logValue(): Promise<void> {
    const line = `${new Date().toISOString()}: ${value}`;
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(temporaryPath, `${line}\n`, 'utf8');
    // Renaming within the same volume keeps readers from seeing a partial write.
    await rename(temporaryPath, filePath);
    console.log(line);
  };
}
