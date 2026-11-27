import { connect } from '@nats-io/transport-node';
import { forward } from './forward.js';

const mode = process.env.BROADCAST_MODE ?? 'discord';
const subject = process.env.NATS_SUBJECT ?? 'todos.status';
const webhook = process.env.DISCORD_WEBHOOK_URL;
if (!['log', 'discord'].includes(mode)) throw new Error('Invalid BROADCAST_MODE');
if (!process.env.NATS_URL || (mode === 'discord' && !webhook)) throw new Error('Missing broadcaster connection settings');
const nc = await connect({
  servers: process.env.NATS_URL, name: `broadcaster-${process.env.HOSTNAME}`,
  maxReconnectAttempts: -1,
});
const sub = nc.subscribe(subject, { queue: 'broadcaster' });
await nc.flush();
console.log(`Subscribed to ${subject} (queue: broadcaster)`);
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { void nc.drain(); });
for await (const msg of sub) {
  try {
    if (mode === 'log') console.log(JSON.stringify({ subject, notification: msg.string() }));
    else await forward(msg.string(), webhook);
  } catch {
    // Neither the webhook URL nor the received payload belongs in logs.
    console.warn('Dropped Todo notification; not retrying');
  }
}
