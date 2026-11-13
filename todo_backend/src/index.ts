import { createApp, parsePort } from './server.js';
import { loadConfig } from './config.js';
import { createDatabase } from './database.js';

let database: ReturnType<typeof createDatabase> | undefined;
try {
  const port = parsePort(process.env.PORT);
  const config = loadConfig(process.env);
  database = createDatabase(process.env);
  await database.initialize();
  const store = database;
  const server = createApp(store);

  server.on('error', (error: Error) => {
    console.error(`Server failed: ${error.message}`);
    process.exitCode = 1;
    void store.close();
  });

  function shutdown(): void {
    server.close(() => { void store.close(); });
    setTimeout(() => server.closeAllConnections(), config.shutdownTimeoutMs).unref();
  }
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  server.listen(port, config.host, () => {
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
