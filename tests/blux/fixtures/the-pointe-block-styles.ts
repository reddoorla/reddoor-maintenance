// The real the-pointe export's block-style data, verbatim from site.json
// (~/Desktop/thePointe), reduced to the keys the emit padding resolution
// reads: `styles.blocks` in full, and each page block's `_contentPadding` /
// `_max-content-width` raw values — INCLUDING the export's malformed
// tombstones (`"px"`, `""`), which is the very trap the class-default fill
// exists for: bands 1,2,3,4,5,9,10,11,15 carry no usable own padding and
// rely on their `.blocksNcontainer` class default.
export const pointeBlockStyles = {
  styles: {
    blocks: [
      {
        _label: "Block (Default)",
        ".blocks0": { position: "relative" },
        ".blocks0container": {
          "box-sizing": "border-box",
          "max-width": "1280px",
          margin: "0 auto",
          padding: "120px 4% 120px 4%",
          __media_mobile_padding: "80px 4% 80px 4%",
        },
      },
      {
        _label: "White text/image BG",
        ".blocks1": { position: "relative", color: "#fff", "background-color": "#333" },
        ".blocks1container": {
          "box-sizing": "border-box",
          "max-width": "1280px",
          margin: "0 auto",
          padding: "120px 4%",
          __media_mobile_padding: "80px 4% 80px 4%",
        },
        ".blocks1:hover": {},
      },
      {
        _label: "Special Grid Spacer Block",
        ".blocks2": { position: "relative" },
        ".blocks2container": {
          "box-sizing": "border-box",
          "max-width": "1280px",
          margin: "0 auto",
          padding: "40px 0",
          __media_mobile_padding: "20px 0",
        },
      },
    ],
  },
  content: {
    pages: [
      {
        items: [
          { styles: { _contentPadding: "0 4% 0 4%" } },
          { styles: { "_max-content-width": "1280px", _contentPadding: "px" } },
          { styles: { _contentPadding: "" } },
          { styles: { "_max-content-width": "1280px", _contentPadding: "px" } },
          { styles: {} },
          { styles: { "_max-content-width": "1280px", _contentPadding: "px" } },
          { styles: { "_max-content-width": "1280px", _contentPadding: "0 4% 0 4%" } },
          { styles: { _contentPadding: "100px 4% 100px 4%" } },
          { styles: { _contentPadding: "0px", "_max-content-width": "none" } },
          { styles: { "_max-content-width": "1280px", _contentPadding: "px" } },
          { styles: { _contentPadding: "", "_max-content-width": "1280px" } },
          { styles: { "_max-content-width": "1280px", _contentPadding: "px" } },
          { styles: { "_max-content-width": "none", _contentPadding: "0 4% 0 4%" } },
          { styles: { _contentPadding: "100px 4% 100px 4%" } },
          { styles: { _contentPadding: "0 4% 80px 4%" } },
          { styles: { _contentPadding: "" } },
        ],
      },
    ],
  },
};
