import { connect } from '@nats-io/transport-node';
import { forward } from './forward.js';

const webhook = process.env.DISCORD_WEBHOOK_URL;
if (!webhook || !process.env.NATS_URL) throw new Error('DISCORD_WEBHOOK_URL and NATS_URL are required');
const nc = await connect({
  servers: process.env.NATS_URL, name: `broadcaster-${process.env.HOSTNAME}`,
  maxReconnectAttempts: -1,
});
const sub = nc.subscribe('todos.status', { queue: 'broadcaster' });
await nc.flush();
console.log('Subscribed to todos.status (queue: broadcaster)');
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { void nc.drain(); });
for await (const msg of sub) {
  try {
    await forward(msg.string(), webhook);
  } catch {
    // Neither the webhook URL nor the received payload belongs in logs.
    console.warn('Dropped Todo notification; not retrying');
  }
}
