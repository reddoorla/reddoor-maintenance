import type { ChecksResult, CrawlResult, JourneyMap, PageCapture, PageExtract } from "./types.js";

/**
 * Can a visitor do the one thing this site needs them to do?
 *
 * Every other check in this audit is generic — crawlable, readable, not broken.
 * Those are worth measuring and they are the same questions for every site,
 * which is exactly the problem: a dentist's site succeeds when somebody books an
 * appointment and a branding studio's succeeds when a qualified enquiry arrives
 * with a budget attached. Grading both against one template scores neither
 * against what it is for.
 *
 * So one goal is named, and the findings are read against it. The goal is
 * inferred from the site by the analyze stage and may be overridden by the
 * operator — and an inference we get wrong is itself worth reporting, because if
 * a model that has just read twenty pages cannot tell what the site is for,
 * neither can a visitor.
 *
 * Findings carry a `scope`, and the report orders by it. That ordering is the
 * only place the commercial ladder appears: a stale phone link is an afternoon,
 * "you have never published a price and every buyer asks" is a content
 * engagement, and "there is no way to publish or update any of this" is a
 * platform conversation. The report must never say those words. Ordering does
 * the work, and a prospect who reads to the bottom arrives at the conversation
 * on their own.
 */

export type SiteGoal =
  "book" | "enquire" | "call" | "visit" | "buy" | "demo" | "partner" | "unknown";

export const GOAL_LABELS: Record<SiteGoal, string> = {
  book: "book an appointment",
  enquire: "start a project or ask for a quote",
  call: "pick up the phone",
  visit: "come to you in person",
  buy: "buy something",
  demo: "talk to your sales team",
  partner: "ask about distribution or partnership",
  unknown: "— we could not tell",
};

/** How much work putting one thing right is. Orders the report; never printed
 *  as a tier, and never priced. */
export type Scope = "quick" | "content" | "structural";

/**
 * Three states, not two — and the third is the one that matters.
 *
 * Caught on live data: `reachable` and `tappable-phone` both read their input
 * from `checks`, which older stored reports do not carry. With a boolean they
 * came back `false`, and the report said "no way to reach you from where they
 * land" about sites that have one — turning our own missing measurement into
 * the prospect's defect. That is the single error this whole codebase is built
 * not to make, and a two-state field makes it the default.
 */
export type RequirementStatus = "met" | "missing" | "unmeasured";

export type GoalRequirement = {
  key: string;
  /** What the visitor needs, in the visitor's terms. */
  label: string;
  status: RequirementStatus;
  /** Where we found it — the receipt. Null when we did not. */
  evidence: string | null;
  /** Why this one matters for THIS goal, not in general. */
  why: string;
  scope: Scope;
};

export type GoalFit = {
  goal: SiteGoal;
  /** "operator" when supplied at dispatch, "inferred" when the analyze stage
   *  read it off the site. A reader is owed that distinction. */
  source: "inferred" | "operator";
  requirements: GoalRequirement[];
  met: number;
  /** Requirements we could actually judge — `met` + `missing`. Excludes
   *  `unmeasured`, so "3 of 4" never counts something we did not look at. */
  total: number;
};

/**
 * Third-party scheduling a visitor can actually complete. Deliberately a list
 * of hosts rather than a guess at markup: a booking widget is nearly always an
 * outbound link or an iframe to one of these, and inferring "booking" from a
 * form containing a date field catches every event RSVP on the web.
 *
 * Matched on the HOSTNAME, never on the raw href — see `linksTo`. A substring
 * test for "cal.com" credited a booking system to medical.com, surgical.com,
 * socal.com and every `mailto:` address at any of them, and printed that URL
 * back to the client as the receipt. Medtech and clinic prospects link to
 * *medical.com constantly.
 */
const BOOKING_HOSTS = [
  "zocdoc.com",
  "calendly.com",
  "acuityscheduling.com",
  "squarespacescheduling.com",
  "nexhealth.com",
  "localmed.com",
  "setmore.com",
  "simplybook.me",
  "appointy.com",
  "cal.com",
  "savvycal.com",
  "youcanbook.me",
  "meetings.hubspot.com",
  "chilipiper.com",
  "patientpop.com",
  "doctolib",
  "getweave.com",
  "flexbooker.com",
  "bookem",
  "vagaro.com",
  "mindbodyonline.com",
];

/**
 * A link that shows the visitor where you are. An entry may carry a path prefix
 * when the host alone is not the signal — google.com is not a map, but
 * google.com/maps is.
 *
 * `maps.google.com` and `bing.com/maps` were both missed while the substring
 * test was crediting *medical.com with a booking system: the check was loose
 * where it should have been strict and strict where it should have been loose.
 */
const MAP_HOSTS = [
  "google.com/maps",
  "maps.google.com",
  "goo.gl/maps",
  "maps.app.goo.gl",
  "maps.apple.com",
  "bing.com/maps",
];

