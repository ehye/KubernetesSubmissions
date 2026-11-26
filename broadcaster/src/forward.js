export async function forward(data, webhook) {
  const { user, message } = JSON.parse(data);
  if (user !== 'bot' || !['A todo was created', 'A todo was updated'].includes(message)) {
    throw new Error('Invalid Todo status message');
  }
  // A timeout is ambiguous: the webhook may already have accepted the message.
  // Never retry this POST, even for HTTP 429 or 5xx.
  const response = await fetch(webhook, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user, content: message }),
  });
  await response.body?.cancel();
  if (!response.ok) throw new Error(`Webhook HTTP ${response.status}`);
}
