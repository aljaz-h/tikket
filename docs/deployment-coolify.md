# Deploying Tikket with Coolify, an external proxy, or plain Docker Compose

Tikket is a single container (Node.js + embedded SQLite) with one persistent volume. It does not
depend on any particular reverse proxy: the Compose files contain **no Traefik labels and publish
no host port**. Pick the guide that matches how HTTPS reaches your server:

| Guide                                                                                              | TLS terminated by                  | Compose file                                               |
| -------------------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------- |
| [A. Coolify + its proxy (Traefik or Caddy)](#a-coolify-with-its-integrated-proxy-traefik-or-caddy) | Coolify's proxy                    | `compose.yml`                                              |
| [B. Coolify + external Nginx Proxy Manager](#b-coolify-with-an-external-nginx-proxy-manager)       | NPM (optionally behind Cloudflare) | `compose.external-proxy.yml`                               |
| [C. Standalone Docker Compose](#c-standalone-docker-compose-no-coolify)                            | any proxy, or none for local use   | `compose.yml` / `compose.external-proxy.yml` (+ overrides) |

Also: [configuration reference](#configuration-reference) ·
[trusted proxies](#trusted-proxies) · [prebuilt GHCR image](#prebuilt-image-ghcr-optional) ·
[storage, backup, rollback](#storage-backups-upgrades-and-rollback) ·
[verification](#verifying-a-deployment) · [what was tested](#what-has-been-tested) ·
[troubleshooting](#troubleshooting)

---

## The Compose files

| File                         | Purpose                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compose.yml`                | The portable definition. One `tikket` service, `expose: 3000`, named volume `tikket-data` at `/data`, health check, non-root user, read-only root filesystem, `/tmp` tmpfs, all capabilities dropped. No `container_name`, no fixed project name, no ports, no proxy labels.                                                            |
| `compose.external-proxy.yml` | `compose.yml` **plus** one pre-existing external network (name from `PROXY_NETWORK`, default `proxy_shared`) with a DNS alias (`PROXY_ALIAS`, default `tikket`). It is a complete file because Coolify accepts a single Compose file; `npm run check:compose` fails if it ever differs from `compose.yml` in anything but this network. |
| `compose.local-port.yml`     | Override: publish `127.0.0.1:${HOST_PORT:-3000}` for access from the host only.                                                                                                                                                                                                                                                         |
| `compose.ghcr.yml`           | Override: run the prebuilt image instead of building.                                                                                                                                                                                                                                                                                   |

Inside the container Tikket always listens on **port 3000** and stores everything under **`/data`**:

```
/data/tikket.db, tikket.db-wal, tikket.db-shm   SQLite database (WAL mode)
/data/tikket.db.migrate-lock                     lock file used while migrating (harmless)
/data/uploads/                                   attachments and thumbnails
/data/.session-secret                            only if SESSION_SECRET is not set
/data/backups/                                   created by scripts/backup.js
```

---

## A. Coolify with its integrated proxy (Traefik or Caddy)

Coolify's proxy routes the domain to the container and obtains the certificate. Tikket needs no
labels for this; Coolify generates the routing from the domain you enter.

1. **Create the resource.** _Projects → (your project) → + New → Public Repository_ (or _Private
   Repository_ via the GitHub App / deploy key). Enter the repository URL and branch.
2. **Choose the build pack.** Select **Docker Compose**. Set _Base Directory_ `/` and
   _Docker Compose Location_ **`/compose.yml`**. Click _Continue_/_Load Compose file_. Coolify
   lists one service, `tikket`, the volume `tikket-data` and the variables from the file.
3. **Environment variables** (_Environment Variables_ tab). `ORIGIN` is marked required because the
   file uses `${ORIGIN:?…}`.

   | Variable         | Value                                                                                           |
   | ---------------- | ----------------------------------------------------------------------------------------------- |
   | `ORIGIN`         | `https://tikket.example.com` – exactly the domain from step 4, no trailing slash                |
   | `SESSION_SECRET` | output of `openssl rand -base64 48` (mark it _secret/locked_ in Coolify)                        |
   | `ADDRESS_HEADER` | `X-Forwarded-For` (Coolify's proxy is the only entry point)                                     |
   | `XFF_DEPTH`      | `1` (`2` if Cloudflare is proxied in front of Coolify; see [trusted proxies](#trusted-proxies)) |

   Optional (v0.5 integrations): `ENCRYPTION_KEY` = output of `openssl rand -base64 32`, marked
   _secret/locked_ – needed before setting up email in the admin area, Discord, webhooks or
   GitHub. Store a copy outside Coolify: backups can only be restored with the same key. SMTP can
   also be configured here with `SMTP_HOST`, `SMTP_FROM`, … (see [email](email.md)).

   Leave everything else at its default. Tikket does **not** read Coolify's generated
   `SERVICE_FQDN_*` / `COOLIFY_*` variables; `ORIGIN` is always set explicitly.

4. **Domain and port.** In the `tikket` service settings set _Domains_ to
   **`https://tikket.example.com:3000`**. The `:3000` suffix tells Coolify which _container_ port
   to route to; the site is still served on 443. Without it Coolify assumes port 80 and you get a
   _Bad Gateway_.
5. **HTTPS.** With an `https://` domain Coolify's proxy requests a Let's Encrypt certificate
   automatically (DNS must point to the server, ports 80/443 open). Behind Cloudflare use SSL mode
   _Full (strict)_.
6. **Deploy.** Click _Deploy_. The first start validates configuration, checks that `/data` is
   writable and applies migrations; the container only turns _healthy_ after that.
7. **Verify.** In the deployment logs look for `[tikket] ready – serving https://tikket.example.com`.
   Then open the domain – you are redirected to `/setup` to create the first administrator.
   `https://tikket.example.com/api/health` returns `{"status":"ok"}`.

**Caddy instead of Traefik.** If the server's proxy is set to Caddy (_Servers → Proxy_), the steps
are identical; Coolify generates Caddy labels from the same domain field. Coolify documents Caddy
support as less mature than Traefik – see [what has been tested](#what-has-been-tested).

**Do not** add `ports:` for this mode, and do not enable Coolify's _Raw Compose Deployment_:
normal Compose deployment already attaches the proxy network and generates the routing.

---

## B. Coolify with an external Nginx Proxy Manager

Use this when Nginx Proxy Manager (NPM) – possibly behind Cloudflare – is your public entry point
and Coolify only builds and runs containers:

```
Browser ─HTTPS─▶ Cloudflare (optional) ─HTTPS─▶ NPM ─HTTP over Docker network "proxy_shared"─▶ tikket:3000
```

Tikket is reached **directly** by NPM over a shared Docker network. No host port is published and
the request does not pass through Coolify's proxy.

### B1. Avoid two proxies fighting over ports 80/443

Coolify's proxy and NPM cannot both bind ports 80/443 on the same server. Choose one:

- **NPM is the only public proxy (typical):** _Servers → (server) → Proxy → Stop Proxy_ and set the
  proxy type to _None / Custom_ so Coolify does not restart it. (Other Coolify resources then also
  need NPM proxy hosts.)
- **Both are needed:** keep Coolify's proxy on 80/443 and run NPM elsewhere (another host or other
  ports) – or route Tikket through Coolify instead (guide A).

### B2. Create (or reuse) the shared network

On the Coolify server (SSH), once:

```bash
docker network ls --filter name=proxy_shared          # already there?
docker network create proxy_shared                    # otherwise create it
```

Any name works – set the same name in `PROXY_NETWORK` below. Tikket's Compose file declares the
network `external: true`: it never creates or deletes it, and a missing network makes the deployment
fail with `network proxy_shared declared as external, but could not be found` (create it, redeploy).

### B3. Connect Nginx Proxy Manager to that network

If NPM runs from its own Compose file, add the network there (and recreate NPM):

```yaml
services:
  npm:
    # … your existing NPM service …
    networks:
      - default
      - proxy_shared
networks:
  proxy_shared:
    external: true
```

Or attach the running container without editing files (lost if the container is recreated from a
file that does not list the network):

```bash
docker network connect proxy_shared <npm-container-name>
```

If NPM runs on **another host**, a Docker network cannot connect them; see the note in
[standalone usage](#c3-with-an-external-reverse-proxy) about publishing a port on a private
interface instead.

### B4. Deploy Tikket in Coolify

1. _+ New → (Public|Private) Repository_, build pack **Docker Compose**, _Base Directory_ `/`,
   _Docker Compose Location_ **`/compose.external-proxy.yml`**.
2. Environment variables:

   | Variable                              | Value                                                                |
   | ------------------------------------- | -------------------------------------------------------------------- |
   | `ORIGIN`                              | `https://tikket.example.com` (the domain configured in NPM)          |
   | `SESSION_SECRET`                      | `openssl rand -base64 48`                                            |
   | `PROXY_NETWORK`                       | `proxy_shared` (your network name)                                   |
   | `PROXY_ALIAS`                         | `tikket` – the hostname NPM will use; must be unique on that network |
   | `ADDRESS_HEADER`                      | `X-Forwarded-For`                                                    |
   | `XFF_DEPTH`                           | `1` (see [B7](#b7-cloudflare-in-front-of-npm) for Cloudflare)        |
   | `BODY_SIZE_LIMIT` / `MAX_UPLOAD_SIZE` | defaults `25M` / `10M` are fine                                      |

3. **Leave the service's _Domains_ field empty.** A domain would make Coolify configure its own
   proxy route as well (a second, unwanted path to the app).
4. _Deploy_ and wait until the service is _healthy_.

Coolify names containers `<service>-<uuid>`; do not use that name in NPM. The fixed network alias
(`PROXY_ALIAS`) is the stable hostname. Check it from the NPM container:

```bash
docker exec <npm-container-name> sh -c 'wget -qO- http://tikket:3000/api/health || curl -s http://tikket:3000/api/health'
# → {"status":"ok"}
docker network inspect proxy_shared --format '{{range .Containers}}{{.Name}} {{end}}'
```

### B5. Configure the NPM proxy host

_Hosts → Proxy Hosts → Add Proxy Host_:

- **Details:** Domain `tikket.example.com`; Scheme **`http`**; Forward Hostname/IP **`tikket`**
  (your `PROXY_ALIAS`); Forward Port **`3000`**; enable _Block Common Exploits_. _Websockets_ and
  _Cache Assets_ are not needed (leave caching **off** – Tikket sets its own cache headers and
  private attachments must not be cached by a proxy).
- **SSL:** request a Let's Encrypt certificate (or a Cloudflare Origin Certificate, see B7);
  enable _Force SSL_ and _HTTP/2_. Enable _HSTS_ once everything works.
- **Advanced** → _Custom Nginx Configuration_:

  ```nginx
  client_max_body_size 25m;     # ≥ BODY_SIZE_LIMIT, otherwise large screenshots fail with 413
  proxy_buffer_size 16k;        # headroom for response headers (CSP etc.)
  proxy_buffers 8 16k;
  proxy_read_timeout 60s;
  ```

NPM already sends `Host`, `X-Forwarded-Proto` and `X-Forwarded-For`. Tikket does not use
`Host`/`X-Forwarded-Proto`/`X-Forwarded-Host` for anything security-relevant – its public URL
always comes from `ORIGIN`.

### B6. Make sure the traffic path is the one you expect

```bash
# 1. Tikket publishes no host port (empty output):
docker port $(docker ps -qf "name=tikket-") 2>/dev/null
# 2. Coolify generated no proxy route for it (no traefik/caddy labels):
docker inspect $(docker ps -qf "name=tikket-") --format '{{json .Config.Labels}}' | tr ',' '\n' | grep -Ei 'traefik|caddy' || echo "no proxy labels"
# 3. Responses come from NPM (OpenResty), not Traefik:
curl -sI https://tikket.example.com | grep -i '^server:'      # → server: openresty
```

In Tikket, _Account → Password & sessions_ shows the client IP of each session. It should show
your real IP (not an NPM/Docker `172.x` address – if it does, `ADDRESS_HEADER` is not set; if it
shows a Cloudflare IP, see B7).

### B7. Cloudflare in front of NPM

- DNS record _proxied_ (orange cloud), SSL/TLS mode **Full (strict)**. In NPM use a Let's Encrypt
  certificate via DNS challenge or a Cloudflare _Origin Certificate_.
- Cloudflare's free plan allows request bodies up to 100 MB – above Tikket's defaults.
- **Client IPs.** Each proxy appends to `X-Forwarded-For`, so Tikket sees
  `client, cloudflare-edge`. Recommended: make NPM restore the real client IP from Cloudflare and
  keep `XFF_DEPTH=1`. Add to the proxy host's _Advanced_ config (or NPM's global
  `/data/nginx/custom/http_top.conf`) Cloudflare's published ranges:

  ```nginx
  # https://www.cloudflare.com/ips-v4 and /ips-v6 – keep this list current
  set_real_ip_from 173.245.48.0/20;
  set_real_ip_from 103.21.244.0/22;
  # … all other Cloudflare ranges …
  real_ip_header CF-Connecting-IP;
  ```

  Alternative without real-IP restoration: `XFF_DEPTH=2`. This is only safe if NPM accepts
  connections **exclusively** from Cloudflare (firewall); otherwise anyone can bypass Cloudflare and
  forge the client IP used for rate limiting.

### B8. Updates

Push to the configured branch and click _Redeploy_ (or enable Coolify's auto-deploy webhook). The
volume `tikket-data` is kept and the network alias stays the same, so the NPM proxy host needs no
change. A re-created container usually gets a new IP; NPM resolves the alias through Docker's DNS,
but if you ever see a 502 right after a redeploy, restart the NPM container once (the test setup
in `tests/deployment/proxies/nginx.conf` uses `resolver 127.0.0.11` to re-resolve per request).

---

## C. Standalone Docker Compose (no Coolify)

Requirements: Docker Engine with Compose v2.24+.

```bash
git clone <repository> tikket && cd tikket
cp .env.example .env
# edit .env: ORIGIN=https://tikket.example.com, SESSION_SECRET=$(openssl rand -base64 48), …
```

### C1. Quick local test (no proxy)

```bash
echo 'ORIGIN=http://localhost:3000' >> .env      # http is fine for localhost only
docker compose -f compose.yml -f compose.local-port.yml up -d --build
curl http://127.0.0.1:3000/api/health
```

The port is bound to `127.0.0.1` only. Change it with `HOST_PORT=8080` (then
`ORIGIN=http://localhost:8080`).

### C2. With a proxy on the same host but not in Docker (e.g. system nginx/Caddy)

Use the same two files (`compose.yml` + `compose.local-port.yml`) and point the proxy at
`http://127.0.0.1:3000`. Example Caddyfile:

```caddyfile
tikket.example.com {
	request_body {
		max_size 25MB
	}
	reverse_proxy 127.0.0.1:3000
}
```

Set `ORIGIN=https://tikket.example.com`, `ADDRESS_HEADER=X-Forwarded-For`, `XFF_DEPTH=1`.

### C3. With an external reverse proxy container (NPM, Caddy, nginx, Traefik)

```bash
docker network create proxy_shared            # once (or reuse an existing network)
# .env: PROXY_NETWORK=proxy_shared, PROXY_ALIAS=tikket, ORIGIN=https://…, ADDRESS_HEADER=X-Forwarded-For
docker compose -f compose.external-proxy.yml up -d --build
```

Connect the proxy container to `proxy_shared` and forward to `http://tikket:3000`
([B3](#b3-connect-nginx-proxy-manager-to-that-network) and [B5](#b5-configure-the-npm-proxy-host)
apply unchanged). Minimal configurations that are exercised by the automated deployment test
live in `tests/deployment/proxies/` (nginx, Caddy, Traefik file provider).

If the proxy runs on **another machine**, Docker networks cannot connect them. Publish the port on
a private interface instead (e.g. a VPN/LAN address) with an override such as
`ports: ['10.0.0.5:3000:3000']`, and firewall it to the proxy's address.

### C4. Several instances on one host

Use a different project directory or `-p <name>` per instance (volumes are namespaced by project)
and a different `PROXY_ALIAS` per instance on a shared network.

---

## Configuration reference

All variables are read at start-up and validated; invalid values stop the container with a message
listing every problem (visible in `docker compose logs` / Coolify deployment logs).

| Variable                        | Default                         | Notes                                                                                                                                                                                       |
| ------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ORIGIN`                        | – (**required**)                | Public URL, scheme + host (+ port), no path/trailing slash. Drives CSRF checks, `Secure` cookies, HSTS and all absolute links. Forwarded `Host`/`Proto` headers are never trusted for this. |
| `SESSION_SECRET`                | generated                       | ≥ 32 chars. Empty → random secret generated once into `/data/.session-secret` (warning logged). Short or placeholder → start-up error. Changing it signs everyone out.                      |
| `ADDRESS_HEADER`                | empty                           | Header with the client IP, e.g. `X-Forwarded-For`. Empty → the TCP peer address is used.                                                                                                    |
| `XFF_DEPTH`                     | `1`                             | Number of trusted proxies appending to `X-Forwarded-For`.                                                                                                                                   |
| `APP_URL`                       | `ORIGIN`                        | Base for invitation/reset links if it must differ.                                                                                                                                          |
| `ENCRYPTION_KEY`                | –                               | 32 random bytes (`openssl rand -base64 32`) for integration secrets. Never generated; back it up. See [integrations](integrations.md).                                                      |
| `SMTP_*`                        | –                               | Optional email configuration, see [email](email.md).                                                                                                                                        |
| `MAX_UPLOAD_SIZE`               | `10M`                           | Hard per-image limit (admins can lower it).                                                                                                                                                 |
| `BODY_SIZE_LIMIT`               | `25M`                           | Max request body; must be ≥ `MAX_UPLOAD_SIZE`. Keep the proxy's limit ≥ this.                                                                                                               |
| `LOGIN_RATE_LIMIT`              | `10`                            | Failed sign-ins per account per 15 min (per-IP: 3×).                                                                                                                                        |
| `PROXY_NETWORK` / `PROXY_ALIAS` | `proxy_shared` / `tikket`       | Only `compose.external-proxy.yml`.                                                                                                                                                          |
| `HOST_PORT`                     | `3000`                          | Only `compose.local-port.yml`.                                                                                                                                                              |
| `TIKKET_IMAGE`                  | `ghcr.io/aljaz-h/tikket:latest` | Only `compose.ghcr.yml`.                                                                                                                                                                    |

`PORT` (3000), `HOST` (0.0.0.0) and `DATA_DIR` (`/data`) are fixed in the Compose files – change
the volume mapping, not these.

## Trusted proxies

Tikket uses the client IP for login/registration rate limiting, session lists and the audit log.
It only takes the IP from a header when you say so (`ADDRESS_HEADER`), and then only the entry
added by your own proxies (`XFF_DEPTH`, counted from the right). Values a client sends itself are
ignored. Rules of thumb:

- One proxy in front (Coolify's Traefik/Caddy, or NPM): `ADDRESS_HEADER=X-Forwarded-For`, `XFF_DEPTH=1`.
- Cloudflare → proxy: restore the real IP at the proxy (B7) and keep `XFF_DEPTH=1`, or use `2` if the
  proxy only accepts Cloudflare connections.
- No proxy / not sure: leave `ADDRESS_HEADER` empty (safe default; all requests then appear to
  come from the proxy's IP, so rate limits are shared).
- Never set `ADDRESS_HEADER` if clients can reach Tikket without passing your proxy.

## Prebuilt image (GHCR, optional)

`.github/workflows/docker-publish.yml` builds `linux/amd64` and `linux/arm64` images and pushes
them to `ghcr.io/<owner>/tikket` (tags `X.Y.Z`, `X.Y`, `X`, `latest` for `vX.Y.Z` git tags,
`edge` for `main`, `sha-…`). It only needs the built-in `GITHUB_TOKEN` with `packages: write`.
Make the package public in GitHub (_Packages → tikket → Package settings_) or log in to GHCR on the
server.

- Standalone: `docker compose -f compose.yml -f compose.ghcr.yml pull && docker compose -f compose.yml -f compose.ghcr.yml up -d`
  (pin `TIKKET_IMAGE=ghcr.io/<owner>/tikket:1.2.0` for controlled upgrades).
- Coolify: Coolify's Git-based Compose deployment takes one file, so it builds from source (guides A/B).
  To run the image instead, create a _Docker Compose Empty_ resource and paste the contents of
  `compose.yml` (or `compose.external-proxy.yml`) with the `build:` block replaced by
  `image: ghcr.io/<owner>/tikket:<version>`. This is Coolify's raw/pasted Compose mode: updates
  then come from changing the image tag rather than from Git, and everything else (domain,
  network, variables) is configured exactly as in A/B.

Building from source stays the default; GHCR is never required.

## Storage, backups, upgrades and rollback

**Persistence.** Everything lives in the named volume `tikket-data` (Coolify prefixes it with the
resource UUID). It survives restarts, container re-creation, image rebuilds, redeploys and
`docker compose down`. It is only deleted by `docker compose down -v`, `docker volume rm`, or
deleting the resource in Coolify with volume deletion selected – **never** do that without a backup.
The root filesystem is read-only; only `/data` (volume) and `/tmp` (tmpfs, used transiently during
image processing) are writable. The image runs as uid/gid **1000**; named volumes inherit the
correct ownership automatically. For a bind mount use `chown -R 1000:1000 <dir>` first – Tikket
refuses to start with a clear message if `/data` is not writable.

**Migrations.** On start Tikket applies pending migrations from `drizzle/` before it accepts
requests. They are forward-only, run in a single transaction (a failed migration changes nothing),
never reset data, and are serialised with an exclusive file lock so overlapping containers (e.g.
during a redeploy) cannot apply the same migration twice. There is no seed data. The health check
only reports healthy after start-up completed.

**Backups.**

```bash
# Consistent online snapshot (SQLite backup API) into /data/backups, keep the newest 14:
docker exec <tikket-container> node scripts/backup.js /data/backups 14
# Copy snapshot + attachments off the server:
docker run --rm -v <volume-name>:/data:ro -v "$PWD":/out alpine tar czf /out/tikket-$(date +%F).tar.gz -C /data backups uploads
```

In Coolify you can schedule the first command as a _Scheduled Task_ on the `tikket` service
(e.g. daily `node scripts/backup.js /data/backups 14`). Coolify's built-in database backups do not
cover SQLite files inside application volumes. Always copy backups to another machine.

Verify a backup (read-only) and dry-run its restore with the current image:
`docker exec <tikket-container> node scripts/backup-verify.js /data/backups/<file>.db --uploads /data/uploads`
and `node scripts/restore-verify.js <archive>` – see [Backup verification](backup-verification.md).
_Administration → Backups_ shows the last recorded backup; _Administration → Health_ warns when
none is recorded or it is older than a week.

**Upgrade.** Back up, then redeploy (Coolify) or `git pull && docker compose … up -d --build`.

**Rollback.** If a new version fails to start, the old data is untouched (migrations are
transactional): redeploy the previous commit/image. If the new version _did_ migrate the schema,
older code may not understand it – restore the backup taken before the upgrade:

```bash
docker compose stop tikket            # or stop the resource in Coolify
docker run --rm -v <volume-name>:/data -v "$PWD":/in alpine sh -c '
  cd /tmp && tar xzf /in/tikket-YYYY-MM-DD.tar.gz &&
  rm -f /data/tikket.db /data/tikket.db-wal /data/tikket.db-shm &&
  cp "$(ls backups/tikket-*.db | tail -1)" /data/tikket.db &&
  rm -rf /data/uploads && cp -r uploads /data/uploads && chown -R 1000:1000 /data'
# then deploy the previous version
```

**Recovery.** Lost the only admin password: `docker exec <tikket-container> node scripts/reset-link.js <username>`.
Database integrity: `docker exec <tikket-container> node scripts/db-check.js` (integrity, foreign
keys, schema version; read-only).

## Verifying a deployment

```bash
curl -s https://tikket.example.com/api/health                 # {"status":"ok"}
curl -sI https://tikket.example.com/my-tickets | grep -iE '^(location|strict-transport)'
#   location: /login?next=…        (relative → stays on https)
#   strict-transport-security: …   (present because ORIGIN is https)
```

Then sign in and check in the browser's dev tools that the `tikket_session` cookie is `Secure`,
`HttpOnly`, `SameSite=Lax`, create a ticket with a screenshot, and check _Password & sessions_ for
your real IP.

## What has been tested

Automated (`npm run test:deployment`, also run in CI) – **locally, without Coolify**:

- `compose.yml`, `compose.external-proxy.yml` and both overrides validated with `docker compose config`;
  the external-proxy file is asserted identical to `compose.yml` except for its network; no host
  ports, no `container_name`, no Traefik labels; Compose refuses to start without `ORIGIN`.
- The production image built and deployed with `compose.external-proxy.yml` on an external network;
  container healthy, non-root, read-only root filesystem, writable `/data` and `/tmp`, reachable by
  its alias from the shared network, no published ports.
- HTTPS termination by **nginx configured like Nginx Proxy Manager**, **Caddy** and **Traefik**
  (file provider, standing in for Coolify's Traefik), each with a self-signed certificate:
  first-run setup, login/logout, `Secure; HttpOnly; SameSite=Lax` session cookie, ticket creation
  with a ~4.6 MB screenshot, comments, attachment download, cross-origin form/API posts rejected,
  invitation and reset links built from `ORIGIN` even with spoofed `Host`/`X-Forwarded-Host`/
  `X-Forwarded-Proto`, relative redirects + HSTS, client-supplied `X-Forwarded-For` ignored,
  anonymous attachment access denied, no browser errors.
- Persistence across `up --force-recreate`, a simulated image upgrade (new image ID) and
  `down` + `up`; database `integrity_check` after a graceful `SIGTERM` stop (exit 0).
- Start-up refuses: missing `ORIGIN`, weak `SESSION_SECRET`, unwritable data directory.
- `compose.yml` + `compose.local-port.yml`: reachable on `127.0.0.1:<port>` and bound to loopback only.
- Concurrent migrations from several processes (Vitest), failed-migration rollback, idempotent
  restarts.

**Not verified against a real Coolify installation.** The Coolify guides follow Coolify v4's
documented Docker Compose build pack behaviour (domain-with-port routing, environment variable
detection from `${VAR}`/`${VAR:?}`, persistent named volumes, external networks), but they were not
executed on a Coolify server, and Coolify's Caddy proxy, generated labels, container naming and
Scheduled Tasks were not exercised. Real Nginx Proxy Manager and Cloudflare were also not used –
an nginx configuration equivalent to NPM's proxy host was. Please report differences you encounter.

## Troubleshooting

| Symptom                                                         | Cause / fix                                                                                                                                          |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Container exits immediately, logs show `Invalid configuration:` | Fix the listed variables (usually `ORIGIN`).                                                                                                         |
| `Data directory "/data" is not writable by uid 1000`            | Bind mount owned by root: `chown -R 1000:1000 <dir>`, or use the named volume.                                                                       |
| _Bad Gateway_ in Coolify                                        | Domain missing `:3000`, or the container is not healthy yet (check logs).                                                                            |
| _Bad Gateway_ in NPM                                            | NPM not on `PROXY_NETWORK`, wrong _Forward Hostname_ (use `PROXY_ALIAS`, not the Coolify container name), or scheme set to `https` (must be `http`). |
| 502 with `upstream sent too big header` in NPM logs             | Add `proxy_buffer_size 16k; proxy_buffers 8 16k;` (B5). Current versions keep headers small; very old builds sent large `Link` headers.              |
| 403 _Cross-site POST form submissions are forbidden_            | `ORIGIN` does not exactly match the URL in the browser (scheme, host, port).                                                                         |
| Logged out after every request / cookie missing                 | Site served over `http://` while `ORIGIN` is `https://` – enable _Force SSL_ in the proxy.                                                           |
| 413 on screenshot upload                                        | Raise the proxy limit (`client_max_body_size`) and/or `BODY_SIZE_LIMIT`.                                                                             |
| All users share rate limits; sessions show `172.x`              | `ADDRESS_HEADER` not set ([trusted proxies](#trusted-proxies)).                                                                                      |
| `network … declared as external, but could not be found`        | `docker network create <PROXY_NETWORK>` on that server.                                                                                              |
| Deployment hangs at start-up while another instance runs        | Two Tikket containers share one volume and one is migrating; they wait for the migration lock (up to 2 minutes). Run only one instance per volume.   |
