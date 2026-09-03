import { parse, HTMLElement, NodeType } from "node-html-parser";
import type { FormShape, PageAnchor, PageExtract } from "./types.js";

/** See `PageExtract.anchors`: the extract is persisted once per page per audit,
 *  and a navigation-heavy page can carry several hundred anchors. Generous
 *  enough that no ordinary page reaches it; `anchorCount` always reports the
 *  true total so a capped list is never mistaken for a complete one. */
export const MAX_ANCHORS = 300;

/** Same discipline as `MAX_ANCHORS`, for `PageExtract.scriptSrcs`. A tag-manager
 *  page can inject a hundred of these; `scriptCount` reports the true total. */
export const MAX_SCRIPTS = 120;

/** Input types that are not a field a visitor fills in. `hidden` carries CSRF
 *  tokens and form ids; the button types are the control, not the question.
 *
 *  `password` is deliberately NOT in this set. It IS a field a visitor fills
 *  in, and `fieldCount` is documented as "visible, named controls", so hiding
 *  it here would make that number lie. What a password means for the form's
 *  KIND is handled in `formShape` instead, where it disqualifies the form
 *  outright rather than merely going uncounted. */
const NON_FIELD_INPUTS = new Set(["hidden", "submit", "button", "image", "reset"]);

/** Names, types and labels that mean "we can contact you back". A form with
 *  none of these is a search box or a filter, and calling that a conversion
 *  path would pass a site that cannot be reached by anyone. */
const CONTACT_FIELD = /\b(e-?mail|phone|tel|mobile|contact)\b/i;

/**
 * Break a field's attributes into words the way a human reads them.
 *
 * `CONTACT_FIELD` is anchored on `\b`, and neither of the two conventions that
 * dominate real form markup puts a word boundary where one is needed:
 *
 *   snake_case  `user_phone`  — `_` is a WORD character, so `\bphone\b` misses
 *   camelCase   `yourPhone`   — `r` to `P` is not a boundary either
 *
 * Left unhandled, both read a working enquiry form as "other", which reports a
 * site with a perfectly good contact form as having no way to reach anyone —
 * a false alarm in the direction that costs a prospect's trust in the whole
 * audit. Caught by a test, not by review.
 */
const toWords = (s: string): string =>
  s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_\-.]+/g, " ");

/** Subtrees a browser never renders. Skipped WHOLE — including their headings,
 *  images and schema blocks, which a <template> stamp would otherwise donate to
 *  the page's real counts. */
export const UNRENDERED_TAGS = new Set(["STYLE", "NOSCRIPT", "TEMPLATE", "SVG"]);

/** Elements that force a break in rendered text. Inline elements deliberately do
 *  NOT: `<b>Acme</b>Corp` is one word on screen and must stay one word here,
 *  because the raw-vs-rendered word diff is what the audit's headline number is
 *  made of, and an invented word break biases it in only one direction. */
const BLOCK = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "BR",
  "DD",
  "DIV",
  "DL",
  "DT",
  "FIELDSET",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "FORM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "TD",
  "TH",
  "TR",
  "UL",
]);

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Word/Google-Docs paste soup and broken page-builder plugins nest ordinary
 *  formatting spans far past anything hand-written markup would reach — a
 *  plain recursive walk throws `RangeError: Maximum call stack size exceeded`
 *  around 5,000 levels, which would take the whole audit down with it.
 *  Mirrors checks.ts's `MAX_SCHEMA_DEPTH` precedent: generous enough that no
 *  real page is anywhere near it, so only pathological nesting is affected —
 *  the branch simply stops descending and the extract is honestly partial. */
const MAX_WALK_DEPTH = 100;

/** Rendered text of one element: text nodes concatenated with NO inserted
 *  separator, a newline at each block boundary, whitespace collapsed last —
 *  which is what a browser shows. TITLE and SCRIPT are dropped wherever they
 *  appear, since a <title> misplaced in <body> is still invisible. */
