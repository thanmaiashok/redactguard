# P0 — Decisions (docs read 2026-11-04)

> Check documents for hidden leaks before you share them. Offline. One command.

## Docs checked (current, not memory)

| Topic           | Source                                                                                     | Key facts used                                                                                                                                                                                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plugin manifest | code.claude.com/docs/en/plugins-reference                                                  | `.claude-plugin/plugin.json`, only `name` required (kebab-case, must not start with `claude-`). Skills auto-discovered at `skills/<name>/SKILL.md`. MCP via root `.mcp.json` or `mcpServers`. `${CLAUDE_PLUGIN_ROOT}` usable in MCP `command/args/env`. Validate with `claude plugin validate --strict`.             |
| Marketplace     | code.claude.com/docs/en/plugin-marketplaces                                                | `.claude-plugin/marketplace.json` needs `name`, `owner.name`, `plugins[]` (`name`, `source`). Repo that is both the marketplace and the plugin: `"source": "./"`. Install: `/plugin marketplace add thanmaiashok/redactguard` then `/plugin install redactguard@redactguard`.                                        |
| SKILL.md        | platform.claude.com agent-skills overview + best-practices; code.claude.com/docs/en/skills | `name` ≤ 64 chars, lowercase/digits/hyphens. `description` ≤ 1024 chars, third person, what + when. Body < 500 lines. Use only portable keys (`name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`) so the skill also uploads to claude.ai/API. `${CLAUDE_SKILL_DIR}` for bundled scripts. |
| MCP TS SDK      | github.com/modelcontextprotocol/typescript-sdk (main = v2)                                 | v2 is stable: `@modelcontextprotocol/server` 2.4.0 (Apache-2.0, node ≥ 20). `McpServer` + `registerTool(name, {description, inputSchema}, handler)`, `StdioServerTransport` from `@modelcontextprotocol/server/stdio`, zod v4 (`import * as z from 'zod/v4'`). Never write to stdout; log with `console.error`.      |

Not reachable from this sandbox: modelcontextprotocol.io and agentskills.io (DNS blocked). The Claude Desktop config snippet will be verified in P6.

## Runtime target

**Node ≥ 22.13** (not 20). Node 20 reached end-of-life on 2026-04-30, and `pdfjs-dist` ≥ 6 needs `>=22.13.0 || >=24`. CI matrix: Node 22 + 24 on ubuntu, macos and windows.

## Dependencies (licenses checked on npm)

| Package                                                                                 | Ver     | License                              | Use                                                                                                                                               |
| --------------------------------------------------------------------------------------- | ------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| pdfjs-dist (legacy build)                                                               | 6.5.438 | Apache-2.0                           | text content, operator lists, annotations, metadata, rendering                                                                                    |
| pdf-lib                                                                                 | 1.17.1  | MIT                                  | rebuild cleaned PDFs, raw object access (JS, embedded files)                                                                                      |
| @napi-rs/canvas                                                                         | 1.1.0   | MIT (Skia, BSD)                      | rasterize pages, image decode/encode (PNG/JPEG/WebP), HTML thumbnails. Prebuilt binaries, no compiler. Loaded lazily, so `scan` works without it. |
| exifr                                                                                   | 7.1.3   | MIT, 0 deps                          | EXIF/GPS/XMP/thumbnail for JPG/PNG/HEIC/WebP                                                                                                      |
| jszip                                                                                   | 3.10.2  | MIT OR GPL-3.0 (we use it under MIT) | DOCX zip read/write                                                                                                                               |
| fast-xml-parser                                                                         | 5.12.0  | MIT                                  | DOCX XML + XMP                                                                                                                                    |
| @modelcontextprotocol/server                                                            | 2.4.0   | Apache-2.0                           | MCP server                                                                                                                                        |
| zod                                                                                     | 4.x     | MIT                                  | MCP schemas + finding schema                                                                                                                      |
| commander                                                                               | 14.x    | MIT                                  | CLI (v15 needs node ≥ 22.12, so 14 is fine either way)                                                                                            |
| picocolors                                                                              | 1.1.1   | ISC                                  | terminal colors                                                                                                                                   |
| Dev: typescript 5.9.3, vitest 4.1, tsup, tsx, eslint 10 + typescript-eslint 8, prettier |         | MIT / Apache-2.0                     | typescript-eslint supports TS < 6.1, so TS 7 is not used yet                                                                                      |

Test install of the runtime set gave these transitive licenses: MIT 26, Apache-2.0 3, ISC 3, MIT-or-GPL 1 (jszip), MIT+Zlib 1 (pako), 0BSD 1. **No copyleft-only licenses.** A `scripts/check-licenses.ts` CI step will keep it that way.

**Rejected:** `sharp` (its prebuilt libvips binaries are LGPL-3.0, and @napi-rs/canvas covers the same needs), `node-canvas` (needs system cairo), `libheif-js` (LGPL-3.0), mupdf/PyMuPDF (AGPL), exiftool-vendored (Perl dependency, too heavy).

**HEIC:** scanning works (exifr reads HEIC metadata). Cleaning HEIC is not supported in v0.1 because no permissive decoder exists. This goes in the README's Limitations section.

## No-network guarantee

1. Static test: no source file in `packages/*/src` imports `http`, `https`, `net`, `tls`, `dns`, `undici`, or calls `fetch`/`XMLHttpRequest`/`WebSocket`.
2. Runtime test: stub those modules and `globalThis.fetch` to throw, then run full scan + clean on every fixture. This also catches dependencies. pdfjs is loaded with local `standardFontDataUrl`, `isEvalSupported:false`, `useWorkerFetch:false`.

## Distribution note

A plugin installed from GitHub has no `node_modules`, so the skill and plugin MCP entry call `npx -y redactguard@<pinned>`. npm downloads the package once, at install time. After that, nothing goes over the network: files are never uploaded and the tool makes no calls. The README will state this plainly.

npm names `redactguard` and `@redactguard/*` are free. The scope needs an npm org created by the owner before P7 publish.

## Final structure

```
redactguard/
├── .claude-plugin/{plugin.json, marketplace.json}
├── .mcp.json                       # plugin MCP entry → npx redactguard-mcp
├── skills/redactguard/{SKILL.md, scripts/scan.sh, scripts/clean.sh}
├── packages/
│   ├── core/        @redactguard/core
│   │   └── src/{types.ts, scan.ts, pdf/*, docx/*, image/*, clean/*, report/*}
│   ├── cli/         redactguard          (bin: redactguard)
│   └── mcp-server/  @redactguard/mcp-server (bin: redactguard-mcp)
├── fixtures/{generate.ts, expected/*.json, out/ (gitignored)}
├── examples/  docs/  assets/demo.gif
├── scripts/check-licenses.ts
├── .github/workflows/{ci.yml, action/}  # action.yml at repo root in P7
└── README.md CONTRIBUTING.md SECURITY.md LICENSE
```

Finding shape: `{ id, detector, severity: 'high'|'medium'|'low'|'info', page?, bbox?, evidence, summary, fix }`.

## Added in P3

- `piexifjs` 1.0.6 (MIT), **dev-only**: writes fake EXIF into test JPEGs. It is not shipped.
- `pdf-lib` is now also a runtime dependency of core. It reads the original JPEG bytes inside PDFs (for EXIF) and will rebuild PDFs in P4.
- `@napi-rs/canvas` decodes images for pixelation and thumbnail checks. It is loaded lazily: if it fails to load, scans still run and skip pixel checks with a warning.
