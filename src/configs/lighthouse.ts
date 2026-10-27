export const lighthouseConfig = {
  ci: {
    collect: {
      url: ["http://localhost:5173/dev/a11y-fixtures"],
      // `npm run vite:dev` works on both pnpm and npm sites — pnpm respects
      // the `run` form too. Keeps this config portable across the fleet
      // while sites transition to pnpm.
      //
      // `--port 5173 --strictPort` because `url` above is pinned to 5173 and
      // nothing else here binds vite to it. The readiness check makes the drift
      // silent AND wrong rather than merely slow: `startServerReadyPattern`
      // matches vite's "ready in" line whatever port it settled on, so with
      // something already on 5173 vite comes up on 5174, announces itself,
      // and lighthouse then collects from 5173 — auditing the squatter and
      // reporting ITS scores as this site's. That is the same failure the
      // audits fixed for themselves (see src/audits/lighthouse.ts, which
      // allocates a free port and passes both flags); this config is what a
      // site gets when it consumes the shared lighthouserc directly.
      startServerCommand: "npm run vite:dev -- --port 5173 --strictPort",
      startServerReadyPattern: "ready in",
      startServerReadyTimeout: 120_000,
      numberOfRuns: 1,
      settings: {
        preset: "desktop",
        skipAudits: ["uses-http2"],
      },
    },
    assert: {
      assertions: {
        "categories:accessibility": ["error", { minScore: 0.95 }],
        "categories:best-practices": ["error", { minScore: 0.9 }],
        "categories:seo": ["error", { minScore: 0.9 }],
        "categories:performance": ["warn", { minScore: 0.7 }],
      },
    },
    upload: {
      target: "temporary-public-storage",
    },
  },
} as const;

export default lighthouseConfig;
