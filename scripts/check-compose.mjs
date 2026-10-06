// Validates every Compose variant and asserts that compose.external-proxy.yml stays identical to
// compose.yml apart from the proxy network. Run with: npm run check:compose  (needs Docker Compose)
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const env = {
	...process.env,
	ORIGIN: 'https://tikket.example.com',
	PROXY_NETWORK: 'proxy_shared',
	PROXY_ALIAS: 'tikket',
	HOST_PORT: '3000',
	TIKKET_IMAGE: '',
	COMPOSE_PROJECT_NAME: 'tikket-check'
};
const config = (...files) =>
	JSON.parse(
		execFileSync(
			'docker',
			['compose', ...files.flatMap((f) => ['-f', f]), 'config', '--format', 'json'],
			{ env, encoding: 'utf8' }
		)
	);

const base = config('compose.yml');
const external = config('compose.external-proxy.yml');
const local = config('compose.yml', 'compose.local-port.yml');
const ghcr = config('compose.yml', 'compose.ghcr.yml');

const svc = base.services.tikket;
assert.ok(!svc.ports?.length, 'compose.yml must not publish host ports');
assert.ok(!svc.container_name, 'compose.yml must not set container_name');
assert.ok(!base.name || base.name === 'tikket-check', 'compose.yml must not fix the project name');
assert.ok(
	!Object.keys(svc.labels ?? {}).some((l) => l.startsWith('traefik.')),
	'no Traefik labels'
);
assert.equal(svc.read_only, true);
assert.ok(svc.healthcheck?.test, 'healthcheck required');
assert.ok(
	svc.volumes.some((v) => v.target === '/data' && v.type === 'volume'),
	'persistent /data volume'
);

// The external-proxy variant must equal the base definition apart from networks.
const strip = (c) => {
	const copy = structuredClone(c);
	delete copy.networks;
	delete copy.services.tikket.networks;
	return copy;
};
assert.deepEqual(
	strip(external),
	strip(base),
	'compose.external-proxy.yml drifted from compose.yml'
);
assert.equal(external.networks.proxy.external, true);
assert.equal(external.networks.proxy.name, 'proxy_shared');
assert.ok(external.services.tikket.networks.proxy.aliases.includes('tikket'));

assert.deepEqual(
	local.services.tikket.ports.map((p) => [p.host_ip, p.published, p.target]),
	[['127.0.0.1', '3000', 3000]]
);
assert.ok(!ghcr.services.tikket.build && ghcr.services.tikket.image.startsWith('ghcr.io/'));

// ORIGIN is mandatory.
let failed = false;
try {
	execFileSync('docker', ['compose', '-f', 'compose.yml', 'config', '-q'], {
		env: { ...env, ORIGIN: '' },
		stdio: 'pipe'
	});
} catch {
	failed = true;
}
assert.ok(failed, 'compose must refuse to start without ORIGIN');

console.log(
	'Compose files OK: compose.yml, compose.external-proxy.yml, compose.local-port.yml, compose.ghcr.yml'
);
