# Email (SMTP)

Email is optional. When it is configured:

- people can receive **notification emails** – each person chooses which categories, independently
  of in-app notifications;
- **invitations** with an email address are emailed (the link is still shown to the inviter);
- administrators' **password reset links** are emailed to the user;
- users can **reset a forgotten password** themselves (“Forgot password?” on the sign-in page).

Without email nothing changes: notifications stay in-app and links are shared by hand.

## Configuration

### Option A – Administration → Email

Enable sending, enter the server (host, port, encryption: STARTTLS, TLS or none), optional
username/password, sender name and address, reply-to and the timeout. The password is stored
encrypted and requires [`ENCRYPTION_KEY`](integrations.md#the-encryption-key-encryption_key); it
is never shown again – an empty password field keeps it, “Remove the stored password” clears it.
**Send test** shows the result and the page keeps the latest test result.

### Option B – environment variables

| Variable                          | Meaning                                                        |
| --------------------------------- | -------------------------------------------------------------- |
| `SMTP_HOST`                       | Server host. Setting it switches to environment configuration. |
| `SMTP_PORT`                       | Port (default 587 for STARTTLS, 465 for TLS, 25 for none).     |
| `SMTP_SECURITY`                   | `starttls` (default), `tls` or `none`.                         |
| `SMTP_USER`, `SMTP_PASSWORD`      | Credentials (optional).                                        |
| `SMTP_FROM`                       | Sender address (required with `SMTP_HOST`).                    |
| `SMTP_FROM_NAME`, `SMTP_REPLY_TO` | Optional.                                                      |
| `SMTP_TIMEOUT`                    | Connection timeout in seconds (default 15).                    |
| `SMTP_ENABLED`                    | `false` pauses sending without removing the configuration.     |

**Precedence:** when `SMTP_HOST` is set, the environment configuration is used as a whole and the
admin form becomes read-only (it shows the values, never the password). Otherwise the admin
configuration is used. The two are never mixed. Environment variables suit immutable
infrastructure and secret managers; the password then never touches the database.

TLS certificates are always verified (TLS 1.2+); there is no switch to disable verification.
`SMTP_SECURITY=none` sends credentials in plain text and is only for a relay on a trusted network.

## Email preferences

_Account settings → Notifications_ has an **In-app** and an **Email** column per category:
comments, mentions, status changes (including completion), assignments, other updates of followed
tickets, releases, milestones and – for project staff – new tickets. Defaults for email: mentions,
assignments, comments, status changes and releases on; the rest off.

## What is sent – and what never is

- Emails are rendered when they are sent. At that moment Tikket checks again that the recipient is
  active, still wants this category and can still see the project – **removed members stop
  receiving emails from private projects**, even for queued messages.
- **Internal notes are never included.** Staff who may read them get “X added an internal note”
  without the text; nobody else gets anything.
- **Aggregation:** like grouped in-app notifications, repeated comments, status changes and
  updates on the same ticket send at most one email per person per hour. Mentions and assignments
  are always sent. Each event is queued once (deduplicated).
- The person who did something never gets an email about it.
- Emails are plain, branded transactional messages (charcoal header, lime button) with a
  plain-text alternative. No tracking pixels, no remote images, no web fonts – the content is
  complete with images blocked. Every email links to the preferences page.
- Self-service resets answer identically whether or not an account exists, send at most one email
  per account every 10 minutes, are rate limited per IP, and the reset token is created when the
  email is sent – it is never stored in the queue.

## Reliability

Emails are queued in the database and sent in the background (see
[delivery queue](integrations.md#delivery-queue)). A failing mail server never makes the action
fail. Connection problems, timeouts and SMTP 4xx answers are retried (6 attempts); rejected
credentials, certificate problems and 5xx answers fail permanently. Administration → Email shows
waiting/sent/failed counts and recent failures with a **Retry** button.

## Troubleshooting

| Symptom                                           | Fix                                                                              |
| ------------------------------------------------- | -------------------------------------------------------------------------------- |
| “The SMTP server rejected the credentials”        | Check username/password (many providers need an app password).                   |
| “TLS failed: … certificate could not be verified” | Use the host name on the certificate; for port 465 choose TLS, for 587 STARTTLS. |
| “Could not connect … (ECONNECTION)” / timeout     | Firewall or wrong port. Many hosts block outbound port 25; use 587.              |
| Links in emails point to the wrong host           | Set `ORIGIN` (or `APP_URL`) to the public URL.                                   |
| No “Forgot password?” link                        | Email is not enabled or the sender address is missing.                           |
