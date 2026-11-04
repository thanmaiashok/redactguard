# DOCX: comments

**Rule:** `docx.comment` (**medium**, or **low** when the comment only records an author)

## What it means

Comments live in `word/comments.xml` with the author's name, initials and a timestamp. Resolved comments are still there too. A comment like "Can we hide the late fee from them?" is a classic leak.

redactguard shows each comment's author, its text and the passage it is attached to.

## Fix

Review → Delete → **Delete All Comments in Document**, or run `redactguard clean`.
