import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

/**
 * Outbound HTTP to user-supplied URLs: project website icons, Discord and generic webhooks,
 * GitHub API calls.
 *
 * SSRF protections:
 * - only http/https, no credentials in URLs; icon fetching is limited to ports 80/443;
 * - every hostname is resolved and *all* addresses must be public: loopback, private, link-local
 *   (incl. cloud metadata 169.254.169.254), CGNAT, multicast, reserved, IPv4-mapped/NAT64 forms
 *   and unique-local IPv6 are refused;
 * - the connection is pinned to the validated address (no second DNS lookup → no rebinding);
 * - redirects are followed manually (max 3) and every hop is validated again;
 * - strict timeouts and response-size limits; responses are buffered, never streamed elsewhere.
 *
 * Private destinations can be allowed for webhooks only with OUTBOUND_ALLOW_PRIVATE_NETWORKS=true
 * (an explicit administrator decision). Even then, link-local addresses (cloud metadata
 * services) and the unspecified address stay blocked.
 */

export class FetchError extends Error {}

function ipv4ToInt(ip: string) {
	return ip.split('.').reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;
}
const V4_BLOCKED: [string, number][] = [
	['0.0.0.0', 8],
	['10.0.0.0', 8],
	['100.64.0.0', 10],
	['127.0.0.0', 8],
	['169.254.0.0', 16],
	['172.16.0.0', 12],
	['192.0.0.0', 24],
	['192.0.2.0', 24],
	['192.88.99.0', 24],
	['192.168.0.0', 16],
	['198.18.0.0', 15],
	['198.51.100.0', 24],
	['203.0.113.0', 24],
	['224.0.0.0', 4],
	['240.0.0.0', 4]
];

