# Tikket

**Tikket** is a lightweight, self-hosted issue and feedback tracker. Users pick a project, choose what they want to report — a bug, a feature request, an improvement or general feedback — and describe it in their own words, with screenshots and links. Project owners triage, prioritise, discuss and resolve tickets, and publish a roadmap and changelog.

It runs as a single Node.js container with an embedded SQLite database and a data volume. No Redis, no PostgreSQL, no SMTP required.

---

## Contents

- [Features](#features)
- [Technology](#technology)
- [Quick start (Docker Compose)](#quick-start-docker-compose)
- [Initial administrator setup](#initial-administrator-setup)
- [Configuration](#configuration)
- [Reverse proxy](#reverse-proxy) · [Coolify & proxy deployment guide](docs/deployment-coolify.md)
- [Feedback widget guide](docs/feedback-widget.md)
- [Data, attachments and backups](#data-attachments-and-backups)
- [Updating](#updating)
- [Development](#development)
- [Testing](#testing)
- [Architecture](#architecture)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [Known limitations](#known-limitations)

---

## Features

**Reporting (for everyone)**

- Guided ticket form: project → _what would you like to report?_ → title & description. Only a title and description are required.
- Type-specific optional fields with progressive disclosure: expected behaviour, reproduction steps and affected URL for bugs; motivation for features; proposed solution for improvements.
- Rich-text editor (headings, bold, italic, lists, links, inline code, code blocks, quotes, undo/redo, keyboard shortcuts). Content is sanitised server-side against a strict allow-list.
- Screenshots via drag & drop, file picker or **pasting from the clipboard**; previews and removal before submitting; full-screen lightbox. Images are validated by content, re-encoded to strip metadata (e.g. GPS EXIF) and thumbnailed.
- Draft auto-save in the browser (per user and project), live review summary, and **similar-ticket suggestions** while typing the title (SQLite FTS5).
- **Screenshot annotation**: arrows, rectangles, circles, freehand, text, highlight, pixelate and **redact** (solid black, burned into the pixels – the original is never uploaded). Undo/redo/reset and keyboard shortcuts; works for uploaded, pasted and dropped images, in tickets, comments and the widget.
- **Ticket templates**: optional extra questions per ticket type (short text, long text, dropdown, checkbox, URL).
- **Embeddable feedback widget** for your own websites – see the [widget guide](docs/feedback-widget.md).
- Works without JavaScript (plain textarea and file input fallbacks).

**Collaboration**

- Comments with images, editing, deletion and moderator removal, `@mentions`.
- Upvotes (one per user, concurrency-safe), "most requested" sorting.
- Follow tickets; authors and commenters follow automatically.
- In-app notifications with bell, unread count, mark (all) as read and per-type preferences.

**Managing (for owners and moderators)**

- Statuses Open, Planned, In Progress, Completed, On Hold, Declined, Duplicate — with optional explanations, resolution notes, duplicate linking and reopening.
- Priorities (Low → Critical), assignment, labels.
- List view with search, filters (status, type, priority, reporter, assignee, labels, created/updated dates), sorting and pagination — all persisted in the URL.
- Kanban board with drag & drop and an accessible per-card status selector; both use the same server action.
- Activity history interleaved with the discussion.
- **Internal notes**: staff can switch the comment box to an internal note, visible only to project owners, moderators and administrators.
- **Bulk editing** in the ticket list: select tickets (with select-all) and change status, priority, assignee or add/remove a label in one confirmed step.
- **Duplicate merging** and **ticket links** (related to, blocks, blocked by).
- **Templates** management with live preview, enable/disable, a default per type, reordering and versioning.
- Dashboards: personal (my submissions, following, recently updated, notifications) and staff (open/planned/in-progress counters, new reports to review, most requested, recent activity).
- Automatic roadmap (Planned / In Progress / Completed) and a curated changelog (owners pick completed tickets per release; drafts stay private).

**Projects, people and administration**

- Multiple projects with unique keys (`SPL-1`, `SPL-2`, …), emoji icon and colour, public/private visibility and optional anonymous read-only access.
- Per-project roles: owner, moderator, member. Settings for voting, attachments, comments, submission policy and author edit policy. Archiving keeps all history read-only.
- Secure, single-use, expiring invitation links (optionally bound to an email) for the instance or a specific project.
- Admin area: users (search, create, invite, roles, disable/reactivate, revoke sessions, password-reset links), projects, invitations, system settings and an audit log.
- Dark (default), light and system themes.

## Technology

| Area       | Choice                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------- |
| Framework  | SvelteKit 2, Svelte 5 (runes), TypeScript, adapter-node                                                          |
| UI         | Tailwind CSS 4, shadcn-svelte–style components on bits-ui, Lucide icons, svelte-sonner toasts                    |
| Editor     | Tiptap 3 (lazy-loaded only where needed)                                                                         |
| Database   | SQLite (better-sqlite3, WAL mode) with Drizzle ORM and Drizzle migrations; FTS5 for search                       |
| Auth       | Server-side sessions (random token in an HTTP-only cookie, HMAC-derived ID in the DB), Argon2id password hashing |
| Validation | Zod                                                                                                              |
| Images     | sharp (validation, re-encoding, thumbnails)                                                                      |
| Tests      | Vitest (unit + integration), Playwright (end-to-end)                                                             |

## Quick start (Docker Compose)

```bash
git clone <this repository> tikket && cd tikket
cp .env.example .env
# Edit .env: ORIGIN = the URL users will open; SESSION_SECRET = output of `openssl rand -base64 48`
docker compose -f compose.yml -f compose.local-port.yml up -d --build
curl http://127.0.0.1:3000/api/health      # {"status":"ok"}
```

`compose.yml` publishes **no** host port (the app listens on 3000 inside the Compose network);
`compose.local-port.yml` adds a binding on `127.0.0.1` only. Put a reverse proxy in front for HTTPS,
open `ORIGIN` and you are taken to the setup page.

**Deployment guides** – Coolify (with its Traefik/Caddy proxy or an external Nginx Proxy Manager),
external proxies on a shared Docker network, Cloudflare, the optional prebuilt GHCR image, backups
and rollback: **[docs/deployment-coolify.md](docs/deployment-coolify.md)**.

| Compose file                 | Use                                                                        |
| ---------------------------- | -------------------------------------------------------------------------- |
| `compose.yml`                | Portable definition (standalone and Coolify with its own proxy)            |
| `compose.external-proxy.yml` | Same plus a pre-existing shared Docker network for NPM/Caddy/nginx/Traefik |
| `compose.local-port.yml`     | Override: publish on `127.0.0.1:${HOST_PORT:-3000}`                        |
| `compose.ghcr.yml`           | Override: run the prebuilt image instead of building                       |

The container runs as uid 1000 with a read-only root filesystem, `no-new-privileges`, no
capabilities, an init process, a restart policy, a health check (healthy only after configuration
checks and migrations) and a named volume `tikket-data` at `/data`.

## Initial administrator setup

On first start Tikket detects that no administrator exists and redirects every page to `/setup`. Create the first administrator there (optionally naming your workspace). The setup runs inside a single database transaction, so concurrent requests cannot create two administrators, and the page is disabled permanently afterwards.

Next steps:

1. **Projects → New project** – choose a name and key (e.g. `SPL`).
2. **Project → Settings → Members** – add existing users, or **Create link** to invite new people.
3. **Administration → Settings** – enable public registration if you want it (off by default), adjust attachment limits, session lifetime and default theme.

## Configuration

All configuration is via environment variables (see `.env.example`). They are validated at
start-up; invalid values (missing `ORIGIN`, short/placeholder `SESSION_SECRET`, impossible size
limits, malformed proxy settings, an unwritable data directory) stop the process with a message
listing every problem.

| Variable                                                       | Default                                            | Description                                                                                                                                                                                                                                               |
| -------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ORIGIN`                                                       | — (**required** in production)                     | Public URL, e.g. `https://tikket.example.com` (no path, no trailing slash). Used for CSRF origin checks, `Secure` cookies, HSTS and every absolute link; forwarded `Host`/`Proto` headers are never trusted instead.                                      |
| `APP_URL`                                                      | `ORIGIN`                                           | Base for invitation/reset links (also editable in System settings).                                                                                                                                                                                       |
| `SESSION_SECRET`                                               | auto-generated                                     | ≥ 32 characters. Sessions are stored as an HMAC of the cookie token with this secret. If empty, a secret is generated once and stored in `DATA_DIR/.session-secret` (logged as a warning). Changing it signs everyone out.                                |
| `PORT` / `HOST`                                                | `3000` / `0.0.0.0`                                 | Listen address inside the container.                                                                                                                                                                                                                      |
| `DATA_DIR`                                                     | `./data` (`/data` in Docker)                       | Database, uploads and generated secret.                                                                                                                                                                                                                   |
| `DATABASE_PATH`                                                | `$DATA_DIR/tikket.db`                              | SQLite file.                                                                                                                                                                                                                                              |
| `UPLOADS_DIR`                                                  | `$DATA_DIR/uploads`                                | Attachment storage.                                                                                                                                                                                                                                       |
| `MAX_UPLOAD_SIZE`                                              | `10M`                                              | Hard per-image limit (admins can set a lower limit in the UI).                                                                                                                                                                                            |
| `BODY_SIZE_LIMIT`                                              | `25M` in Docker (`512K` adapter default otherwise) | Max request body. Must be ≥ `MAX_UPLOAD_SIZE`; the no-JS form can send several images at once.                                                                                                                                                            |
| `ADDRESS_HEADER` / `XFF_DEPTH`                                 | empty / `1`                                        | Set to `X-Forwarded-For` / number of trusted proxy hops when Tikket is only reachable through your proxy, so rate limiting and audit logs see real client IPs. Leave empty otherwise — see [trusted proxies](docs/deployment-coolify.md#trusted-proxies). |
| `LOGIN_RATE_LIMIT`                                             | `10`                                               | Failed sign-ins per account per 15 min (per-IP limit is 3×).                                                                                                                                                                                              |
| `MIGRATIONS_DIR`                                               | `./drizzle`                                        | Location of SQL migrations.                                                                                                                                                                                                                               |
| `PROXY_NETWORK` / `PROXY_ALIAS` / `HOST_PORT` / `TIKKET_IMAGE` |                                                    | Only used by the matching Compose file/override.                                                                                                                                                                                                          |

## Reverse proxy

Tikket expects TLS to be terminated by a reverse proxy and works with any of them – Coolify's
Traefik or Caddy, Nginx Proxy Manager, Caddy, nginx or Traefik – with or without Cloudflare in front.
No proxy-specific labels are part of the Compose files. Step-by-step instructions, NPM proxy host
settings, Cloudflare client-IP handling and verification commands are in
[docs/deployment-coolify.md](docs/deployment-coolify.md); tested minimal nginx/Caddy/Traefik
configurations are in `tests/deployment/proxies/`.

Essentials for any proxy: forward to `http://<tikket>:3000`, allow request bodies ≥ `BODY_SIZE_LIMIT`
(25 MB), do not cache responses, set `ORIGIN` to the public `https://` URL. The health check
endpoint is `GET /api/health` (`{"status":"ok"}` once start-up completed; `503` before).

## Data, attachments and backups

Everything lives in the data volume:

```
/data/tikket.db (+ -wal, -shm)   SQLite database (WAL mode)
/data/uploads/ab/<id>.<ext>      Original images (random IDs, sharded)
/data/uploads/ab/<id>.thumb.webp Thumbnails
/data/.session-secret            Only if SESSION_SECRET is not set
/data/backups/                   Database backups created by the backup script
```

Attachments are never served from a static directory: `/api/files/<id>` checks that the viewer can access the attachment's project (pending uploads are visible only to the uploader). Display names are stored separately from the random file names.

### Backup

The database must be copied consistently — don't just copy `tikket.db` while the app is running. Use the included online backup script (SQLite backup API; safe while running):

```bash
# 1. Consistent database snapshot into /data/backups (keeps the newest 14)
docker compose exec tikket node scripts/backup.js /data/backups 14

# 2. Archive the snapshot and the attachments to the host
# The volume is named <compose-project>_tikket-data (see `docker volume ls`).
docker run --rm -v tikket_tikket-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/tikket-$(date +%F).tar.gz -C /data backups uploads
```

Copy the archive off the server. A daily cron job running these two commands is a good default. (Alternatively stop the container — `docker compose stop` — and archive the whole volume.)

### Restore

```bash
docker compose down
# Extract the archive somewhere, then copy files into the volume:
docker run --rm -v tikket_tikket-data:/data -v "$PWD":/backup alpine sh -c '
  cd /tmp && tar xzf /backup/tikket-YYYY-MM-DD.tar.gz &&
  rm -f /data/tikket.db /data/tikket.db-wal /data/tikket.db-shm &&
  cp "$(ls backups/tikket-*.db | tail -1)" /data/tikket.db &&
  rm -rf /data/uploads && cp -r uploads /data/uploads &&
  chown -R 1000:1000 /data'
docker compose up -d
```

Restore the database and the `uploads` directory from the same point in time; attachments without a database row are harmless, but database rows without files show broken images. Pending migrations are applied automatically when the restored database is opened by a newer version.

## Updating

```bash
docker compose exec tikket node scripts/backup.js     # always back up first
git pull
docker compose -f compose.yml -f compose.local-port.yml up -d --build   # same -f files as before
```

Database migrations (in `drizzle/`) run automatically on start-up before requests are served; they are forward-only, transactional, never rebuild or reset the database, and are serialised across processes with a lock file so overlapping containers cannot apply a migration twice. The container shuts down gracefully on `SIGTERM` (in-flight requests finish, the database is checkpointed and closed). To roll back, restore the backup taken before updating and run the previous image.

## Development

Requirements: Node.js 22 LTS (≥ 22.12) and npm.

```bash
npm ci                      # installs dependencies (.npmrc enables legacy-peer-deps)
npm run dev                 # http://localhost:5173 – data in ./data
```

The first visit redirects to `/setup`. Useful scripts:

| Command                           | Purpose                                                           |
| --------------------------------- | ----------------------------------------------------------------- |
| `npm run check`                   | Svelte/TypeScript type checking                                   |
| `npm run lint` / `npm run format` | Prettier + ESLint                                                 |
| `npm test`                        | Unit and integration tests (Vitest)                               |
| `npm run test:e2e`                | End-to-end tests (Playwright; builds must exist: `npm run build`) |
| `npm run build` / `npm start`     | Production build / run it (`node build`)                          |
| `npm run db:generate`             | Generate a migration after changing `src/lib/server/db/schema.ts` |
| `npm run db:migrate`              | Apply migrations manually (also done automatically at start-up)   |
| `npm run check:compose`           | Validate all Compose files (needs Docker)                         |
| `npm run test:deployment`         | Build the image and test it behind nginx, Caddy and Traefik       |

Schema changes: edit `schema.ts`, run `npm run db:generate -- --name <change>`, review the SQL in `drizzle/`, commit it. Custom SQL (e.g. FTS triggers) lives in `drizzle/0001_search_fts.sql`.

## Testing

- **Unit** (`tests/unit`): permission matrix, status workflow rules, ticket references, filters and FTS query building, sanitisation, URL safety, validation schemas, rate limiting, image detection.
- **Integration** (`tests/integration`, real migrated SQLite per test): first-run setup race, authentication and sessions, password change/reset, invitations, ticket numbering, creation/editing policies, attachments (real images via sharp), status/priority/assignment/labels, duplicates, voting, comments, mentions, notifications and access control in search.
- **Unit/integration additions for deployment**: start-up environment validation, concurrent migrations from several processes, failed-migration rollback, idempotent restarts.
- **Deployment** (`tests/deployment/run.sh`, needs Docker): builds the production image, deploys `compose.external-proxy.yml` on an external network and drives it through **nginx (NPM-style), Caddy and Traefik** terminating HTTPS – Secure cookies, CSRF, spoofed forwarded headers, large uploads, links built from `ORIGIN`, persistence across re-creation/upgrade/`down`+`up`, start-up failures for bad configuration, read-only filesystem, loopback-only port override.
- **Phase 2** (`tests/unit/phase2.test.ts`, `tests/integration/phase2.test.ts`): origin normalisation, environment sanitising, template validation, blocking-cycle detection, bulk form parsing; widget enable/origins/token scoping and revocation, template versioning and snapshots, internal-note isolation (pages, files, notifications, search, editing), bulk edits with skipped tickets and grouped notifications, vote/follower merging, relationships, and upgrading an existing database to the new schema.
- **End-to-end** (`e2e/`, Playwright against the production build, plus `e2e/host-server.mjs` as a third-party website on another origin). `02-phase2.spec.ts` covers the widget across origins (config/CSP checks, sign-in pop-up, consent, ticket creation, ignored spoofed messages, mobile), annotation with a pixel check that redaction is burned in, templates, internal notes, relationships and bulk editing. `01-core.spec.ts`: setup, login/logout, project creation, invitation & membership, ticket submission with uploaded and pasted screenshots, owner review (priority, assignee, status, comment), notifications, upvote, completion on the board, private-project isolation (pages, files, search APIs, forged posts), mobile submission without horizontal overflow, and no console errors.

```bash
npm test
npm run build && npx playwright install chromium && npm run test:e2e
# Use an existing Chromium instead of downloading: PW_CHROMIUM_PATH=/path/to/chrome npm run test:e2e
npm run check:compose && npm run test:deployment     # Docker required
```

CI (`.github/workflows/ci.yml`) runs lint, type checks, all three test layers and the deployment test.

## Architecture

```
src/
  hooks.server.ts            sessions, setup redirect, theme, security headers, maintenance jobs
  lib/shared/                constants, workflow rules, filters, formatting (client + server)
  lib/server/
    db/                      Drizzle schema and connection (WAL, busy_timeout, foreign keys, migrations)
    auth/                    password hashing, sessions, tokens, rate limiting
    authz.ts                 the single authorisation layer (project access, edit/delete rules, visibility SQL)
    services/                users, projects, tickets, comments, search, notifications, invitations, changelog, audit
    sanitize.ts, uploads.ts  rich-text allow-list, image validation/storage/thumbnails
  lib/components/            design system (ui/) and app components
  routes/                    pages and form actions; api/ for uploads, files, search, notifications, health
drizzle/                     SQL migrations
```

Key decisions:

- **All authorisation goes through `authz.ts`.** Pages, form actions, API endpoints, file downloads, search, dashboards and notification recipients use the same `ProjectAccess` computation and the same "viewable projects" SQL condition. Private projects return 404 to outsiders so their existence is not revealed.
- **Ticket numbers** are allocated with `UPDATE projects SET ticket_counter = ticket_counter + 1 … RETURNING` inside an `IMMEDIATE` transaction — never `MAX(number) + 1`. A unique index on `(project_id, number)` backs it up.
- **Votes** use a composite primary key and adjust the denormalised counter in the same transaction only when a row actually changed.
- **History is preserved**: foreign keys default to `RESTRICT`, comments are soft-deleted, projects are archived rather than deleted.
- **Progressive enhancement**: every mutation is a SvelteKit form action; the board's drag & drop and status selector post to the ticket page's `?/status` action.
- **No polling**: the unread count refreshes on navigation; notifications load when the bell opens.

### Phase 2 design notes

- **Internal notes** are ordinary comments with an immutable `internal` flag. Visibility is decided in one place (`canViewInternalNotes` / `canWriteInternalNotes` in `authz.ts`): only project owners, moderators and administrators can read or write them, in any project they can manage. They are filtered out of ticket pages, attachment downloads (`/api/files` answers 404 for others), activity history and notifications. Notifications about notes go to staff only and never include the note's text. Notes don't change the public comment count or "updated" time, and comments are not part of the search index. A note cannot be turned into a public comment (or vice versa) – write a new one instead.
- **Templates** are versioned. Every ticket stores a snapshot of the template name, version, and each question's label and type together with the answer, so editing, disabling or deleting a template never changes existing tickets. Answers are validated on the server against the active template (required fields, dropdown options, http(s) URLs, length limits).
- **Merging duplicates**: marking a ticket as _Duplicate of X_ merges it into X. Voters of the duplicate are added to X (each person counted once, the vote count recomputed), followers are added to X, and tickets that were duplicates of the duplicate are re-pointed to X so chains never form. The duplicate keeps its own comments, votes and history. Merging is limited to the same project, a ticket can't duplicate itself, and the target can't itself be a duplicate.
- **Ticket links** are limited to tickets of the same project. _Blocked by_ is stored as the inverse _blocks_; _related to_ is undirected. Self links, a second link between the same pair and blocking cycles of any length are rejected. Adding and removing links is recorded in the history of both tickets.
- **Bulk editing** applies one change to up to 100 tickets in a single transaction. Every ticket is looked up inside the project the user manages, so numbers from other projects can't be touched; tickets that already match are skipped and reported. Each changed ticket gets its own history entry (marked as a bulk edit), but notifications are grouped: each person receives at most one notification per bulk operation. Marking duplicates in bulk is not offered (each needs its own original), and tickets cannot be archived or deleted – Tikket keeps history, so close them with a status instead.

## Security

- Argon2id password hashing (OWASP parameters), constant-time-ish login for unknown accounts, per-account and per-IP login rate limits; rate limits on setup, registration, invitations, uploads and content creation.
- Sessions: 256-bit random token in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` under HTTPS); only an HMAC of it is stored. Sliding expiry (configurable), revoked on password change/reset, account disabling and on demand.
- CSRF: SvelteKit origin checking for form posts plus an explicit same-origin check for all mutating `/api` requests, and `SameSite` cookies.
- Strict Content-Security-Policy (no inline scripts; nonce/hash based), `X-Frame-Options: DENY` (only the widget form at `/embed/<KEY>` may be framed, by the project's allowed origins), `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP/CORP, HSTS under HTTPS.
- Input validation with Zod everywhere; rich text sanitised with an allow-list (no images, iframes, styles, event handlers; only http/https/mailto links with `rel="noopener noreferrer nofollow ugc"`); plain-text fields are rendered as text with safe auto-linking.
- Uploads: size limits, content sniffing (magic bytes) plus full decode by sharp, metadata stripping, random file names, no path input from users, served with `Content-Disposition`, `nosniff` and a sandboxing CSP. Abandoned pending uploads are deleted after 24 h.
- Invitation and reset tokens are random, stored hashed, single-use, expiring and revocable; the granted role always comes from the stored record.
- Security-relevant actions are written to the audit log (admins only).
- The feedback widget never exposes credentials in host pages; see the [widget security model](docs/feedback-widget.md#security-model).
- Server URLs submitted by users are never fetched.
- The container runs as the non-root `node` user with a read-only root filesystem in the provided Compose file.

## Troubleshooting

| Symptom                                                              | Fix                                                                                                                                    |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| "Cross-site POST form submissions are forbidden" / 403 on every form | `ORIGIN` must exactly equal the browser URL (e.g. `https://tikket.example.com`, no trailing slash).                                    |
| Signed out immediately / cookie not kept                             | Serving over plain HTTP with an `https://` `ORIGIN` (or vice versa). Make the proxy and `ORIGIN` agree.                                |
| Uploads fail with 413                                                | Raise `client_max_body_size` in the proxy and `BODY_SIZE_LIMIT`; check `MAX_UPLOAD_SIZE` and the admin setting.                        |
| Everyone shares one rate-limit bucket / audit IP is the proxy        | Set `ADDRESS_HEADER=X-Forwarded-For` and the right `XFF_DEPTH`.                                                                        |
| `SQLITE_BUSY` errors                                                 | Don't put the database on a network filesystem (NFS/SMB); use a local Docker volume.                                                   |
| `EACCES` writing to `/data` after restoring                          | `chown -R 1000:1000` the volume contents (the app runs as uid 1000).                                                                   |
| Forgot the only admin password                                       | `docker compose exec tikket node scripts/reset-link.js <username>` prints a one-hour, single-use reset link (logged in the audit log). |
| Docker build fails fetching packages behind a TLS-intercepting proxy | `docker build --secret id=ca,src=/path/to/proxy-ca.pem .`                                                                              |

## Known limitations

- **Email notifications are not implemented** — notifications are in-app only (by design no SMTP is required). Invitation and reset links are shown to the admin/owner to share manually.
- Project icons are emoji or a coloured initial; uploading a custom project logo is not supported.
- Single-instance design (in-memory rate limiting, SQLite). Run one container per data volume.
- The UI is English only.
- The feedback widget requires reporters to sign in; anonymous widget submissions are not supported.
- Tickets cannot be archived or deleted (bulk or otherwise); close them with a status.
