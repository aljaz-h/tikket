# Importing tickets

**Project settings → Import** (owners) creates tickets in an existing project from:

- a **Tikket JSON export** (Project settings → Export, standard or staff) – from another project
  or another Tikket instance;
- a **Tikket project bundle** (`.zip`, the JSON export plus images) – the same, with attachments; or
- a **CSV file** – e.g. a spreadsheet or an export from another tracker (Tikket's own ticket CSV
  works too). Comma or semicolon separated, UTF-8 (with or without BOM), quoted fields with
  newlines are supported.

## Flow

1. **Upload** – up to 5 000 tickets; 10 MB for JSON/CSV, 200 MB for bundles (and within the
   server's `BODY_SIZE_LIMIT`). The file is parsed and validated; nothing is created yet.
2. **Map columns** (CSV) – choose the column for each field: title (required), description, type,
   status, priority, labels (`;` `,` or `|` separated), assignee, reporter, release, milestone,
   created date, **updated date**, original ID. Tikket guesses the mapping from common header names
   (e.g. _Summary_, _Issue key_, _Issue type_, _Tags_, _Fix version_, _Date created_,
   _Last modified_, _Assignee email_) and warns when a column is used for two fields, a mapped column
   is empty in every row, or no title column is chosen.
3. **Review** – how many tickets will be created, which records are skipped and why (e.g.
   missing title, with their row number), warnings (unknown values fall back to Bug / Open /
   Medium), **row issues** with their row numbers (invalid dates, unknown values), **possible
   duplicates** (titles that already exist in the project or repeat in the file – listed, not
   blocking), new labels, releases and milestones, number conflicts, images (bundles) and a
   preview. Updated dates are kept (never earlier than the creation date).
4. **Options**
   - _Match people to project members_ (off by default): reporters, assignees and comment authors
     whose username or email address matches a member of this project are linked to them (assignees must be
     staff). Otherwise **you** are recorded and the original name is kept in the ticket history
     and on imported comments.
   - _Keep original ticket numbers_: used when the number is free in this project; otherwise the
     ticket gets the next number. New tickets created later never collide.
   - _Import comments_ (JSON): public comments and – from staff exports – internal notes.
   - _Create missing labels, releases and milestones_: otherwise those references are dropped.
     Imported releases are never published automatically.
5. **Confirm** – the import runs in **one transaction**: if anything fails, nothing is imported
   and the import is marked failed. Confirming twice (double click, retry) imports only once.

Every imported ticket has the source **Import** and keeps its original ID (e.g. `OLD-42`) as its
external reference. Relationships and duplicates between tickets of the same file are restored;
references to tickets outside the file are dropped.

## Project bundles and attachments

A bundle is checked before anything is imported:

- **Archive safety:** only `manifest.json`, `project.json` and files under `attachments/` are
  accepted. Absolute paths, `..`, backslashes, symlinks or other special entries, encrypted or
  unknown compression, duplicate names and suspicious compression ratios (zip bombs) reject the
  bundle. Every entry's CRC-32 and size are checked.
- **Checksums:** `project.json` must match the manifest's SHA-256, otherwise the bundle is rejected.
  Each image must match its size and SHA-256.
- **Content:** each image must really be an allowed image type (checked by its bytes, like normal
  uploads) and within the upload size limit.

Images that are missing or fail a check are **listed in the review and left out**; the rest of
the import continues and no broken references are created. Imported images are attached to the
new ticket or to the new copy of their comment, with their original names and dimensions. If the
import fails, the files written so far are removed again. The uploaded bundle is kept only until
the import finishes (or for 24 hours if it is never confirmed).

## What is never imported

- **Accounts** – no users are created; people are only matched to existing members, and only
  when you enable it.
- **Secrets** – tokens, passwords, integration settings and email addresses are not read from the
  file.
- **Votes** (they belong to accounts) and attachments from plain JSON files (only bundles carry
  the files).

All text goes through the same sanitiser as the web editor (scripts, event handlers and unsafe
links are removed); spreadsheet formula prefixes added by exports (`'=…`) are removed again.
Imports are audit-logged (`project.imported`). Unconfirmed uploads are deleted after 24 hours.
