# PDF: hidden text

**Rules:** `pdf.hidden-text.low-contrast`, `.invisible`, `.transparent`, `.tiny`, `.off-page`, `.under-image` (all **high**), plus `pdf.hidden-text.ocr-layer` (**info**).

## What it means

The text is in the file, but you can't see it on the page. Anyone can still select, copy, search or extract it. People often "hide" text like this when they mean to delete it.

| Rule               | How the text is hidden                                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `low-contrast`     | Same colour as what's behind it, e.g. white on white or black on a black box drawn _before_ the text. Contrast ratio below 1.25. |
| `invisible`        | PDF text render mode 3 (invisible) or 7 (clip only), with no scanned image underneath.                                           |
| `transparent`      | Fill opacity (`ca`) of 5% or less.                                                                                               |
| `tiny`             | Less than 1 pt tall once rendered.                                                                                               |
| `off-page`         | Less than 10% of the text is inside the page box, e.g. cropped away.                                                             |
| `under-image`      | An opaque image is painted on top of it later in the drawing order.                                                              |
| `ocr-layer` (info) | Invisible text over a scanned image. Normal OCR, but black boxes drawn on the scan do not remove it.                             |

## How it works

redactguard replays each page's drawing commands (via pdf.js operator lists), tracking the colour, opacity, render mode, font size and position of every piece of text. It compares that against every shape and image painted before and after.

## Fix

Delete the text in the source document and export again, or run `redactguard clean`, which rasterizes the affected pages so no text layer remains.

## Limits

- Assumes white paper when nothing is painted under the text.
- Text over a photo or gradient is not contrast-checked.
- Images with transparent areas painted over text may give a false `under-image` finding.
- Clipping paths are not tracked yet.
