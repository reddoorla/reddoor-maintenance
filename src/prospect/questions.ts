import type { SiteGoal } from "./goals.js";

/**
 * The questions we ask of every site, fixed in advance.
 *
 * These used to be written by the model on each run — "6-10 questions a real
 * buyer in this category asks" — and the result was a good report built on an
 * instrument that could not be read twice. The set changed between audits, and
 * so did its size, so the Answers score measured a different thing every time.
 * The report meanwhile promised, one section above it, that "every number here
 * is one we can move and show you the before and after of". That promise was
 * not true of the number we most wanted to build a relationship on.
 *
 * Fixing the set costs us something real: a model writing questions fresh can
 * be sharper about a specific business than a list written months earlier. We
 * are trading that sharpness for a number that survives being measured twice,
 * which is the only property that makes a second audit worth selling. The model
 * still does the hard part — reading the site and judging each answer.
 *
 * The set is keyed on the goal because the goal is already the axis the rest of
 * the report is organised around (see goals.ts), and because it is the axis a
 * client can confirm or correct in one sentence. It is versioned because these
 * questions WILL be edited, and an edit must break comparability loudly rather
 * than silently: see `sameQuestionSet`.
 */

/** Bumped whenever any question text or any set's membership changes. A
 *  version bump deliberately makes every prior audit non-comparable, because
 *  it is. Editing a question in place without bumping this is the one change
 *  that would let the report claim a before/after across two different tests. */
export const QUESTION_SET_VERSION = 1;

export type BuyerQuestionSpec = {
  /** Stable across versions where the question means the same thing, so a
   *  future comparison can align individual rows and not just whole sets. */
  id: string;
  question: string;
};

export type QuestionSet = {
  /** `${goal}-v${QUESTION_SET_VERSION}` — stored with the audit and compared
   *  before any before/after claim is made. */
  id: string;
  goal: SiteGoal;
  questions: BuyerQuestionSpec[];
};

export const ALL_GOALS: readonly SiteGoal[] = [
  "book",
  "enquire",
  "call",
  "visit",
  "buy",
  "demo",
  "partner",
  "unknown",
] as const;

/**
 * Asked of every site, whatever it is for.
 *
 * `cost` leads deliberately. It is the question missing from every site in the
 * corpus we have audited so far, it is the one buyers say most often decides
 * whether they make contact, and it is content work rather than engineering —
 * which is to say it is the finding that most reliably turns into a
 * conversation about telling the story properly.
 */
const UNIVERSAL: BuyerQuestionSpec[] = [
  { id: "cost", question: "What does this cost?" },
  { id: "who-for", question: "Is this for someone like me?" },
  { id: "proof", question: "Why should I believe you can do this?" },
  { id: "who-does-it", question: "Who will I actually be dealing with?" },
  { id: "where", question: "Where are you, and do you cover me?" },
  { id: "next-step", question: "What happens after I get in touch?" },
];

/** Added to the universal set for each goal. Kept to four so every goal's set
 *  is the same size and a reader is never asked to compare a ten-question site
 *  against a six-question one. */
const BY_GOAL: Record<Exclude<SiteGoal, "unknown">, BuyerQuestionSpec[]> = {
  book: [
    { id: "availability", question: "Are you taking new clients right now?" },
    { id: "how-to-book", question: "How do I book, and can I do it without phoning?" },
    { id: "first-visit", question: "What happens at a first appointment?" },
    { id: "payment", question: "What payment or insurance do you accept?" },
  ],
  enquire: [
    { id: "timeline", question: "How long does a project like mine take?" },
    { id: "process", question: "How do you work — what are the stages?" },
    { id: "minimum", question: "Is there a minimum size of project you take on?" },
    { id: "my-input", question: "What will you need from me?" },
  ],
  call: [
    { id: "reachable-hours", question: "When can I actually reach you?" },
    { id: "who-answers", question: "Who picks up when I call?" },
    { id: "call-cost", question: "Is a first conversation free?" },
    { id: "urgent", question: "What do I do if it is urgent or out of hours?" },
  ],
  visit: [
    { id: "opening-hours", question: "When are you open?" },
    { id: "getting-there", question: "Where do I park, or how do I get there on transit?" },
    { id: "what-on-site", question: "What will I find when I get there?" },
    { id: "accessibility", question: "Is the building accessible?" },
  ],
  buy: [
    { id: "shipping", question: "What does delivery cost and how long does it take?" },
    { id: "returns", question: "What happens if I need to send it back?" },
    { id: "stock", question: "Is it actually in stock?" },
    { id: "payment-methods", question: "How can I pay?" },
  ],
  demo: [
    { id: "demo-content", question: "What actually happens in a demo?" },
    { id: "integration", question: "Will it work with what we already use?" },
    { id: "compliance", question: "How do you handle security and compliance?" },
    { id: "who-else", question: "Who else like us is already using this?" },
  ],
  partner: [
    { id: "partner-fit", question: "What are you looking for in a partner?" },
    { id: "partner-terms", question: "What are the commercial terms?" },
    { id: "territory", question: "Is my territory or market available?" },
    { id: "partner-support", question: "What support do you give partners?" },
  ],
};

/**
 * The set to ask of a site with this goal.
 *
 * `unknown` gets the universal questions rather than nothing. A site whose
 * purpose we could not read is still a site a buyer arrives at wanting to know
 * what it costs and who they would be dealing with, and returning an empty set
 * would render as a business that answers nothing rather than as an audit that
 * did not know what to ask. Because the universal questions are a subset of
 * every goal's set, learning the goal later only ever adds rows — it never
 * changes the meaning of one already asked.
 */
export function questionSetFor(goal: SiteGoal): QuestionSet {
  const specific = goal === "unknown" ? [] : BY_GOAL[goal];
  return {
    id: `${goal}-v${QUESTION_SET_VERSION}`,
    goal,
    questions: [...UNIVERSAL, ...specific],
  };
}

/**
 * Whether two audits asked the same questions, and so whether the difference
 * between their Answers scores means anything.
 *
 * A null id — every audit stored before this existed — is never a match, in
 * either direction. Reading "we don't know" as "same set" is precisely how a
 * report ends up claiming an improvement across two different measurements,
 * and that is the failure this whole change exists to prevent.
 */
export function sameQuestionSet(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  return a === b;
}
