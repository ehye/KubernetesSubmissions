import { createApp, parsePort } from './server.js';
import { createDatabase } from './counter.js';

let database: ReturnType<typeof createDatabase> | undefined;
try {
  const port = parsePort(process.env.PORT);
  database = createDatabase(process.env);
  await database.initialize();
  const counter = database;
  const server = createApp(counter);

  server.on('error', (error: Error) => {
    console.error(`Server failed: ${error.message}`);
    process.exitCode = 1;
    void counter.close();
  });

  function shutdown(): void {
    server.close(() => { void counter.close(); });
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
  await database?.close();
}
