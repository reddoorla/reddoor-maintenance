/** Beachfront Dentistry — page-doc assembly (webflow-import Task 9).
 *
 *  Emits the FIVE `page` docs (home, your-first-visit, our-team, services,
 *  ask-the-doctor) that drive the site repo's Plan-B slice models. `contact-us`
 *  is a route in the site repo, not a doc, so it is intentionally absent.
 *
 *  Slice wire format — mirrors the blux catalog emit precedent
 *  (src/blux/emit/plan.ts `PlanSlice`; catalog/emit.ts `sliceOf`): every entry
 *  is `{ slice_type, variation, primary, items }`, and `items` is ALWAYS
 *  present (`[]` when the slice carries none). Field names inside
 *  `primary`/`items` are the contract with the site repo's slice models — do
 *  not rename them.
 *
 *  Copy sourcing:
 *   - COLLECTION-DRIVEN copy (reviews, service-category names + intros) is read
 *     from the WebflowIR, never hardcoded.
 *   - PAGE copy (headlines, value-prop blurbs, CTAs) is the site-specific
 *     config that lives in THIS file. Every string was extracted from the
 *     crawled fixtures (home.html / our-team.html / services-index.html /
 *     ask-the-doctor.html) — except your-first-visit, which has no fixture; its
 *     copy is capture-sourced from the crawl analysis and flagged inline.
 *
 *  Images: every DESIGN asset (hero backgrounds, media_text side images, the
 *  office-tour photos, the meet-team collage, question teaser side image) is
 *  OMITTED here — those are Phase-4 editorial fills done directly in Prismic.
 *  The ONLY asset placeholders these page docs carry are reviewer photos, which
 *  come from the IR's homepage review carousel.
 */
import { assetFilename } from "../crawl.js";
import { heading1, paragraph, type AssetPlaceholder, type WfDoc } from "../to-docs.js";
import type { WebflowIR, WfReview } from "../types.js";

/** One assembled slice — the exact blux `PlanSlice` envelope. */
type Slice = {
  slice_type: string;
  variation: string;
  primary: Record<string, unknown>;
  items: Record<string, unknown>[];
};

const webLink = (url: string) => ({ link_type: "Web" as const, url });

/** Envelope builder — `items` defaults to `[]` so every slice keeps the full
 *  wire-format key set even when it has no repeatable rows. */
const slice = (
  slice_type: string,
  variation: string,
  primary: Record<string, unknown>,
  items: Record<string, unknown>[] = [],
): Slice => ({ slice_type, variation, primary, items });

/** Reviewer avatar → asset placeholder (filename-keyed like to-docs, alt falls
 *  back to the reviewer's name). */
const reviewerPhoto = (r: WfReview): AssetPlaceholder | undefined =>
  r.reviewerPhoto
    ? {
        __asset: assetFilename(r.reviewerPhoto.url),
        ...(r.reviewerName ? { alt: r.reviewerName } : {}),
      }
    : undefined;

const reviewItem = (r: WfReview): Record<string, unknown> => {
  const photo = reviewerPhoto(r);
  return {
    quote: r.quote,
    reviewer_name: r.reviewerName,
    ...(r.reviewerPlace ? { reviewer_place: r.reviewerPlace } : {}),
    ...(photo ? { reviewer_photo: photo } : {}),
    ...(r.reviewUrl ? { review_url: webLink(r.reviewUrl) } : {}),
  };
};

/** The homepage review carousel, reused verbatim on your-first-visit. */
const reviewCarousel = (ir: WebflowIR, heading: string): Slice =>
  slice("carousel", "review", { heading: heading1(heading) }, ir.reviews.map(reviewItem));

/** The closing call-to-action hero — identical on every page. */
const heroCta = (): Slice =>
  slice("hero", "cta", {
    heading: heading1("Ready for great dental health?"),
    cta_label: "Book an Appointment",
    cta_link: webLink("#appointment"),
  });

