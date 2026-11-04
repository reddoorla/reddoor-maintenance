// #910: the stored a11y skip list as the Turso and legacy readers parse it. A corrupt cell
// must read as "not stored", never throw inside the fleet read.
import { describe, it, expect } from "vitest";
import { parseA11ySkippedRoutes } from "../../src/fleet/site-row.js";

describe("parseA11ySkippedRoutes", () => {
  it("reads the stored list, keeping the path when there is one", () => {
    expect(
      parseA11ySkippedRoutes(
        JSON.stringify([
          {
            route: "animate-in demo",
            reason: "fixture not in this site's source",
            path: "/dev/animate-in",
          },
          { route: "/", reason: "placeholder Prismic repo" },
        ]),
      ),
    ).toEqual([
      {
        route: "animate-in demo",
        reason: "fixture not in this site's source",
        path: "/dev/animate-in",
      },
      { route: "/", reason: "placeholder Prismic repo" },
    ]);
    expect(parseA11ySkippedRoutes("[]")).toEqual([]);
  });

  it("reads a blank, absent, non-JSON or non-array cell as not stored", () => {
    for (const raw of [null, undefined, "", "  ", "{not json", "{}", '"x"', 3]) {
      expect(parseA11ySkippedRoutes(raw), JSON.stringify(raw)).toBeNull();
    }
  });

  it("drops an entry without both strings, and a non-string path", () => {
    expect(
      parseA11ySkippedRoutes(
        JSON.stringify([
          { route: "/a" },
          { reason: "x" },
          null,
          5,
          { route: "/b", reason: "r", path: 7 },
        ]),
      ),
    ).toEqual([{ route: "/b", reason: "r" }]);
  });
});
