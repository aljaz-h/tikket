# Project management (v0.4)

Tikket v0.4 adds lightweight planning tools for project owners and moderators: saved ticket views, releases, milestones, a richer ticket list and an actionable project overview. There are deliberately no sprints, story points, velocity charts or time tracking.

- [Saved views](#saved-views)
- [Ticket list: filters, columns, quick and bulk actions](#ticket-list)
- [Releases](#releases)
- [Milestones](#milestones)
- [Project overview](#project-overview)
- [Notifications](#notifications)
- [Permissions](#permissions)
- [Database migration](#database-migration)

## Saved views

A view is a named combination of **filters, sort order and visible columns** for one project. Open **Tickets**: views are listed on the left (a dropdown on phones). One click switches views; the active view is highlighted, and a dot marks it as modified when you change its filters (use **Update view** to save the change).

| Kind              | Who sees it                      | Who can change it          |
| ----------------- | -------------------------------- | -------------------------- |
| **Default views** | Everyone (some need sign-in)     | Built in, not editable     |
| **Personal view** | Only its creator                 | Its creator                |
| **Shared view**   | Everyone who can see the project | Project owners, moderators |

Default views: _All tickets, Open tickets, Assigned to me, Reported by me, Following, Unassigned (staff), High priority, Most requested, Recently completed_.

**Save current view** stores the current list; staff can tick _Share with the project_. Each view's menu offers rename, duplicate (always as a personal copy you can change), move up/down and delete.

Views store only a validated, normalised filter query (the same one you see in the URL) – never SQL. The server re-parses it every time, applies the viewer's permissions again, and drops filters that point to deleted labels, releases or milestones (a notice says so). Plain URLs keep working without saving anything.

## Ticket list

**Filters** (combine freely; all are in the URL): status, type, priority, labels, reporter (`me`), assignee (`me`, unassigned), created/updated date ranges, **following**, **has attachments** (images on internal notes don't count), **blocked by open tickets**, and – for staff – **target release** and **milestone** (including "none").

**Columns**: _Columns_ lets you show Ticket ID, Status, Type, Priority, Assignee, Reporter, Labels, Votes, Comments, Target release (staff), Milestone (staff), Created and Updated. The title is always shown. Your choice is remembered in your browser and stored in saved views. On phones the list shows a compact layout.

**Quick actions** (staff): the `⋯` button on each row changes status, priority, assignee, label, target release or milestone without opening the ticket. **Bulk actions** apply the same changes to many selected tickets, including setting/removing a target release or milestone. Both use the same server action: one transaction, per-ticket permission checks, unchanged tickets skipped and reported, one history entry per ticket, and grouped notifications.

**Previous / next**: a ticket opened from a list shows its position ("3 / 41") and previous/next buttons that follow the same filters and order. Only the list's query string travels in the link; nothing is stored in the browser.

## Releases

_Project → Releases_ (staff). A release has a version or name (unique per project, case-insensitive), optional release notes, optional target date and a status: **Planned**, **In Progress**, **Released** or **Cancelled**.

Assign tickets from the release page (`SPL-12, SPL-18`), the ticket sidebar (_Target release_), row quick actions or bulk actions. Each ticket has at most one target release; assign it elsewhere to move it, or choose "No release". Only planned and in-progress releases accept tickets.

The release page shows progress (completed / linked tickets – no bar when nothing is linked), tickets grouped by status and a history of changes.

### Publishing

Owners click **Publish release**. The review screen lists every linked ticket and highlights unresolved ones. Publishing:

1. never changes ticket statuses – optionally it moves unresolved tickets out of the release;
2. records the publication date;
3. makes the release a public **changelog** entry listing its completed tickets;
4. notifies followers and reporters of those tickets once each (setting: _Releases_).

A release can only be published once. Its notes can still be edited afterwards; edits appear in its history. Published releases cannot be deleted; unpublished ones can (their tickets just lose the target release).

### Changelog integration

There is one system: a release **is** the changelog entry. _Project → Changelog_ shows published releases, newest first, with the completed tickets they shipped.

## Milestones

_Project → Milestones_ (staff). Milestones are goals ("Improve mobile experience") rather than versions: a name (unique per project), description and optional target date, with states **Open**, **Completed** and **Archived** (reopen or restore any time). A ticket belongs to at most one milestone; assign it from the milestone page, the ticket sidebar, quick actions or bulk actions. Progress (total, completed, remaining, percentage) is always computed from the tickets' current status.

## Project overview

Everyone sees open / planned / in-progress / completed counts, what's coming up, recently completed tickets, the most requested open tickets and the latest releases. Staff additionally see awaiting-review, unassigned and high-priority counts, **Needs attention** (new reports, unassigned high-priority tickets, tickets reopened in the last 30 days), **upcoming releases** and **active milestones** with progress. Every list is a small indexed query.

## Notifications

_Settings → Notifications_ now also has **Releases** (on by default) and **Milestones** (off by default) next to comments, mentions, status changes, assignments and other updates. Repeated comments, status changes, updates and milestone moves on the same ticket are merged into one unread notification ("… (3 updates)") for six hours; mentions and assignments are never merged. Bulk operations send at most one notification per person. Notifications are only delivered to people who can still see the project, so removed members stop receiving updates immediately.

## Permissions

| Action                                                                   | Who                               |
| ------------------------------------------------------------------------ | --------------------------------- |
| Personal views                                                           | Any signed-in user of the project |
| Shared views (create, edit, reorder, delete)                             | Owners, moderators, admins        |
| Releases, milestones (create, edit, assign)                              | Owners, moderators, admins        |
| Publish a release                                                        | Owners, admins                    |
| Release/milestone pages, planning filters and columns, "Needs attention" | Owners, moderators, admins        |

Everything is checked on the server through the central authorisation layer. Archived projects keep their releases, milestones and views visible to staff but read-only. Planning data is never sent to non-staff, and other people's personal views are invisible (404).

## Database migration

Migration `0003_v04_management` is additive and runs automatically on start-up:

- `changelog_entries` becomes the release table (new `status`, `target_date`, `released_at` columns). Published entries become _Released_, drafts become _Planned_ with their date as target date.
- Duplicate version names within a project (case-insensitive) are renamed `"<version> (<id>)"` before a unique index is created; nothing is deleted.
- Ticket links of changelog entries are moved to `tickets.release_id`; if a ticket was listed in several entries, the most recent entry of its own project wins. The old `changelog_ticket_links` table is then dropped.
- New tables `milestones`, `saved_views` and `project_activity`; new `tickets.milestone_id`. Indexes cover the new filters, and triggers prevent assigning a release or milestone of another project.

Back up before updating, as always (`node scripts/backup.js`).