const homeDoc = (ir: WebflowIR): WfDoc => ({
  type: "page",
  uid: "home",
  lang: "en-us",
  data: {
    slices: [
      slice("hero", "default", {
        heading: heading1(
          "Have a relaxed dental experience where you are known and cared for at Beachfront Dentistry",
        ),
        body: paragraph("Finally have a dentist that puts you first"),
        cta_label: "Request Appointment",
        cta_link: webLink("#appointment"),
      }),
      // Value props — the source section carries no heading of its own, so the
      // grid heading is omitted (the cards carry all the copy).
      slice("section_grid", "default", { columns: 3 }, [
        {
          item_heading: heading1("Comfort"),
          item_body: paragraph(
            "It is our goal to provide you with a relaxing, comfortable, and professional dental experience",
          ),
        },
        {
          item_heading: heading1("Comprehensive"),
          item_body: paragraph(
            "Our dental care integrates all oral health needs with goals of establishing life-long and healthy habits",
          ),
        },
        {
          item_heading: heading1("Caring"),
          item_body: paragraph(
            "Our focus on preventative and restorative dental treatments ensures that you receive long-lasting, quality care",
          ),
        },
      ]),
      reviewCarousel(ir, "Serving the South Bay for over 40 years"),
      slice(
        "section_grid",
        "default",
        { heading: heading1("Your Path to Oral Health"), columns: 3 },
        [
          { item_heading: heading1("Book an Appointment") },
          { item_heading: heading1("Have a Complete Exam") },
          { item_heading: heading1("Receive a No-Pressure Plan") },
        ],
      ),
      // Meet Our Team — the homepage has no team blurb, so body is omitted;
      // the collage image is a Phase-4 editorial fill (media OMITTED).
      slice("media_text", "imageRight", { heading: heading1("Meet Our Team") }),
      slice("section_grid", "default", { heading: heading1("Services"), columns: 3 }, [
        { item_heading: heading1("Cosmetic Dentistry"), item_link: webLink("/services") },
        // "Implant Dentistry" is SOURCE-FAITHFUL home.html copy — the /services
        // page names the same category "Restore Your Smile". Deliberate
        // divergence; do not "fix" to match.
        { item_heading: heading1("Implant Dentistry"), item_link: webLink("/services") },
        { item_heading: heading1("General Dentistry"), item_link: webLink("/services") },
      ]),
      // side_image OMITTED (Phase-4). Heading uses the site's canonical section
      // name — the homepage teaser has no distinct heading in the source.
      slice("question_list", "teaser", { heading: heading1("Ask the Doctor"), max_items: 6 }),
      heroCta(),
    ],
  },
});

// your-first-visit has NO crawl fixture; copy below is capture-sourced from the
// crawl analysis (the h1) and Phase-4 editorial placeholders where noted.
const yourFirstVisitDoc = (ir: WebflowIR): WfDoc => ({
  type: "page",
  uid: "your-first-visit",
  lang: "en-us",
  data: {
    slices: [
      slice("hero", "default", { heading: heading1("We are excited to meet and care for you.") }),
      // Office tour photos are a Phase-4 editorial fill — items intentionally empty.
      slice(
        "carousel",
        "photos",
        { heading: heading1("Office Tour"), label: "Office photo tour" },
        [],
      ),
      slice("media_text", "imageRight", { heading: heading1("Meet Our Team") }),
      // First-exam copy is a Phase-4 editorial placeholder (no fixture to
      // source). The [DRAFT] prefix lives IN the content on purpose so it is
      // self-evidently provisional in the Prismic UI and cannot ship unreviewed.
      slice("rich_text", "default", {
        content: paragraph(
          "[DRAFT — replace before publish] During your first visit we take the time to get to know you, review your dental and medical history, and complete a thorough exam so we can build a no-pressure care plan around your goals.",
        ),
        band: null,
      }),
      reviewCarousel(ir, "Serving the South Bay for over 40 years"),
      heroCta(),
    ],
  },
});

const ourTeamDoc = (): WfDoc => ({
  type: "page",
  uid: "our-team",
  lang: "en-us",
  data: {
    slices: [
      slice("lead_text", "default", {
        eyebrow: "Meet Our Team",
        body: paragraph(
          "We love caring for our patients and we also love the beach, read a little about each of our team members and see their favorite beach beyond the South Bay.",
        ),
        band: null,
      }),
      slice("collection_list", "grid", {
        heading: heading1("Our Team"),
        collection_type: "person",
        max_items: 24,
      }),
      heroCta(),
    ],
  },
});

const servicesDoc = (ir: WebflowIR): WfDoc => ({
  type: "page",
  uid: "services",
  lang: "en-us",
  data: {
    slices: [
      slice("lead_text", "default", {
        eyebrow: "Services",
        body: paragraph(
          "We offer a wide array of services in cosmetic, implant, and general dentistry. From present issues like discoloration, decay and misalignment to preventative measures for oral cancer and enamel loss- we have you covered.",
        ),
        band: null,
      }),
      // One band per crawled service category (name + intro come from the IR).
      ...ir.serviceCategories.map((c) =>
        slice("service_category_band", "default", {
          category_tag: c.name,
          heading: heading1(c.name),
          ...(c.intro ? { intro: paragraph(c.intro) } : {}),
        }),
      ),
      heroCta(),
    ],
  },
});

const askTheDoctorDoc = (): WfDoc => ({
  type: "page",
  uid: "ask-the-doctor",
  lang: "en-us",
  data: {
    slices: [
      // The source page has no intro paragraph, so lead_text carries the eyebrow
      // only (body omitted).
      slice("lead_text", "default", { eyebrow: "Ask the Doctor", band: null }),
      // The numbered Q&A is self-labeling and the eyebrow above already names the
      // page, so no separate list heading is emitted.
      slice("question_list", "numbered", {}),
      heroCta(),
    ],
  },
});

/** Assemble the five Beachfront page docs, in nav order. */
export function pageDocs(ir: WebflowIR): WfDoc[] {
  return [homeDoc(ir), yourFirstVisitDoc(ir), ourTeamDoc(), servicesDoc(ir), askTheDoctorDoc()];
}
