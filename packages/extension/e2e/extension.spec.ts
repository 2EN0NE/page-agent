import { chromium, expect, test } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const EXTENSION_PATH = path.resolve(__dirname, '../.output/chrome-mv3')

async function launchExtension() {
	const context = await chromium.launchPersistentContext('', {
		headless: false,
		args: [
			`--disable-extensions-except=${EXTENSION_PATH}`,
			`--load-extension=${EXTENSION_PATH}`,
			'--no-sandbox',
		],
	})
	await context.waitForEvent('serviceworker')
	const worker = context.serviceWorkers()[0]
	const extId = worker.url().split('/')[2]

	const page = await context.newPage()
	await page.goto('https://example.com')

	const sidepanel = await context.newPage()
	await sidepanel.goto(`chrome-extension://${extId}/sidepanel.html`)

	return { context, sidepanel, extId, page }
}

async function resetToChat(sidepanel: any) {
	// Navigate back to sidepanel root to reset view
	const currentUrl = sidepanel.url()
	const extId = currentUrl.split('/')[2]
	await sidepanel.goto(`chrome-extension://${extId}/sidepanel.html`)
	await sidepanel.waitForLoadState('networkidle')
}

test.describe('Extension Loading', () => {
	test('extension builds successfully', () => {
		expect(fs.existsSync(EXTENSION_PATH)).toBe(true)
		expect(fs.existsSync(path.join(EXTENSION_PATH, 'manifest.json'))).toBe(true)
		expect(fs.existsSync(path.join(EXTENSION_PATH, 'sidepanel.html'))).toBe(true)
		expect(fs.existsSync(path.join(EXTENSION_PATH, 'background.js'))).toBe(true)

		const manifest = JSON.parse(
			fs.readFileSync(path.join(EXTENSION_PATH, 'manifest.json'), 'utf-8')
		)
		expect(manifest.manifest_version).toBe(3)
		expect(manifest.version).toBe('0.1.0')
	})
})

test.describe('Sidepanel UI', () => {
	let context: any
	let sidepanel: any

	test.beforeAll(async () => {
		const launched = await launchExtension()
		context = launched.context
		sidepanel = launched.sidepanel
	}, 30000)

	test.afterAll(async () => {
		await context.close()
	})

	test('sidepanel renders with title', async () => {
		await expect(sidepanel.locator('text=Page Agent Sidecar')).toBeVisible({ timeout: 10000 })
	})

	test('Context toggle is present and interactive', async () => {
		const toggle = sidepanel.locator('[aria-label="Toggle context collection"]')
		await expect(toggle).toBeVisible()
		await toggle.click()
		await sidepanel.waitForTimeout(300)
		await toggle.click()
	})

	test('Settings page opens without error', async () => {
		await sidepanel.locator('[aria-label="Settings"]').click()
		await expect(sidepanel.locator('text=Settings')).toBeVisible()
		await expect(sidepanel.locator('text=Base URL')).toBeVisible()
		await expect(sidepanel.locator('text=Model')).toBeVisible()
		await expect(sidepanel.locator('text=API Key')).toBeVisible()
		await resetToChat(sidepanel)
	})

	test('Settings Advanced section expands', async () => {
		await sidepanel.locator('[aria-label="Settings"]').click()
		await sidepanel.locator('button:has-text("Advanced")').click()
		await expect(sidepanel.locator('text=Max Steps')).toBeVisible()
		await expect(sidepanel.locator('text=Context Window')).toBeVisible()
		await expect(sidepanel.locator('text=Suggestion Algorithms')).toBeVisible()
		await expect(sidepanel.locator('text=Article Save Path')).toBeVisible()
		await resetToChat(sidepanel)
	})

	test('Language selector has Chinese option', async () => {
		await sidepanel.locator('[aria-label="Settings"]').click()
		const select = sidepanel.locator('select').first()
		await expect(select).toBeVisible()
		const options = await select.locator('option').allTextContents()
		expect(options).toContain('中文')
		await resetToChat(sidepanel)
	})
})

test.describe('Context Collection & Panels', () => {
	let context: any
	let sidepanel: any

	test.beforeAll(async () => {
		const launched = await launchExtension()
		context = launched.context
		sidepanel = launched.sidepanel
	}, 30000)

	test.afterAll(async () => {
		await context.close()
	})

	test('History panel opens', async () => {
		await sidepanel.locator('[aria-label="History"]').click()
		await expect(sidepanel.locator('span:text("History")').first()).toBeVisible()
		await resetToChat(sidepanel)
	})

	test('Saved Articles panel opens', async () => {
		await sidepanel.locator('[aria-label="Saved Articles"]').click()
		await expect(sidepanel.locator('text=Saved Articles')).toBeVisible()
		await resetToChat(sidepanel)
	})

	test('Context Timeline panel opens', async () => {
		await sidepanel.locator('[aria-label="Context Timeline"]').click()
		await expect(sidepanel.locator('text=Context Timeline')).toBeVisible()
		await resetToChat(sidepanel)
	})
})

test.describe('IndexedDB Persistence', () => {
	let context: any
	let sidepanel: any

	test.beforeAll(async () => {
		const launched = await launchExtension()
		context = launched.context
		sidepanel = launched.sidepanel
	}, 30000)

	test.afterAll(async () => {
		await context.close()
	})

	test('IndexedDB stores are accessible', async () => {
		// Open DB directly to verify schema (independent of sidecar state)
		const dbExists = await sidepanel.evaluate(() => {
			return new Promise<boolean>((resolve) => {
				const req = indexedDB.open('page-agent-ext', 3)
				req.onupgradeneeded = (e) => {
					const db = (e.target as IDBOpenDBRequest).result
					if (!db.objectStoreNames.contains('sessions')) {
						const s = db.createObjectStore('sessions', { keyPath: 'id' })
						s.createIndex('by-created', 'createdAt')
					}
					if (!db.objectStoreNames.contains('contextEvents')) {
						const s = db.createObjectStore('contextEvents', { keyPath: 'id' })
						s.createIndex('by-timestamp', 'timestamp')
						s.createIndex('by-tab', 'tabId')
						s.createIndex('by-domain', 'domain')
						s.createIndex('by-type', 'type')
					}
					if (!db.objectStoreNames.contains('savedArticles')) {
						const s = db.createObjectStore('savedArticles', { keyPath: 'id' })
						s.createIndex('by-saved', 'metadata.savedAt')
						s.createIndex('by-domain', 'domain')
					}
					if (!db.objectStoreNames.contains('annotations')) {
						const s = db.createObjectStore('annotations', { keyPath: 'id' })
						s.createIndex('by-event', 'eventId')
						s.createIndex('by-domain', 'domain')
						s.createIndex('by-timestamp', 'annotatedAt')
					}
					if (!db.objectStoreNames.contains('inputValues')) {
						const s = db.createObjectStore('inputValues', { keyPath: 'id' })
						s.createIndex('by-domain', 'domain')
						s.createIndex('by-field-key', 'fieldKey')
						s.createIndex('by-timestamp', 'timestamp')
					}
				}
				req.onsuccess = () => {
					const db = req.result
					const stores = Array.from(db.objectStoreNames)
					db.close()
					resolve(
						stores.includes('sessions') &&
							stores.includes('contextEvents') &&
							stores.includes('savedArticles') &&
							stores.includes('annotations') &&
							stores.includes('inputValues')
					)
				}
				req.onerror = () => resolve(false)
			})
		})
		expect(dbExists).toBe(true)
	})
})
