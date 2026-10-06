import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Every test worker gets an isolated data directory (database, uploads, secret).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tikket-test-'));
process.env.DATA_DIR = dir;
process.env.SESSION_SECRET = 'test-secret-that-is-long-enough-for-hmac-usage-1234';
process.env.VITEST = 'true';
