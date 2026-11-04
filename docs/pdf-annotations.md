# PDF: annotations and forms

**Rules:** `pdf.annotation.unapplied-redaction` (**high**), `pdf.form.hidden-field` (**high**), `pdf.annotation.comment` (**medium** with text, **low** if it only records an author), `pdf.form.filled-field` (**low**).

## What it means

- **Unapplied redaction.** Acrobat and other editors create a _redaction mark_ first. Until you click **Apply**, the original text sits untouched underneath. redactguard prints that text.
- **Comments and markups.** Sticky notes, highlights and strike-outs travel with the file, along with the author's name. Comments like "we can go lower" are common leaks. For highlights, the highlighted text is shown too.
- **Hidden form fields.** These hold values that never show on the page.
- **Filled form fields.** These stay editable and readable by anyone.

## Fix

Apply redactions, delete comments, flatten forms, or run `redactguard clean`, which burns redactions in and removes all annotations and form fields.