/** Day-of-week followed by a time, which is what an opening-hours line looks
 *  like in prose regardless of how it is formatted. */
const HOURS_IN_TEXT =
  /\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?\s*[-–—:]?\s*(?:[a-z]*\s*)?\d{1,2}\s*(?::\d{2})?\s*(?:am|pm)/i;

/** A currency amount. Anchored on the symbol so "17% revenue lift" in a case
 *  study is not read as a price. */
const MONEY = /[$£€]\s?\d[\d,]*(?:\.\d{2})?(?:\s?[kKmM]\b)?/;

/**
 * The words a site uses when it is about to tell you what something costs.
 *
 * "starting at|starts at" missed the two commonest real phrasings outright:
 * "Treatment plans start at $250" (the bare infinitive) and "$99 new patient
 * special" (no price word at all until "special" was added). Both came back
 * "you have never published a price" against sites that publish one on the home
 * page, which is the same class of error as a false yes and lands in front of
 * the person who wrote the sentence.
 */
const PRICE_WORDS =
  /\b(pricing|price list|start(?:s|ing)? (?:at|from)|begin(?:s|ning)? at|from \$|per project|per month|per hour|retainer|packages?|rates?|fees?|budget starts|as (?:low|little) as|specials?|promotion)\b/i;

/**
 * Content checks match an ANSWER, never a topic.
 *
 * The distinction is the whole reliability of this section, and live data has
 * now caught it twice. Ludlow Kingsley scored a published price off the word
 * "package" in a sentence about photographing packaging. Beachfront Dentistry
 * scored "taking new clients" off a staff bio — "building relationships with our
 * new patients is what Michelle likes best" — which mentions new patients and
 * says nothing whatever about whether they can become one.
 *
 * A bare topic noun is the failure mode: every dental site on earth contains the
 * words "new patients", so matching them measures nothing except that the site
 * is about dentistry. Each pattern below therefore requires language that could
 * only appear in an actual answer — a verb of availability beside the noun, a
 * policy beside the topic, a number beside the term.
 *
 * This matters more here than anywhere else in the audit, because these findings
 * are the ones that quote the site back to its owner. A "No" we got wrong is a
 * conversation. A "Yes" quoting a sentence that plainly does not support it
 * tells the reader our checks do not mean what they say, and they would be
 * right. `tests/prospect/goals.test.ts` holds a decoy corpus of sentences that
 * mention every one of these topics without answering any of them; nothing here
 * may fire on it.
 *
 * Replaying the checks over the stored audits found six of the eight patterns
 * still firing on a bare topic noun — fourteen "met" receipts across ten real
 * sites, quoting back to the client: placeholder lorem ipsum, the country list
 * inside a phone-input widget ("British Indian Ocean Territory"), a client's
 * name on a portfolio page ("Meridian Distribution"), a COMPETITOR's
 * money-back promise on a comparison page, and a legal disclaimer. Every
 * pattern below now asks for the answer beside the noun: parking with a place
 * or a price, shipping with a cost or a window, a return with a policy verb, a
 * territory that is exclusive or available. The test for whether an alternative
 * belongs here is the receipt: the sentence it matches, printed on its own,
 * has to answer the question the requirement asks.
 */

/** Alternatives, one per line, because a pattern nobody can read is a pattern
 *  nobody can check. */
const anyOf = (...alternatives: string[]): RegExp => new RegExp(alternatives.join("|"), "i");

