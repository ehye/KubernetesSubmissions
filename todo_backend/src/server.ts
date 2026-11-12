import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

interface Todo {
  id: string;
  text: string;
}

export function parsePort(value: string | undefined): number {
  if (value === undefined || value === '') throw new Error('PORT is required');
  if (!/^\d+$/.test(value) || !Number.isInteger(Number(value)) || Number(value) > 65535) {
    throw new Error('PORT must be an integer between 0 and 65535');
  }
  return Number(value);
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    // Drain oversized requests without keeping their data in memory.
    if (size <= 8_192) chunks.push(Buffer.from(chunk));
  }
  return size > 8_192 ? null : Buffer.concat(chunks).toString('utf8');
}

export function createApp() {
  // Each backend process owns its list. A database can replace this storage later.
  const todos: Todo[] = [];

  return createServer(async (request, response) => {
    if (request.url?.split('?')[0] !== '/todos') {
      sendJson(response, 404, { error: 'Not found' });
      return;
    }
    if (request.method === 'GET') {
      sendJson(response, 200, todos);
      return;
    }
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'GET, POST');
      sendJson(response, 405, { error: 'Method not allowed' });
      return;
    }
    if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      request.resume();
      sendJson(response, 415, { error: 'Content-Type must be application/json' });
      return;
    }

    try {
      const raw = await readBody(request);
      if (raw === null) {
        sendJson(response, 413, { error: 'Request body exceeds 8 KiB' });
        return;
      }
      let input: unknown;
      try {
        input = JSON.parse(raw);
      } catch {
        sendJson(response, 400, { error: 'Invalid JSON' });
        return;
      }
      if (typeof input !== 'object' || input === null || !('text' in input) || typeof input.text !== 'string') {
        sendJson(response, 400, { error: 'Todo text is required' });
        return;
      }
      const text = input.text.trim();
      if (text.length === 0 || input.text.length > 140) {
        sendJson(response, 400, { error: 'Todo text must contain 1 to 140 characters' });
        return;
      }
      const todo = { id: randomUUID(), text };
      todos.push(todo);
      sendJson(response, 201, todo);
    } catch (error) {
      console.error(error);
      if (!response.destroyed) sendJson(response, 500, { error: 'Unable to create todo' });
    }
  });
}
