export const lighthouseConfig = {
  ci: {
    collect: {
      url: ["http://localhost:5173/dev/a11y-fixtures"],
      startServerCommand: "pnpm vite:dev",
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
