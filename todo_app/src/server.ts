import { createServer } from 'node:http';
import { createImageCache } from './image-cache.js';

export function parsePort(value: string | undefined): number {
  if (value === undefined) return 3000;

  if (!/^\d+$/.test(value) || !Number.isInteger(Number(value)) || Number(value) > 65535) {
    throw new Error('PORT must be an integer between 0 and 65535');
  }

  return Number(value);
}

interface AppOptions {
  imagePath?: string;
  imageUrl?: string;
  enableShutdownTest?: boolean;
  onShutdown?: () => void;
}

export function createApp({
  imagePath = './data/todo-image/image.jpg',
  imageUrl,
  enableShutdownTest = false,
  onShutdown = () => process.exit(1),
}: AppOptions = {}) {
  const getImage = createImageCache({ filePath: imagePath, imageUrl });

  return createServer(async (request, response) => {
    const path = request.url?.split('?')[0];

    if (path === '/_test/shutdown') {
      if (!enableShutdownTest) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Not found\n');
      } else if (request.method !== 'POST') {
        response.writeHead(405, { Allow: 'POST', 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Use POST to test shutdown\n');
      } else {
        response.writeHead(202, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        response.end('Shutting down for testing\n', onShutdown);
      }
      return;
    }

    if (request.method === 'GET' && path === '/image') {
      try {
        const image = await getImage();
        response.writeHead(200, {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'no-store',
        });
        response.end(image);
      } catch (error) {
        console.error('Unable to load the image:', error);
        response.writeHead(503, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
          'Retry-After': '5',
        });
        response.end('Image is temporarily unavailable\n');
      }
      return;
    }

    if (request.method === 'GET' && path === '/') {
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Todo app</title>
    <style>
      body { max-width: 1200px; margin: 0 auto; padding: 24px; text-align: center; }
      img { display: block; width: 400px; max-width: 100%; height: auto; margin: 24px auto; }
      .todo-panel { max-width: 36rem; margin: 24px auto; text-align: left; }
      label { display: block; margin-bottom: 8px; }
      .todo-controls { display: flex; gap: 8px; }
      input { flex: 1; min-width: 0; padding: 8px; font: inherit; }
      button { padding: 8px 16px; font: inherit; }
      small { display: block; margin-top: 8px; }
      li { margin: 8px 0; }
    </style>
  </head>
  <body>
    <h1>Todo app</h1>
    <img src="/image" alt="Random photograph from Lorem Picsum" width="1200" height="1200">
    <section class="todo-panel" aria-labelledby="todos-heading">
      <h2 id="todos-heading">Todos</h2>
      <label for="todo-input">New todo</label>
      <div class="todo-controls">
        <input id="todo-input" name="todo" type="text" maxlength="140" aria-describedby="todo-limit" placeholder="What needs to be done?">
        <button type="button">Send</button>
      </div>
      <small id="todo-limit">Maximum 140 characters.</small>
      <ul>
        <li>Buy groceries</li>
        <li>Read a book</li>
        <li>Finish the Kubernetes exercise</li>
      </ul>
    </section>
  </body>
</html>
`);
      return;
    }

    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Todo app\n');
  });
}