function textOf(el: HTMLElement): string {
  const parts: string[] = [];
  const walk = (node: HTMLElement, depth: number): void => {
    if (depth > MAX_WALK_DEPTH) return;
    for (const child of node.childNodes) {
      if (child.nodeType === NodeType.TEXT_NODE) {
        parts.push(child.text);
        continue;
      }
      if (child.nodeType !== NodeType.ELEMENT_NODE) continue;
      const e = child as HTMLElement;
      const tag = e.tagName;
      if (UNRENDERED_TAGS.has(tag) || tag === "SCRIPT" || tag === "TITLE") continue;
      const block = BLOCK.has(tag);
      if (block) parts.push("\n");
      walk(e, depth + 1);
      if (block) parts.push("\n");
    }
  };
  walk(el, 0);
  return collapse(parts.join(""));
}

type Collected = {
  metas: HTMLElement[];
  /** `<link>` elements — canonical and friends. NOT anchors; see `anchors`. */
  links: HTMLElement[];
  jsonLd: string[];
  images: HTMLElement[];
  headings: { level: number; text: string }[];
  title: string | null;
  /** `<a href>` elements, in document order. */
  anchors: HTMLElement[];
  forms: HTMLElement[];
  /** `src` of each `<script src>`, in document order. Inline scripts are not
   *  collected — see `PageExtract.scriptSrcs`. */
  scriptSrcs: string[];
};

/** One ordered pass for the element-level signals. Document order matters: the
 *  heading sequence drives a later level-skip check. Depth-limited for the
 *  same reason as `textOf`'s walk — see `MAX_WALK_DEPTH`. */
function collect(el: HTMLElement, out: Collected, depth = 0): void {
  if (depth > MAX_WALK_DEPTH) return;
  for (const child of el.childNodes) {
    if (child.nodeType !== NodeType.ELEMENT_NODE) continue;
    const e = child as HTMLElement;
    const tag = e.tagName;
    if (UNRENDERED_TAGS.has(tag)) continue;
    switch (tag) {
      case "META":
        out.metas.push(e);
        break;
      case "LINK":
        out.links.push(e);
        break;
      case "IMG":
        out.images.push(e);
        break;
      case "A":
        // Only anchors that actually go somewhere. `<a>` without href is a
        // named target or a styling hook, and counting it as a link would
        // inflate every navigation measure below.
        if ((e.getAttribute("href") ?? "").trim()) out.anchors.push(e);
        break;
      case "FORM":
        out.forms.push(e);
        break;
      case "TITLE":
        if (out.title === null) out.title = collapse(e.text) || null;
        break;
      case "SCRIPT": {
        if ((e.getAttribute("type") ?? "").toLowerCase().trim() === "application/ld+json") {
          out.jsonLd.push(e.text);
        }
        const src = (e.getAttribute("src") ?? "").trim();
        if (src) out.scriptSrcs.push(src);
        // Raw-text element — nothing inside to walk.
        continue;
      }
      case "H1":
      case "H2":
      case "H3":
      case "H4":
      case "H5":
      case "H6": {
        const text = textOf(e);
        if (text) out.headings.push({ level: Number(tag.slice(1)), text });
        break;
      }
    }
    collect(e, out, depth + 1);
  }
}

/**
 * Path segments that name a form doing something other than starting a
 * conversation with the business.
 *
 * A login, an account signup, a checkout and a WordPress comment box all ask
 * for an email address and at least one more field — which was every signal
 * the shape test had, so all four read as enquiry forms. journey.ts counts
 * ONLY `enquiry`, precisely so that "a site nobody can actually reach" does
 * not score as having a conversion path, and a patient-portal login sitting in
 * a site header handed exactly that to every page of such a site.
 *
 * Matched on whole path SEGMENTS, never as substrings. `/signup-for-a-consultation`
 * is a real lead form; excluding it would report a reachable business as
 * unreachable, which is the false alarm `toWords` above exists to prevent.
 */
const NON_ENQUIRY_SEGMENTS = new Set([
  // Account doors
  "login",
  "log-in",
  "log_in",
  "logon",
  "signin",
  "sign-in",
  "sign_in",
  "signup",
  "sign-up",
  "sign_up",
  "register",
  "registration",
  // Commerce
  "checkout",
  "cart",
  "basket",
  // Retrieval, not contact
  "search",
  // WordPress, whose comment endpoint is a fixed path on a great many sites
  "wp-login",
  "wp-signup",
  "wp-register",
  "wp-comments-post",
]);

