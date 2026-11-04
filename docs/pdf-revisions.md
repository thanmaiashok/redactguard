# PDF: earlier versions (incremental updates)

**Rules:** `pdf.revisions.removed-text` (**high**), `pdf.revisions.removed-comment` (**medium**), `pdf.revisions.old-metadata` (**medium**), `pdf.revisions.history` (**low**)

## What it means

When you edit a PDF and press **Save** (not Save As), many apps don't rewrite the file. They **append** the changes to the end and leave the old version intact. Anyone can cut the file at an earlier `%%EOF` marker and get the old version back, including text you deleted.

## How it works

1. Find every `startxref … %%EOF` trailer. Each one ends a saved version.
2. Open each earlier version on its own.
3. Compare its text lines, comments and document properties with the final version.
4. Report anything that existed before and is gone now. `details.endsAtByte` gives the byte offset where that version ends.

Linearized ("fast web view") files have a first-page section that isn't a real version, and it is skipped. At most 25 earlier versions are checked.

## Fix

Save a fresh copy without history (File → Save As, or Print to PDF), or run `redactguard clean`, which rebuilds the file from scratch.

## Limits

Only text, comment contents and the main Info fields are compared. Changes inside images, or deleted pages, are not described in detail. Signed PDFs normally keep versions on purpose, which is why `pdf.revisions.history` is only low.
