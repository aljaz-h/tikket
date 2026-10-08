<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="static/logo.svg" />
    <img src="static/logo-on-light.svg" alt="Tikket" width="320" />
  </picture>
</p>

# Tikket

**Tikket** is a lightweight, self-hosted issue and feedback tracker. Users pick a project, choose what they want to report — a bug, a feature request, an improvement or general feedback — and describe it in their own words, with screenshots and links. Project owners triage, prioritise, discuss and resolve tickets, and publish a roadmap and changelog.

It runs as a single Node.js container with an embedded SQLite database and a data volume. No Redis, no PostgreSQL, no SMTP required – email, Discord, webhooks and GitHub are optional [integrations](docs/integrations.md).

---

## Contents

- [Features](#features)
- [Technology](#technology)
- [Quick start (Docker Compose)](#quick-start-docker-compose)
- [Initial administrator setup](#initial-administrator-setup)
- [Configuration](#configuration)
- [Reverse proxy](#reverse-proxy) · [Coolify & proxy deployment guide](docs/deployment-coolify.md)
- [Feedback widget guide](docs/feedback-widget.md) · [Project management guide](docs/project-management.md)
- [Integrations](docs/integrations.md): [Email](docs/email.md) · [Webhooks](docs/webhooks.md) · [GitHub](docs/github.md) · [Data export](docs/data-export.md)
- Operations: [Health, delivery queue & reminders](docs/health.md) · [Backup verification](docs/backup-verification.md)
- Developer workflow: [Automations](docs/automations.md) · [REST API](docs/api.md) · [API tokens](docs/authentication-tokens.md) · [Import](docs/import.md) · [Workflows](docs/workflows.md)
- [Data, attachments and backups](#data-attachments-and-backups)
- [Updating](#updating)
- [Development](#development) · [Design guide](DESIGN.md)
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
- In-app notifications with bell, unread count, mark (all) as read and per-type preferences (including releases and milestones); repeated updates on the same ticket are grouped.

**Managing (for owners and moderators)**

- Statuses Open, Planned, In Progress, Completed, On Hold, Declined, Duplicate — with optional explanations, resolution notes, duplicate linking and reopening.
- Priorities (Low → Critical), assignment, labels.
- List view with search, filters (status, type, priority, reporter, assignee, labels, created/updated dates, following, attachments, blocked, target release, milestone), sorting, **customisable columns** and pagination — all persisted in the URL.
- **Saved views**: personal views and shared project views of filters, sort and columns, plus built-in views such as _Assigned to me_ and _High priority_.
- **Quick actions** on every row and **previous/next** navigation between tickets of the list you came from.
- **Releases**: plan versions, assign tickets, track progress and publish after a review screen – a published release is the changelog entry.
- **Milestones**: goals that group related tickets, with progress derived from ticket status.
- **Project overview** for staff: awaiting review, unassigned and high-priority counts, _Needs attention_, upcoming releases and active milestones. See the [project management guide](docs/project-management.md).
- Kanban board with drag & drop and an accessible per-card status selector; both use the same server action.
- Activity history interleaved with the discussion.
- **Internal notes**: staff can switch the comment box to an internal note, visible only to project owners, moderators and administrators.
- **Bulk editing** in the ticket list: select tickets (with select-all) and change status, priority, assignee, labels, target release or milestone in one confirmed step.
- **Duplicate merging** and **ticket links** (related to, blocks, blocked by).
- **Templates** management with live preview, enable/disable, a default per type, reordering and versioning.
- Dashboards: personal (my submissions, following, recently updated, notifications) and staff (open/planned/in-progress counters, new reports to review, most requested, recent activity).
- Automatic roadmap (Planned / In Progress / Completed) and a changelog of published releases.

**Integrations & communication (all optional)**

- **Email notifications** over SMTP (admin form or environment variables), with per-person in-app and email preferences, aggregation, emailed invitations and self-service password resets. Branded transactional emails without tracking. → [Email](docs/email.md)
- **Discord** notifications per project (new tickets/bugs/features, high priority, status changes, completions, public comments, releases). → [Integrations](docs/integrations.md#discord)
- **Signed webhooks** with a versioned JSON envelope, HMAC-SHA256 signatures, retries and delivery history. → [Webhooks](docs/webhooks.md)
- **GitHub**: commits and pull requests that mention `SPL-42` appear on the ticket with their state; optional merge automation. → [GitHub](docs/github.md)
- **Public roadmap controls**: staff only, project members or everyone who can view the project, with switches for releases, dates, milestones, priorities, votes and assignees.
- **Exports**: versioned project JSON (standard or staff), formula-safe ticket CSV, and a personal export of your own submissions. → [Data export](docs/data-export.md)
- **Automations**: per-project _when / if / then_ rules (ticket, comment, vote, release and GitHub triggers; AND/OR conditions; status, priority, assignee, label, planning, note, notification, webhook and comment actions) with templates, dry-run testing, loop prevention and run history. → [Automations](docs/automations.md)
- **REST API** (`/api/v1`) with personal access tokens and project API tokens, scopes, cursor pagination, idempotent ticket creation, rate limits and an OpenAPI 3.1 document (`/api/openapi.json`, rendered at `/docs/api`). → [REST API](docs/api.md) · [API tokens](docs/authentication-tokens.md)
- **Import** from Tikket JSON exports or CSV with column mapping, review, all-or-nothing transactions and optional member matching. → [Import](docs/import.md)
- **Operations** (v0.7): _Administration → Health_, _Delivery queue_ (inspect, retry, discard) and _Backups_; `backup:verify`, `restore:verify` and `db:check` scripts; personal ticket reminders. → [Health](docs/health.md) · [Backup verification](docs/backup-verification.md)
- **Workflow customisation** per project: enabled statuses, defaults, allowed transitions, required notes, reporter reopen, comments on completed tickets. → [Workflows](docs/workflows.md)
- Integration secrets are encrypted at rest with `ENCRYPTION_KEY`; deliveries run from a persistent SQLite queue inside the same container.

**Projects, people and administration**

- Multiple projects with unique keys (`SPL-1`, `SPL-2`, …), public/private visibility and optional anonymous read-only access.
- **Project branding**: logo, optional accent colour (used sparingly on the project's icon, header action, roadmap and widget; text contrast is chosen automatically), short description, website and support/documentation link.
- **Project logos**: upload a PNG, JPEG or WebP image (drag & drop or file picker, with preview), or fetch the project website's icon. Without a logo, the emoji or coloured initial is used. Logos appear wherever the project is shown (sidebar, lists, search, ticket pages).
- Per-project roles: owner, moderator, member. Project settings are grouped under _General_ (general settings, members, labels, danger zone – picked from a dropdown that shows the current section, each with its own URL), _Feedback widget_ and _Ticket templates_. Settings for voting, attachments, comments, submission policy and author edit policy. Archiving keeps all history read-only.
- Secure, single-use, expiring invitation links (optionally bound to an email) for the instance or a specific project.
- Admin area (opened from the account menu): users (search, create, invite, roles, disable/reactivate, revoke sessions, password-reset links), projects, invitations, system settings and an audit log.
- Dark (default), light and system themes in the Tikket charcoal-and-lime palette.
- Collapsible sidebar: collapse or expand it with its toggle button (keyboard accessible), or click empty space in the collapsed rail to expand it. The choice is remembered in a cookie, so it survives reloads without flashing.

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

| Variable                                                                                                                                                | Default                                            | Description                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ORIGIN`                                                                                                                                                | — (**required** in production)                     | Public URL, e.g. `https://tikket.example.com` (no path, no trailing slash). Used for CSRF origin checks, `Secure` cookies, HSTS and every absolute link; forwarded `Host`/`Proto` headers are never trusted instead.                                      |
| `APP_URL`                                                                                                                                               | `ORIGIN`                                           | Base for invitation/reset links (also editable in System settings).                                                                                                                                                                                       |
| `SESSION_SECRET`                                                                                                                                        | auto-generated                                     | ≥ 32 characters. Sessions are stored as an HMAC of the cookie token with this secret. If empty, a secret is generated once and stored in `DATA_DIR/.session-secret` (logged as a warning). Changing it signs everyone out.                                |
| `PORT` / `HOST`                                                                                                                                         | `3000` / `0.0.0.0`                                 | Listen address inside the container.                                                                                                                                                                                                                      |
| `DATA_DIR`                                                                                                                                              | `./data` (`/data` in Docker)                       | Database, uploads and generated secret.                                                                                                                                                                                                                   |
| `DATABASE_PATH`                                                                                                                                         | `$DATA_DIR/tikket.db`                              | SQLite file.                                                                                                                                                                                                                                              |
| `UPLOADS_DIR`                                                                                                                                           | `$DATA_DIR/uploads`                                | Attachment storage.                                                                                                                                                                                                                                       |
| `MAX_UPLOAD_SIZE`                                                                                                                                       | `10M`                                              | Hard per-image limit (admins can set a lower limit in the UI).                                                                                                                                                                                            |
| `BODY_SIZE_LIMIT`                                                                                                                                       | `25M` in Docker (`512K` adapter default otherwise) | Max request body. Must be ≥ `MAX_UPLOAD_SIZE`; the no-JS form can send several images at once.                                                                                                                                                            |
| `SHUTDOWN_TIMEOUT`                                                                                                                                      | `10` in Docker (`30` adapter default otherwise)    | Seconds to let in-flight requests finish after `SIGTERM` before remaining connections are closed. Keep it below the container stop grace period (30 s in the Compose files) so shutdown is always clean.                                                  |
| `ADDRESS_HEADER` / `XFF_DEPTH`                                                                                                                          | empty / `1`                                        | Set to `X-Forwarded-For` / number of trusted proxy hops when Tikket is only reachable through your proxy, so rate limiting and audit logs see real client IPs. Leave empty otherwise — see [trusted proxies](docs/deployment-coolify.md#trusted-proxies). |
| `LOGIN_RATE_LIMIT`                                                                                                                                      | `10`                                               | Failed sign-ins per account per 15 min (per-IP limit is 3×).                                                                                                                                                                                              |
| `MIGRATIONS_DIR`                                                                                                                                        | `./drizzle`                                        | Location of SQL migrations.                                                                                                                                                                                                                               |
| `ENCRYPTION_KEY`                                                                                                                                        | —                                                  | 32 random bytes (`openssl rand -base64 32`). Required to store integration secrets; never generated automatically. **Back it up** – see [encryption key](docs/integrations.md#the-encryption-key-encryption_key).                                         |
| `ENCRYPTION_KEY_PREVIOUS`                                                                                                                               | —                                                  | Old key(s) during a key rotation (comma-separated).                                                                                                                                                                                                       |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_FROM_NAME`, `SMTP_REPLY_TO`, `SMTP_TIMEOUT`, `SMTP_ENABLED` | —                                                  | Optional email configuration; when `SMTP_HOST` is set it takes precedence over Administration → Email. See [Email](docs/email.md).                                                                                                                        |
| `OUTBOUND_ALLOW_PRIVATE_NETWORKS`                                                                                                                       | `false`                                            | Allow webhooks to private addresses (trusted single-tenant setups only).                                                                                                                                                                                  |
| `API_RATE_LIMIT`                                                                                                                                        | `300`                                              | REST API requests per minute per token (writes: a fifth of it). See [REST API](docs/api.md#rate-limits).                                                                                                                                                  |
| `PROXY_NETWORK` / `PROXY_ALIAS` / `HOST_PORT` / `TIKKET_IMAGE`                                                                                          |                                                    | Only used by the matching Compose file/override.                                                                                                                                                                                                          |

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
/data/uploads/ab/<id>.png         Project logos (256 × 256 PNG)
/data/.session-secret            Only if SESSION_SECRET is not set
/data/backups/                   Database backups created by the backup script
```

Project logos are stored in the same uploads directory, so they survive container restarts and redeploys and are part of every backup of the volume. They are served by `/api/project-logos/<id>` with the project's visibility.

Attachments are never served from a static directory: `/api/files/<id>` checks that the viewer can access the attachment's project (pending uploads are visible only to the uploader). Display names are stored separately from the random file names.

### Backup

> **⚠️ Back up `ENCRYPTION_KEY` separately (e.g. in your password manager).** The database contains
> integration configuration, encrypted integration secrets, the delivery queue/history, GitHub
> references and project branding. Restoring it needs the **same** `ENCRYPTION_KEY`; without it the
> encrypted secrets (SMTP password, Discord/webhook URLs, signing secrets, GitHub secrets) cannot be
> recovered and must be re-entered – see [lost encryption key](docs/integrations.md#lost-encryption-key).
>
> API tokens are stored only as hashes: a restored database keeps existing tokens working, but
> lost tokens can't be recovered, and tokens created after the backup must be recreated after
> restoring it – see [API tokens](docs/authentication-tokens.md#backups).

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

Check a backup before you need it – `npm run backup:verify -- <file>` (read-only) and
`npm run restore:verify -- <file>` (dry-run restore on a temporary copy); see
[Backup verification](docs/backup-verification.md). _Administration → Backups_ shows the last
recorded backup.

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
- **v0.4 management** (`tests/integration/v04.test.ts`, `e2e/04-management.spec.ts`): saved views (personal/shared permissions, normalisation, cross-project isolation), releases (unique names, cross-project rejection in the service and the database, progress, review, single publication, changelog, notifications), milestones (progress, completion, reopen, archive, permissions), new filters including internal-note attachment privacy, previous/next, bulk and quick release/milestone changes, grouped notifications, removed members, preferences, and upgrading a pre-v0.4 database with changelog data; in the browser: release planning and publication, milestones, columns, quick and bulk actions, saved views with previous/next, staff vs member overview, and mobile layouts.
- **Branding** (`e2e/03-branding.spec.ts`): favicon/manifest assets, dark default and switching to light (checked against the token colours), keyboard use of the custom dropdowns, ticket context menu, custom/indeterminate checkboxes, and no console or hydration errors.
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

### Design system

- **Tokens** live in `src/app.css`: colours are CSS variables for the dark default (`:root`, `.dark`), `.light` and `.theme-system` (follows the OS), mapped to Tailwind colours with `@theme inline`. Components use only these (`bg-primary`, `text-link`, `border-primary-border`, `bg-primary-soft`, `text-muted-foreground`, …), never raw colour values. Lime (`#B8F779`) is used for primary actions, focus rings and selected states; text links use `--link`, which is a darker green in the light theme for contrast.
- **Logo**: `src/lib/components/Logo.svelte` renders the icon and – when the workspace is called "Tikket" – the official wordmark in its original proportions; other workspace names are shown next to the icon. Favicons, touch and manifest icons are in `static/`.
- **Controls**: `ui/select.svelte` renders a themed native `<select>` on the server and without JavaScript, and swaps to an accessible bits-ui listbox (searchable for long lists such as people) after hydration, submitting through a hidden input. Checkboxes and radios are native inputs drawn by base styles (lime when checked, indeterminate for "select all"). Dialogs, menus, context menus and tooltips are bits-ui (focus trap, Escape, scroll lock); no `alert`/`confirm`/`prompt` is used. Toasts are capped at three, dismissible, with colour only on the icon. Scrollbars are slim and brighten on hover. Animations are disabled under `prefers-reduced-motion`.

### v0.4 design notes

- **One release system**: releases extend the former changelog entries (same table); a ticket's target release is a single `tickets.release_id`. Publishing turns a release into the public changelog entry. See the [project management guide](docs/project-management.md#database-migration) for how existing changelog data is migrated.
- **Planning data is staff-only**: releases, milestones, their filters and columns are only loaded for project staff; the list query ignores those filters for everyone else.
- **Saved views** store a normalised query string produced by the same parser as the URL, so a view can never contain anything a URL couldn't – and permissions are re-applied whenever it is opened.
- **Quick actions reuse bulk editing** (one ticket, same action), so authorisation, transactions, history and notification grouping are identical.
- **Progress is derived**: release and milestone progress is a grouped count over tickets, computed for all items in one query.

### v0.5 design notes (UI refinements and logos)

- **Logos are attachments** of kind `project_logo` referenced by `projects.logo_id` (migration `0004_project_logos`, additive; `ON DELETE SET NULL`). Every logo is decoded and re-encoded to a 256 × 256 PNG (`fit: contain` on transparent), which validates the content and strips metadata. Fetched icons are stored as pending previews owned by the requester until applied; unapplied previews are removed by the regular pending-upload cleanup. Replacing or removing a logo deletes the old file.
- **One `ProjectIcon` component** renders logos everywhere, falling back to the emoji/initial if there is no logo or the image fails to load.
- **Settings sections are routes** (`/p/<KEY>/settings`, `/members`, `/labels`, `/danger`), so the dropdown label, deep links and back/forward all follow the URL. Old `#members`/`#labels`/`#danger-zone` links redirect.
- **Tab rows** share one `TabNav` component. The active underline is an inset shadow instead of a negative margin (the old cause of a needless scrollbar); on narrow screens rows scroll horizontally without a visible scrollbar.

### Integrations design notes

- **One outbound queue** (`outbound_jobs`) for email, Discord and webhooks: transactional enqueue, lease-based claiming, capped exponential backoff, dead state, pruning, graceful shutdown. Synchronous sending would have tied request latency and reliability to third-party servers, so a small persistent queue was justified; it stays inside the existing container and database.
- **One event bus** (`integrations/events.ts`): services emit `ticket.*`, `comment.created`, `release.published` and `milestone.completed` inside their transaction; payloads are built once, never contain internal notes, and are shared by webhooks and Discord.
- **Email mirrors notifications**: `notify()` decides who may hear about something (active, can view the project, staff for internal notes); email preferences are applied on top, and everything is re-checked when the email is sent.
- **Secrets** live in their own encrypted columns bound to their purpose (AES-GCM additional data); the start-up check refuses stored secrets without a key and re-encrypts after rotation.
- **Roadmap settings** default to what the roadmap already showed (ticket titles, types, votes to project viewers); every planning detail is opt-in and omitted from the server response when off. Migration `0005_integrations` only adds tables and nullable columns.

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
- Outbound requests to user-supplied URLs (webhooks, Discord, GitHub API, _Fetch website icon_) all go through the same SSRF guard; webhooks never follow redirects and private destinations need the explicit `OUTBOUND_ALLOW_PRIVATE_NETWORKS` opt-in. Integration secrets are encrypted at rest (AES-256-GCM, `ENCRYPTION_KEY`), never returned to the browser and never logged; webhooks are signed (HMAC-SHA256 with timestamp); GitHub deliveries are verified (`X-Hub-Signature-256`), checked against the connected repository and replay-protected; exports are owner-only and audit-logged, and CSV cells are protected against formula injection. Details in [docs/integrations.md](docs/integrations.md).
- API tokens (personal and project) are stored as SHA-256 hashes, shown once, scoped, expiring and revocable; the API ignores cookies (no CSRF surface), answers invisible projects with 404, never lets a project token reach another project, rate-limits per token and audit-logs writes without the token. Automations run with the same permission and workflow checks as people, cannot delete data, and are protected against loops. Imports never create accounts or read secrets, sanitise all content and run all-or-nothing. See [API tokens](docs/authentication-tokens.md), [Automations](docs/automations.md) and [Import](docs/import.md).
- _Fetch website icon_ additionally uses only ports 80/443, no credentials in URLs, every DNS answer must be a public address (loopback, private, link-local/cloud metadata, CGNAT, multicast, reserved and IPv4-mapped forms are refused), the connection is pinned to the validated address, redirects (max 3) are re-validated, and requests have strict time and size limits. SVG is never accepted; fetched icons are decoded and re-encoded like uploads, shown as a preview first and stored locally (never hot-linked or refetched).
- Project logos can only be changed by project owners and administrators on non-archived projects; changes are audit-logged.
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

- Email, Discord, webhooks and GitHub were tested against local mock servers (an SMTP sink, a local HTTP receiver, signed fake GitHub deliveries) – not against the real services.
- GitHub uses a repository webhook plus an optional read-only token; a GitHub App installation flow is not implemented. One repository per project; no issue synchronisation.
- No email-to-ticket ingestion; replies to notification emails are not read.
- Import creates tickets in an existing project; it does not restore whole projects, accounts or votes. Attachments are restored only from project bundles (see [Import](docs/import.md)). Full instance restore is done with the backup scripts.
- Automations, the REST API, imports and GitHub automation triggers were tested with integration tests, end-to-end tests and signed fake GitHub deliveries – not against the real GitHub service.
- Workflows configure the built-in statuses; custom statuses are not supported. The REST API has no webhooks-management or attachment endpoints and no OAuth app flow (tokens only).
- Website-icon fetching supports PNG, JPEG, WebP and GIF icons and PNG images inside `.ico` files; SVG-only icons and BMP-only `.ico` files are not supported (upload a logo instead). Only the standard ports 80/443 are fetched.
- Single-instance design (in-memory rate limiting, SQLite). Run one container per data volume.
- The UI is English only.
- The feedback widget requires reporters to sign in; anonymous widget submissions are not supported.
- Tickets cannot be archived or deleted (bulk or otherwise); close them with a status.
- A ticket has at most one target release and one milestone. Published releases cannot be unpublished.
- Backup verification reads archives into memory (up to 4 GB) and understands the tar formats produced by GNU/BusyBox tar; ZIP64 project bundles (over 4 GB) are not supported, and bundle imports are limited to 200 MB.
- Reminders fire at 9:00 server time (the container's time zone, usually UTC), checked every few seconds by the delivery worker; there is no per-user time zone.
- Imported bundle images get no thumbnail (the original is shown); browser support was verified with Chromium only in automated tests.
