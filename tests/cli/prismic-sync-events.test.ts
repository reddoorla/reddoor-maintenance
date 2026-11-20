import { describe, it, expect } from "vitest";
import { prismicSyncOpenedEvent } from "../../src/cli/commands/prismic-sync.js";

// P1-87 PR 9 (c). A sync PR that this run opened is one feed event, named for the
// site. A site with no name records nothing: the feed never shows a path.
const AT = "2026-06-25T07:00:00.000Z";

describe("prismicSyncOpenedEvent", () => {
  it("builds one event for a named site's opened PR, keyed by repo and PR number", () => {
    expect(prismicSyncOpenedEvent("Caltex", "reddoorla/caltex", 7, AT)).toEqual({
      id: "prismic_sync_opened:reddoorla/caltex#7",
      ts: AT,
      type: "prismic_sync_opened",
      siteId: null,
      siteName: "Caltex",
      summary: "Prismic sync PR opened",
      data: null,
    });
  });

  it("records nothing for a site with no name", () => {
    expect(prismicSyncOpenedEvent(null, "reddoorla/caltex", 7, AT)).toBeNull();
  });

  it("records nothing for an empty name", () => {
    expect(prismicSyncOpenedEvent("", "reddoorla/caltex", 7, AT)).toBeNull();
  });
});
