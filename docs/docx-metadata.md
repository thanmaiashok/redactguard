# DOCX: properties, paths and hidden parts

| Rule                                                              | Severity | What it finds                                                                                                                               |
| ----------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `docx.metadata.author`                                            | medium   | `dc:creator` and `cp:lastModifiedBy` (names)                                                                                                |
| `docx.metadata.company`                                           | medium   | Company, Manager, and custom properties named like a company, client or department                                                          |
| `docx.file-path`                                                  | medium   | Local paths: attached template, linked files (`TargetMode="External"`), field codes like `INCLUDEPICTURE "C:\Users\…"`. Names the username. |
| `docx.embedded-object`                                            | medium   | Files under `word/embeddings/`. An embedded chart usually carries the **whole** source spreadsheet.                                         |
| `docx.macros`                                                     | medium   | `vbaProject.bin` (VBA macros)                                                                                                               |
| `docx.metadata.title`                                             | low      | Title, subject, description, keywords, category, status                                                                                     |
| `docx.metadata.software` / `.template` / `.edit-stats` / `.dates` | low      | App and version, template name, revision count, total editing time, created / modified / printed dates                                      |
| `docx.metadata.custom`                                            | low      | Other custom properties (e.g. sensitivity labels written by company systems)                                                                |
| `docx.document-variables`                                         | low      | `w:docVars`, often written by macros and add-ins                                                                                            |
| `docx.custom-xml`                                                 | low      | Data in `customXml/item*.xml` (SharePoint, templates, add-ins)                                                                              |

Images in `word/media/` go through every [image check](image-metadata.md) (GPS, serial numbers, thumbnails, pixelation). The finding names the part, e.g. `word/media/image1.jpeg`.

Ordinary web hyperlinks are not reported.

## Safety

DOCX files are zip archives. redactguard refuses archives with more than 10,000 parts or more than 1 GB uncompressed (zip bombs). Damaged parts are skipped with a warning.

## Fix

File → Info → Check for Issues → **Inspect Document** → remove everything listed. Or run `redactguard clean`.
