export function loadConfig(env: NodeJS.ProcessEnv) {
  const host = env.HOST;
  if (host === undefined || host.trim() === '') throw new Error('HOST is required');
  const timeout = env.SHUTDOWN_TIMEOUT_MS;
  if (timeout === undefined || !/^\d+$/.test(timeout) || !Number.isSafeInteger(Number(timeout)) || Number(timeout) < 1 || Number(timeout) > 2_147_483_647) {
    throw new Error('SHUTDOWN_TIMEOUT_MS must be a positive integer no larger than 2147483647');
  }
  return { host, shutdownTimeoutMs: Number(timeout) };
}
