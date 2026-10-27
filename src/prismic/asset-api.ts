export type FetchFn = typeof fetch;

export type LibraryAsset = { id: string; url: string; size?: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  tries = 4,
  fetchImpl: FetchFn = fetch,
): Promise<Response> {
  for (let i = 0; ; i++) {
    const res = await fetchImpl(url, init);
    if (res.status !== 429 || i >= tries - 1) return res;
    await sleep(1500 * (i + 1));
  }
}

export const apiHeaders = (repo: string, token: string) => ({
  repository: repo,
  Authorization: `Bearer ${token}`,
});

export async function expectOk(res: Response, what: string): Promise<Response> {
  if (res.ok) return res;
  throw new Error(`${what}: ${res.status} ${(await res.text()).slice(0, 300)}`);
}

export async function listAssetsByFilename(
  repo: string,
  token: string,
  fetchImpl: FetchFn = fetch,
): Promise<Map<string, LibraryAsset>> {
  const map = new Map<string, LibraryAsset>();
  let cursor = "";
  for (;;) {
    const res = await expectOk(
      await fetchWithRetry(
        `https://asset-api.prismic.io/assets?limit=500${cursor}`,
        { headers: apiHeaders(repo, token) },
        4,
        fetchImpl,
      ),
      "asset list",
    );
    const page = (await res.json()) as {
      items: { id: string; filename: string; url: string; size?: number }[];
      cursor?: string;
    };
    for (const a of page.items) {
      map.set(a.filename, {
        id: a.id,
        url: a.url,
        ...(typeof a.size === "number" ? { size: a.size } : {}),
      });
    }
    if (!page.cursor || !page.items.length) return map;
    cursor = `&cursor=${encodeURIComponent(page.cursor)}`;
  }
}

export async function uploadAsset(
  repo: string,
  token: string,
  filename: string,
  blob: Blob,
  opts: { alt?: string; fetchImpl?: FetchFn } = {},
): Promise<LibraryAsset> {
  const form = new FormData();
  form.append("file", blob, filename);
  if (opts.alt) form.append("alt", opts.alt);
  const res = await expectOk(
    await fetchWithRetry(
      "https://asset-api.prismic.io/assets",
      { method: "POST", headers: apiHeaders(repo, token), body: form },
      4,
      opts.fetchImpl ?? fetch,
    ),
    `upload asset ${filename}`,
  );
  const created = (await res.json()) as { id: string; url: string };
  return { id: created.id, url: created.url };
}
