declare global {
  interface Window {
    __LS_IMAGE_REQUEST_HEADERS__?: () => Record<string, string>;
  }
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * True when image XHR requests must attach gateway / parent-platform auth headers.
 */
export function needsImageAuthHeaders(): boolean {
  if (typeof window === "undefined") return false;
  const headers = window.__LS_IMAGE_REQUEST_HEADERS__?.();
  return Boolean(headers && typeof headers === "object" && Object.keys(headers).length > 0);
}

/**
 * Poll until auth headers are available (e.g. wujie parent injects token after sub-app mount).
 */
export async function waitForAuthHeaders(timeoutMs = 5000, intervalMs = 100): Promise<boolean> {
  if (needsImageAuthHeaders()) return true;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await delay(intervalMs);
    if (needsImageAuthHeaders()) return true;
  }

  return false;
}

/**
 * Backoff + wait for a fresh token before retrying a failed authenticated image request.
 */
export async function waitBeforeAuthRetry(attempt: number): Promise<void> {
  const backoff = Math.min(300 * 2 ** attempt, 3000);
  await delay(backoff);
  await waitForAuthHeaders(3000, 100);
}
