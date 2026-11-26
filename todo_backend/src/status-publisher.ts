import { connect, type NatsConnection } from '@nats-io/transport-node';

export type TodoAction = 'created' | 'updated';

export function createStatusPublisher(url: string | undefined) {
  let nc: NatsConnection | undefined;
  let connecting = false;
  let stopped = false;
  async function open() {
    if (!url || stopped || connecting || (nc && !nc.isClosed())) return;
    connecting = true;
    try {
      const connection = await connect({ servers: url, name: 'todo-backend', timeout: 1500, maxReconnectAttempts: -1 });
      if (stopped) await connection.close();
      else nc = connection;
    } catch {
      console.warn('NATS unavailable; Todo writes remain enabled');
    } finally {
      connecting = false;
    }
  }
  void open();
  return {
    publish(action: TodoAction) {
      if (!nc || nc.isClosed()) {
        void open(); // Reconnect for future events; never replay this one.
        return;
      }
      try {
        nc.publish('todos.status', JSON.stringify({ user: 'bot', message: `A todo was ${action}` }));
      } catch {
        console.warn('Dropped Todo status publication');
      }
    },
    close() {
      stopped = true;
      return nc?.close();
    },
  };
}
