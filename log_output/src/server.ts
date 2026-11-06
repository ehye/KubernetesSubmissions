import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';

async function readCount(filePath: string): Promise<string> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '0';
    throw error;
  }
  if (!/^(0|[1-9]\d*)$/.test(content.trim())) {
    throw new Error('Invalid persisted ping-pong count');
  }
  return content.trim();
}

export function createApp(filePath: string, counterPath = join(dirname(filePath), 'pingpong-count.txt')) {
  return createServer(async (_request, response) => {
    const headers = {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    };

    try {
      const content = await readFile(filePath, 'utf8');
      const count = await readCount(counterPath);
      response.writeHead(200, headers);
      response.end(`${content.trimEnd()}.\nPing / Pongs: ${count}\n`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        response.writeHead(503, { ...headers, 'Retry-After': '1' });
        response.end('Log output is not ready yet\n');
      } else {
        console.error(error);
        response.writeHead(500, headers);
        response.end('Unable to read log output\n');
      }
    }
  });
}
