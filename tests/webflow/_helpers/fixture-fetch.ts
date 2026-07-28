/** Fixture-backed FetchPage for crawlSite tests — the four index pages map to
 *  their captured fixtures; every detail path resolves to a representative
 *  fixture (selector shapes are identical across items of a Webflow collection,
 *  they're template pages). Shared by crawl.test.ts and beachfront.test.ts so
 *  the two suites can never crawl different fake sites. */
import { readFileSync } from "node:fs";

export const fx = (name: string) =>
  readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf-8");

const FIXTURE_BY_PATH: Record<string, string> = {
  "/": fx("home.html"),
  "/our-team": fx("our-team.html"),
  "/services": fx("services-index.html"),
  "/ask-the-doctor": fx("ask-the-doctor.html"),
};

export const fakeFetch = async (path: string) =>
  FIXTURE_BY_PATH[path] ??
  (path.startsWith("/team-members/")
    ? fx("team-dr-robert-quan.html")
    : path.startsWith("/services/")
      ? fx("service-dental-crowns.html")
      : fx("question-tooth-broke-off.html"));
