import { createServer } from 'node:http';

export function parsePort(value: string | undefined): number {
  if (value === undefined) return 3000;

  if (!/^\d+$/.test(value) || !Number.isInteger(Number(value)) || Number(value) > 65535) {
    throw new Error('PORT must be an integer between 0 and 65535');
  }

  return Number(value);
}

export function createApp() {
  let counter = 0n;

  return createServer((request, response) => {
    const path = request.url?.split('?')[0];
    if (path !== '/pingpong' && path !== '/pings') {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }

    if (request.method !== 'GET') {
      response.writeHead(405, {
        'Content-Type': 'text/plain; charset=utf-8',
        Allow: 'GET',
      });
      response.end('Method not allowed');
      return;
    }

    response.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(path === '/pings' ? `${counter}` : `pong ${counter++}`);
  });
}
