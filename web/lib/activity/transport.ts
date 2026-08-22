export class ActivityRequestError extends Error {
  status?: number;
}

export async function activityRequest<T>(path: string, token: string | null, options: RequestInit = {}): Promise<T> {
  if (!token) throw new Error('Activity authentication is not ready');

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
  const forwardAbort = () => controller.abort();
  options.signal?.addEventListener('abort', forwardAbort, { once: true });

  try {
    const response = await fetch(path, {
      ...options,
      signal: controller.signal,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new ActivityRequestError(body.error || `Request failed: ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return body as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError' && !options.signal?.aborted) {
      throw new Error('Request timed out');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
    options.signal?.removeEventListener('abort', forwardAbort);
  }
}
