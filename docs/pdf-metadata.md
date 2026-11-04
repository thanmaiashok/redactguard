# PDF: metadata

**Rules:** `pdf.metadata.author`, `.company`, `.file-path` (**medium**); `.title`, `.custom`, `.software`, `.dates`, `.document-ids`, `.edit-history` (**low**).

## What it means

Besides what's on the page, a PDF carries a hidden properties section: the Info dictionary and an XMP metadata packet. Word, Acrobat and other apps fill it automatically with your name, your company, the original file path (which often includes your username), the programs used, and timestamps. An old title such as "DRAFT v3 – offer for …" often survives too.

## How it works

Reads the Info dictionary (including custom keys such as `Company`) and every property in the XMP packet. If the same value appears in both, it is reported once and both locations are listed. Any value that looks like a file path (`C:\Users\…`, `/Users/…`, `/home/…`, `\\server\…`, `file://`) becomes its own medium finding, which names the username when one is visible.

## Fix

Clear the fields in File → Properties, or run `redactguard clean`, which removes the Info dictionary and the XMP packet.
