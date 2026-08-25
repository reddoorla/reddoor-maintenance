import { parse, HTMLElement, NodeType } from "node-html-parser";
import type { RobotsAgentAccess } from "./types.js";

/** The answer-engine crawlers the report scores. */
export const AI_AGENTS = [
  "GPTBot",
  "OAI-SearchBot",
  "ClaudeBot",
  "PerplexityBot",
  "Google-Extended",
  "CCBot",
] as const;

/** The classical baseline — a prospect blocking these has a bigger problem than AEO. */
export const CLASSICAL_AGENTS = ["Googlebot", "Bingbot"] as const;

export const ALL_AGENTS: string[] = [...AI_AGENTS, ...CLASSICAL_AGENTS];

type RobotsRule = { type: "allow" | "disallow"; path: string; line: string };
type RobotsGroup = { agents: string[]; rules: RobotsRule[] };

/** Parse robots.txt into agent groups. Consecutive `User-agent:` lines share one
 *  rule set, per the robots.txt convention. */
export function parseRobots(txt: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = (rawLine.split("#")[0] ?? "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (field === "allow" || field === "disallow") {
      if (!current) continue;
      current.rules.push({ type: field === "allow" ? "allow" : "disallow", path: value, line });
      lastWasAgent = false;
    }
  }
  return groups;
}

/** Can each agent fetch the site root? Only rules that cover "/" decide: a
 *  `Disallow: /admin` scopes a section, not the site, and must not read as a
 *  block in the report. An agent-specific group wins over the wildcard group. */
export function evaluateAgentAccess(robotsTxt: string | null): RobotsAgentAccess[] {
  if (robotsTxt === null) {
    return ALL_AGENTS.map((agent) => ({ agent, allowed: true, matchedRule: null }));
  }
  const groups = parseRobots(robotsTxt);
  return ALL_AGENTS.map((agent) => {
    const lower = agent.toLowerCase();
    const specific = groups.find((g) => g.agents.includes(lower));
    const group = specific ?? groups.find((g) => g.agents.includes("*"));
    if (!group) return { agent, allowed: true, matchedRule: null };
    const header = `User-agent: ${specific ? agent : "*"}`;
    const rootRules = group.rules.filter((r) => r.path === "/");
    const block = rootRules.find((r) => r.type === "disallow");
    const allow = rootRules.find((r) => r.type === "allow");
    if (block && !allow) return { agent, allowed: false, matchedRule: `${header} → ${block.line}` };
    return {
      agent,
      allowed: true,
      matchedRule: allow ? `${header} → ${allow.line}` : null,
    };
  });
}

/** Same-origin http(s) hrefs in document order, absolute, fragment-stripped, deduped. */
export function sameOriginLinks(html: string, baseUrl: string): string[] {
  const base = new URL(baseUrl);
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (el: HTMLElement): void => {
    for (const child of el.childNodes) {
      if (child.nodeType !== NodeType.ELEMENT_NODE) continue;
      const e = child as HTMLElement;
      if (e.tagName === "A") {
        const href = e.getAttribute("href");
        if (href) {
          let u: URL | null;
          try {
            u = new URL(href, base);
          } catch {
            u = null;
          }
          if (
            u &&
            u.origin === base.origin &&
            (u.protocol === "http:" || u.protocol === "https:")
          ) {
            u.hash = "";
            const norm = u.toString();
            if (!seen.has(norm)) {
              seen.add(norm);
              out.push(norm);
            }
          }
        }
      }
      walk(e);
    }
  };
  walk(parse(html));
  return out;
}

export function parseSitemapLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>([\s\S]*?)<\/loc>/gi)]
    .map((m) => (m[1] ?? "").trim())
    .filter(Boolean);
}

export function isSitemapIndex(xml: string): boolean {
  return /<sitemapindex[\s>]/i.test(xml);
}
