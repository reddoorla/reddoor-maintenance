import type { CockpitModel, SiteCard } from "../../../../src/dashboard/fleet-cockpit.js";
import { itemLevel } from "../../../../src/dashboard/fleet-cockpit.js";
import type { AttentionItem } from "../../../../src/alerts/attention.js";
import { pacificDay, plainReasons } from "./view.js";

/** P1-87 PR 5b: the site ticker, one entry per maintained site, worst first. Names,
 *  tiers, reasons, speed scores and deploy dates only: no lead's details reach it. */
export type TickerEntry = {
  key: string;
  name: string;
  tier: "broken" | "attention" | "watch" | "ok";
  tierWord: "Broken" | "Attention" | "Watch" | "OK";
  /** "certificate expires in 6 days", "speed 97 of 100", "last deployed Nov 12". */
  fact: string;
  /** "/s/<stored slug>", or null when the site has no stored slug. */
  href: string | null;
};

const TIER_RANK: Record<TickerEntry["tier"], number> = { broken: 0, attention: 1, watch: 2, ok: 3 };
const TIER_WORD: Record<TickerEntry["tier"], TickerEntry["tierWord"]> = {
  broken: "Broken",
  attention: "Attention",
  watch: "Watch",
  ok: "OK",
};

/** The row's loop time in seconds: 0.15 of a second a character of its text (name, tier
 *  word and fact), and never under 20, so a short row does not race. */
export function tickerSeconds(entries: readonly TickerEntry[]): number {
  const chars = entries.reduce((n, e) => n + e.name.length + e.tierWord.length + e.fact.length, 0);
  return Math.max(20, Math.round(chars * 0.15));
}

/** "and N more" after the first candidate; the first alone when there is one. */
function summarise(candidates: readonly string[]): string {
  const uniq = [...new Set(candidates)];
  if (uniq.length === 0) return "see the site's page";
  return uniq.length > 1 ? `${uniq[0]}, and ${uniq.length - 1} more` : uniq[0]!;
}

function notOkFact(card: SiteCard, now: Date): string {
  const at = (level: string): AttentionItem[] => card.items.filter((it) => itemLevel(it) === level);
  if (card.tier === "broken") {
    const words = plainReasons(at("broken"), card.site, now);
    return summarise(words === null ? [] : words.split("; "));
  }
  if (card.tier === "attention") return summarise(at("attention").map((it) => it.title));
  // Watch: the watch-level items, then the watch reasons the rules gave.
  return summarise([...at("watch").map((it) => it.title), ...card.watchReasons]);
}

/** A stored deploy time, read only when it is a real timestamp. Date.parse is lenient: "0" and
 *  "12" parse to a believable year and day, and "2026-02-30" rolls over into March. So the
 *  value must have the column's shape, parse, and keep its own calendar day in UTC. */
function deployedAt(value: string | null): Date | null {
  if (value === null || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return d.toISOString().slice(0, 10) === value.slice(0, 10) ? d : null;
}

function okFact(card: SiteCard): string {
  const { pScore, lastDeployAt } = card.site;
  if (pScore !== null) return `speed ${pScore} of 100`;
  const deployed = deployedAt(lastDeployAt);
  if (deployed !== null) return `last deployed ${pacificDay(deployed)}`;
  return "no speed score or deploy recorded yet";
}

/** The ticker's entries: the maintained sites of the model, broken first, then by name.
 *  Pure; `slugById` is the snapshot's stored slug per site id. */
export function tickerView(
  model: CockpitModel,
  slugById: ReadonlyMap<string, string>,
  now: Date,
): TickerEntry[] {
  const rows: Array<TickerEntry & { rank: number }> = [];
  for (const card of model.cards) {
    const { site } = card;
    if (site.status !== "maintained") continue;
    const tier: TickerEntry["tier"] | null =
      card.tier === "healthy"
        ? "ok"
        : card.tier === "broken" || card.tier === "attention" || card.tier === "watch"
          ? card.tier
          : null;
    if (tier === null) continue;
    const slug = slugById.get(site.id);
    rows.push({
      key: site.id,
      name: site.name,
      tier,
      tierWord: TIER_WORD[tier],
      fact: tier === "ok" ? okFact(card) : notOkFact(card, now),
      href: slug === undefined ? null : `/s/${slug}`,
      rank: TIER_RANK[tier],
    });
  }
  rows.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  return rows.map(({ rank: _rank, ...entry }) => entry);
}
