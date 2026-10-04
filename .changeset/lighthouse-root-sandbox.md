---
"@reddoorla/maintenance": patch
---

The lighthouse audit now works when run as root. When the process is root, as in a Claude cloud container, it passes `--no-sandbox` to Chrome, which otherwise refuses to start ("Running as root without --no-sandbox is not supported"); any other user keeps the sandbox. When lhci writes no results, the summary now names lhci's own error (Chrome's refusal, a `Runtime error encountered:` line, or a failed autorun healthcheck such as "Chrome installation not found") instead of the first 200 characters of stderr, which were npm deprecation warnings.
