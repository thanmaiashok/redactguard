# PDF: covered text (fake black-box redaction)

**Rule:** `pdf.covered-text` (**high**)

## What it means

Someone drew a black (or white) box over text and thought it was gone. The box only _covers_ the text. The text itself is still in the file, so anyone can select it, copy it, search for it, or delete the box. This is the most common redaction failure in court filings and leaked reports.

redactguard prints the text it found under each box.

## What counts as a box

Any shape painted **after** the text (later in the page's drawing order) that is:

- an opaque fill (≥ 90% opacity) in a known colour, with normal blending, or
- a straight stroked line at least 3 pt thick (a "bar"), or
- the appearance of an annotation, e.g. a filled Square comment.

A glyph counts as covered when **at least 50%** of its box is under the shape. The check runs per glyph, so a box over just the SSN in `Name: … SSN: 000-12-3456` reports only `000-12-3456`. Boxes of the same colour that touch are merged into one finding.

This also covers scanned pages: if a black box is drawn on a scan, the invisible OCR text underneath is still there and gets reported.

## Not reported

- Shapes drawn **before** the text, e.g. a white heading on a black banner.
- Highlights with multiply or darken blending, which leave the text visible.
- See-through boxes (opacity below 90%) and soft-masked shapes.
- Unapplied **Redact** annotations. These have their own rule, [`pdf.annotation.unapplied-redaction`](pdf-annotations.md).

## Fix

Use a redaction tool that **deletes** the content (Acrobat: Redact → Apply), or run `redactguard clean`. It turns affected pages into images with the boxes burned in, so no text remains.

## Limits

Pattern or gradient fills and clipping paths are not treated as boxes yet. Text inside Form XObjects is analysed; text inside Type3 glyph procedures is not.
