import { describe, it, expect } from "vitest";
import {
  feedEntityType,
  isSkippedFeed,
} from "../../../src/blux/catalog/feeds.js";

describe("feedEntityType (frozen spec §8 mapping)", () => {
  it("maps the named feeds", () => {
    expect(feedEntityType("Products")).toBe("product");
    expect(feedEntityType("Equipment Grid")).toBe("product");
    expect(feedEntityType("Center Features")).toBe("product");
    expect(feedEntityType("Team")).toBe("person");
    expect(feedEntityType("Reps")).toBe("person");
    expect(feedEntityType("Trainers")).toBe("person");
    expect(feedEntityType("Events")).toBe("event");
    expect(feedEntityType("Donate Life Observances")).toBe("event");
    expect(feedEntityType("News")).toBe("news_article");
    expect(feedEntityType("Outside The Lines")).toBe("news_article");
    expect(feedEntityType("All Projects List")).toBe("project");
    expect(feedEntityType("Portfolio")).toBe("project");
    expect(feedEntityType("Projects")).toBe("project");
  });
  it("is case/space-insensitive and defaults to collection_item", () => {
    expect(feedEntityType("  products ")).toBe("product");
    expect(feedEntityType("Gallery Wall")).toBe("collection_item");
  });
  it("suffix-matches prefixed Equipment Grid names (fitHealthClub ×4)", () => {
    expect(feedEntityType("The Pointe Equipment Grid")).toBe("product");
    expect(feedEntityType("Alamo Heights equipment grid")).toBe("product");
    // the suffix must END the name — a mere substring does not match
    expect(feedEntityType("Equipment Grid Extras")).toBe("collection_item");
  });
  it("flags DO-NOT-USE feeds as skipped", () => {
    expect(isSkippedFeed("DO NOT USE THIS")).toBe(true);
    expect(isSkippedFeed("do not use — old")).toBe(true);
    expect(isSkippedFeed("Products")).toBe(false);
  });
});
