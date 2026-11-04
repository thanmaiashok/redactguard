# redactguard

**Check documents for hidden leaks before you share them. Offline. One command.**

redactguard scans PDF, Word (DOCX) and image files for privacy leaks: text hidden under black boxes, white-on-white text, unapplied redactions, comments, author names, file paths, GPS locations and more. It explains each finding in plain language and makes a safely cleaned copy.

> 🚧 Work in progress. The full README, install instructions and demo come in P7.

## Privacy

redactguard **never makes a network call**. No uploads and no telemetry. Two tests enforce this:

1. A static check fails if any source file imports `http`, `https`, `net`, `tls`, `dns` or similar, or calls `fetch`.
2. A runtime check scans every test fixture with sockets, DNS, `fetch`, `http(s)`, `tls` and UDP booby-trapped. Any attempt fails the build.

pdf.js gets a custom data loader that reads fonts, cmaps and wasm only from local disk.

## Progress

- [x] **P0** Docs read, libraries and licenses confirmed, structure fixed ([decisions](docs/P0-DECISIONS.md))
- [x] **P1** Fixture generator + PDF detectors
  - [x] [metadata](docs/pdf-metadata.md): author, company, file paths, software, dates, XMP IDs and history
  - [x] [annotations and forms](docs/pdf-annotations.md): unapplied redactions (shows the text underneath), comments, hidden and filled form fields
  - [x] [hidden text](docs/pdf-hidden-text.md): white-on-white, invisible mode, transparent, tiny, off-page, under an image; OCR layers recognised
  - [x] Golden-JSON tests, malformed-PDF fuzzing, no-network test, license check
- [x] **P2** The two hardest leaks
  - [x] [covered text](docs/pdf-covered-text.md): text under black or white boxes, thick bars, annotation boxes and boxes on scanned pages; checked per glyph
  - [x] [earlier versions](docs/pdf-revisions.md): deleted text, comments and old properties recovered from incremental updates
- [x] **P3** Word and image detectors, plus attachments, JavaScript and images inside PDFs
  - [x] DOCX: [tracked changes](docs/docx-tracked-changes.md), [comments](docs/docx-comments.md), [hidden text](docs/docx-hidden-text.md), [properties, paths and hidden parts](docs/docx-metadata.md)
  - [x] Images: [GPS, serials, authors, AI prompts, thumbnails that differ](docs/image-metadata.md), [pixelation risk](docs/image-pixelation.md) (flag only, no reconstruction)
  - [x] PDF: [attachments, JavaScript, images in pages](docs/pdf-embedded.md)
  - [x] Zip-bomb limits, damaged-part handling, broader fuzzing, dependency-hygiene test
- [ ] **P4** Cleaner + automatic re-scan
- [ ] **P5** CLI polish, JSON/HTML reports, exit codes
- [ ] **P6** SKILL.md, Claude plugin manifests, MCP server
- [ ] **P7** README, examples, GitHub Action, v0.1.0

## Development

Requires Node ≥ 22.13 and pnpm 10.

```bash
pnpm install
```

```bash
pnpm test
```

```bash
pnpm fixtures
```

`pnpm fixtures` writes synthetic leaky documents to `fixtures/out/`. All names and numbers in them are fake.

To regenerate the expected findings after an intended change:

```bash
UPDATE_GOLDEN=1 pnpm test
```

## License

MIT. All dependencies use permissive licenses (MIT, Apache-2.0, ISC, BSD), and `pnpm check-licenses` enforces it.
