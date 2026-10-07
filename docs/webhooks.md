# Webhooks

_Project settings → Integrations → Webhooks_ sends signed JSON events to your own endpoints
(automation, chat bots, data pipelines). Owners can add endpoints, choose events, enable/disable,
send a test event, rotate the signing secret and see the recent delivery history.

## Events

| Event                   | When                                                           |
| ----------------------- | -------------------------------------------------------------- |
| `ticket.created`        | A ticket is submitted (web or widget).                         |
| `ticket.updated`        | Title, description, type or priority changes (`data.changes`). |
| `ticket.status_changed` | The status changes (`data.from`, `data.to`).                   |
| `ticket.assigned`       | Assigned or unassigned (`data.ticket.assignee`).               |
| `ticket.completed`      | Marked completed (in addition to `ticket.status_changed`).     |
| `comment.created`       | A **public** comment is posted. Internal notes are never sent. |
| `release.published`     | A release is published (`data.release`).                       |
| `milestone.completed`   | A milestone is completed (`data.milestone`).                   |

Bulk edits send one event per changed ticket with `"bulk": true`; GitHub automation adds
`"automation": {…}`. The **Test** button sends a `ping` event.

## Request

`POST` with `Content-Type: application/json` and these headers:

| Header             | Content                                                                             |
| ------------------ | ----------------------------------------------------------------------------------- |
| `Tikket-Event`     | Event name, e.g. `ticket.created`.                                                  |
| `Tikket-Delivery`  | The event id (`evt_…`). **The same for every retry** – use it to ignore duplicates. |
| `Tikket-Timestamp` | Unix time (seconds) of this attempt.                                                |
| `Tikket-Signature` | `v1=<hex>` – HMAC-SHA256 of `<timestamp>.<raw body>` with the signing secret.       |
| `Tikket-Attempt`   | 1, 2, 3 …                                                                           |

Body – a stable envelope, version `"1"` (fields are only ever added within a version):

```json
{
	"version": "1",
	"id": "evt_3q9dQ7yZ0d1x",
	"event": "ticket.created",
	"created_at": "2026-10-07T09:12:44.120Z",
	"project": { "id": 1, "key": "SPL", "name": "Spool", "url": "https://tikket.example.com/p/spl" },
	"data": {
		"ticket": {
			"id": 42,
			"key": "SPL-42",
			"number": 42,
			"title": "Playback progress resets after refresh",
			"type": "bug",
			"status": "open",
			"priority": "medium",
			"url": "https://tikket.example.com/p/spl/tickets/42",
			"description": "Plain text, at most 2000 characters",
			"reporter": { "username": "aljaz", "name": "Aljaž" },
			"assignee": null,
			"created_at": "…",
			"updated_at": "…",
			"completed_at": null
		}
	}
}
```

`comment.created` adds `data.comment` (`id`, `author`, `body` – plain text up to 4000 characters,
`created_at`, `url`). Payloads only contain what the project's owners can see anyway; they never
contain internal notes, email addresses or secrets. The payload is built when the event happens,
so retries send exactly the same body.

## Verifying signatures

Verify against the **raw** request body (before JSON parsing) and reject old timestamps to
prevent replays:

```js
import crypto from 'node:crypto';

export function verifyTikket(rawBody, headers, secret, toleranceSeconds = 300) {
	const timestamp = Number(headers['tikket-timestamp']);
	if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds)
		return false;
	const expected =
		'v1=' + crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
	const given = String(headers['tikket-signature'] ?? '');
	return (
		given.length === expected.length &&
		crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))
	);
}
```

Python:

```python
import hmac, hashlib, time

def verify_tikket(raw_body: bytes, headers, secret: str, tolerance=300) -> bool:
    ts = int(headers.get("Tikket-Timestamp", "0"))
    if abs(time.time() - ts) > tolerance:
        return False
    expected = "v1=" + hmac.new(secret.encode(), f"{ts}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, headers.get("Tikket-Signature", ""))
```

Also store processed `Tikket-Delivery` ids for a while and ignore repeats – a delivery may arrive
twice if your endpoint answered slowly.

## Signing secret

A secret (`whsec_…`) is created with each endpoint and **shown once**. Copy it into your receiver.
**Rotate secret** creates a new one (also shown once) and the old one stops being used
immediately – update your receiver right away. Secrets are stored encrypted
([ENCRYPTION_KEY](integrations.md#the-encryption-key-encryption_key)).

## Retries and delivery history

Answer with any 2xx quickly (within 10 s). Then:

- timeouts, connection errors, **429** (honouring `Retry-After`, capped) and **5xx/408** are
  retried with exponential backoff, up to 8 attempts;
- **other 4xx are not retried**; redirects (3xx) are not followed and count as failures;
- the last 50 deliveries per endpoint are kept: event, time, HTTP status, duration, attempt and a
  short error excerpt (never headers or full response bodies).

Endpoint URLs follow the [SSRF rules](integrations.md#outbound-security-ssrf): public addresses
only unless the administrator set `OUTBOUND_ALLOW_PRIVATE_NETWORKS=true`. Any port is allowed.
Query strings are hidden in the UI (`https://hooks.example.com/in?…`) since they often carry
tokens.
