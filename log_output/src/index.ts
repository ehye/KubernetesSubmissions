import { createApp } from './server.js';

const portValue = process.env.PORT ?? '3000';
const port = Number(portValue);

if (!/^\d+$/.test(portValue) || !Number.isInteger(port) || port > 65535) {
  console.error('PORT must be an integer between 0 and 65535');
  process.exitCode = 1;
} else {
  const server = createApp(process.env.LOG_FILE ?? './data/log.txt', process.env.PING_PONG_URL);

  server.on('error', (error: Error) => {
    console.error(`Server failed: ${error.message}`);
    process.exitCode = 1;
  });

  function shutdown(): void {
    server.close();
    setTimeout(() => server.closeAllConnections(), 10_000).unref();
  }

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  server.listen(port, '0.0.0.0', () => {
    const address = server.address();
    if (address !== null && typeof address !== 'string') {
      console.log(`Server started in port ${address.port}`);
    }
  });
}
