import { loadConfig } from '../dist/config.js';
import { createApp as app } from '../dist/server.js';
import { createImageCache as cache } from '../dist/image-cache.js';

// Explicit test fixtures, not production defaults.
export const testEnv = {
  HOST: '127.0.0.1', PORT: '0',
  IMAGE_CACHE_FILE: './data/todo-image/image.jpg',
  PICSUM_URL: 'http://127.0.0.1:1/image',
  TODO_BACKEND_URL: 'http://127.0.0.1:1',
  IMAGE_CACHE_DURATION_MS: '600000', IMAGE_TIMEOUT_MS: '15000',
  BACKEND_TIMEOUT_MS: '3000', SHUTDOWN_TIMEOUT_MS: '10000',
  IMAGE_RETRY_AFTER_SECONDS: '5',
  ENABLE_SHUTDOWN_TEST: 'false',
};
export const IMAGE_CACHE_DURATION_MS = Number(testEnv.IMAGE_CACHE_DURATION_MS);
export const createApp = (options = {}) => app({ ...loadConfig(testEnv), ...options });
export const createImageCache = options => cache({
  imageUrl: testEnv.PICSUM_URL,
  cacheDurationMs: IMAGE_CACHE_DURATION_MS,
  timeoutMs: Number(testEnv.IMAGE_TIMEOUT_MS),
  ...options,
});
