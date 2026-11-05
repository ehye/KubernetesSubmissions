import { createApp, createLogger } from './server.js';

const portValue = process.env.PORT ?? '3000';
const port = Number(portValue);

if (!/^\d+$/.test(portValue) || !Number.isInteger(port) || port > 65535) {
  console.error('PORT must be an integer between 0 and 65535');
  process.exitCode = 1;
} else {
  const logger = createLogger();
  const server = createApp(logger.getStatus);
  let interval: ReturnType<typeof setInterval> | undefined;

  server.on('error', (error: Error) => {
    console.error(`Server failed: ${error.message}`);
    clearInterval(interval);
    process.exitCode = 1;
  });

  function shutdown(): void {
    clearInterval(interval);
    server.close();
    setTimeout(() => server.closeAllConnections(), 10_000).unref();
  }

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  server.listen(port, '0.0.0.0', () => {
    logger.log();
    interval = setInterval(logger.log, 5_000);
  });
}
