/** Bound headers AND body reads; even a stalled upstream body cannot strand login. */
export async function derivJson(url: string, init: RequestInit, timeoutMs = 5000): Promise<{response: Response; body: unknown}> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('Deriv request deadline exceeded')); }, timeoutMs);
  });
  try {
    return await Promise.race([deadline, (async () => {
      const response = await fetch(url, { ...init, signal: controller.signal });
      const body: unknown = await response.json().catch(() => null);
      return { response, body };
    })()]);
  } finally { if (timer) clearTimeout(timer); }
}
