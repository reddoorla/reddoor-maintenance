// Blux nav anchors are JS-driven: core runtime maps `href="/#N"` to the band
// id `page-block-N` — but site-specific custom scripts embedded in the export
// can send a link anywhere (the-pointe's sends "Contact Us" to `footer0`), so
// the authoritative mapping is the answer key MEASURED from the export's own
// runtime by settle's click audit. With the runtime stripped those hrefs are
// dead; bake the resolved target into the frozen markup. Unmeasured indexes
// fall back to Blux core's `page-block-N` (when that band is missing, Blux
// core no-ops — exactly what a dead in-page anchor does, so the fallback is
// faithful either way). Digit-only fragments only — real named anchors
// (`/#about`) are untouched. The starter's render-time enhance layer keeps its
// own `/#N` rewrite as a repair path for pre-bake artifacts; baked hrefs no
// longer match it.

const HASHLINK_RE = /href="\/#(\d+)"/g;

export function resolveAnchors(html: string, targets: Record<string, string> = {}): string {
  return html.replace(
    HASHLINK_RE,
    (_full, n: string) => `href="#${targets[n] ?? `page-block-${n}`}"`,
  );
}