/** Does this `action` post somewhere that is not a way to reach a person?
 *  Resolved against a placeholder base so a relative action, a rooted path and
 *  a full URL are all read the same way; the base itself is never used. A
 *  trailing extension is dropped so `/wp-comments-post.php` reads as its
 *  segment. A form with no action posts to its own URL, which says nothing
 *  either way — and saying nothing is not evidence against the site. */
function isNonEnquiryAction(action: string | null): boolean {
  if (!action) return false;
  let path: string;
  try {
    path = new URL(action, "https://form.invalid/").pathname;
  } catch {
    path = action;
  }
  return path
    .toLowerCase()
    .split("/")
    .some((segment) => NON_ENQUIRY_SEGMENTS.has(segment.replace(/\.[a-z0-9]+$/, "")));
}

/** One `<form>`'s shape. Exported for its own tests: telling a contact form
 *  from a search box is the judgement the conversion check rests on, and it is
 *  worth being able to exercise it directly. */
export function formShape(form: HTMLElement): FormShape {
  const controls = form.querySelectorAll("input, textarea, select");
  let fieldCount = 0;
  /** Fields that are a way to reply, so the rest can be counted separately —
   *  see the enquiry bar below. */
  let contactFieldCount = 0;
  let hasContactField = false;
  let hasPassword = false;
  let hasTextarea = false;
  let hasSubmit = form.querySelectorAll("button").length > 0;

  for (const control of controls) {
    const type = (control.getAttribute("type") ?? "").toLowerCase().trim();
    if (control.tagName === "INPUT" && NON_FIELD_INPUTS.has(type)) {
      if (type === "submit" || type === "image") hasSubmit = true;
      continue;
    }
    if (control.tagName === "TEXTAREA") hasTextarea = true;
    if (control.tagName === "INPUT" && type === "password") hasPassword = true;
    fieldCount += 1;
    // Any of the attributes an author might carry the meaning in. Checked
    // together rather than in priority order: a field is a contact field if
    // ANY of them says so, and sites disagree about which one to use.
    const signature = toWords(
      [
        type,
        control.getAttribute("name") ?? "",
        control.getAttribute("id") ?? "",
        control.getAttribute("placeholder") ?? "",
        control.getAttribute("autocomplete") ?? "",
        control.getAttribute("aria-label") ?? "",
      ].join(" "),
    );
    if (type === "email" || type === "tel" || CONTACT_FIELD.test(signature)) {
      hasContactField = true;
      contactFieldCount += 1;
    }
  }

  const action = form.getAttribute("action")?.trim() || null;
  // An account door, not a conversation. A password field says so outright; the
  // path says so for the portal logins that ask for a member number and a PIN.
  const isAccountForm = hasPassword || isNonEnquiryAction(action);
  // A message box, or enough questions beyond the contact details to be an
  // intake form. Without this, "first name + email + Subscribe" — the second
  // commonest newsletter box on the web — cleared the bar on `fieldCount >= 2`
  // alone.
  //
  // The threshold is TWO non-contact questions, not three. Three was tried and
  // it failed a shape that is everywhere: name / email / phone / subject with
  // no message box, the lean quote form. Reading that as a newsletter signup
  // costs the site a real conversion path and can make a page with a working
  // enquiry form read as having none — which is the same class of error, in
  // the same direction, as the ones this pass exists to remove. A newsletter
  // box asking two questions beyond an email address does not exist in the
  // wild; a quote form that does is ordinary.
  const asksSomethingBack = hasTextarea || fieldCount - contactFieldCount >= 2;

  return {
    // A lone contact field is a newsletter box, not an enquiry form. See
    // `FormKind`: on one audited site a footer email box put every page at zero
    // clicks from "reaching them", when the only form that reaches a person
    // was the nine-field one on its contact page.
    kind:
      isAccountForm || !hasContactField
        ? "other"
        : fieldCount >= 2 && asksSomethingBack
          ? "enquiry"
          : "subscribe",
    action,
    method: (form.getAttribute("method") ?? "get").toLowerCase().trim() || "get",
    fieldCount,
    hasContactField,
    hasSubmit,
  };
}

