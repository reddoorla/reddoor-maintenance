/** IR for a scraped Webflow site. Everything downstream (docs, assets, page
 *  assembly) reads this — extractors are the only code that touches HTML. */
export type WfImage = { url: string; alt?: string };

export type WfTeamMember = {
  slug: string; // from /team-members/<slug>
  name: string; // h1
  role?: string; // first h4 ("Dentist", "Administrator", …)
  bioHtml: string; // joined <p> elements, verbatim inner HTML
  photo?: WfImage;
};

export type WfService = {
  slug: string;
  title: string; // h2
  category: string; // h3.service-page-label, trimmed
  subtitle?: string; // h5.text-body-large
  bodyHtml: string; // div.w-richtext innerHTML
  hero?: WfImage;
  youtubeUrl?: string; // iframe src when present
};

export type WfQuestion = {
  slug: string;
  title: string; // h2.heading-30
  lead?: string; // h5.text-body-large
  bodyHtml: string; // .dynamic-content-body.w-richtext innerHTML
  image?: WfImage;
  order: number; // 0-based position on /ask-the-doctor
};

export type WfReview = {
  quote: string;
  reviewerName: string;
  reviewerPlace?: string;
  reviewerPhoto?: WfImage;
  reviewUrl?: string;
};

export type WfServiceCategory = { name: string; intro?: string; slugs: string[] };

export type WebflowIR = {
  baseUrl: string;
  capturedAt: string;
  team: WfTeamMember[]; // display order
  services: WfService[];
  serviceCategories: WfServiceCategory[]; // 4 for beachfront
  questions: WfQuestion[]; // /ask-the-doctor order
  reviews: WfReview[];
};

/** Prismic RichText block (the subset the shared entity `body` field allows). */
export type RtSpan =
  | { start: number; end: number; type: "strong" | "em" }
  | { start: number; end: number; type: "hyperlink"; data: { link_type: "Web"; url: string } };
export type RtBlock = {
  // "heading1" is used by doc titles (to-docs), never by htmlToRichText.
  type: "paragraph" | "list-item" | "o-list-item" | "heading1";
  text: string;
  spans: RtSpan[];
};
