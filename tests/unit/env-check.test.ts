import { describe, expect, it } from 'vitest';
import { validateEnvironment } from '../../src/lib/server/env-check';

const prod = {
	NODE_ENV: 'production',
	ORIGIN: 'https://tikket.example.com',
	SESSION_SECRET: 'a'.repeat(20) + 'b'.repeat(20),
	BODY_SIZE_LIMIT: '25M',
	MAX_UPLOAD_SIZE: '10M'
};

describe('validateEnvironment', () => {
	it('accepts a correct production configuration', () => {
		expect(validateEnvironment(prod)).toEqual({ errors: [], warnings: [] });
	});

	it('requires ORIGIN in production and rejects paths, trailing slashes and bad schemes', () => {
		expect(validateEnvironment({ ...prod, ORIGIN: undefined }).errors[0]).toMatch(
			/ORIGIN is not set/
		);
		expect(validateEnvironment({ ...prod, ORIGIN: 'https://x.example/tikket' }).errors[0]).toMatch(
			/without a path/
		);
		expect(validateEnvironment({ ...prod, ORIGIN: 'https://x.example/' }).errors[0]).toMatch(
			/trailing slash/
		);
		expect(validateEnvironment({ ...prod, ORIGIN: 'ftp://x.example' }).errors[0]).toMatch(
			/not a valid/
		);
		expect(validateEnvironment({ NODE_ENV: 'development' }).errors).toEqual([]);
	});

	it('warns about plain-HTTP public origins but not localhost', () => {
		expect(
			validateEnvironment({ ...prod, ORIGIN: 'http://tikket.example.com' }).warnings[0]
		).toMatch(/plain HTTP/);
		expect(validateEnvironment({ ...prod, ORIGIN: 'http://localhost:3000' }).warnings).toEqual([]);
	});

	it('never accepts weak or placeholder session secrets', () => {
		expect(validateEnvironment({ ...prod, SESSION_SECRET: 'short' }).errors[0]).toMatch(
			/at least 32/
		);
		expect(
			validateEnvironment({ ...prod, SESSION_SECRET: 'change-me-to-a-long-random-string-please' })
				.errors[0]
		).toMatch(/placeholder/);
		expect(validateEnvironment({ ...prod, SESSION_SECRET: '' }).warnings[0]).toMatch(
			/generated once/
		);
	});

	it('validates trusted proxy settings', () => {
		expect(
			validateEnvironment({ ...prod, ADDRESS_HEADER: 'X-Forwarded-For', XFF_DEPTH: '0' }).errors[0]
		).toMatch(/XFF_DEPTH/);
		expect(validateEnvironment({ ...prod, ADDRESS_HEADER: 'bad header!' }).errors[0]).toMatch(
			/not a valid header/
		);
		expect(
			validateEnvironment({ ...prod, ADDRESS_HEADER: 'X-Forwarded-For', XFF_DEPTH: '2' }).errors
		).toEqual([]);
		expect(validateEnvironment({ ...prod, HOST_HEADER: 'x-forwarded-host' }).warnings[0]).toMatch(
			/ignored/
		);
	});

	it('checks that the request body limit fits the upload limit', () => {
		expect(validateEnvironment({ ...prod, BODY_SIZE_LIMIT: '1M' }).errors[0]).toMatch(
			/BODY_SIZE_LIMIT/
		);
		expect(validateEnvironment({ ...prod, BODY_SIZE_LIMIT: undefined }).warnings[0]).toMatch(
			/BODY_SIZE_LIMIT/
		);
		expect(validateEnvironment({ ...prod, BODY_SIZE_LIMIT: 'Infinity' }).errors).toEqual([]);
		expect(validateEnvironment({ ...prod, MAX_UPLOAD_SIZE: 'lots' }).errors[0]).toMatch(
			/MAX_UPLOAD_SIZE/
		);
		expect(validateEnvironment({ ...prod, PORT: '99999' }).errors[0]).toMatch(/PORT/);
	});

	it('flags APP_URL problems', () => {
		expect(validateEnvironment({ ...prod, APP_URL: 'not a url' }).errors[0]).toMatch(/APP_URL/);
		expect(validateEnvironment({ ...prod, APP_URL: 'https://other.example' }).warnings[0]).toMatch(
			/differs/
		);
	});
});
