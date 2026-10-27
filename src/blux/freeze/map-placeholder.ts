import { parse } from "node-html-parser";

// The frozen export's Google-Map band is a CUSTOM Google My Maps: a KmlLayer
// keyed by a My Maps id (`…/kml?…&mid=<ID>`) rendered at runtime. With the Blux
// JS stripped, the settled `gm-style` DOM Google left behind is dead (broken
// tiles + CSP console noise). Replace it with a clean, height-preserving
// placeholder that carries the `mid` so a future (production) hydrator can bring
// the real map back once a domain-scoped Maps key exists.

// The My Maps id, pulled from the export's KML url (deterministic, not from the
// settled DOM which no longer holds it).
const MID_RE = /[?&]mid=([\w-]+)/;

/**
 * Convert each rendered Google-Map container into a `.blux-frozen-map`
 * placeholder. A container is an element whose `id` names a map (`/map/i`) AND
 * that actually rendered (has a `.gm-style` descendant); its dead children are
 * removed and the KML `mid` (if found in `exportHtml`) is attached. Its existing
 * id + inline height are kept so the band's box is unchanged. `exportHtml` is the
 * raw Blux export string.
 */
export function mapPlaceholder(html: string, exportHtml: string): string {
  const root = parse(html);
  const mid = exportHtml.match(MID_RE)?.[1];

  for (const el of root.querySelectorAll("[id]")) {
    const id = el.getAttribute("id") ?? "";
    if (!/map/i.test(id)) continue;
    if (!el.querySelector(".gm-style")) continue; // only actually-rendered maps
    el.set_content(""); // drop the dead gm-style DOM
    el.classList.add("blux-frozen-map");
    if (mid) el.setAttribute("data-kml-mid", mid);
  }

  return root.toString();
}
