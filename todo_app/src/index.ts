import { createApp, parsePort } from './server.js';

try {
  const port = parsePort(process.env.PORT);
  const server = createApp({
    imagePath: process.env.IMAGE_CACHE_FILE,
    imageUrl: process.env.PICSUM_URL,
    backendUrl: process.env.TODO_BACKEND_URL,
    enableShutdownTest: process.env.ENABLE_SHUTDOWN_TEST === 'true',
  });

  server.on('error', (error: Error) => {
    console.error(`Server failed: ${error.message}`);
    process.exitCode = 1;
  });

  function shutdown(): void {
    server.close();
    // Bound shutdown time so active connections cannot delay Kubernetes termination indefinitely.
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
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
