# Feedback widget

The feedback widget lets people report bugs, ideas and improvements from **your own website** without leaving it. It is a small loader script that adds a button; the button opens the Tikket report form in an isolated iframe.

- [Installation](#installation)
- [Allowed websites](#allowed-websites)
- [How sign-in works](#how-sign-in-works)
- [What is collected](#what-is-collected)
- [Security model](#security-model)
- [Customisation](#customisation)
- [Content-Security-Policy on your site](#content-security-policy-on-your-site)
- [Testing the connection](#testing-the-connection)
- [Troubleshooting](#troubleshooting)

## Installation

1. Open **Project → Settings → Feedback widget** (project owners and administrators).
2. Add every website that will show the widget under **Allowed websites**, one origin per line, e.g. `https://spool.example.com`. Only the scheme, host and port count; paths are ignored.
3. Turn on **Enable the widget** and save.
4. Copy the snippet and add it before `</body>` on the pages of those websites:

```html
<script src="https://tikket.example.com/widget.js" data-project="SPL" async></script>
```

The loader is about 4 KB, loads asynchronously, renders its button inside a shadow root (so it neither inherits nor leaks CSS) and creates the iframe only when the button is clicked.

No API key, secret or token is ever placed in your website's HTML.

## Allowed websites

The widget only works on the origins you list:

- `GET /api/widget/<KEY>/config` answers **404** unless the request's `Origin` header exactly matches an allowed origin (no prefix, sub-domain or scheme matching). The loader therefore shows nothing on other sites.
- The form page `/embed/<KEY>` sends `Content-Security-Policy: frame-ancestors 'self' <allowed origins>`, so browsers refuse to frame it anywhere else. Every other Tikket page keeps `frame-ancestors 'none'` and `X-Frame-Options: DENY`.
- Removing an origin, or disabling the widget, immediately revokes every widget sign-in issued for it.

Use `https://` origins in production. `http://localhost` is fine for development.

## How sign-in works

Anonymous submissions are **not** supported: every report is linked to a Tikket account, exactly like reports created in Tikket itself. This keeps spam out and lets reporters follow their tickets.

1. The visitor writes the report in the widget form. Nothing is sent yet.
2. On **Sign in & send**, a small first-party pop-up window opens on the Tikket domain. The visitor signs in there (or is already signed in) and must explicitly click **Allow** for that website.
3. Tikket issues a short-lived (8 h) widget token bound to **one user, one project and one website origin**. Only its SHA-256 hash is stored. The pop-up hands it to the widget iframe with `postMessage`, checking the exact target window and origin, and closes.
4. The report is sent with the token as a `Bearer` header. Widget APIs never accept session cookies, so a third-party page can't ride on the visitor's Tikket session, and the token never leaves the iframe (it is not visible to the host page).

Each request re-checks the account status and the user's permission to submit to the project, so revoking access takes effect immediately. Private projects and projects limited to members behave as usual: people without access see a "no access" message after signing in.

If the browser blocks the pop-up, the widget offers to continue in Tikket in a new tab with the title and description pre-filled.

## What is collected

When **Include page information** is enabled, the host page sends this context to the widget, and the reporter sees it under **Review what is sent** and can exclude it per report:

| Field             | Notes                                                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page address      | Origin and path only. **Query strings and fragments are always removed** (they often carry tokens or e-mail addresses). Dropped if it isn't on the verified origin. |
| Page title        | Clipped to 200 characters.                                                                                                                                          |
| Browser, OS       | Derived from the user agent.                                                                                                                                        |
| Window size       | e.g. `1280×720`.                                                                                                                                                    |
| Time of reporting |                                                                                                                                                                     |
| Website           | The origin the widget was authorised for (verified, not taken from the message).                                                                                    |

Nothing else is read from your page: no form fields, cookies, storage or DOM content. The server sanitises the context again and keeps only the fields above. Staff see it on the ticket under **Environment**, labelled as reported by the browser and not verified.

## Security model

- The iframe is sandboxed (`allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox`).
- `postMessage` messages are accepted only from the exact expected window **and** origin: the iframe accepts context only from its parent on the allowed origin, and tokens only from the pop-up it opened on Tikket's own origin. The loader accepts messages only from its own iframe on Tikket's origin.
- Submissions are rate limited per IP and per user, include a honeypot field and a minimum fill time.
- Uploaded screenshots go through the same validation, re-encoding and metadata stripping as everywhere else.
- Widget setting changes are written to the audit log.

## Customisation

Button label, position (any corner), accent colour, default report type, whether screenshots are allowed and whether page information is offered. Ticket templates for the chosen type are shown in the widget as well. The settings page has a static preview and can open the real, live form.

## Content-Security-Policy on your site

If your website sends a CSP, allow the Tikket origin in:

```
script-src  https://tikket.example.com
frame-src   https://tikket.example.com
connect-src https://tikket.example.com
```

## Testing the connection

The settings page shows a checklist: widget enabled, number of allowed websites, HTTPS, plain-HTTP origins, and **"Loader seen on …"** – recorded (at most once a minute) when the loader fetches its configuration from an allowed origin. Add the snippet, open one of your pages, then press **Check again**.

## Troubleshooting

| Symptom                                   | Fix                                                                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| No button appears                         | The page's origin is not in the allowed list (compare scheme and port), or the widget is disabled. Check the browser console and your CSP. |
| Button appears but the panel stays blank  | Your CSP blocks `frame-src`, or Tikket runs on `http://` while your site uses `https://` (mixed content).                                  |
| "Your browser blocked the sign-in window" | Allow pop-ups for the site, or use **Open in Tikket instead**.                                                                             |
| Signed in but "no access"                 | The project is private or limited to members; add the person to the project.                                                               |
