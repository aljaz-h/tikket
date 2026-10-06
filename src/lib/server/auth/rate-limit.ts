/**
 * Small in-memory fixed-window rate limiter. Tikket runs as a single instance,
 * so process memory is an appropriate store.
 */
interface Bucket {
	count: number;
	resetAt: number;
}

export class RateLimiter {
	private buckets = new Map<string, Bucket>();

	constructor(
		private readonly limit: number,
		private readonly windowMs: number
	) {}

	/** Returns the remaining wait in ms when limited, otherwise 0. */
	check(key: string, now = Date.now()): number {
		const bucket = this.buckets.get(key);
		if (!bucket || bucket.resetAt <= now) return 0;
		return bucket.count >= this.limit ? bucket.resetAt - now : 0;
	}

	hit(key: string, now = Date.now()): number {
		this.sweep(now);
		let bucket = this.buckets.get(key);
		if (!bucket || bucket.resetAt <= now) {
			bucket = { count: 0, resetAt: now + this.windowMs };
			this.buckets.set(key, bucket);
		}
		bucket.count += 1;
		return bucket.count > this.limit ? bucket.resetAt - now : 0;
	}

	reset(key: string) {
		this.buckets.delete(key);
	}

	clear() {
		this.buckets.clear();
	}

	private lastSweep = 0;
	private sweep(now: number) {
		if (now - this.lastSweep < 60_000) return;
		this.lastSweep = now;
		for (const [key, bucket] of this.buckets) if (bucket.resetAt <= now) this.buckets.delete(key);
	}
}

const FIFTEEN_MINUTES = 15 * 60 * 1000;

export const limiters = {
	/** Failed logins per account identifier. */
	loginAccount: new RateLimiter(Number(process.env.LOGIN_RATE_LIMIT ?? 10), FIFTEEN_MINUTES),
	/** All login attempts per client IP. */
	loginIp: new RateLimiter(Number(process.env.LOGIN_RATE_LIMIT ?? 10) * 3, FIFTEEN_MINUTES),
	/** Registration, setup and invitation acceptance per IP. */
	signup: new RateLimiter(10, 60 * 60 * 1000),
	/** Password changes per user. */
	password: new RateLimiter(10, FIFTEEN_MINUTES),
	/** Uploads per user. */
	upload: new RateLimiter(120, 10 * 60 * 1000),
	/** Content creation (tickets / comments) per user. */
	write: new RateLimiter(60, 10 * 60 * 1000)
};

export function resetAllLimiters() {
	for (const limiter of Object.values(limiters)) limiter.clear();
}

export function formatWait(ms: number): string {
	const minutes = Math.ceil(ms / 60000);
	return minutes <= 1 ? 'a minute' : `${minutes} minutes`;
}
