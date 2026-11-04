# DOCX: hidden text

**Rules:** `docx.hidden-text.vanish`, `docx.hidden-text.white`, `docx.hidden-text.tiny` (all **high**)

| Rule     | How the text is hidden                                                                                                |
| -------- | --------------------------------------------------------------------------------------------------------------------- |
| `vanish` | Font → **Hidden** (`w:vanish`), directly or through a character or paragraph style. It shows with "Show hidden text". |
| `white`  | White (or near-white) font colour, with no highlight or shading behind it and no dark page background.                |
| `tiny`   | Font size 1 pt or less.                                                                                               |

All three are invisible when printed or viewed normally, but the text is in the file: it can be copied, searched and indexed.

## Fix

Show hidden text (Ctrl+Shift+8), then delete the text rather than recolouring or hiding it. Or run `redactguard clean`.

## Limits

Theme colours other than `background1`/`light1`, and text hidden by table-cell shading that matches the font colour, are not checked yet.