const ANSWERS = {
  /** A verb of availability beside the noun. "not accepting new patients" is a
   *  perfectly good answer and matches too — the requirement is that the site
   *  says, not that the answer is yes. */
  acceptingClients:
    /\b(?:accepting|welcoming|taking(?:\s+on)?|seeing|onboarding)\s+(?:any\s+)?new\s+(?:patients|clients|customers|members|students)\b|\bnew\s+(?:patients|clients|customers|members)\s+(?:are\s+)?(?:welcome|accepted)\b/i,

  /**
   * "same day" alone matched anniversaries and opening dates; it has to be the
   * same day as something a caller would want. Bare "no obligation" matched a
   * terms-of-use line — "we are under no obligation to update this page" —
   * which is the site disclaiming a duty to itself, not offering the visitor
   * anything, so the phrase now has to attach to the visitor's decision.
   */
  whatToExpect: anyOf(
    String.raw`\b(?:free|complimentary|no[- ]cost|no[- ]charge|no[- ]obligation)\s+(?:initial\s+|first\s+|\d+[- ]minute\s+)?(?:consultations?|consults?|quotes?|quotations?|estimates?|assessments?|evaluations?|exams?)\b`,
    String.raw`\b(?:consultations?|consults?|quotes?|estimates?|assessments?)\s+(?:are|is)\s+(?:always\s+)?(?:free|complimentary|on us|no charge)\b`,
    String.raw`\bwith\s+no\s+obligation\b`,
    String.raw`\b(?:there(?:'s| is)|and)\s+(?:is\s+)?no\s+obligation\b`,
    String.raw`\bno\s+obligation\s+to\s+(?:buy|book|purchase|proceed|continue|commit|hire)\b`,
    // "What to expect" as a promise the sentence then keeps, rather than a
    // slogan that leaves the visitor exactly where they were.
    String.raw`\b(?:here(?:'s| is)|this is|below is)\s+what\s+to\s+expect\b`,
    String.raw`\bwhat\s+to\s+expect\s+(?:at|on|during|from|when|before|after|in)\b`,
    String.raw`\bwe(?:'ll| will)\s+call\s+you\s+back\b`,
    String.raw`\bsame[- ]day\s+(?:appointments?|service|visit|care|callback|response)\b`,
  ),

  /**
   * "garage" on its own matched an auto shop describing itself, and bare
   * "parking" matched placeholder copy promising a parking page "coming soon".
   * A visitor asking about parking wants a price, a place or a promise.
   */
  gettingThere: anyOf(
    String.raw`\b(?:free|street|on[- ]?site|off[- ]?street|validated|complimentary|covered|underground|gated|ample|dedicated|reserved|metered|paid|patient|client|customer|visitor|garage|lot)\s+parking\b`,
    String.raw`\bparking\s+(?:lot|garage|structure|deck|spaces?|is|are|can\s+be|will\s+be|available|validated|included)\b`,
    String.raw`\bparking\s+(?:in|on|at|behind|beneath|below|under|out\s+(?:back|front)|across|next\s+to|opposite)\b`,
    String.raw`\bwe\s+(?:have|offer|provide|validate)\s+(?:\w+\s+){0,2}parking\b`,
    String.raw`\bvalet\s+(?:parking|service)\b`,
    // Transit, with a distance or a direction beside it. A station named and
    // left there tells a visitor nothing about getting from it to you.
    String.raw`\b(?:bus stop|subway|light rail|metro station|train station|nearest station|public transit|park[- ]and[- ]ride)\b[^.!?]{0,60}?\b(?:is|are|stops?|serves?|steps|blocks?|minutes?|walk|away|outside|across|adjacent|nearby|north|south|east|west|corner|line)\b`,
    String.raw`\b(?:steps|blocks?|minutes?|short walk|walking distance|directly across)\b[^.!?]{0,60}?\b(?:bus stop|subway|light rail|metro station|train station|station)\b`,
  ),

  /**
   * Bare "delivery" matched "delivery of care" and "delivery of the project",
   * and bare "shipping" matched a placeholder and a "prices, shipping and
   * availability subject to change" line. The buyer's question is what it costs
   * and when it arrives, so the pattern asks for one of those.
   */
  shipping: anyOf(
    String.raw`\b(?:free|flat[- ]rate|expedited|overnight|standard|express|next[- ]day|same[- ]day|two[- ]day|international|domestic|worldwide)\s+(?:shipping|delivery|postage)\b`,
    String.raw`\bshipping\s+(?:is|costs?|rates?|charges?|fees?|options?|times?|policy|starts|and\s+handling|within|on\s+(?:all\s+)?orders?)\b`,
    String.raw`\bdelivery\s+(?:times?|options?|charges?|fees?|costs?|rates?|window)\b`,
    String.raw`\b(?:ships?|shipped|shipping|delivers?|delivered|dispatch(?:ed)?)\s+(?:within|in)\s+(?:\d|one|two|three|four|five|six|seven|ten|a\s+few)`,
    String.raw`\bships?\s+(?:free|the\s+same\s+day|next\s+day|worldwide|nationwide)\b`,
    String.raw`\borders?\s+(?:over|above)\s+[$£€]\s?\d[\d,]*\s+ship`,
  ),

  /**
   * Bare "return" matched "return to our office" and "returning patients" — the
   * latter on exactly the kind of site this check runs against — and bare
   * "refunds" / "money-back" matched a legal disclaimer and a COMPETITOR's
   * guarantee quoted on a comparison page. A returns policy is a promise the
   * seller makes, so the pattern asks for the promise, and `NOT_OUR_ANSWER`
   * throws out the ones made by somebody else.
   */
  returns: anyOf(
    String.raw`\b(?:returns?|refunds?|exchanges?)\s+(?:and\s+(?:exchanges?|refunds?)\s+)?polic(?:y|ies)\b`,
    String.raw`\breturns?\s+(?:and|&)\s+exchanges?\b`,
    String.raw`\b\d+[- ]day\s+(?:returns?|refunds?|exchanges?|money[- ]back|guarantee|return\s+window)\b`,
    String.raw`\b(?:returns?|refunds?|exchanges?)\s+(?:are\s+)?(?:accepted\s+)?within\s+\d`,
    String.raw`\bfree\s+returns?\b`,
    String.raw`\b(?:you|we)\s+(?:can|may|will|do|must)?\s*(?:accept|offer|issue|process|request|return|refund)\w*(?:\s+(?:a|an|any|all|your|the|full|partial|unopened|unused|original|damaged))*\s+(?:returns?|refunds?|exchanges?|items?|orders?|purchases?|products?)\b`,
    String.raw`\b(?:full|partial|store[- ]credit|prorated)\s+refunds?\b`,
    String.raw`\b(?:our|a)\s+(?:no[- ]questions[- ]asked\s+)?money[- ]back\s+guarantee\b`,
  ),

  /**
   * Bare "distributor" / "distribution" / "wholesale" matched a client's name
   * on a portfolio page and "distribution rights" in a legal footer. The
   * requirement is a ROUTE for a partner, not the word for one, so the pattern
   * asks for the invitation: become, apply, programme, enquiry.
   */
  partnerRoute: anyOf(
    String.raw`\b(?:become|becoming|apply\s+to\s+be(?:come)?|interested\s+in\s+becoming|join\s+us\s+as)\s+(?:a|an|our)?\s*(?:partner|distributor|dealer|reseller|stockist|retailer|affiliate)s?\b`,
    String.raw`\b(?:distribut(?:or|ion)|dealer|reseller|wholesale|partner(?:ship)?|stockist|trade)\s+(?:program(?:me)?s?|applications?|enquir(?:y|ies)|inquir(?:y|ies)|opportunit(?:y|ies)|accounts?|portal|pricing|terms|network)\b`,
    String.raw`\bapply\s+(?:now\s+)?(?:for|to\s+join)\s+(?:a\s+|our\s+)?(?:wholesale|dealer|distributor|reseller|partner|trade)\b`,
    String.raw`\b(?:partner|distribute|resell|wholesale)\s+with\s+us\b`,
    String.raw`\bjoin\s+our\s+(?:dealer|partner|reseller|distributor|stockist)\s+(?:network|program(?:me)?|team)\b`,
    String.raw`\b(?:looking|searching)\s+for\s+(?:new\s+)?(?:distributors|dealers|resellers|partners|stockists)\b`,
    String.raw`\b(?:signing|recruiting|appointing|onboarding)\s+(?:new\s+)?(?:distributors|dealers|resellers|partners|stockists)\b`,
  ),

  /**
   * Bare "requirements" matched "requirements for your first visit", bare
   * "volume" matched "volume of work", and bare "territory" matched the country
   * list inside a phone-input widget on three separate sites. A territory
   * answers the question only when the site says what its status is.
   */
  partnerTerms: anyOf(
    String.raw`\b(?:exclusive|protected|open|available|assigned|unassigned|defined|remaining|new)\s+territor(?:y|ies)\b`,
    String.raw`\bterritor(?:y|ies)\s+(?:is|are)\s+(?:exclusive|protected|open|available|assigned|awarded|granted|allocated|still)\b`,
    String.raw`\bterritor(?:y|ies)\s+(?:rights|protection|exclusivity|agreement|restrictions)\b`,
    String.raw`\bminimum\s+(?:order|volume|purchase|commitment|spend|quantity)\b`,
    String.raw`\bvolume\s+commitment\b`,
    String.raw`\b(?:partner|dealer|reseller|distributor|stockist)\s+(?:requirements|criteria|qualifications)\b`,
    String.raw`\bqualif(?:ication|ying)\s+criteria\b`,
    String.raw`\blicens(?:e|ing)\s+requirements?\b`,
  ),
} as const;

