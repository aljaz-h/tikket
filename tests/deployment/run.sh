#!/usr/bin/env bash
# End-to-end deployment test: production image + compose.external-proxy.yml behind nginx
# (configured like Nginx Proxy Manager), Caddy and Traefik, all terminating HTTPS.
# Verifies health, read-only filesystem, no published ports, HTTPS cookies, CSRF, proxy header
# handling, large uploads, persistence across re-creation / image upgrade / down+up, and
# start-up failures for invalid configuration.
#
# Usage: npm run test:deployment     (requires Docker with Compose v2.24+)
#   TIKKET_DOCKER_BUILD_FLAGS   extra flags for `docker build` (e.g. --secret id=ca,src=ca.pem)
#   PROXY_IMAGE_PREFIX          registry prefix for nginx/caddy/traefik (default: docker.io/library/)
#   PW_CHROMIUM_PATH            optional Chromium executable for Playwright
set -euo pipefail
cd "$(dirname "$0")/../.."

PROJECT=tikket-deploytest
NET=tikket_deploytest_proxy
ALIAS=tikket-app
IMAGE="${PROJECT}-tikket"
PREFIX="${PROXY_IMAGE_PREFIX:-docker.io/library/}"
WORK="$(mktemp -d)"
export COMPOSE_PROJECT_NAME=$PROJECT PROXY_NETWORK=$NET PROXY_ALIAS=$ALIAS
export ORIGIN=https://tikket.test:8443 ADDRESS_HEADER=X-Forwarded-For XFF_DEPTH=1
export SESSION_SECRET="$(head -c 48 /dev/urandom | base64 | tr -d '\n')"
COMPOSE=(docker compose -f compose.external-proxy.yml)

step() { printf '\n▶ %s\n' "$*"; }
ok() { printf '  ✓ %s\n' "$*"; }
fail() { printf '  ✗ %s\n' "$*" >&2; exit 1; }

cleanup() {
	docker rm -f tikket-deploytest-proxy >/dev/null 2>&1 || true
	"${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true   # test volumes only
	docker network rm $NET >/dev/null 2>&1 || true
	docker image rm "$IMAGE:upgrade" >/dev/null 2>&1 || true
	rm -rf "$WORK"
}
trap cleanup EXIT
cleanup >/dev/null 2>&1 || true
WORK="$(mktemp -d)"

wait_healthy() {
	local id; id=$("${COMPOSE[@]}" ps -q tikket)
	for _ in $(seq 1 60); do
		[ "$(docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null)" = healthy ] && return 0
		sleep 1
	done
	docker logs "$id" | tail -20; fail "container did not become healthy"
}

start_proxy() {
	local name=$1
	docker rm -f tikket-deploytest-proxy >/dev/null 2>&1 || true
	case $name in
		nginx) docker run -d --name tikket-deploytest-proxy --network $NET -p 127.0.0.1:8443:443 \
			-v "$PWD/tests/deployment/proxies/nginx.conf:/etc/nginx/nginx.conf:ro" -v "$WORK/certs:/certs:ro" "${PREFIX}nginx:1.27-alpine" >/dev/null ;;
		caddy) docker run -d --name tikket-deploytest-proxy --network $NET -p 127.0.0.1:8443:443 \
			-v "$PWD/tests/deployment/proxies/Caddyfile:/etc/caddy/Caddyfile:ro" -v "$WORK/certs:/certs:ro" "${PREFIX}caddy:2-alpine" >/dev/null ;;
		traefik) docker run -d --name tikket-deploytest-proxy --network $NET -p 127.0.0.1:8443:443 \
			-v "$PWD/tests/deployment/proxies/traefik.yml:/etc/traefik/traefik.yml:ro" \
			-v "$PWD/tests/deployment/proxies/traefik-dynamic.yml:/etc/traefik/dynamic.yml:ro" -v "$WORK/certs:/certs:ro" "${PREFIX}traefik:v3.1" >/dev/null ;;
	esac
	for _ in $(seq 1 30); do
		curl -sk --noproxy '*' --resolve tikket.test:8443:127.0.0.1 -o /dev/null https://tikket.test:8443/api/health && return 0
		sleep 1
	done
	docker logs tikket-deploytest-proxy | tail -20; fail "$name proxy did not come up"
}

