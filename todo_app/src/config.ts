export function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === '') throw new Error(`${name} is required`);
  return value;
}

export function positiveInteger(env: NodeJS.ProcessEnv, name: string): number {
  const value = required(env, name);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > 2_147_483_647) {
    throw new Error(`${name} must be a positive integer no larger than 2147483647`);
  }
  return Number(value);
}

function httpUrl(env: NodeJS.ProcessEnv, name: string): string {
  const value = required(env, name);
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:') return value;
  } catch {}
  throw new Error(`${name} must be an HTTP or HTTPS URL`);
}

export function loadConfig(env: NodeJS.ProcessEnv) {
  const enabled = required(env, 'ENABLE_SHUTDOWN_TEST');
  if (enabled !== 'true' && enabled !== 'false') throw new Error('ENABLE_SHUTDOWN_TEST must be true or false');
  return {
    host: required(env, 'HOST'),
    imagePath: required(env, 'IMAGE_CACHE_FILE'),
    imageUrl: httpUrl(env, 'PICSUM_URL'),
    backendUrl: httpUrl(env, 'TODO_BACKEND_URL'),
    cacheDurationMs: positiveInteger(env, 'IMAGE_CACHE_DURATION_MS'),
    imageTimeoutMs: positiveInteger(env, 'IMAGE_TIMEOUT_MS'),
    backendTimeoutMs: positiveInteger(env, 'BACKEND_TIMEOUT_MS'),
    imageRetryAfterSeconds: positiveInteger(env, 'IMAGE_RETRY_AFTER_SECONDS'),
    shutdownTimeoutMs: positiveInteger(env, 'SHUTDOWN_TIMEOUT_MS'),
    enableShutdownTest: enabled === 'true',
  };
}
