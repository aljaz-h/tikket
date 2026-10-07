# REST API (v1)

Tikket has a JSON REST API under `/api/v1` for scripts, CI pipelines and bots.

- **Reference:** `/docs/api` in your Tikket (rendered) and `/api/openapi.json` (OpenAPI 3.1, usable
  with Swagger UI, Postman, code generators).
- **Authentication:** `Authorization: Bearer <token>` with a personal access token or a project
  API token – see [API tokens](authentication-tokens.md). The API ignores browser cookies, so it
  is not affected by CSRF and needs no `Origin` header.

## Conventions

```jsonc
// success
{ "data": { … }, "meta": { … } }
// error
{ "error": { "code": "ticket_not_found", "message": "Ticket not found" } }
```

| Status  | Typical codes                                                                          |
| ------- | -------------------------------------------------------------------------------------- |
| 400     | `invalid_filter`, `invalid_limit`, `invalid_cursor`, `invalid_json`                    |
| 401     | `unauthenticated`, `invalid_token`, `token_expired`, `token_revoked`, `token_inactive` |
| 403     | `insufficient_scope`, `forbidden` (the user lacks the permission)                      |
| 404     | `project_not_found`, `ticket_not_found`, `not_found`                                   |
| 413/415 | `payload_too_large` (256 KB), `unsupported_media_type` (send JSON)                     |
| 422     | `validation_failed` (with `details.field`), `idempotency_key_reused`, `conflict`       |
| 429     | `rate_limited`                                                                         |
| 500     | `internal_error` (with a request id for the server log; never a stack trace)           |

Projects a token cannot see answer `404`, exactly like projects that don't exist.

## Endpoints

| Method | Path                                               | Personal scope   | Project scope     |
| ------ | -------------------------------------------------- | ---------------- | ----------------- |
| GET    | `/api/v1/me`                                       | any              | any               |
| GET    | `/api/v1/projects`                                 | `projects:read`  | any               |
| GET    | `/api/v1/projects/{key}`                           | `projects:read`  | any               |
| GET    | `/api/v1/projects/{key}/tickets`                   | `tickets:read`   | `tickets:read`    |
| POST   | `/api/v1/projects/{key}/tickets`                   | `tickets:write`  | `tickets:create`  |
| GET    | `/api/v1/projects/{key}/tickets/{number}`          | `tickets:read`   | `tickets:read`    |
| PATCH  | `/api/v1/projects/{key}/tickets/{number}`          | `tickets:write`  | `tickets:update`  |
| GET    | `/api/v1/projects/{key}/tickets/{number}/comments` | `comments:read`  | `tickets:read`    |
| POST   | `/api/v1/projects/{key}/tickets/{number}/comments` | `comments:write` | `comments:create` |
| GET    | `/api/v1/projects/{key}/labels`                    | `projects:read`  | `tickets:read`    |
| GET    | `/api/v1/projects/{key}/releases`                  | `projects:read`  | `releases:read`   |
| GET    | `/api/v1/projects/{key}/milestones` (staff)        | `projects:read`  | `milestones:read` |
| GET    | `/api/v1/projects/{key}/members` (staff)           | `projects:read`  | –                 |
| GET    | `/api/v1/projects/{key}/views`                     | `projects:read`  | –                 |
| GET    | `/api/v1/projects/{key}/automations` (staff)       | `projects:read`  | –                 |

Every request is additionally limited by what the user may do in the web app: e.g. only staff
change statuses or see internal notes, planning data (release, milestone) is staff-only, member
lists never contain email addresses.

### Tickets

```bash
# List (newest first) with filters
curl -H "Authorization: Bearer $TIKKET_TOKEN" \
  "$TIKKET_URL/api/v1/projects/WEB/tickets?status=open,in_progress&priority=high&limit=50"
```

Filters: `status`, `type`, `priority` (comma-separated), `assignee` (username or `none`),
`reporter`, `label`, `milestone` / `release` (id or `none`, staff only), `updated_after`,
`created_after` (ISO 8601). Unknown values are rejected with `400 invalid_filter`.

```bash
# Create – safe to retry with an Idempotency-Key
curl -X POST -H "Authorization: Bearer $TIKKET_TOKEN" -H "Content-Type: application/json" \
  -H "Idempotency-Key: build-4711" \
  -d '{"title":"Nightly build failed","description":"See CI run 4711","type":"bug"}' \
  "$TIKKET_URL/api/v1/projects/WEB/tickets"
```

Body: `title` (3–200), `description` (plain text) or `description_html` (sanitised), `type`.
Unknown fields are rejected. The same `Idempotency-Key` with the same body returns the original
ticket for 24 hours (`Idempotent-Replayed: true`); with a different body it is rejected.

```bash
# Update – all fields or none
curl -X PATCH -H "Authorization: Bearer $TIKKET_TOKEN" -H "Content-Type: application/json" \
  -d '{"status":"completed","status_note":"Fixed in 1.4","labels":["backend"]}' \
  "$TIKKET_URL/api/v1/projects/WEB/tickets/42"
```

Fields: `title`, `description` / `description_html`, `type`, `status` (+ `status_note`,
`duplicate_of`), `priority`, `assignee` (username or `null`), `labels` (replaces; existing label
names), `milestone_id`, `release_id`. The project's [workflow](workflows.md) applies: a transition
it doesn't allow, or a missing required note, is rejected with `422`. If any change fails, none is
applied.

### Pagination

Lists return `meta.next_cursor`; pass it as `?cursor=` until it is `null`. `limit` is 1–100
(default 25). Cursors are opaque.

### Rate limits

Per token: **300 requests/minute** and **60 writes/minute** (set `API_RATE_LIMIT` to change the
request limit; writes are a fifth of it). Every response has `X-RateLimit-Limit`,
`X-RateLimit-Remaining` and `X-RateLimit-Reset` (seconds); a `429` adds `Retry-After`.

## Audit

Ticket creation, ticket updates and comments made through the API are audit-logged with the user,
the token's prefix and id, and the client IP – never the token itself.

## Versioning policy

`/api/v1` only changes **additively**: new endpoints, new optional request fields, new response
fields and new enum values (clients should ignore unknown fields and tolerate unknown values).
Breaking changes – removing or renaming fields, changing types or semantics – would ship as
`/api/v2`, with `/api/v1` kept for at least one further minor release and the change announced in
the release notes.