/**
 * A promise made by somebody else is not this site's answer.
 *
 * Caught by replaying over the stored audits: a comparison page quoting a
 * competitor's money-back guarantee scored the prospect a returns policy, and
 * the competitor's own sentence was printed to them as the receipt.
 *
 * Applied to a WINDOW around the match rather than to the sentence, because
 * extracted page text is frequently headings and table cells joined with no
 * punctuation at all. There the whole site is one "sentence", and a
 * sentence-wide veto would silence every content check on the site because of
 * one word somewhere else on the page — our parsing limit reported as their
 * defect, in the other direction.
 */
const NOT_OUR_ANSWER =
  /\b(?:competitors?|competing|the competition|unlike|versus|vs\.?|compared (?:to|with)|other (?:agencies|firms|providers|companies|clinics|shops|practices|studios|brands)|most (?:agencies|firms|providers|companies|clinics|shops|practices|studios)|elsewhere|they (?:offer|charge|advertise|promise))\b/i;

/** How far either side of a match counts as its surroundings. */
const NOT_OUR_ANSWER_WINDOW = 90;

function extractOf(page: PageCapture): PageExtract | null {
  return page.rendered ?? page.raw;
}

/**
 * All visible text across every readable page, in the case the site wrote it.
 *
 * It used to be lower-cased once here, which was free for matching — every
 * pattern below is `/i` — but the quotes are pulled out of this same string and
 * shown to the client as the receipt. A site that says "what Michelle likes
 * best" came back quoted as "what michelle likes best", which reads as though we
 * mangled their copy. Evidence has to look like evidence.
 */
