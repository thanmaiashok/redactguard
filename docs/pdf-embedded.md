# PDF: attachments, JavaScript and images

| Rule                | Severity | What it finds                                                                                                                                                                                                                                                                   |
| ------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pdf.embedded-file` | medium   | Files attached to the PDF (the attachments panel, or paperclip annotations), with name, size and description. Attached images also go through every image check.                                                                                                                |
| `pdf.javascript`    | medium   | Document-level, page-level, and field or annotation scripts. Scripts can run when the file opens and could report who opened it. redactguard never runs them.                                                                                                                   |
| `image.*`           | various  | Every image drawn on a page goes through the [image checks](image-metadata.md). EXIF and GPS come from the original JPEG bytes stored in the PDF. [Pixelation](image-pixelation.md) is checked on the decoded pixels, and the finding includes the area's position on the page. |

Each image is checked once, even when it appears on many pages, and at most 200 images per file are checked.

## Fix

Remove attachments and scripts, or run `redactguard clean`, which rebuilds the PDF without them.
