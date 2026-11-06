import { setInterval } from 'node:timers/promises';
import { createLogger } from './logger.js';

const controller = new AbortController();
const shutdown = () => controller.abort();
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

try {
  const logValue = createLogger(process.env.LOG_FILE ?? './data/log.txt');
  await logValue();
  for await (const _ of setInterval(5_000, undefined, { signal: controller.signal })) {
    // Await each write so interval ticks cannot produce overlapping writes.
    await logValue();
  }
} catch (error) {
  if (!(controller.signal.aborted && error instanceof Error && error.name === 'AbortError')) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
