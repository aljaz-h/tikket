# Health, delivery queue and reminders

Small operational pages for administrators – no monitoring stack, no telemetry, nothing sent
anywhere. Each page is computed when it is opened.

## Administration → Health

| Section        | Shows                                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------- |
| Application    | Tikket version, uptime, environment, server time, public URL                                                     |
| Database       | connected, SQLite size (database + WAL), migrations applied of those shipped, WAL mode, foreign keys             |
| Storage        | data and upload directories writable, used space (data, uploads), free space on the volume, last recorded backup |
| Delivery queue | waiting, retrying and failed jobs                                                                                |
| Integrations   | email configured / sending, encryption key set, number of GitHub connections, Discord channels and webhooks      |

**Warnings** appear at the top, for example: pending migrations, the data volume not writable,
less than 10 % free space, failed deliveries, no backup recorded or the last one older than a week,
email not configured (optional), `ENCRYPTION_KEY` not set. Filesystem paths and secrets are never
shown.

Directory sizes are counted with a bounded walk and cached for a minute. For a full database check
run, on the server:

```bash
docker compose exec tikket node scripts/db-check.js     # npm run db:check
```

It runs `PRAGMA integrity_check` and `foreign_key_check` and compares the schema version with the
migrations shipped – read-only, but it reads the whole database, so it is not run automatically.

## Administration → Delivery queue

Emails, Discord messages, webhooks and automations share one queue in the database.

- **Summary:** waiting, retrying, failed, delivered in the last 24 hours, oldest waiting job, last
  successful delivery and last failure.
- **Lists** (failed / retrying / waiting, filterable by type): type, project, related ticket,
  attempts, last error, next retry, created and last attempt.
- **Retry now** re-queues a failed job (with fresh attempts) or runs a waiting retry immediately.
- **Discard** permanently removes a failed or waiting job.
- **Details** show metadata only.

Only administrators can open the page, retry or discard. Project owners see the delivery history of
their own Discord channels and webhooks under _Project settings → Integrations_.

Payloads, destination URLs, signing secrets, SMTP credentials and tokens are never shown: errors
are shortened and URLs, tokens and long opaque strings are replaced (`[url]`, `[secret]`,
`[redacted]`). Temporary failures (timeouts, 429, 5xx) retry with increasing delays; permanent
failures (e.g. a deleted webhook, 4xx) stop immediately and are listed as failed. Failed jobs are
kept 30 days, delivered ones 7 days. Permanent failures are also logged with the job id, type and
project.

## Reminders

On a ticket, **Remind me** sets a private, one-off reminder: tomorrow, in 3 days, in a week (each
at 9:00 server time) or on a chosen date. When it is due you get an in-app notification
("Reminder about this ticket") – also when "Other updates" notifications are switched off, since
you asked for it – and an email if you receive emails for "Other updates". Access is checked again
when it fires. At most 10 open reminders per person; there is no recurrence and no scheduler – the
delivery worker checks for due reminders on its regular tick. Sent reminders are removed after 30
days.

## Logs

Server logs contain structured context where useful – an error id (also shown on the error page as
_Reference_), method, path without the query string, route and user id; job id, type and project
for failed deliveries; the chain id for automation safety limits. Raw tokens, webhook URLs, SMTP
passwords, encryption keys and ticket contents are not logged.
