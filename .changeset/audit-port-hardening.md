---
"@reddoorla/maintenance": patch
---

Harden lighthouse + a11y audits against zombie dev-server processes.

Both audits used to spawn `npm run vite:dev` and probe a hardcoded `localhost:5173`. If another process was already on 5173 (e.g. an orphaned vite from a prior `pnpm dev`), vite would silently bump to a free port while the audit kept probing 5173 — landing on the zombie and getting stale 404s, surfacing as `no manifest written` / `no results written (exit 1)`.

The audits now allocate a free port up front and pass `--port <port> --strictPort` to vite, so the spawned server either binds the intended port or fails loudly. The lighthouse config gets its URL port rewritten to match; the a11y audit synthesizes its own playwright config (with `reuseExistingServer: false`) instead of relying on the site's local one.
