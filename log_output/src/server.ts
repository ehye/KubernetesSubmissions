import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

export function createLogger() {
  const value = randomUUID();
  let status = `${new Date().toISOString()}: ${value}`;

  return {
    getStatus: () => status,
    log: () => {
      status = `${new Date().toISOString()}: ${value}`;
      console.log(status);
    },
  };
}

export function createApp(getStatus: () => string) {
  return createServer((_request, response) => {
    response.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(`${getStatus()}\n`);
  });
}
