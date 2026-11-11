import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

async function requestCount(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
  if (!response.ok) throw new Error(`Ping-pong returned HTTP ${response.status}`);
  const count = (await response.text()).trim();
  if (!/^(0|[1-9]\d*)$/.test(count)) {
    throw new Error('Ping-pong returned an invalid count');
  }
  return count;
}

interface ConfigOptions {
  informationFile?: string;
  message?: string;
}

export function createApp(filePath: string, pingPongUrl = 'http://127.0.0.1:3001/pings', config: ConfigOptions = {}) {
  return createServer(async (_request, response) => {
    const headers = {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    };

    let content: string;
    try {
      content = await readFile(filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        response.writeHead(503, { ...headers, 'Retry-After': '1' });
        response.end('Log output is not ready yet\n');
      } else {
        console.error(error);
        response.writeHead(500, headers);
        response.end('Unable to read log output\n');
      }
      return;
    }

    let configOutput = '';
    if (config.informationFile !== undefined) {
      try {
        const information = await readFile(config.informationFile, 'utf8');
        configOutput = `file content: ${information.trimEnd()}\n`;
      } catch (error) {
        console.error(error);
        response.writeHead(500, headers);
        response.end('Unable to read configuration file\n');
        return;
      }
    }
    if (config.message !== undefined) {
      configOutput += `env variable: MESSAGE=${config.message}\n`;
    }

    try {
      const count = await requestCount(pingPongUrl);
      response.writeHead(200, headers);
      response.end(`${configOutput}${content.trimEnd()}.\nPing / Pongs: ${count}\n`);
    } catch (error) {
      console.error(error);
      response.writeHead(503, { ...headers, 'Retry-After': '1' });
      response.end('Ping-pong is temporarily unavailable\n');
    }
  });
}
