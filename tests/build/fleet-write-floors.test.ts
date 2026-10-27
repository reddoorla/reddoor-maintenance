import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { withoutComments, workflowPath } from "./_helpers/workflow-source.js";

// #1651 item 3 (the operator, 10-27: delete them). Behind the write gate, the old bare
// `wrote=0` and mass-flake checks could not fire: the gate reds on wrote=0, and on
// failed + missing above a quarter of the applicable sites, which every `failed * 4 >
// total` night already is. A floor that cannot fire reads as a second gate that does
// not exist, so none comes back.
describe("the fleet nightlies keep no bare write floors behind the gate", () => {
  it.each(["fleet-lighthouse.yml", "fleet-smoke.yml", "fleet-security.yml", "fleet-form-e2e.yml"])(
    "%s",
    (file) => {
      const wf = withoutComments(readFileSync(workflowPath(file), "utf-8"));
      expect(wf).toMatch(/FLEET_WRITE_GATE verdict=red/);
      expect(wf).not.toMatch(/"\$wrote" -eq 0/);
      expect(wf).not.toMatch(/failed \* 4/);
    },
  );
});
