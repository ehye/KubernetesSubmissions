export interface ReadingTodoConfig {
  randomUrl: string;
  todoApiUrl: string;
  language: string;
  userAgent: string;
  timeoutMs: number;
}

export function loadReadingTodoConfig(env: NodeJS.ProcessEnv): ReadingTodoConfig {
  function required(name: string): string {
    const value = env[name];
    if (!value?.trim()) throw new Error(`${name} is required`);
    return value;
  }
  function httpUrl(name: string): string {
    const value = required(name);
    try {
      const url = new URL(value);
      if (url.protocol === 'http:' || url.protocol === 'https:') return value;
    } catch {}
    throw new Error(`${name} must be an HTTP or HTTPS URL`);
  }
  const timeout = required('REQUEST_TIMEOUT_MS');
  if (!/^\d+$/.test(timeout) || !Number.isSafeInteger(Number(timeout)) || Number(timeout) < 1 || Number(timeout) > 2_147_483_647) {
    throw new Error('REQUEST_TIMEOUT_MS must be a positive integer no larger than 2147483647');
  }
  return {
    randomUrl: httpUrl('WIKIPEDIA_RANDOM_URL'),
    todoApiUrl: httpUrl('TODO_API_URL'),
    language: required('WIKIPEDIA_LANGUAGE'),
    userAgent: required('WIKIPEDIA_USER_AGENT'),
    timeoutMs: Number(timeout),
  };
}

export async function createReadingTodo(config: ReadingTodoConfig): Promise<string> {
  let text: string;
  while (true) {
    const article = await fetch(config.randomUrl, {
      headers: { 'Accept-Language': config.language, 'User-Agent': config.userAgent },
      redirect: 'follow',
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    // Only the final redirect URL is needed; do not download the article body.
    await article.body?.cancel();
    if (!article.ok) throw new Error(`Wikipedia returned HTTP ${article.status}`);
    const url = new URL(article.url);
    const source = new URL(config.randomUrl);
    if (url.origin !== source.origin || !url.pathname.startsWith('/wiki/') || url.pathname === source.pathname) {
      throw new Error('Wikipedia did not redirect to an article');
    }
    text = `Read ${url.href}`;
    if (text.length <= 140) break;
    // The CronJob deadline bounds the overall run if no suitable article is found.
  }

  const response = await fetch(config.todoApiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    redirect: 'error',
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  await response.body?.cancel();
  if (response.status !== 201) throw new Error(`Todo backend returned HTTP ${response.status}; todo creation was not confirmed`);
  return text;
}
