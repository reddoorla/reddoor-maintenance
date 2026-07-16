---
"@reddoorla/maintenance": minor
---

blux theme: emit the export's button skins. Converted trees carry the raw
anchors verbatim (`class="ib middle buttonsN"`), so without the declared
`styles.buttons` skins a button renders as a bare link. `ThemeIR.buttonStyles`
captures each skin (values in declaration order — the skins rely on a `border`
shorthand followed by side zero-overrides netting a bottom-only rule) and
`emitButtonsCss` appends `.buttonsN` rules (+ :hover/:active variants) and the
`.ib` inline-block base to theme.css.
