import { defineConfig, devices } from '@playwright/test'
import path from 'path'

/**
 * Playwright config for testing the Page Agent Sidecar Chrome extension.
 *
 * Uses Chromium with --load-extension to load the built extension.
 * Tests cover: sidepanel UI, settings, context collection, article saving, history.
 */
export default defineConfig({
	testDir: './e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: 'list',
	use: {
		trace: 'on-first-retry',
		actionTimeout: 10_000,
	},
	projects: [
		{
			name: 'chromium-extension',
			use: {
				...devices['Desktop Chrome'],
				// Launch args for loading the unpacked extension
				launchOptions: {
					args: [
						`--disable-extensions-except=${path.resolve('.output/chrome-mv3')}`,
						`--load-extension=${path.resolve('.output/chrome-mv3')}`,
						'--no-sandbox',
					],
				},
			},
		},
	],
})