/** Parse one HTML document into the signals every downstream check reads.
 *  Pure — the same input always yields the same extract. */
export function extractPage(html: string): PageExtract {
  const root = parse(html);
  // node-html-parser surfaces `<!doctype html>` as a TEXT node that is a SIBLING
  // of <html>, not a doctype node, so the walk starts at <html> when there is one.
  const documentEl = root.querySelector("html") ?? root;
  const out: Collected = {
    metas: [],
    links: [],
    jsonLd: [],
    images: [],
    headings: [],
    title: null,
    anchors: [],
    forms: [],
    scriptSrcs: [],
  };
  collect(documentEl, out);

  const social: Record<string, string> = {};
  const metas: Record<string, string> = {};
  let metaDescription: string | null = null;
  let hasViewportMeta = false;
  for (const m of out.metas) {
    // `charset` is written as a bare attribute (`<meta charset="utf-8">`), not
    // as name/content, so it never had a key here and the charset check could
    // not see it. Normalising it to `charset` gives it the same shape as every
    // other meta; a `<meta http-equiv="content-type">` declaration lands there
    // too, since both are a page declaring its encoding.
    const charset = (m.getAttribute("charset") ?? "").trim();
    if (charset) {
      metas["charset"] = charset;
      continue;
    }
    const key = (m.getAttribute("property") ?? m.getAttribute("name") ?? "").toLowerCase().trim();
    const content = (m.getAttribute("content") ?? "").trim();
    if (!key) {
      const equiv = (m.getAttribute("http-equiv") ?? "").toLowerCase().trim();
      if (equiv === "content-type" && /charset=/i.test(content)) {
        metas["charset"] = content.replace(/^.*charset=/i, "").trim();
      }
      continue;
    }
    if (key === "description") metaDescription = content || null;
    else if (key === "viewport") hasViewportMeta = content.length > 0;
    if (key.startsWith("og:") || key.startsWith("twitter:")) social[key] = content;
    // Everything else, including description and viewport: `social` owns the
    // two prefixes and `metas` owns the rest, so nothing is stored twice.
    else metas[key] = content;
  }

  const canonicalEl = out.links.find(
    (l) => (l.getAttribute("rel") ?? "").toLowerCase().trim() === "canonical",
  );

  return {
    title: out.title,
    metaDescription,
    canonical: canonicalEl?.getAttribute("href")?.trim() || null,
    social,
    headings: out.headings,
    jsonLd: out.jsonLd,
    images: {
      total: out.images.length,
      withAlt: out.images.filter((i) => (i.getAttribute("alt") ?? "").trim().length > 0).length,
    },
    hasViewportMeta,
    // Body-scoped: <head> has no visible text, and scoping here rather than
    // filtering keeps the rule obvious.
    text: textOf(root.querySelector("body") ?? documentEl),
    anchors: out.anchors.slice(0, MAX_ANCHORS).map((a): PageAnchor => ({
      href: (a.getAttribute("href") ?? "").trim(),
      // The visible label, not the raw text: an anchor wrapping an icon and a
      // span should read as its span. `textOf` already drops the unrendered
      // subtrees an icon sprite lives in.
      text: textOf(a).slice(0, 120),
      rel: (a.getAttribute("rel") ?? "").toLowerCase().trim(),
    })),
    // The TRUE total, so a capped list is never mistaken for a complete one.
    anchorCount: out.anchors.length,
    imageSrcs: out.images
      .map((i) => (i.getAttribute("src") ?? "").trim())
      .filter((src) => src.length > 0),
    forms: out.forms.map(formShape),
    metas,
    scriptSrcs: out.scriptSrcs.slice(0, MAX_SCRIPTS),
    // The TRUE total, for the same reason `anchorCount` exists: a capped list
    // must never be mistaken for a complete one.
    scriptCount: out.scriptSrcs.length,
  };
}
