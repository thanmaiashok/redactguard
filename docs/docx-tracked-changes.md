# DOCX: tracked changes

**Rules:** `docx.tracked-deletion` (**high**), `docx.tracked-insertion` (**medium**), `docx.tracked-move` (**low**), `docx.tracked-formatting` (**low**)

## What it means

With **Track Changes** on, Word doesn't delete anything. Deleted text stays in the file, marked as a deletion (`<w:del>`), along with the name of the person who deleted it and when. Switching the view to "No Markup" only hides it. Anyone who opens the file with "All Markup" or rejects the change sees the original again.

redactguard prints the deleted text, e.g. the old price `12,000` that was changed to `15,000`.

## How it works

Reads the main document, headers, footers, footnotes and endnotes in order. Text inside `w:del` / `w:moveFrom` is deleted text; text inside `w:ins` / `w:moveTo` is inserted text. Changes by the same author in the same paragraph are grouped, and whole deleted paragraphs stay together. Text boxes count too, read once even though Word stores them twice (`mc:AlternateContent`).

## Fix

Review → Accept → **Accept All Changes** (or Reject), then turn Track Changes off. Or run `redactguard clean`.
