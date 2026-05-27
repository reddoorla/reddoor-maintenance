import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export const CHECK_CID = "rd-check-png";
export const BLURRED_CID = "rd-blurred-tests-jpg";

export type BundledImage = {
  bytes: Uint8Array;
  contentType: string;
  cid: string;
  filename: string;
};

/**
 * Read the bundled image bytes from disk (next to this file in dist/, copied
 * by tsup's onSuccess hook). Both Maintenance and Testing variants reference
 * `check.png`; only the Maintenance variant references `blurredTests.jpg`.
 */
export async function loadBundledImages(): Promise<{
  check: BundledImage;
  blurred: BundledImage;
}> {
  const [check, blurred] = await Promise.all([
    readFile(join(here, "check.png")),
    readFile(join(here, "blurredTests.jpg")),
  ]);
  return {
    check: {
      bytes: new Uint8Array(check),
      contentType: "image/png",
      cid: CHECK_CID,
      filename: "check.png",
    },
    blurred: {
      bytes: new Uint8Array(blurred),
      contentType: "image/jpeg",
      cid: BLURRED_CID,
      filename: "blurredTests.jpg",
    },
  };
}
