import { createServer } from 'node:http';

export function parsePort(value: string | undefined): number {
  if (value === undefined) return 3000;

  if (!/^\d+$/.test(value) || !Number.isInteger(Number(value)) || Number(value) > 65535) {
    throw new Error('PORT must be an integer between 0 and 65535');
  }

  return Number(value);
}

export function createApp() {
  return createServer((request, response) => {
    if (request.method === 'GET' && request.url?.split('?')[0] === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Todo app</title>
  </head>
  <body>
    <h1>Todo app</h1>
  </body>
</html>
`);
      return;
    }

    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Todo app\n');
  });
}
