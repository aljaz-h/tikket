# Importing tickets

**Project settings → Import** (owners) creates tickets in an existing project from:

- a **Tikket JSON export** (Project settings → Export, standard or staff) – from another project
  or another Tikket instance; or
- a **CSV file** – e.g. a spreadsheet or an export from another tracker (Tikket's own ticket CSV
  works too). Comma or semicolon separated, UTF-8 (with or without BOM), quoted fields with
  newlines are supported.

## Flow

1. **Upload** – up to 10 MB and 5 000 tickets. The file is parsed and validated; nothing is
   created yet.
2. **Map columns** (CSV) – choose the column for each field: title (required), description, type,
   status, priority, labels (`;` `,` or `|` separated), assignee, reporter, release, milestone,
   created date, original ID. Tikket guesses the mapping from the header names.
3. **Review** – how many tickets will be created, which records are skipped and why (e.g.
   missing title, with their row number), warnings (unknown values fall back to Bug / Open /
   Medium), new labels, releases and milestones, number conflicts and a preview.
4. **Options**
   - _Match people to project members_ (off by default): reporters, assignees and comment authors
     whose username matches a member of this project are linked to them (assignees must be
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

## What is never imported

- **Accounts** – no users are created; people are only matched to existing members, and only
  when you enable it.
- **Secrets** – tokens, passwords, integration settings and email addresses are not read from the
  file.
- **Attachments and votes** (files aren't part of exports; votes belong to accounts).

All text goes through the same sanitiser as the web editor (scripts, event handlers and unsafe
links are removed); spreadsheet formula prefixes added by exports (`'=…`) are removed again.
Imports are audit-logged (`project.imported`). Unconfirmed uploads are deleted after 24 hours.
