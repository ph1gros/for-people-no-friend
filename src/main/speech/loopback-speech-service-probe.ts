const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export type SpeechProbeFetch = (
  input: string,
  init: RequestInit,
) => Promise<Pick<Response, 'status'>>;

export const probeLoopbackSpeechService = async (
  baseUrl: string,
  fetchLocal: SpeechProbeFetch = fetch,
): Promise<boolean> => {
  let endpoint: URL;
  try {
    endpoint = new URL(baseUrl);
  } catch {
    return false;
  }
  if (endpoint.protocol !== 'http:' || !LOOPBACK_HOSTS.has(endpoint.hostname)) return false;
  endpoint.pathname = '/health';
  endpoint.search = '';
  endpoint.hash = '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 700);
  try {
    await fetchLocal(endpoint.toString(), {
      method: 'GET',
      signal: controller.signal,
      redirect: 'error',
      cache: 'no-store',
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};
