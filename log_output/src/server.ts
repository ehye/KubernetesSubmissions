import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

export function createApp(filePath: string) {
  return createServer(async (_request, response) => {
    const headers = {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    };

    try {
      const content = await readFile(filePath, 'utf8');
      response.writeHead(200, headers);
      response.end(content);
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
