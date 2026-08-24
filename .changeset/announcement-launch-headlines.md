---
"@reddoorla/maintenance": minor
---

Announcement and Launch reports get their own header headlines ("Your website is
set up for ongoing care." / "Your website is live."), closing the blank band
those types have shown since headlines moved off the plate. All four report
types now stamp a headline.

Also generalises the alpha recovery for Figma MCP exports, which are always
flattened onto whatever sits behind the node — a white frame for
Maintenance/Testing, Figma's canvas grey for the two new ones. The backdrop is
now detected instead of assumed white, and the channel with the most ink/backdrop
separation is used (green separates the brand red from white by 221 levels but
from canvas grey by only 4). Re-verified against the known-good Maintenance
asset: unchanged at mean abs alpha diff 0.022.
