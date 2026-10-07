# API tokens

Tikket's [REST API](api.md) authenticates with bearer tokens – never with the browser session.

```
Authorization: Bearer tkt_pat_…
```

## Personal access tokens

**Account settings → Developer → New token.** A personal token acts **as you**: it can never do
more than your account can, narrowed further by its scopes.

| Scope            | Allows                                                             |
| ---------------- | ------------------------------------------------------------------ |
| `projects:read`  | Projects you can access, their labels, releases, milestones, views |
| `tickets:read`   | Read tickets                                                       |
| `tickets:write`  | Create and update tickets (with your permissions)                  |
| `comments:read`  | Read comments (internal notes only if you are staff)               |
| `comments:write` | Post comments (internal notes only if you are staff)               |

## Project API tokens

**Project settings → Developer** (owners only). For CI pipelines, deploy scripts and bots that
work on **one project**. A project token can never reach another project – other projects answer
`404` exactly like projects that don't exist. It acts with the rights of the owner who created it
and **stops working if that person is no longer an owner** (or is disabled). Project tokens
never see or write **internal notes**, so they are safe to hand to CI systems and third parties.

| Scope             | Allows                                      |
| ----------------- | ------------------------------------------- |
| `tickets:read`    | Read tickets, comments and labels           |
| `tickets:create`  | Create tickets                              |
| `tickets:update`  | Update tickets (status, priority, labels …) |
| `comments:create` | Post comments                               |
| `releases:read`   | Read releases                               |
| `milestones:read` | Read milestones                             |

## Security

- Tokens are 240-bit random values (`tkt_pat_…` / `tkt_prj_…`) shown **once**, right after
  creation. Copy them into a secret store (CI secrets, a password manager).
- Tikket stores only a **SHA-256 hash** plus a short prefix (`tkt_pat_ab12••••••••`) for
  recognising tokens in lists. Raw tokens are never logged, audited or shown again.
- Expiry: 7, 30, 90 days, 1 year or never. Expired and revoked tokens stop working immediately.
- _Last used_ is updated at most every 5 minutes per token.
- Creating, revoking and every API write are audit-logged with the token's prefix and id.
- At most 50 active tokens per person or project; at most 10 new tokens per hour per person.
- Failed authentication (a wrong, expired or revoked token) is rate-limited per client IP; valid
  tokens are never blocked by it.

## Backups

The database contains only token **hashes**. Restoring a backup keeps existing tokens working,
but a token that was lost cannot be recovered – revoke it and create a new one. After restoring
an **older** backup, tokens created after that backup no longer exist and must be recreated.
