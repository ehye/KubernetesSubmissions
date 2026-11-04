import { createServer } from 'node:http';

export function parsePort(value: string | undefined): number {
  if (value === undefined) return 3000;

  if (!/^\d+$/.test(value) || !Number.isInteger(Number(value)) || Number(value) > 65535) {
    throw new Error('PORT must be an integer between 0 and 65535');
  }

  return Number(value);
}

export function createApp() {
  return createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Todo app\n');
  });
}
