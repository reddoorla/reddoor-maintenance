// Site-declared slots, merged into the freeze manifest alongside the derived
// ones. See `ExtraSlotsFile` in types.ts for why they exist.
//
// This module is deliberately incurious about what a site declares: it checks
// the shape, the reserved prefix and key uniqueness, and nothing else. The
// freeze tool serves several frozen sites and must not learn any one site's
// content model.

import { EXTRA_SLOT_PREFIX, type Slot } from "./types.js";

/** Thrown with the offending path so a bad declaration names itself. */
function fail(path: string, why: string): never {
  throw new Error(`extra slots: ${path} ${why}`);
}

function asString(v: unknown, path: string): string {
  if (typeof v !== "string" || v.trim() === "") {
    fail(path, `must be a non-empty string (got ${JSON.stringify(v)})`);
  }
  return v as string;
}

/**
 * Validate a site's extra-slots declaration against the slots the freeze
 * derived, returning the extras to append.
 *
 * A declaration that is wrong must stop the freeze rather than ship: these
 * slots become live CMS fields, and a key that collides with a derived one
 * would let a site-declared value silently overwrite real page content when
 * the render builds its value map.
 */
export function validateExtraSlots(file: unknown, derived: Slot[]): Slot[] {
  if (file === undefined || file === null) return [];
  if (typeof file !== "object" || Array.isArray(file)) {
    fail("root", "must be an object with a `slots` array");
  }
  // Read as `unknown`, not as `ExtraSlotsFile` — the whole point here is that
  // the input has not been checked yet, and typing it as the target would make
  // every access below assert what this function is supposed to prove.
  const slots: unknown = (file as { slots?: unknown }).slots;
  if (!Array.isArray(slots)) fail("slots", "must be an array");

  const derivedKeys = new Set(derived.map((s) => s.key));
  const seen = new Set<string>();
  const out: Slot[] = [];

  slots.forEach((raw, i) => {
    const at = `slots[${i}]`;
    if (typeof raw !== "object" || raw === null) fail(at, "must be an object");
    const s = raw as Record<string, unknown>;

    const key = asString(s.key, `${at}.key`);
    if (!key.startsWith(EXTRA_SLOT_PREFIX)) {
      fail(
        `${at}.key`,
        `must start with "${EXTRA_SLOT_PREFIX}" so it cannot collide with a derived slot (got "${key}")`,
      );
    }
    if (derivedKeys.has(key)) fail(`${at}.key`, `collides with a derived slot ("${key}")`);
    if (seen.has(key)) fail(`${at}.key`, `is declared twice ("${key}")`);
    seen.add(key);

    const kind = s.kind;
    if (kind !== "text" && kind !== "image") {
      fail(`${at}.kind`, `must be "text" or "image" (got ${JSON.stringify(kind)})`);
    }

    const section = typeof s.section === "string" && s.section.trim() ? s.section : "x";
    if (kind === "text") {
      out.push({ key, kind, text: asString(s.text, `${at}.text`), section });
    } else {
      out.push({ key, kind, url: asString(s.url, `${at}.url`), section });
    }
  });

  return out;
}