function siteText(pages: PageCapture[]): string {
  return pages.map((p) => extractOf(p)?.text ?? "").join(" ");
}

function allAnchors(pages: PageCapture[]): { href: string; text: string }[] {
  const out: { href: string; text: string }[] = [];
  for (const page of pages) {
    for (const a of extractOf(page)?.anchors ?? []) out.push({ href: a.href, text: a.text });
  }
  return out;
}

/** A short quotation around one match, so a finding can show its work. */
function quoteAt(haystack: string, at: number, length: number): string {
  const start = Math.max(0, at - 40);
  return `…${haystack
    .slice(start, at + length + 40)
    .replace(/\s+/g, " ")
    .trim()}…`;
}

/** A short quotation around the first match, so a finding can show its work. */
function quote(haystack: string, pattern: RegExp): string | null {
  const m = pattern.exec(haystack);
  if (!m || m.index === undefined) return null;
  return quoteAt(haystack, m.index, m[0].length);
}

/**
 * The first match whose surroundings do not disown it.
 *
 * Every match here becomes a receipt, so the scan keeps going past one that
 * sits inside a comparison with somebody else's offer rather than giving up at
 * the first hit: a site that mentions a competitor's guarantee in one paragraph
 * and states its own in the next has answered the question.
 */
function answerIn(text: string, pattern: RegExp): string | null {
  const scan = new RegExp(
    pattern.source,
    pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
  );
  for (let m = scan.exec(text); m !== null; m = scan.exec(text)) {
    if (m[0].length === 0) {
      scan.lastIndex += 1;
      continue;
    }
    const from = Math.max(0, m.index - NOT_OUR_ANSWER_WINDOW);
    const around = text.slice(from, m.index + m[0].length + NOT_OUR_ANSWER_WINDOW);
    if (NOT_OUR_ANSWER.test(around)) continue;
    return quoteAt(text, m.index, m[0].length);
  }
  return null;
}

type Signals = {
  text: string;
  anchors: { href: string; text: string }[];
  schemaTypes: string[];
  /** Best enquiry form on the site, by field count. */
  bestEnquiryFields: number;
  /** False when no page carried a `forms` array at all — the field is optional
   *  on reports stored before form extraction existed, and there a count of
   *  zero means we never looked, not that the site has no form. */
  formsMeasured: boolean;
  /** Any phone written as a `tel:` link anywhere. */
  hasTappablePhone: boolean;
  /** False when there is no phone number at all, or when the report predates
   *  `linked` being recorded — either way the tappable check cannot be judged. */
  phoneLinkMeasured: boolean;
  /** The whole journey map, not just its headline number. The headline is
   *  computed over pages that HAVE a path, so reading it alone said "yes, a
   *  route from wherever they land" about sites whose dead ends were listed
   *  three inches further down the same report. */
  journey: JourneyMap | null;
};

/**
 * A price word and an actual amount, in the same breath.
 *
 * Ludlow Kingsley scored a published price off the word "package" in a sentence
 * about photographing product packaging, with the `$` coming from a case study.
 * The first fix required the two within 120 characters of each other, and the
 * decoy corpus then caught that this had not fixed anything — it passed only
 * because the fixture happened to put 400 characters between them. At the
 * distance the two actually occur on a portfolio site, a case-study figure still
 * scored as a price.
 *
 * Proximity was the wrong rule. What separates "packages starting at $12,000"
 * from "we photographed each package. That campaign delivered $2.4M" is not
 * distance — it is that the second pair spans a sentence boundary. A price and
 * the word introducing it are always in one clause; a coincidence usually is
 * not. So the two must share a sentence AND sit close within it, which also
 * degrades safely: extracted page text is often headings and table cells joined
 * with no punctuation at all, and there the proximity rule still applies.
 */
const PRICE_WINDOW = 60;

/** Sentence-ish. A false split (on "Dr." or "Inc.") can only make this check
 *  stricter, never more permissive, so a naive rule is the safe one. */
const SENTENCE_SPLIT = /(?<=[.!?])\s+/;

/**
 * Money in a sentence about results is a result, not a price.
 *
 * Caught by replaying this check across the stored audits: our OWN site scored a
 * published price off "double sales year over year for five straight years, from
 * $1M to $16M". The amount is in the same sentence as the price word ("from $"),
 * so neither proximity nor the sentence rule saves it — the sentence is simply
 * about an outcome. Every agency and B2B site on the prospect list leads with
 * numbers like this, which makes it the single most likely way for this check to
 * embarrass us in front of the person who wrote the sentence.
 *
 * Deliberately excluded: "save"/"savings", which belong to real offers ("save
 * $50 on your first order"), and "delivered", which collides with shipping.
 */
