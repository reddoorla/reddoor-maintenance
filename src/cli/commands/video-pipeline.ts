// CLI adapters for `reddoor-maint video-pipeline <encode|stuck>`. Loaded lazily
// from bin.ts, so the node-only pipeline never joins the CLI's startup graph.
import { readFile } from "node:fs/promises";
import { runPipelineEncode } from "../../video-pipeline/node/encode.js";
import { runPipelineStuck } from "../../video-pipeline/node/stuck-cli.js";

export type VideoPipelineCliOptions = {
  url?: string;
  key?: string;
  force?: boolean;
  class?: string;
  site?: string;
  repo?: string;
  prismic?: string;
  mediaBase?: string;
  rules?: string;
  openIssue?: boolean;
  cwd?: string;
  verbose?: boolean;
};

export function runEncodeCommand(opts: VideoPipelineCliOptions) {
  return runPipelineEncode({
    url: opts.url,
    class: opts.class,
    site: opts.site,
    key: opts.key,
    force: opts.force === true,
  });
}

export function runStuckCommand(opts: VideoPipelineCliOptions) {
  return runPipelineStuck(
    {
      site: opts.site,
      repo: opts.repo,
      prismic: opts.prismic,
      mediaBase: opts.mediaBase,
      rules: opts.rules,
      openIssue: opts.openIssue,
    },
    { readFile: (p) => readFile(p, "utf-8") },
  );
}
