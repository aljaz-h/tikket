# Roadmap

The roadmap is another view of your tickets, not a separate planning tool. It groups tickets by their status, so everything you do on it is an ordinary ticket change: the same permissions, activity history, notifications, integrations and [automations](automations.md) apply.

## Columns

| Column                 | Shows                                                                         |
| ---------------------- | ----------------------------------------------------------------------------- |
| **Open / Unplanned**   | Tickets with status _Open_: they exist, but are not committed to the roadmap. |
| **Planned**            | Status _Planned_.                                                             |
| **In Progress**        | Status _In Progress_.                                                         |
| **Recently completed** | Status _Completed_ in the last 90 days.                                       |

Within a column tickets are sorted by votes, then by most recent change (completed tickets by completion date). Each column shows its real ticket count; very long columns are cut off (100 tickets, 30 for completed).

Staff (owners, moderators, administrators) always see the **Open / Unplanned** column. Everyone else only sees it when an owner switches on _Open / Unplanned column_ in **Settings → Roadmap**. It is off by default, so existing public roadmaps do not suddenly list every open ticket.

## Moving tickets (staff)

- **Drag and drop** (mouse or pen): drag a card to another column. Valid columns are highlighted and show where the card will land. Columns the [workflow](workflows.md) does not allow are dimmed and explain why (for example "Tickets cannot move from Open to Completed in this project.").
- **Actions menu** (the `…` button on every card, always visible on touch devices): _Move to…_ lists the statuses the workflow allows, and works with the keyboard. Statuses that require a note are disabled; open the ticket to add the note.
- The ticket page's status selector is unchanged.

All of these call the same status change as the ticket page. Dropping a card does not bypass the workflow: the server checks the transition again, and if it refuses (or the request fails) the card goes back where it was and a message explains why. After a move the roadmap uses its normal sort order; there is no manual card ranking.

Touch screens use the actions menu rather than dragging, which is unreliable on phones. The columns scroll horizontally inside their own container, so the page itself never scrolls sideways.

## Assign to me

Staff who can be assigned tickets get a one-click **Assign to me**:

- on the ticket page, next to the Assignee field (it becomes "Assigned to you" once done);
- in the roadmap card's actions menu.

It uses the normal assignment change, so history, followers, notifications and automations behave exactly as when choosing yourself in the dropdown. It is not offered to people who cannot assign tickets or cannot be assignees, or when the ticket is already yours.

## Roadmap image

**Export image** on the roadmap page downloads a PNG of the roadmap: project logo and name, one column per status with ticket keys, titles and type markers, plus vote counts and releases where the roadmap's own visibility settings show them, and an optional "Updated" date. Long titles wrap and are cut with "…"; each column shows "+ N more" instead of growing without limit.

The image is drawn on the server (no browser, no screenshot) with the bundled Inter font. It uses the project's accent colour (teal if none) on slate surfaces.

**What is never in the image:** internal notes, comments, assignees, staff-only priorities, releases or milestones that are hidden, integration data, or anything an anonymous visitor could not see on the roadmap. Staff exports additionally include the Open / Unplanned column.

`/p/KEY/roadmap/export.png` follows the roadmap page's visibility: staff-only and members-only roadmaps need a session; a public roadmap can also be fetched signed out.

### Public live image

For embedding in a README, website, documentation or forum post, an owner can enable a stable, always-current image:

```
https://your-tikket.example.com/public/projects/KEY/roadmap.png
```

Set it up in **Settings → Roadmap → Shareable roadmap image**:

1. The project must be public with anonymous reading, and the roadmap audience must be _Anyone who can view the project_. Otherwise the option is disabled.
2. Switch on **Allow public roadmap image**. It is **off by default**; existing projects are not exposed.
3. Choose a layout (full or compact), whether to show the logo and the updated date. Vote counts and releases follow the roadmap visibility switches above; there are no separate image-only exceptions.
4. Copy the Markdown:

```markdown
![Project roadmap](https://your-tikket.example.com/public/projects/KEY/roadmap.png)

[![Project roadmap](https://your-tikket.example.com/public/projects/KEY/roadmap.png)](https://your-tikket.example.com/p/KEY/roadmap)
```

The URL uses your configured **Application URL** (or the address you opened the settings from). No GitHub integration is needed.

The image endpoint answers `404` for unknown projects, projects whose image is off, private projects and roadmaps that are not public, with an identical response, so nothing about private projects is revealed. If you change the roadmap audience or make the project private, the image stops being served on the next request; saving a non-public audience also turns the setting off, so it does not come back by surprise.

### Caching and refresh

- Rendered images are cached in memory per project (one entry each, nothing is stored on disk). The `ETag` is a hash of everything shown in the picture, so the PNG is only re-rendered when roadmap-relevant data changes (statuses, titles, votes, releases, project name, logo or image options). Revalidation with `If-None-Match` returns `304` without rendering.
- Public responses use `Cache-Control: public, max-age=300, must-revalidate`; staff exports use `private, no-cache`.
- **GitHub and other sites cache remote images themselves.** GitHub proxies README images through its own cache, so a change on the roadmap can take a while (sometimes hours) to show up there regardless of Tikket. Do not rely on instant refresh. Adding a query string such as `roadmap.png?v=2` forces a fresh fetch; Tikket ignores the parameter.
- The image only needs the single Tikket container: no extra service, Redis or headless browser.

### Limitations

- Text is drawn with Inter (Latin, Latin Extended, Greek and Cyrillic). Characters outside those scripts, such as CJK or emoji, appear as "?".
- The image shows the first 10 tickets per column (15 in the compact layout) and the total count.
