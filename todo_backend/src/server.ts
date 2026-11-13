import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import type { TodoStore } from './database.js';

const MAX_TODO_LENGTH = 140;

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

export function createApp(todos: TodoStore) {
  return createServer(async (request, response) => {
    if (request.url?.split('?')[0] !== '/todos') {
      sendJson(response, 404, { error: 'Not found' });
      return;
    }
    if (request.method === 'GET') {
      try {
        sendJson(response, 200, await todos.list());
      } catch {
        console.error('Unable to read todos from PostgreSQL');
        sendJson(response, 503, { error: 'Todo database is temporarily unavailable' });
      }
      return;
    }
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'GET, POST');
      sendJson(response, 405, { error: 'Method not allowed' });
      return;
    }
    const requestId = randomUUID();
    response.setHeader('X-Request-ID', requestId);
    let submittedText: string | undefined;
    function respond(status: number, reason: string, body: unknown, todoId?: string): void {
      // JSON encoding keeps user-provided newlines within a single log line.
      // Raw bodies, headers, and credentials are deliberately not logged.
      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        event: 'todo_request',
        requestId,
        method: 'POST',
        path: '/todos',
        status,
        outcome: status === 201 ? 'created' : status >= 500 ? 'failed' : 'rejected',
        reason,
        text: submittedText,
        length: submittedText?.length,
        maxLength: MAX_TODO_LENGTH,
        todoId,
      }));
      if (!response.destroyed) sendJson(response, status, body);
    }
    if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      request.resume();
      respond(415, 'unsupported_content_type', { error: 'Content-Type must be application/json' });
      return;
    }

    let failureReason = 'request_read_failed';
    try {
      const raw = await readBody(request);
      if (raw === null) {
        respond(413, 'body_too_large', { error: 'Request body exceeds 8 KiB' });
        return;
      }
      let input: unknown;
      try {
        input = JSON.parse(raw);
      } catch {
        respond(400, 'invalid_json', { error: 'Invalid JSON' });
        return;
      }
      if (typeof input !== 'object' || input === null || !('text' in input) || typeof input.text !== 'string') {
        respond(400, 'missing_text', { error: 'Todo text is required' });
        return;
      }
      const text = input.text.trim();
      submittedText = input.text;
      if (text.length === 0 || input.text.length > MAX_TODO_LENGTH) {
        respond(400, input.text.length > MAX_TODO_LENGTH ? 'too_long' : 'empty_text', {
          error: `Todo text must contain 1 to ${MAX_TODO_LENGTH} characters`,
        });
        return;
      }
      const todo = { id: randomUUID(), text };
      failureReason = 'database_unavailable';
      const saved = await todos.create(todo);
      respond(201, 'created', saved, saved.id);
    } catch {
      respond(503, failureReason, { error: 'Todo database is temporarily unavailable' });
    }
  });
}
