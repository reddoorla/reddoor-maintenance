// The reddoor mark (32×32 PNG, ~554 B) inlined as a data-URI favicon. The
// dashboard pages are rendered by Netlify functions with no static-asset
// pipeline, so embedding the icon in the <head> brands every page without a
// second request or a hosted file. Source: reddoor-website/static/favicon.png.
const REDDOOR_FAVICON_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAMAAABEpIrGAAAACXBIWXMAAAAnAAAAJwEqCZFPAAAAk1BMVEVHcEzkGTfjGDbjGTfjGTfjGTfjGTfjGDbjGDbjGTfjGTfjGTfkGTfjGTfjGDbjGDbkGTfjGDbjGDbjGTfjGTfjGDbjGTfjGDbjGTfjGDbjGTfjGTfjGDbjGDbjGDbjGDbjGTfjGTbjGDbjGDbjGDbjGDbjGTfjGTfjGTfjGDbjGDbjGTfjGDbjGDbjGTfjGTbkGTfxxbwzAAAALXRSTlMA4DABMOD8cOBwDltwi+bFLMlk54/BDVPk/I61/u2cFaBw9nqO1izBIQE+Becdo6eEAAABBElEQVQ4y91SCVYCMQwt4kxbcEHFfUFFcMGf9P6nM0kXEPEAmtdJs+cnU+f+He2fIIEAYuVgkmvDfTG9Rh+6LoRBUBqE7gi09l9eAeeTrZJoFd5uQWfj4VbPvRqwmj9zfzP6CYpyi48F6HW5A3WuMHsEPsfvO8cSkMPTe+pfRr/MTckdg+4enqL3PkYf/YFIqiiP8VAw6EZkH6QEO0xJLUhmdbY5+TjHkCVohprlcpzlnJw9GlNkrZC16uCmWIaAZItNrT4xV0T2yxrIWoNKy4rdVXOq0MycWp4r43FOMQWciibMYaOHCXKSPhapqTupGFAnwHoVuUUZq7jaSkqDb0/uD9MXqvJMDtU7lL0AAAAASUVORK5CYII=";

/** A ready-to-interpolate `<link rel="icon">` carrying the reddoor mark. */
export const FAVICON_LINK = `<link rel="icon" type="image/png" href="data:image/png;base64,${REDDOOR_FAVICON_PNG_BASE64}" />`;