export function isPublicAddress(address: string): boolean {
	if (net.isIPv4(address)) {
		const n = ipv4ToInt(address);
		return !V4_BLOCKED.some(([base, bits]) => {
			const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
			return (n & mask) === (ipv4ToInt(base) & mask);
		});
	}
	if (net.isIPv6(address)) {
		const a = address.toLowerCase();
		// IPv4-mapped / -compatible / NAT64 forms: judge the embedded IPv4 address.
		const embedded = /^(?:::ffff:|::|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(a);
		if (embedded) return isPublicAddress(embedded[1]);
		const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(a);
		if (hex) {
			const hi = parseInt(hex[1], 16);
			const lo = parseInt(hex[2], 16);
			return isPublicAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
		}
		// Everything else in ::/96 (unspecified, loopback, IPv4-compatible) is not public.
		if (a.startsWith('::')) return false;
		const first = parseInt(a.split(':')[0] || '0', 16);
		if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
		if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 link local
		if ((first & 0xff00) === 0xff00) return false; // multicast
		if (a.startsWith('2001:db8') || a.startsWith('::ffff:')) return false;
		return true;
	}
	return false;
}

/** Link-local (incl. 169.254.169.254 metadata) and unspecified addresses: never reachable. */
export function isAlwaysBlocked(address: string): boolean {
	if (net.isIPv4(address)) return address.startsWith('169.254.') || address.startsWith('0.');
	const a = address.toLowerCase();
	if (a === '::' || /^fe[89ab]/.test(a)) return true;
	const embedded = /^(?:::ffff:)(\d+\.\d+\.\d+\.\d+)$/.exec(a);
	return embedded ? isAlwaysBlocked(embedded[1]) : a === 'fd00:ec2::254';
}

export interface UrlPolicy {
	/** Allow any port (webhooks); otherwise only 80/443. */
	anyPort?: boolean;
	/** Allow private/loopback destinations (only with the administrator opt-in). */
	allowPrivate?: boolean;
}

/** True when the administrator explicitly allowed webhooks to private networks. */
export function privateNetworksAllowed() {
	return process.env.OUTBOUND_ALLOW_PRIVATE_NETWORKS === 'true';
}

function addressAllowed(address: string, policy: UrlPolicy) {
	if (isAlwaysBlocked(address)) return false;
	return policy.allowPrivate ? net.isIP(address) !== 0 : isPublicAddress(address);
}

/** Validates scheme, port and host syntax of a URL we are about to fetch. */
export function checkUrl(raw: string | URL, policy: UrlPolicy = {}): URL {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new FetchError('That is not a valid web address.');
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:')
		throw new FetchError('Only http and https addresses can be used.');
	if (url.username || url.password)
		throw new FetchError('Addresses with credentials are not allowed.');
	if (!policy.anyPort && url.port && url.port !== '80' && url.port !== '443')
		throw new FetchError('Only the standard web ports (80 and 443) are allowed.');
	const host = url.hostname.replace(/^\[|\]$/g, '');
	if (!host || host === 'metadata.google.internal')
		throw new FetchError('That address is not publicly reachable.');
	if (
		!policy.allowPrivate &&
		(host === 'localhost' ||
			host.endsWith('.localhost') ||
			host.endsWith('.local') ||
			host.endsWith('.internal'))
	)
		throw new FetchError('That address is not publicly reachable.');
	if (net.isIP(host) && !addressAllowed(host, policy))
		throw new FetchError('That address is not publicly reachable.');
	return url;
}

export type Resolver = (host: string) => Promise<string[]>;
const systemResolver: Resolver = async (host) =>
	(await dns.promises.lookup(host, { all: true, verbatim: true })).map((r) => r.address);

/** Resolves a host and returns one validated public address (all must be public). */
export async function resolvePublic(
	host: string,
	resolve: Resolver = systemResolver,
	policy: UrlPolicy = {}
) {
	const bare = host.replace(/^\[|\]$/g, '');
	if (net.isIP(bare)) {
		if (!addressAllowed(bare, policy))
			throw new FetchError('That address is not publicly reachable.');
		return bare;
	}
	let addresses: string[];
	try {
		addresses = await resolve(bare);
	} catch {
		throw new FetchError(`Could not find the website ${bare}.`);
	}
	if (!addresses.length || addresses.some((a) => !addressAllowed(a, policy)))
		throw new FetchError('That website resolves to a private or reserved address.');
	return addresses[0];
}

export interface SafeResponse {
	url: URL;
	status: number;
	contentType: string;
	body: Buffer;
	headers: http.IncomingHttpHeaders;
}

interface Options extends UrlPolicy {
	maxBytes: number;
	timeoutMs?: number;
	accept?: string;
	resolve?: Resolver;
	method?: 'GET' | 'POST';
	body?: string | Buffer;
	headers?: Record<string, string>;
}

function requestOnce(
	url: URL,
	address: string,
	opts: Options
): Promise<SafeResponse & { location?: string }> {
	return new Promise((resolvePromise, reject) => {
		const lib = url.protocol === 'https:' ? https : http;
		const req = lib.request(
			{
				protocol: url.protocol,
				hostname: url.hostname,
				port: url.port || (url.protocol === 'https:' ? 443 : 80),
				path: `${url.pathname}${url.search}`,
				method: opts.method ?? 'GET',
				headers: {
					accept: opts.accept ?? '*/*',
					'user-agent': 'Tikket/1.0',
					...opts.headers,
					...(opts.body !== undefined
						? { 'content-length': String(Buffer.byteLength(opts.body)) }
						: {})
				},
				// Pin the connection to the address we validated (TLS still verifies the hostname).
				lookup: (_host, _options, callback) =>
					(callback as (err: null, address: string, family: number) => void)(
						null,
						address,
						net.isIPv6(address) ? 6 : 4
					),
				timeout: opts.timeoutMs ?? 5000,
				agent: false
			},
			(res) => {
				const status = res.statusCode ?? 0;
				if (status >= 300 && status < 400 && res.headers.location) {
					res.resume();
					resolvePromise({
						url,
						status,
						contentType: '',
						body: Buffer.alloc(0),
						headers: res.headers,
						location: res.headers.location
					});
					return;
				}
				const declared = Number(res.headers['content-length'] ?? 0);
				if (declared > opts.maxBytes) {
					res.destroy();
					reject(new FetchError('The response is too large.'));
					return;
				}
				const chunks: Buffer[] = [];
				let size = 0;
				res.on('data', (chunk: Buffer) => {
					size += chunk.length;
					if (size > opts.maxBytes) {
						res.destroy();
						reject(new FetchError('The response is too large.'));
						return;
					}
					chunks.push(chunk);
				});
				res.on('end', () =>
					resolvePromise({
						url,
						status,
						contentType: String(res.headers['content-type'] ?? '').toLowerCase(),
						body: Buffer.concat(chunks),
						headers: res.headers
					})
				);
				res.on('error', reject);
			}
		);
		req.on('timeout', () => req.destroy(new FetchError('The website took too long to answer.')));
		req.on('error', (err) =>
			reject(err instanceof FetchError ? err : new FetchError('The website could not be reached.'))
		);
		req.end(opts.body);
	});
}

/**
 * One request with SSRF protections and no redirect following (webhooks): any status is
 * returned to the caller; a redirect is reported as its 3xx status and never followed.
 */
export async function safeRequest(raw: string | URL, opts: Options): Promise<SafeResponse> {
	const url = checkUrl(raw, opts);
	const address = await resolvePublic(url.hostname, opts.resolve, opts);
	const { location: _location, ...res } = await requestOnce(url, address, opts);
	return res;
}

/** GET a public URL with SSRF protections, following at most three validated redirects. */
export async function safeFetch(raw: string | URL, opts: Options): Promise<SafeResponse> {
	let url = checkUrl(raw, opts);
	for (let hop = 0; hop <= 3; hop++) {
		const address = await resolvePublic(url.hostname, opts.resolve, opts);
		const res = await requestOnce(url, address, opts);
		if (res.location) {
			url = checkUrl(new URL(res.location, url), opts);
			continue;
		}
		if (res.status < 200 || res.status >= 300)
			throw new FetchError(`The website answered with status ${res.status}.`);
		return res;
	}
	throw new FetchError('Too many redirects.');
}
