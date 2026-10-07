# GitHub integration

Link development work to tickets: commits and pull requests that mention a ticket key (e.g.
`SPL-42`) appear in the ticket's **Development** section with their state. Optionally, merging a
linked pull request moves the ticket forward. Tikket never writes to your repository and does not
synchronise GitHub issues.

## Set up

1. _Project settings → Integrations → GitHub_: enter the repository (`owner/name` or its URL) and,
   optionally, a read-only token (see below) and the merge rule. **Connect repository**.
2. Copy the **webhook secret** – it is shown once.
3. In the repository on GitHub: _Settings → Webhooks → Add webhook_:
   - **Payload URL**: the URL shown on the Tikket page (`https://<tikket>/api/integrations/github/<id>`;
     copy button provided),
   - **Content type**: `application/json`,
   - **Secret**: the webhook secret,
   - **Events**: _Let me select individual events_ → **Pushes** and **Pull requests**.
4. GitHub sends a `ping`; the integration switches to _Connected_ and shows the last event.

GitHub must be able to reach Tikket over the internet (any of the supported proxies works; the
endpoint needs no cookies and is exempt only from the same-origin check, not from authentication).

One repository per project for now (the database allows more later).

## How linking works

- **Commits** (`push` events): every commit message is scanned for keys of _this_ project, e.g.
  `fix: prevent progress reset (SPL-42)`.
- **Pull requests** (`pull_request` events): title and description are scanned. The state (open,
  merged, closed), author and update time are kept up to date for every ticket linked to that pull
  request – also for links added by hand.
- Keys of other projects and numbers that don't exist are ignored. Matching is case-insensitive
  and whole-word (`XSPL-1` or `SPL-1a` don't match). At most 20 keys per text and 100 commits per
  push are processed.
- Staff can link an issue, pull request or commit by hand on the ticket (`#12`, `PR 12`, a SHA or a
  github.com link of the connected repository) and remove links.
- The Development section is shown to project members and staff. Its data is cached in Tikket:
  **viewing a ticket never calls GitHub**.

## Merge automation (opt-in)

“When a linked pull request is merged”: **Do nothing** (default), **Move the ticket to In
Progress**, or **Mark the ticket Completed**. Only unresolved tickets change; the history shows
“GitHub automation … after pull request #182 was merged”, followers are notified and webhooks /
Discord receive the usual events. Closing a pull request without merging never changes tickets.
The change follows the project's [workflow](workflows.md): if the transition isn't allowed, the
ticket is left unchanged.

## Automation rules

For anything beyond the simple merge setting, use [automations](automations.md). GitHub events
are automation triggers:

- **Pull request linked** – a pull request that mentions a ticket (or is linked by hand) is
  connected to it. Conditions such as _status is Open or Planned_ let you move it to In Progress.
- **Pull request merged** – a linked pull request is merged. Actions can complete the ticket, add
  a label, comment publicly, notify staff or ping a Discord channel.

Templates: _Complete on pull request merge_ and _In progress when a pull request is linked_.
Each GitHub delivery is processed once (delivery ids are replay-protected), and each event runs a
rule at most once, so redelivered webhooks don't repeat actions. If both the merge setting and a
rule complete the ticket, the second change finds the ticket already completed and does nothing.

## Security

- Every delivery must carry a valid `X-Hub-Signature-256` (HMAC-SHA256 of the raw body with the
  webhook secret, compared in constant time); otherwise **401** and the integration shows the
  rejection.
- The repository in the payload must match the connected one (name, and the numeric repository id
  once known); events for other repositories are ignored (202).
- Each `X-GitHub-Delivery` id is processed once (replays answer “Already processed”); ids are kept
  30 days.
- The webhook URL contains a random identifier, not the project key or id. Payload size is limited
  to 5 MB. Links are always built from the connected repository, never from URLs in the payload.
- The webhook secret and token are stored encrypted
  ([ENCRYPTION_KEY](integrations.md#the-encryption-key-encryption_key)), never shown again and never
  logged. **New webhook secret** replaces a lost one (update it on GitHub too).
- Connecting, changing and disconnecting are owner-only form actions (CSRF-protected) and are
  audit-logged.

## Token (optional)

Public repositories need no token. For a private repository, add a **fine-grained personal access
token** limited to that single repository with read-only _Metadata_, _Contents_ and _Pull
requests_ permissions. It is used only for **Test connection** and to read titles of links added
by hand. (A full GitHub App installation flow is not part of v0.5; the webhook model above needs no
broad credentials.)

## Disconnect

Removes the connection and its development links from tickets. Delete the webhook on GitHub too.
