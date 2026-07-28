/** Detail-page extractors — parse a rendered Webflow detail page (team
 *  member, service, ask-the-doctor question) into its Wf* IR record. */
import { parse, type HTMLElement } from "node-html-parser";
import type { WfImage, WfQuestion, WfService, WfTeamMember } from "./types.js";

const CONTENT_CDN = "/64b1c843b071dc32170ea053/"; // CMS images; chrome lives on the other site id

const text = (el: HTMLElement | null | undefined) =>
  el?.structuredText.replace(/\s+/g, " ").trim() ?? undefined;

/** First content-CDN <img> within `scope`. Callers pass the structural
 *  container that provably holds the SEMANTIC image for their page type —
 *  never the whole document, because decorative backgrounds (e.g. the team
 *  page's beach photo) also live on the content CDN and can precede it.
 *  A null scope means the structural anchor itself didn't match (a page-shape
 *  drift worth surfacing), so it warns; a matched anchor with no content-CDN
 *  img is the benign no-image case and stays silent. */
const contentImg = (scope: HTMLElement | null, anchor: string): WfImage | undefined => {
  if (!scope) {
    console.warn(`webflow extract: anchor "${anchor}" matched nothing`);
    return undefined;
  }
  const img = scope
    .querySelectorAll("img")
    .find((i) => (i.getAttribute("src") ?? "").includes(CONTENT_CDN));
  const url = img?.getAttribute("src");
  const alt = img?.getAttribute("alt") || undefined;
  // `exactOptionalPropertyTypes`: omit the key rather than set undefined.
  return url ? { url, ...(alt ? { alt } : {}) } : undefined;
};

/** Extract a team member from a rendered /team-members/<slug> page. */
export function extractTeamMember(html: string, slug: string): WfTeamMember {
  const root = parse(html);
  const name = text(root.querySelector("h1"));
  if (!name) throw new Error(`team ${slug}: no h1`);
  // The bio is the page's sole .w-richtext, holding only <p> children
  // (fixture-verified). Re-wrap each <p>'s innerHTML rather than taking the
  // container's innerHTML verbatim so any wrapper attributes/divs Webflow
  // adds around paragraphs never leak into bioHtml.
  const bioHtml =
    root
      .querySelector(".w-richtext")
      ?.querySelectorAll("p")
      .map((p) => `<p>${p.innerHTML}</p>`)
      .join("") ?? "";
  if (!bioHtml) throw new Error(`team ${slug}: no .w-richtext bio`);
  const role = text(root.querySelector("h4"));
  // Anchor: `.hero-cols` — the column pair holding the h1 and the headshot
  // (img.member-page-headshot in .col-1-of-3). The decorative beach background
  // (img.hero-dynamic-image) sits directly under section.hero OUTSIDE this
  // container, and precedes the headshot in document order — an unscoped
  // first-match would pick it.
  const photo = contentImg(root.querySelector(".hero-cols"), `team ${slug} .hero-cols`);
  return {
    slug,
    name,
    ...(role !== undefined ? { role } : {}),
    bioHtml,
    ...(photo !== undefined ? { photo } : {}),
  };
}

/** Extract a service from a rendered /services/<slug> page. The breadcrumb
 *  (".service-page-label") repeats 3x — "Services", "/", category — so the
 *  category is the LAST match, not the first. */
export function extractService(html: string, slug: string): WfService {
  const root = parse(html);
  const title = text(root.querySelector(".service-page-title-subtitle-section h2"));
  if (!title) throw new Error(`service ${slug}: no .service-page-title-subtitle-section h2`);
  const labels = root.querySelectorAll(".service-page-label");
  const category = text(labels[labels.length - 1]);
  if (!category) throw new Error(`service ${slug}: no .service-page-label`);
  const bodyHtml = root.querySelector(".w-richtext")?.innerHTML ?? "";
  if (!bodyHtml.trim()) throw new Error(`service ${slug}: no .w-richtext body`);
  const iframe = root
    .querySelectorAll("iframe")
    .map((f) => f.getAttribute("src") ?? "")
    .find((src) => src.includes("youtube.com/embed/"));
  const subtitle = text(root.querySelector("h5.text-body-large"));
  // Anchor: section `.hero` — its img.hero-dynamic-image is the CMS-bound
  // service image (fixture filenames match the slug: dental-crowns.jpg,
  // mi-paste.jpg) and is the only content-CDN img on the page.
  const hero = contentImg(root.querySelector(".hero"), `service ${slug} .hero`);
  return {
    slug,
    title,
    category,
    ...(subtitle !== undefined ? { subtitle } : {}),
    bodyHtml,
    ...(hero !== undefined ? { hero } : {}),
    ...(iframe !== undefined ? { youtubeUrl: iframe } : {}),
  };
}

/** Extract a Q&A entry from a rendered /ask-the-doctor/<slug> page. `order` is
 *  the 0-based position on the /ask-the-doctor index and is caller-supplied. */
export function extractQuestion(html: string, slug: string, order: number): WfQuestion {
  const root = parse(html);
  const title = text(root.querySelector("h2.heading-30"));
  if (!title) throw new Error(`question ${slug}: no h2.heading-30`);
  const bodyHtml = root.querySelector(".dynamic-content-body.w-richtext")?.innerHTML ?? "";
  if (!bodyHtml.trim()) throw new Error(`question ${slug}: no .dynamic-content-body.w-richtext`);
  const lead = text(root.querySelector("h5.text-body-large"));
  // Anchor: section `.hero` — its img.hero-dynamic-image is the CMS-bound
  // question illustration (fixture: chipped-tooth.jpg for the "tooth broke
  // off" question) and is the only content-CDN img on the page.
  const image = contentImg(root.querySelector(".hero"), `question ${slug} .hero`);
  return {
    slug,
    title,
    ...(lead !== undefined ? { lead } : {}),
    bodyHtml,
    ...(image !== undefined ? { image } : {}),
    order,
  };
}
