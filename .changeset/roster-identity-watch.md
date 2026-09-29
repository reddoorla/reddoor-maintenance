---
"@reddoorla/maintenance": minor
---

A maintained site with a blank Git repo or a blank Netlify ID is now a cockpit watch item: "Git repo not recorded (checkout sweeps skip this site)" and "Netlify ID not recorded (deploy check skips this site)", filterable as `no-git-repo` and `no-netlify-id`. Every nightly sweep that needs one of those identities skips the site while the run still succeeds, so until now the first sign was a report that could not be approved (29 Navy, #889). The two conditions are independent, and each can be accepted from the site editor with `no git repo` or `no netlify id` for a site that genuinely has no repo or is not on Netlify. The no-custom-domain aliases (`netlify`, `on netlify`, …) do not mute them. Only `maintained` sites are asked, because that is the set the sweeps cover.