const OUTCOME_CONTEXT =
  /\b(revenue|sales|raised|funding|valuation|arr|mrr|grew|growth|profit|roi|year[- ]over[- ]year|yoy|increased|lift(?:ed)?|generated|worth|acquisition)\b/i;

/**
 * A charge for not turning up is not a price.
 *
 * "A $50 cancellation fee applies to appointments missed without notice" was
 * quoted to a client as proof they publish what their work costs. It is the
 * case-study bug wearing a different hat — a real amount in a sentence that
 * answers a different question — and a buyer reading it learns nothing about
 * what the actual service costs.
 *
 * Tested against the WINDOW the amount was found in rather than the whole
 * sentence, so a rate card that happens to end with a cancellation note still
 * scores the rates.
 */
const PENALTY_CONTEXT =
  /\b(?:cancellation|no[- ]shows?|missed (?:appointments?|visits?)|late (?:fees?|payments?|cancellations?)|reschedul(?:e|ing)|returned (?:check|cheque)|bounced|overdue|penalt(?:y|ies)|interest charge|restocking)\b/i;

function priceSignal(text: string): string | null {
  let offset = 0;
  for (const sentence of text.split(SENTENCE_SPLIT)) {
    const base = offset;
    offset += sentence.length + 1;
    if (OUTCOME_CONTEXT.test(sentence)) continue;

    const words = new RegExp(PRICE_WORDS.source, "gi");
    for (let m = words.exec(sentence); m !== null; m = words.exec(sentence)) {
      const from = Math.max(0, m.index - PRICE_WINDOW);
      const window = sentence.slice(from, m.index + m[0].length + PRICE_WINDOW);
      const money = MONEY.exec(window);
      if (!money || money.index === undefined) continue;
      if (PENALTY_CONTEXT.test(window)) continue;
      // Centre the receipt on the AMOUNT, not on the word that led us to it. The
      // client reads this quote as the proof, and a quote containing "packages"
      // but no number does not look like evidence of a price. Quoted from the
      // full text so the sentence split does not clip the receipt.
      const at = base + from + money.index;
      const quoted = text.slice(Math.max(0, at - 70), at + money[0].length + 70);
      return `…${quoted.replace(/\s+/g, " ").trim()}…`;
    }
  }
  return null;
}

function gather(crawl: CrawlResult, checks: ChecksResult | null): Signals {
  const text = siteText(crawl.pages);
  const phones = checks?.consistency?.phones ?? [];
  let bestEnquiryFields = 0;
  let formsMeasured = false;
  for (const page of crawl.pages) {
    const forms = extractOf(page)?.forms;
    if (forms === undefined) continue;
    formsMeasured = true;
    for (const form of forms) {
      if (form.kind === "enquiry") bestEnquiryFields = Math.max(bestEnquiryFields, form.fieldCount);
    }
  }
  return {
    text,
    anchors: allAnchors(crawl.pages),
    schemaTypes: checks?.schema.typesFound ?? [],
    bestEnquiryFields,
    formsMeasured,
    // `linked` is optional on reports stored before it existed; only an explicit
    // true counts as tappable, and only an explicit false makes the question
    // answerable at all.
    hasTappablePhone: phones.some((p) => p.linked === true),
    phoneLinkMeasured: phones.length > 0 && phones.some((p) => p.linked !== undefined),
    journey: checks?.journey ?? null,
  };
}

/**
 * Does this hostname belong to the target?
 *
 * Registrable-domain matching without a public-suffix list: exact host, or a
 * subdomain of it. An entry with no dot ("doctolib") is a brand rather than a
 * domain — the same product answers on .fr, .de and .it — so it is matched
 * against the hostname's own labels instead.
 */
function hostMatches(hostname: string, target: string): boolean {
  const host = hostname.replace(/^www\./, "");
  if (!target.includes(".")) {
    const labels = host.split(".");
    return labels[0] === target || labels[labels.length - 2] === target;
  }
  return host === target || host.endsWith(`.${target}`);
}

/**
 * The first anchor pointing at one of these targets, or null.
 *
 * The href is PARSED, and the hostname compared — a substring test credited
 * "cal.com" to medical.com, surgical.com and socal.com, and to `mailto:`
 * addresses at all three, then printed the address to the client as proof they
 * had online booking. A target may carry a path prefix ("google.com/maps"),
 * which is checked against the path and nothing else.
 */
const linksTo = (s: Signals, targets: string[]): string | null => {
  for (const a of s.anchors) {
    let url: URL;
    try {
      url = new URL(a.href);
    } catch {
      // A relative href addresses this site, and nothing on this site is a
      // third-party booking system or somebody else's map.
      continue;
    }
    // `mailto:`, `tel:` and `javascript:` carry text that can look like a
    // domain and link to nowhere.
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    for (const target of targets) {
      const slash = target.indexOf("/");
      const wantHost = slash === -1 ? target : target.slice(0, slash);
      const wantPath = slash === -1 ? null : target.slice(slash);
      if (!hostMatches(host, wantHost)) continue;
      if (wantPath !== null && !path.startsWith(wantPath)) continue;
      return a.href;
    }
  }
  return null;
};

