# Integrations

Tikket can talk to the tools around it. **Every integration is optional** – without any of them
Tikket works exactly as before, and no extra service (Redis, a queue server, a mail server) is
ever required.

| Integration      | Where                                      | Guide                            |
| ---------------- | ------------------------------------------ | -------------------------------- |
| Email (SMTP)     | Administration → Email, or env variables   | [email.md](email.md)             |
| Discord          | Project settings → Integrations → Discord  | below                            |
| Generic webhooks | Project settings → Integrations → Webhooks | [webhooks.md](webhooks.md)       |
| GitHub           | Project settings → Integrations → GitHub   | [github.md](github.md)           |
| Data export      | Project settings → General → Export data   | [data-export.md](data-export.md) |

Project integrations are managed by **project owners** (and administrators). The Integrations page
shows one card per integration with its state (connected, not configured, error), the last
success and the most recent error. Every change is written to the audit log – never with secrets.

## The encryption key (`ENCRYPTION_KEY`)

Integration secrets stored in the database are encrypted with AES-256-GCM using a key from the
environment:

- the SMTP password (when email is configured in the admin area),
- Discord webhook URLs (a Discord webhook URL _is_ a password),
- generic webhook URLs and their signing secrets,
- GitHub webhook secrets and tokens.

```bash
openssl rand -base64 32      # → put the result in ENCRYPTION_KEY
```

- The key must be 32 random bytes (base64 or 64 hex characters). An invalid key stops Tikket at
  start-up with an explanation.
- **Tikket never generates this key for you.** Without it, the integration forms explain that the
  key is missing; everything else keeps working.
- Once secrets are stored, Tikket refuses to start without the key rather than silently breaking
  deliveries.
- Secrets are never sent to the browser, never logged and never written to the audit log. Forms
  show `••••••••` for stored values; leaving such a field empty keeps the stored value.

> **⚠️ Back up `ENCRYPTION_KEY` together with your data.** A restored backup needs the same key.
> Without it, the stored integration secrets cannot be recovered – there is no back door.

### Rotating the key

1. Generate a new key.
2. Set `ENCRYPTION_KEY=<new>` and `ENCRYPTION_KEY_PREVIOUS=<old>` (comma-separate several old keys).
3. Restart. All stored secrets are re-encrypted with the new key at start-up (logged as
   `re-encrypted N secret(s)`).
4. Remove `ENCRYPTION_KEY_PREVIOUS` and restart again.

### Lost encryption key

If the key is lost, stored secrets are gone for good. To start Tikket again with a new key:

```bash
docker compose stop tikket
docker compose run --rm tikket node scripts/forget-secrets.js --yes
# set a new ENCRYPTION_KEY, then
docker compose up -d
```

The script removes the unreadable secrets and disables affected destinations; the integrations
keep their settings. Re-enter the Discord/webhook URLs, create a new GitHub webhook secret (and
token) and re-enter the SMTP password. If a key is wrong rather than missing, Tikket starts and
logs which secrets cannot be decrypted; those integrations show an error until fixed.

## Delivery queue

Email, Discord and webhook deliveries go through one small, persistent queue stored in the SQLite
database (table `outbound_jobs`, on the data volume):

- jobs are written in the same transaction as the action that caused them – nothing is sent for a
  rolled-back action and nothing is lost on restart;
- a worker inside the Tikket process claims due jobs with a lease (a crashed process' jobs are
  picked up again when the lease expires);
- temporary failures (timeouts, connection errors, HTTP 429/5xx, SMTP 4xx) are retried with
  capped exponential backoff (30 s, 1 min, 2 min … up to 1 h) – 6 attempts for email and Discord,
  8 for webhooks; permanent failures are marked _dead_ immediately;
- **a failed delivery never makes the ticket action fail**;
- delivered jobs are removed after 7 days, dead ones after 30 days;
- on shutdown, running deliveries get up to 10 s to finish; the rest resume after the restart.

Administrators see email failures (with retry buttons) under Administration → Email; project
owners see the delivery history of each Discord/webhook destination.

Run a single Tikket container per data volume (as before): the queue relies on it.

## Discord

1. In Discord: _Channel settings → Integrations → Webhooks → New webhook → Copy webhook URL_.
2. In Tikket: _Project settings → Integrations → Discord → Add Discord webhook_, paste the URL,
   choose events, save. Use **Test** to post a test message.

Events: any new ticket, new bug reports, new feature requests, high/critical priority (on creation
or when raised), status changes, completed tickets, new public comments, published releases.

Messages are one compact embed (`Tikket — New bug report`, `SPL-123 · title`, project, reporter,
priority, status, a link). User text is truncated (300 characters), Discord markdown is escaped
and mentions can never ping anyone (`allowed_mentions` is empty and `@` is neutralised). Internal
notes are never sent. Only `https://discord.com/api/webhooks/…` URLs (and the `ptb`/`canary`
hosts) are accepted; the URL is stored encrypted and only a masked form
(`discord.com/api/webhooks/1234…/••••••••`) is ever shown again.

## Outbound security (SSRF)

Webhook and Discord deliveries, GitHub API calls and website-icon fetching share one guarded HTTP
client (`src/lib/server/safe-fetch.ts`):

- http/https only, no credentials in URLs;
- every DNS answer must be a public address – loopback, private, link-local, CGNAT, multicast,
  reserved, IPv4-mapped and unique-local IPv6 addresses are refused, and a host that resolves to a
  mix of public and private addresses is refused (DNS rebinding);
- the connection is pinned to the validated address (no second lookup);
- webhooks never follow redirects (a 3xx is a failed delivery); icon fetching re-validates every
  redirect;
- 10 s timeout and a 64 KB response limit for deliveries; only a 200-character error excerpt is
  stored.

`OUTBOUND_ALLOW_PRIVATE_NETWORKS=true` lets webhooks reach private addresses (e.g. an internal
automation server). It is off by default, meant for trusted single-tenant installations, logged as
a warning at start-up, and even then cloud-metadata/link-local addresses stay blocked. Discord and
GitHub never use it.

## Troubleshooting

| Symptom                                                                         | Fix                                                                                                                             |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| “Storing secrets requires ENCRYPTION_KEY”                                       | Set `ENCRYPTION_KEY` (see above) and restart.                                                                                   |
| Start-up fails: “encrypted integration secret(s) but ENCRYPTION_KEY is not set” | Restore the original key. Lost? See _Lost encryption key_.                                                                      |
| “encrypted with a different ENCRYPTION_KEY”                                     | The key changed. Put the old one in `ENCRYPTION_KEY_PREVIOUS`, or re-enter the secret.                                          |
| Webhook: “not publicly reachable”                                               | The endpoint is private/loopback. Use a public URL or (trusted setups only) `OUTBOUND_ALLOW_PRIVATE_NETWORKS=true`.             |
| Webhook: “HTTP 301/302: redirects are not followed”                             | Use the final URL (often `https://` or a trailing slash).                                                                       |
| Discord: “HTTP 404”                                                             | The webhook was deleted in Discord. Create a new one and replace the URL.                                                       |
| Deliveries stay “Waiting”                                                       | Check the container logs; deliveries run inside the Tikket process. Behind a restrictive egress firewall, allow outbound HTTPS. |
