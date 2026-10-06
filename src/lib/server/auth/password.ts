import { hash, verify } from '@node-rs/argon2';

// OWASP-recommended Argon2id parameters (19 MiB memory, 2 iterations, 1 lane).
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 256;

export function hashPassword(password: string): Promise<string> {
	return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
	try {
		return await verify(passwordHash, password);
	} catch {
		return false;
	}
}

/** A fixed hash used to equalise timing when the account does not exist. */
let dummyHash: Promise<string> | null = null;
export async function verifyDummy(password: string) {
	dummyHash ??= hashPassword('tikket-dummy-password-for-timing');
	await verifyPassword(await dummyHash, password);
	return false;
}