const has = (s: Signals, re: RegExp): string | null => quote(s.text, re);

/** A content answer: matched, then checked against what surrounds it. */
const answers = (s: Signals, re: RegExp): string | null => answerIn(s.text, re);

/** One requirement, phrased once. `evidence` non-null means met; null means
 *  missing. Pass `measured: false` for a check whose INPUT was unavailable —
 *  that is a gap in our data, not a finding about the site. */
function req(
  key: string,
  label: string,
  why: string,
  scope: Scope,
  evidence: string | null,
  measured = true,
): GoalRequirement {
  return {
    key,
    label,
    status: !measured ? "unmeasured" : evidence !== null ? "met" : "missing",
    evidence,
    why,
    scope,
  };
}

/**
 * "A route to you from wherever they land", read off the whole journey map.
 *
 * This used to be `worstClicksToContact <= 2`, and journey.ts computes that
 * number only over pages that HAVE a path — a page in `deadEnds` never moves
 * it. So the goal section printed "Yes, a route from wherever they land" at the
 * top of the report while the site-health section listed the stranded pages
 * further down the same page. Two sections of one document contradicting each
 * other in front of the client is worse than either being wrong alone, because
 * it is visible without checking anything.
 *
 * One stranded page IS the failure this requirement is named for, so any dead
 * end makes it missing — and the evidence names the pages and the size of the
 * sample, because "no path among the five pages we looked at" and "no path
 * exists" are different claims and only one of them is ours to make.
 *
 * The evidence is a `missing` receipt, which is why this is built by hand
 * rather than through `req` — there, evidence means "we found it".
 */
function reachability(s: Signals): GoalRequirement {
  const shape = (status: RequirementStatus, evidence: string | null): GoalRequirement => ({
    key: "reachable",
    label: "A route to you from wherever they land",
    status,
    evidence,
    why: "Search engines and AI answers send people to whichever page answers their question, not to your home page.",
    scope: "quick",
  });

  const journey = s.journey;
  // `anchorsMeasured` is absent on reports stored before it existed, and those
  // journeys were computed by reading a missing anchor list as "this page links
  // nowhere" — which is how every page of a working site becomes a dead end in
  // our data and nowhere else. Only an explicit true is a measurement.
  if (!journey || journey.anchorsMeasured !== true || journey.pagesExamined === 0) {
    return shape("unmeasured", null);
  }

  if (journey.deadEnds.length > 0) {
    const shown = journey.deadEnds.slice(0, 3);
    const rest = journey.deadEnds.length - shown.length;
    return shape(
      "missing",
      `${journey.deadEnds.length} of ${journey.pagesExamined} pages we examined have no route to a way of contacting you: ${shown.join(", ")}${rest > 0 ? `, and ${rest} more` : ""}`,
    );
  }

  const worst = journey.worstClicksToContact;
  // No dead ends and no worst distance means no page carried a distance at all,
  // which is a shape we cannot read rather than a site we can judge.
  if (worst === null) return shape("unmeasured", null);
  if (worst > 2) return shape("missing", null);
  return shape(
    "met",
    worst === 0
      ? `a way to make contact on every one of the ${journey.pagesExamined} pages we examined`
      : `at most ${worst} ${worst === 1 ? "click" : "clicks"} away, across ${journey.pagesExamined} pages examined`,
  );
}

/**
 * Requirements shared by every goal that ends in a human conversation. Pulled
 * out because four of the seven goals need exactly these and duplicating them
 * is how they drift apart.
 */
function contactBasics(s: Signals): GoalRequirement[] {
  return [
    req(
      "tappable-phone",
      "A phone number they can tap",
      "Most of your visitors are on a phone. A number written as text has to be memorised and retyped, at the exact moment they had decided to call.",
      "quick",
      s.hasTappablePhone ? "tel: link found" : null,
      // A site with no phone number anywhere has nothing to make tappable, and
      // a report stored before `linked` was recorded cannot answer this at all.
      s.phoneLinkMeasured,
    ),
    reachability(s),
  ];
}

