const BASE = "http://same.invalid";

/**
 * Where to go after signing in: a path on this site, or "/". Parsed the way
 * a browser would resolve it, so tricks like "/\t/evil.com" or "/\\evil.com"
 * (which browsers treat as another host) fall back to "/".
 */
export function safeNext(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || /[\u0000-\u001f\u007f\\]/.test(value)) return "/";
  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return "/";
  }
  if (url.origin !== BASE || url.pathname.startsWith("//")) return "/";
  return url.pathname + url.search + url.hash;
}
