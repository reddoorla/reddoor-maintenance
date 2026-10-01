# Blux capture: https://mantislandscaping.com

Captured 2026-10-01T17:31:44.129Z by a one-off script (below), for the plan in
[`docs/mantis-landscaping-plan-2026-10.md`](../../docs/mantis-landscaping-plan-2026-10.md)
(#1107). Blux site id `6e0b52ee-9bb9-4c5a-b1ee-653009e3b572`.

**6 pages, 105 files, 244.0 MB. 0 failed to download.**

Only `manifest.json` is here: each page and file's URL, local path, bytes and
sha256, plus the page titles and each page's `data-media` ids. The bytes are not
in this repo. The plan's §3 says why, and says that P0 re-captures them into the
site repo from the Blux export. A later capture proves it fetched the same thing
by matching these sha256s.

## Why not `scripts/webflow-capture`

`node scripts/webflow-capture/capture.mjs --ref https://mantislandscaping.com --expect-pages 6`
captured 5 pages and 11 files, and its check failed twice: `manifest.json has no
siteId` (it keys on Webflow's `data-wf-site`) and `5 pages captured, expected
6`. Blux builds every image URL at runtime from `data-base` + `w:<width>/` +
`data-media`, which a reader of literal URLs cannot see. `/projects/ediblegardens`
is linked only from the projects feed's script.

## Pages

| path                           | bytes  | images |
| ------------------------------ | ------ | ------ |
| `/`                            | 102935 | 16     |
| `/contact-us`                  | 58251  | 1      |
| `/ediblegardens`               | 138032 | 51     |
| `/projects`                    | 80258  | 3      |
| `/projects/water-wise-gardens` | 119683 | 40     |
| `/projects/ediblegardens`      | 126071 | 43     |

There are 89 unique images across the pages. That is the same set as the 89
unique `image:loc` entries in `sitemap.xml`, checked with `comm`.

## Files by host

| host                            | files | MB     | what                                      |
| ------------------------------- | ----- | ------ | ----------------------------------------- |
| `dv4tl7yyk1zlp.cloudfront.net`  | 89    | 242.35 | original uploads (74 jpg, 13 png, 2 gif)  |
| `d3syaxnfm3oj0e.cloudfront.net` | 6     | 0.71   | renditions named literally (favicons, og) |
| `fonts.gstatic.com`             | 5     | 0.14   | Nunito 300/700                            |
| `s3.amazonaws.com`              | 1     | 0.14   | Mailchimp `mc-validate.js`                |
| `mantislandscaping.com`         | 1     | 0.05   | Blux `__analytics.js`                     |
| `eep.io`                        | 1     | 0.02   | Mailchimp badge                           |
| `fonts.googleapis.com`          | 1     | 0.00   | font CSS                                  |
| `cdn-images.mailchimp.com`      | 1     | 0.00   | Mailchimp form CSS                        |

## How it was captured

The script makes plain GETs, one at a time, with a 600 ms pause between pages
and 150 ms between files. It:

1. reads the page list and image titles from `sitemap.xml`;
2. saves each page's HTML;
3. fetches the original of every `data-media` id from the sitemap's own host
   (`dv4tl7yyk1zlp.cloudfront.net/<site id>/<uuid>.<ext>`);
4. fetches every literal `href`/`src` asset URL and every `og:image`, then
   every `url()` in any CSS it fetched.

Run it as `node blux-capture.mjs <out>`.

<details>
<summary><code>blux-capture.mjs</code></summary>

```js
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";

const ref = "https://mantislandscaping.com";
const out = process.argv[2];
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (b) => createHash("sha256").update(b).digest("hex");
const pages = [];
const files = [];
const failed = [];

async function get(url) {
  const r = await fetch(url, { headers: { "user-agent": UA } });
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, type: r.headers.get("content-type"), buf };
}
function save(rel, buf) {
  const p = join(out, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, buf);
}
const localFor = (u) => {
  const x = new URL(u);
  return join(
    "files",
    x.host,
    decodeURIComponent(x.pathname) + (x.search ? ".q" + sha(x.search).slice(0, 8) : ""),
  );
};

const sm = await get(`${ref}/sitemap.xml`);
save("sitemap.xml", sm.buf);
const smText = sm.buf.toString();
const pagePaths = [...smText.matchAll(/<loc>(http[^<]+)<\/loc>/g)].map(
  (m) => new URL(m[1]).pathname,
);
const titles = Object.fromEntries(
  [
    ...smText.matchAll(/<image:loc>([^<]+)<\/image:loc>\s*<image:title>([^<]*)<\/image:title>/g),
  ].map((m) => [m[1].split("/").pop(), m[2]]),
);

const fileUrls = new Set();
let siteId = null;
for (const path of pagePaths) {
  const r = await get(ref + path);
  const html = r.buf.toString();
  save(join("pages", path === "/" ? "" : path, "index.html"), r.buf);
  const media = [
    ...new Set(
      [...html.matchAll(/data-base="([^"]+)"[^>]*data-media="([^"]+)"/g)].map((m) => m[2]),
    ),
  ];
  const base = /data-base="\/\/[^/]+\/([^/]+)\//.exec(html);
  if (base) siteId = base[1];
  pages.push({
    path,
    status: r.status,
    bytes: r.buf.length,
    sha256: sha(r.buf),
    title: /<title>([^<]*)/.exec(html)?.[1],
    media,
  });
  for (const m of media) fileUrls.add(`https://dv4tl7yyk1zlp.cloudfront.net/${siteId}/${m}`);
  for (const m of html.matchAll(/(?:href|src)="((?:https?:)?\/\/[^"]+|\/__[^"]+)"/g)) {
    let u = m[1];
    if (u.startsWith("//")) u = "https:" + u;
    if (u.startsWith("/")) u = ref + u;
    if (/\.(css|js|png|jpe?g|gif|svg|woff2?|ico)(\?|$)|fonts\.googleapis/.test(u)) fileUrls.add(u);
  }
  for (const m of html.matchAll(/content="(http[^"]+\.(?:jpg|png))"/g))
    fileUrls.add(m[1].replace(/^http:/, "https:"));
  await sleep(600);
}

const queue = [...fileUrls];
const seen = new Set();
while (queue.length) {
  const u = queue.shift();
  if (seen.has(u)) continue;
  seen.add(u);
  try {
    const r = await get(u);
    if (r.status !== 200) {
      failed.push({ url: u, status: r.status });
      continue;
    }
    const rel = localFor(u);
    save(rel, r.buf);
    files.push({
      url: u,
      path: rel,
      bytes: r.buf.length,
      sha256: sha(r.buf),
      type: r.type,
      title: titles[u.split("/").pop()],
    });
    if (/text\/css/.test(r.type))
      for (const m of r.buf.toString().matchAll(/url\(([^)]+)\)/g)) {
        const v = m[1].replace(/["']/g, "");
        if (/^https?:/.test(v)) queue.push(v);
      }
  } catch (e) {
    failed.push({ url: u, error: String(e) });
  }
  await sleep(150);
}

const capturedAt = new Date().toISOString();
writeFileSync(
  join(out, "manifest.json"),
  JSON.stringify(
    { ref, host: "blux", bluxSiteId: siteId, capturedAt, pages, files, failed },
    null,
    2,
  ),
);
const total = files.reduce((a, f) => a + f.bytes, 0) + pages.reduce((a, p) => a + p.bytes, 0);
console.log(
  `${pages.length} pages, ${files.length} files, ${(total / 1e6).toFixed(1)} MB, ${failed.length} failed, siteId ${siteId}`,
);
```

</details>