export function checkGoal(
  goal: SiteGoal,
  source: "inferred" | "operator",
  crawl: CrawlResult,
  checks: ChecksResult | null,
): GoalFit {
  const s = gather(crawl, checks);
  let requirements: GoalRequirement[] = [];

  const hours = req(
    "hours",
    "Your opening hours, in text",
    "It is the second thing anyone checks and the first thing that goes stale. When your site does not say, an AI answer will take it from a directory listing you do not control.",
    "quick",
    has(s, HOURS_IN_TEXT) ??
      (s.schemaTypes.some((t) => /openinghours/i.test(t)) ? "openingHours in schema" : null),
  );

  const address = req(
    "address",
    "An address and a map link",
    "Somebody deciding whether to come to you needs to know where you are without leaving your site to find out.",
    "quick",
    linksTo(s, MAP_HOSTS) ??
      (s.schemaTypes.includes("PostalAddress") ? "PostalAddress schema" : null),
  );

  const price = req(
    "price-signal",
    "Some signal of what it costs",
    "It is the most common question buyers ask before making contact, and the one most sites never answer. A range, a starting point or a worked example is enough — silence sends them to someone who does say.",
    "content",
    priceSignal(s.text),
  );

  const qualifying = req(
    "qualifying-form",
    "A form that asks enough to have a real first conversation",
    "A name-and-email box produces enquiries you have to qualify by hand. Three or four more fields turn a lead into a briefed conversation.",
    "content",
    s.bestEnquiryFields >= 4 ? `enquiry form with ${s.bestEnquiryFields} fields` : null,
    s.formsMeasured,
  );

  switch (goal) {
    case "book":
      requirements = [
        req(
          "booking",
          "A way to book without calling",
          "A caller has to reach you during your hours. A booking link works at 11pm, which is when people schedule.",
          "structural",
          linksTo(s, BOOKING_HOSTS),
        ),
        hours,
        ...contactBasics(s),
        req(
          "new-clients",
          "Whether you are taking new clients",
          "Nobody wants to fill in a form to find out you are full.",
          "content",
          answers(s, ANSWERS.acceptingClients),
        ),
        address,
      ];
      break;

    case "enquire":
      requirements = [qualifying, price, ...contactBasics(s)];
      break;

    case "call":
      requirements = [
        ...contactBasics(s),
        hours,
        req(
          "what-to-expect",
          "What happens when they call",
          "A first call is easier to make when the visitor knows who picks up and what it costs them.",
          "content",
          answers(s, ANSWERS.whatToExpect),
        ),
      ];
      break;

    case "visit":
      requirements = [
        address,
        hours,
        ...contactBasics(s),
        req(
          "getting-there",
          "Parking or transit",
          "The last hundred metres are where a visit gets abandoned.",
          "content",
          answers(s, ANSWERS.gettingThere),
        ),
      ];
      break;

    case "buy":
      requirements = [
        req(
          "shipping",
          "Shipping cost and timing",
          "Unexpected shipping cost is the single most common reason a cart is abandoned.",
          "content",
          answers(s, ANSWERS.shipping),
        ),
        req(
          "returns",
          "A returns policy",
          "Buyers look for it before their first order from a company they do not know.",
          "content",
          answers(s, ANSWERS.returns),
        ),
        price,
        ...contactBasics(s),
      ];
      break;

    case "demo":
      requirements = [
        req(
          "demo-path",
          "A demo request that is not the general contact form",
          "Someone ready for a demo is further along than someone with a question, and sending both to one box loses the difference.",
          "structural",
          linksTo(s, BOOKING_HOSTS) ??
            (s.anchors.some((a) =>
              /\b(book a demo|get a demo|request a demo|see it in action)\b/i.test(a.text),
            )
              ? "demo link in navigation"
              : null),
        ),
        qualifying,
        price,
        ...contactBasics(s),
      ];
      break;

    case "partner":
      requirements = [
        req(
          "partner-route",
          "A named route for partners, separate from customers",
          "A distributor who lands on a customer contact form usually leaves.",
          "content",
          answers(s, ANSWERS.partnerRoute),
        ),
        req(
          "requirements",
          "What you are looking for in a partner",
          "Territory, volume or credentials — enough for someone to tell whether it is worth writing to you.",
          "content",
          answers(s, ANSWERS.partnerTerms),
        ),
        ...contactBasics(s),
      ];
      break;

    case "unknown":
      // Deliberately no requirements. Inventing a checklist for a purpose we
      // could not identify would grade the site against our guess and report
      // the result as their failing. The finding IS that we could not tell.
      requirements = [];
      break;
  }

  return {
    goal,
    source,
    requirements,
    met: requirements.filter((r) => r.status === "met").length,
    // Only what we could judge. A denominator that counts unmeasured checks
    // would report "3 of 6" for a site where we looked at four things.
    total: requirements.filter((r) => r.status !== "unmeasured").length,
  };
}

/** Report order: unmet before met, then by how much work it is. A reader should
 *  hit the afternoon's work first and arrive at the structural questions having
 *  already agreed with everything above them. */
const SCOPE_ORDER: Record<Scope, number> = { quick: 0, content: 1, structural: 2 };
/** Missing first, then met, then the ones we could not judge — which belong at
 *  the bottom because they are a note about our measurement, not about them. */
const STATUS_ORDER: Record<RequirementStatus, number> = { missing: 0, met: 1, unmeasured: 2 };

export function orderRequirements(reqs: GoalRequirement[]): GoalRequirement[] {
  return [...reqs].sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      SCOPE_ORDER[a.scope] - SCOPE_ORDER[b.scope],
  );
}
