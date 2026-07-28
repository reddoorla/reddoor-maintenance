/** IR → Prismic entity docs. Maps the crawled WebflowIR onto the shared
 *  fleet entity types (person / news_article / collection_item), which all
 *  share the `uid, title, body, media, gallery, tags, date, link` shape:
 *  team→person (tags=role), services→collection_item (tags=category,
 *  link=YouTube url), questions→news_article (synthetic DESCENDING dates
 *  preserve /ask-the-doctor order when date-sorted). */
import { assetFilename } from "./crawl.js";
import { htmlToRichText } from "./html-to-richtext.js";
import type { RtBlock, WebflowIR, WfImage } from "./types.js";

/** Asset placeholder — resolved to a real Prismic asset id at push time
 *  (Task 8 aligns this with resolveDocData's contract in src/blux/emit). */
export type AssetPlaceholder = { __asset: string; alt?: string };

export type WfDoc = {
  type: "person" | "news_article" | "collection_item" | "page"; // "page" used only by Task 9's assembly
  uid: string;
  lang: "en-us";
  data: Record<string, unknown>;
};

const heading1 = (text: string): RtBlock[] => [{ type: "heading1", text, spans: [] }];
const uid = (slug: string) => slug.toLowerCase(); // Migration API rejects capitals (proven 2026-07-23)

/** Build the asset placeholder for an optional WfImage. `fallbackAlt` is used
 *  when the source image carried no alt text of its own (e.g. the doc's own
 *  title/name), matching extract.ts's contentImg alt-omission convention. */
const asset = (img: WfImage | undefined, fallbackAlt?: string): AssetPlaceholder | undefined => {
  if (!img) return undefined;
  const alt = img.alt || fallbackAlt;
  return { __asset: assetFilename(img.url), ...(alt ? { alt } : {}) };
};

/** Question order → descending dates so date-sorted lists match the live
 *  site's /ask-the-doctor order. Anchor date is arbitrary but fixed
 *  (determinism > realism). */
const questionDate = (order: number): string => {
  const d = new Date(Date.UTC(2026, 5, 30));
  d.setUTCDate(d.getUTCDate() - order);
  return d.toISOString().slice(0, 10);
};

export function irToDocs(ir: WebflowIR): WfDoc[] {
  const people: WfDoc[] = ir.team.map((t) => {
    const media = asset(t.photo, t.name);
    return {
      type: "person",
      uid: uid(t.slug),
      lang: "en-us",
      data: {
        title: heading1(t.name),
        body: htmlToRichText(t.bioHtml),
        // The shared field is always present on fleet docs (CollectionList
        // renders tags verbatim); missing vs empty are equivalent downstream,
        // but this is the ONE place we assign "" rather than omitting the
        // key, since role itself may legitimately be absent.
        tags: t.role ?? "",
        ...(media ? { media } : {}),
      },
    };
  });

  const services: WfDoc[] = ir.services.map((s) => {
    const media = asset(s.hero, s.title);
    return {
      type: "collection_item",
      uid: uid(s.slug),
      lang: "en-us",
      data: {
        title: heading1(s.title),
        body: [
          ...(s.subtitle
            ? [{ type: "paragraph", text: s.subtitle, spans: [] } satisfies RtBlock]
            : []),
          ...htmlToRichText(s.bodyHtml),
        ],
        tags: s.category,
        ...(media ? { media } : {}),
        ...(s.youtubeUrl ? { link: { link_type: "Web", url: s.youtubeUrl } } : {}),
      },
    };
  });

  const questions: WfDoc[] = ir.questions.map((q) => {
    const media = asset(q.image, q.title);
    return {
      type: "news_article",
      uid: uid(q.slug),
      lang: "en-us",
      data: {
        title: heading1(q.title),
        body: [
          ...(q.lead ? [{ type: "paragraph", text: q.lead, spans: [] } satisfies RtBlock] : []),
          ...htmlToRichText(q.bodyHtml),
        ],
        date: questionDate(q.order),
        ...(media ? { media } : {}),
      },
    };
  });

  return [...people, ...services, ...questions];
}
