import { createServer } from 'node:http';
import { createCounter } from './counter.js';

export function parsePort(value: string | undefined): number {
  if (value === undefined) return 3000;

  if (!/^\d+$/.test(value) || !Number.isInteger(Number(value)) || Number(value) > 65535) {
    throw new Error('PORT must be an integer between 0 and 65535');
  }

  return Number(value);
}

export function createApp(counterPath: string) {
  const increment = createCounter(counterPath);

  return createServer(async (request, response) => {
    if (request.url?.split('?')[0] !== '/pingpong') {
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

    try {
      const previous = await increment();
      response.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end(`pong ${previous}`);
    } catch (error) {
      console.error(error);
      response.writeHead(500, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end('Unable to update ping-pong count');
    }
  });
}
