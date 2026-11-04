# Images: pixelation risk

**Rule:** `image.pixelation` (**high** / **medium** / **low**)

## What it means

A mosaic ("pixelate") effect is not a reliable redaction. When the blocks are small compared with the letters, published research has recovered pixelated text. A solid box is always safe.

redactguard **only flags the risk**. It never tries to reverse pixelation.

## How it works

1. Find flat rectangles: runs of same-coloured pixels that repeat identically on consecutive rows.
2. For each block size from 32 px down to 4 px, keep rectangles whose sides are multiples of that size and that sit on one shared grid.
3. Group neighbouring grid cells and keep areas that are dense (≥ 60% filled), varied (≥ 6 different blocks) and at least 3×2 blocks. Fragments split by JPEG noise are merged.

## Risk levels

For a strip up to 6 blocks tall (it looks like a line of text), the likely text height is taken as about 70% of the strip:

| block size ÷ text height | risk     |
| ------------------------ | -------- |
| < 0.5                    | **high** |
| 0.5 – 1                  | medium   |
| ≥ 1                      | low      |

For taller areas (faces, whole paragraphs): blocks ≤ 8 px are **medium**, larger ones **low**.

The finding gives the area in pixels (`details.region`) and, for images inside PDFs, its place on the page (`bbox`).

## Fix

Cover the area with a solid box, for example with `redactguard clean --fix-pixelation` and the coordinates from the report.

## Limits

- Heavily compressed JPEGs (quality around 80 or lower) can hide the grid, so the area may be missed.
- Blocks larger than half the strip height may be missed. These are lower risk.
- Blur is not detected.
- Regular patterns such as colour swatches or pixel art can look like a mosaic.
