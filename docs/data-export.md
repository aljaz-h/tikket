# Data export

## Project export

_Project settings → General → Export data_ (project owners and administrators). Every export is
recorded in the audit log.

- **JSON** – the complete project in one versioned file.
  - **Standard export**: public discussion only.
  - **Staff export**: additionally internal notes (each comment has `internal: true/false`) and the
    usernames of voters. The file starts with a `notice` field saying so. Share it only with staff.
- **Project bundle (.zip)** – the JSON export plus the uploaded images, for moving a project to
  another Tikket (see below).
- **CSV** – one row per ticket for spreadsheets.

Exports never contain password hashes, sessions, API tokens, integration secrets, SMTP
credentials, encryption keys or email addresses. In the JSON export, uploaded images are listed by
name, type and size, not embedded; the bundle carries the files. Tickets are read page by page and
streamed, so large projects don't need much memory.

### JSON format (`tikket-project`, version 1)

```jsonc
{
	"format": "tikket-project",
	"version": 1,
	"scope": "standard", // or "staff" (then also "notice")
	"exported_at": "2026-10-07T09:00:00.000Z",
	"project": {
		"key": "SPL",
		"name": "Spool",
		"description": "…",
		"url": "…",
		"docs_url": "…",
		"icon": "🎬",
		"color": "indigo",
		"accent_color": "#b8f779",
		"visibility": "private",
		"settings": {
			"submission_policy": "…",
			"voting_enabled": true,
			"attachments_enabled": true,
			"comments_enabled": true,
			"edit_policy": "…",
			"allow_anonymous_read": false
		},
		"created_at": "…",
		"archived_at": null
	},
	"members": [{ "username": "aljaz", "name": "Aljaž", "role": "owner" }],
	"labels": [{ "name": "UI", "color": "blue" }],
	"releases": [
		{
			"id": 3,
			"version": "1.4",
			"status": "released",
			"target_date": null,
			"release_date": "2026-09-30",
			"summary_html": "…",
			"released_at": "…"
		}
	],
	"milestones": [
		{
			"id": 1,
			"name": "Beta",
			"description": null,
			"status": "open",
			"target_date": "2026-12-01",
			"completed_at": null
		}
	],
	"tickets": [
		{
			"id": 42,
			"key": "SPL-42",
			"number": 42,
			"url": "…",
			"type": "bug",
			"title": "…",
			"description_html": "…",
			"description_text": "…",
			"details": { "stepsToReproduce": "…" },
			"status": "completed",
			"priority": "high",
			"resolution_note": null,
			"duplicate_of": null,
			"source": "web",
			"environment": null,
			"reporter": { "username": "mia", "name": "Mia" },
			"assignee": null,
			"labels": ["UI"],
			"release": "1.4",
			"milestone": null,
			"votes": 7,
			"voters": ["…"], // staff export only
			"created_at": "…",
			"updated_at": "…",
			"completed_at": "…",
			"closed_at": "…",
			"template": {
				"name": "Bug",
				"version": 2,
				"answers": [{ "key": "device", "label": "Which device?", "kind": "select", "value": "TV" }]
			},
			"relationships": [{ "kind": "blocks", "ticket": "SPL-40" }], // relates | blocks | blocked_by
			"attachments": [
				{
					"id": "…",
					"name": "before.png",
					"mime_type": "image/png",
					"size": 12345,
					"comment_id": null
				}
			],
			"comments": [
				{
					"id": 9,
					"author": { "username": "…", "name": "…" },
					"internal": false,
					"body_html": "…",
					"body_text": "…",
					"deleted": false,
					"created_at": "…",
					"edited_at": null
				}
			],
			"activity": [
				{
					"type": "status",
					"actor": { "username": "…", "name": "…" },
					"data": { "from": "open", "to": "planned" },
					"created_at": "…"
				}
			]
		}
	]
}
```

Users are referenced by username (stable and unique), tickets by key. The format is designed as the
basis of a future import/restore: fields are only added within version 1; anything incompatible
gets a new version number. JSON exports can be imported into another project – see
[Import](import.md).

### CSV

Columns: Ticket ID, Title, Type, Status, Priority, Reporter, Assignee, Labels (`; `-separated),
Votes, Release, Milestone, Created, Updated, Completed, URL. UTF-8 with BOM, RFC 4180 quoting.
**Formula injection is prevented:** any cell starting with `=`, `+`, `-`, `@`, tab or carriage
return is prefixed with `'`, so spreadsheets show it as text instead of evaluating it.

### Project bundle (`tikket-project-bundle`, version 1)

A ZIP file with:

```
manifest.json            { "format": "tikket-project-bundle", "version": 1, "createdAt", "project",
                           "projectJson": { "path", "sha256", "size" },
                           "files": [{ "path", "sha256", "size", "attachmentId", "name",
                                       "mimeType", "width", "height" }] }
project.json             the JSON export above (standard or staff, as chosen)
attachments/<id>.<ext>   the original image of every attachment listed in project.json
```

- The scope follows the JSON choice: a standard bundle never contains images of internal notes.
- The export page shows how many images a bundle will contain and their total size, and warns above
  100 MB. Bundles are streamed (one image at a time); no background job is involved.
- Importing a bundle needs the receiving server's `BODY_SIZE_LIMIT` (and the proxy's body limit)
  to be at least the bundle size; the importer accepts bundles up to 200 MB.
- Images missing on disk when the bundle is created are left out; the importer then reports them.

## Personal export

_Account settings → Your data_: the tickets you reported and the comments you wrote, as JSON
(`tikket-personal`, version 1) or a ticket CSV. Only projects you can still access are included,
and no other people's data apart from project names.
