import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
	testDir: 'e2e',
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 60_000,
	expect: { timeout: 10_000 },
	reporter: [['list']],
	use: {
		baseURL: `http://localhost:${PORT}`,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		launchOptions: { executablePath }
	},
	projects: [
		{ name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { executablePath } } }
	],
	webServer: {
		command: `rm -rf e2e/.data && node build`,
		port: PORT,
		reuseExistingServer: false,
		timeout: 60_000,
		env: {
			PORT: String(PORT),
			HOST: '127.0.0.1',
			ORIGIN: `http://localhost:${PORT}`,
			DATA_DIR: 'e2e/.data',
			LOGIN_RATE_LIMIT: '1000',
			BODY_SIZE_LIMIT: '20M',
			NODE_ENV: 'production'
		}
	}
});
