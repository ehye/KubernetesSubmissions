import type { IncomingMessage, ServerResponse } from 'node:http';

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

export async function proxyTodos(request: IncomingMessage, response: ServerResponse, backendUrl: string): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'POST') {
    response.setHeader('Allow', 'GET, POST');
    sendJson(response, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    let body: string | undefined;
    if (request.method === 'POST') {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size <= 8_192) chunks.push(Buffer.from(chunk));
      }
      if (size > 8_192) {
        sendJson(response, 413, { error: 'Request body exceeds 8 KiB' });
        return;
      }
      body = Buffer.concat(chunks).toString('utf8');
    }

    const upstream = await fetch(new URL('/todos', backendUrl), {
      method: request.method,
      headers: request.method === 'POST' ? { 'Content-Type': request.headers['content-type'] ?? 'application/octet-stream' } : undefined,
      body,
      signal: AbortSignal.timeout(3_000),
    });
    const content = await upstream.text();
    if (upstream.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      throw new Error('Todo backend returned a non-JSON response');
    }
    sendJson(response, upstream.status, JSON.parse(content));
  } catch (error) {
    console.error('Unable to reach todo backend:', error);
    if (!response.destroyed) sendJson(response, 503, { error: 'Todo backend is temporarily unavailable' });
  }
}
