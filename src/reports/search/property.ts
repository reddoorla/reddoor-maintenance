const HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

export function normalizeSearchConsoleProperty(raw: string): string | null {
  const v = raw.trim();
  const domain = /^sc-domain:(.+)$/i.exec(v);
  if (domain) {
    const host = domain[1]!.trim();
    return HOST.test(host) ? `sc-domain:${host.toLowerCase()}` : null;
  }
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.search || url.hash || url.username || url.password) return null;
  if (!HOST.test(url.hostname)) return null;
  return url.href.endsWith("/") ? url.href : `${url.href}/`;
}