step "Validate Compose files"
node scripts/check-compose.mjs

step "Build production image"
# shellcheck disable=SC2086
docker build ${TIKKET_DOCKER_BUILD_FLAGS:-} -t "$IMAGE" . >"$WORK/build.log" 2>&1 || { tail -30 "$WORK/build.log"; fail "image build failed"; }
ok "image $IMAGE built"

step "Start-up validation (container must refuse invalid configuration)"
set +e
out=$(docker run --rm "$IMAGE" 2>&1); code=$?
set -e
[ $code -ne 0 ] && grep -q "ORIGIN is not set" <<<"$out" && ok "missing ORIGIN → exit $code with clear message" || fail "missing ORIGIN not rejected: $out"
set +e
out=$(docker run --rm -e ORIGIN=https://x.example -e SESSION_SECRET=short "$IMAGE" 2>&1); code=$?
set -e
[ $code -ne 0 ] && grep -q "SESSION_SECRET must be at least 32" <<<"$out" && ok "weak SESSION_SECRET → exit $code" || fail "weak secret not rejected: $out"
mkdir -p "$WORK/rootowned" && chmod 755 "$WORK/rootowned"
set +e
out=$(docker run --rm --user 1000:1000 -v "$WORK/rootowned:/data" -e ORIGIN=https://x.example "$IMAGE" 2>&1); code=$?
set -e
if [ "$(stat -c %u "$WORK/rootowned")" != 1000 ]; then
	[ $code -ne 0 ] && grep -q "is not writable" <<<"$out" && ok "unwritable data directory → exit $code with clear message" || fail "unwritable data dir not reported: $out"
fi

step "Deploy with compose.external-proxy.yml on external network $NET"
docker network create $NET >/dev/null
"${COMPOSE[@]}" up -d --no-build >/dev/null
wait_healthy
ok "container healthy"
CID=$("${COMPOSE[@]}" ps -q tikket)
[ -z "$(docker port "$CID")" ] && ok "no host ports published" || fail "host ports published: $(docker port "$CID")"
[ "$(docker inspect -f '{{.Config.User}}' "$CID")" = node ] && ok "runs as non-root user 'node'" || fail "not running as node"
docker exec "$CID" sh -c 'touch /app/x 2>/dev/null' && fail "root filesystem is writable" || ok "root filesystem is read-only"
docker exec "$CID" sh -c 'touch /data/.probe /tmp/.probe && rm /data/.probe /tmp/.probe' && ok "/data and /tmp writable"
docker run --rm --network $NET "${PREFIX}nginx:1.27-alpine" wget -qO- "http://$ALIAS:3000/api/health" | grep -q ok && ok "reachable as http://$ALIAS:3000 from the shared network"

mkdir -p "$WORK/certs"
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=tikket.test" -addext "subjectAltName=DNS:tikket.test" \
	-keyout "$WORK/certs/key.pem" -out "$WORK/certs/cert.pem" >/dev/null 2>&1
chmod 644 "$WORK/certs/"*.pem

step "nginx (Nginx Proxy Manager-style) → Tikket"
start_proxy nginx
node tests/deployment/check.mjs full nginx

step "Re-create container (docker compose up --force-recreate)"
"${COMPOSE[@]}" up -d --no-build --force-recreate >/dev/null
wait_healthy
start_proxy caddy
step "Caddy → Tikket (after re-creation)"
node tests/deployment/check.mjs verify caddy

step "Backup and verification inside the running container (v0.7)"
docker exec "$CID" node scripts/backup.js /data/backups 3 >/dev/null && ok "online backup with metadata"
SNAP=$(docker exec "$CID" sh -c 'ls -1 /data/backups/tikket-*.db | tail -1')
docker exec "$CID" node scripts/backup-verify.js "$SNAP" --uploads /data/uploads >"$WORK/verify.txt" \
	&& grep -q 'Restorable: yes' "$WORK/verify.txt" && ok "backup:verify: restorable" || { cat "$WORK/verify.txt"; fail "backup:verify"; }
docker exec "$CID" node scripts/restore-verify.js "$SNAP" >"$WORK/restore.txt" \
	&& grep -q 'Dry-run restore' "$WORK/restore.txt" && ok "restore:verify: dry run on a temporary copy" || { cat "$WORK/restore.txt"; fail "restore:verify"; }
docker exec "$CID" node scripts/db-check.js >"$WORK/dbcheck.txt" && grep -q 'Integrity check: ok' "$WORK/dbcheck.txt" \
	&& ok "db:check: integrity ok" || { cat "$WORK/dbcheck.txt"; fail "db:check"; }

step "Simulated upgrade: new image ID, container replaced"
printf 'FROM %s\nLABEL org.tikket.test-upgrade="%s"\n' "$IMAGE" "$(date +%s)" | docker build -q -t "$IMAGE:upgrade" - >/dev/null
docker tag "$IMAGE:upgrade" "$IMAGE"
OLD=$CID
"${COMPOSE[@]}" up -d --no-build >/dev/null
wait_healthy
CID=$("${COMPOSE[@]}" ps -q tikket)
[ "$OLD" != "$CID" ] && ok "container replaced by upgraded image" || fail "container was not replaced"

step "docker compose down + up (volume must survive)"
"${COMPOSE[@]}" down >/dev/null
docker volume inspect "${PROJECT}_tikket-data" >/dev/null && ok "volume ${PROJECT}_tikket-data kept by 'down'"
"${COMPOSE[@]}" up -d --no-build >/dev/null
wait_healthy
step "Traefik → Tikket (after upgrade and down/up)"
start_proxy traefik
node tests/deployment/check.mjs verify traefik

step "Graceful shutdown"
"${COMPOSE[@]}" stop -t 30 tikket >/dev/null
code=$(docker inspect -f '{{.State.ExitCode}}' "$("${COMPOSE[@]}" ps -aq tikket)")
[ "$code" = 0 ] && ok "stopped cleanly on SIGTERM (exit 0)" || fail "exit code $code on stop"
docker run --rm -v "${PROJECT}_tikket-data:/data" "$IMAGE" node -e "
const D=require('better-sqlite3'); const db=new D('/data/tikket.db',{readonly:true});
const r=db.pragma('integrity_check',{simple:true}); if(r!=='ok') {console.error(r); process.exit(1)}
console.log('  ✓ integrity_check ok, tickets:', db.prepare('select count(*) n from tickets').get().n)"

step "Standalone compose.yml + compose.local-port.yml (loopback-only host port)"
"${COMPOSE[@]}" down >/dev/null
LOCAL=(docker compose -p ${PROJECT}-local -f compose.yml -f compose.local-port.yml)
docker tag "$IMAGE" "${PROJECT}-local-tikket"
HOST_PORT=38080 "${LOCAL[@]}" up -d --no-build --wait >/dev/null 2>&1
curl -s --noproxy '*' http://127.0.0.1:38080/api/health | grep -q ok && ok "health on http://127.0.0.1:38080" || fail "local port not reachable"
binding=$(docker port "$(HOST_PORT=38080 "${LOCAL[@]}" ps -q tikket)" 3000)
[ "$binding" = "127.0.0.1:38080" ] && ok "published on loopback only ($binding)" || fail "unexpected binding: $binding"
HOST_PORT=38080 "${LOCAL[@]}" down -v >/dev/null 2>&1
docker image rm "${PROJECT}-local-tikket" >/dev/null 2>&1 || true

printf '\nAll deployment checks passed.\n'
