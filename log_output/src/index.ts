import { randomUUID } from 'node:crypto';

const value = randomUUID();

function logValue(): void {
  console.log(`${new Date().toISOString()}: ${value}`);
}

const interval = setInterval(logValue, 5_000);

function shutdown(): void {
  clearInterval(interval);
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

logValue();
