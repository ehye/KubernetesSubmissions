import { createApp, parsePort } from './server.js';
import { loadConfig } from './config.js';
import { createDatabase } from './database.js';
import { createStatusPublisher } from './status-publisher.js';

let database: ReturnType<typeof createDatabase> | undefined;
let publisher: ReturnType<typeof createStatusPublisher> | undefined;
try {
  const port = parsePort(process.env.PORT);
  const config = loadConfig(process.env);
  publisher = createStatusPublisher(process.env.NATS_URL);
  database = createDatabase(process.env, publisher.publish);
  const store = database;
  const server = createApp(store);

  server.on('error', (error: Error) => {
    console.error(`Server failed: ${error.message}`);
    process.exitCode = 1;
    void store.close();
    void publisher?.close();
  });

  function shutdown(): void {
    server.close(() => { void store.close(); void publisher?.close(); });
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
  await publisher?.close();
}
