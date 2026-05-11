/**
 * SidecarE2ETest - Automated end-to-end validation of the sidecar pipeline.
 * Runs in content script on startup to catch integration issues early.
 */
import {
	type ContextEventRecord,
	clearOldContextEvents,
	queryContextEvents,
	saveContextEvents,
} from '@/lib/db'

import { ContextObserver } from './ContextObserver'
import { ReadingDetector } from './ReadingDetector'
import {
	SemanticFrequencyAlgorithm,
	generateColdStartSuggestions,
} from './SuggestionEngine'

const TEST_TAG = '[SidecarE2ETest]'

interface TestResult {
	name: string
	pass: boolean
	error?: string
	durationMs: number
}

async function runTest(name: string, fn: () => Promise<void>): Promise<TestResult> {
	const start = performance.now()
	try {
		await fn()
		return { name, pass: true, durationMs: Math.round(performance.now() - start) }
	} catch (err) {
		return {
			name,
			pass: false,
			error: err instanceof Error ? err.message : String(err),
			durationMs: Math.round(performance.now() - start),
		}
	}
}

export async function runSidecarE2ETest(): Promise<void> {
	console.log(`${TEST_TAG} Starting end-to-end self-test...`)
	const results: TestResult[] = []

	// ── Test 1: IndexedDB write/read cycle ──
	results.push(
		await runTest('IndexedDB write + read', async () => {
			const testEvent: ContextEventRecord = {
				id: `test-${Date.now()}`,
				tabId: 999,
				url: 'https://test.example.com',
				title: 'Test Page',
				domain: 'test.example.com',
				type: 'click',
				timestamp: Date.now(),
				data: { test: true },
			}
			await saveContextEvents([testEvent])
			const events = await queryContextEvents({ windowMs: 60_000, limit: 10 })
			const found = events.some((e) => e.id === testEvent.id)
			if (!found) throw new Error('Written event not found in query results')
		})
	)

	// ── Test 2: ContextObserver records events ──
	results.push(
		await runTest('ContextObserver event recording', async () => {
			const observer = new ContextObserver(998, { enabled: true })
			observer.record('scroll', { testScroll: true })
			// Wait for micro-flush
			await new Promise((r) => setTimeout(r, 500))
			const events = await queryContextEvents({ windowMs: 60_000, limit: 10 })
			const found = events.some((e) => e.type === 'scroll' && e.data.testScroll === true)
			observer.dispose()
			if (!found) throw new Error('Observer event not persisted')
		})
	)

	// ── Test 3: ReadingDetector scoring ──
	results.push(
		await runTest('ReadingDetector score calculation', async () => {
			const observer = new ContextObserver(997, { enabled: true })
			const detector = new ReadingDetector(observer)
			const score = detector.getScore()
			detector.dispose()
			observer.dispose()
			if (typeof score.score !== 'number') throw new Error('Score is not a number')
			if (typeof score.wordCount !== 'number') throw new Error('WordCount is not a number')
		})
	)

	// ── Test 4: Time window filtering ──
	results.push(
		await runTest('Time window filtering', async () => {
			// Write an old event (simulated)
			const oldEvent: ContextEventRecord = {
				id: `old-${Date.now()}`,
				tabId: 996,
				url: 'https://old.example.com',
				title: 'Old',
				domain: 'old.example.com',
				type: 'mutation',
				timestamp: Date.now() - 10 * 60 * 1000, // 10 min ago
				data: {},
			}
			await saveContextEvents([oldEvent])

			// Query with 5 min window — should NOT include old event
			const recent = await queryContextEvents({ windowMs: 5 * 60 * 1000, limit: 100 })
			const foundOld = recent.some((e) => e.id === oldEvent.id)
			if (foundOld) throw new Error('Old event leaked through 5min window')

			// Query with 15 min window — SHOULD include old event
			const wide = await queryContextEvents({ windowMs: 15 * 60 * 1000, limit: 100 })
			const foundWide = wide.some((e) => e.id === oldEvent.id)
			if (!foundWide) throw new Error('Old event missing in 15min window')
		})
	)

	// ── Test 5: Clear all events ──
	results.push(
		await runTest('Clear all events', async () => {
			await clearOldContextEvents()
			const events = await queryContextEvents({ windowMs: 24 * 60 * 60 * 1000, limit: 1000 })
			if (events.length > 0) throw new Error(`Expected 0 events after clear, got ${events.length}`)
		})
	)

	// ── Test 6: Bigram Jaccard matching ──
	results.push(
		await runTest('Bigram Jaccard field matching', async () => {
			const algo = new SemanticFrequencyAlgorithm()
			const field = {
				tagName: 'INPUT',
				type: 'email',
				name: 'work_email',
				label: 'Work Email',
				placeholder: undefined,
			}
			const history = [
				{
					id: 'hist-1',
					domain: 'example.com',
					fieldKey: 'email_address|email',
					fieldLabel: 'Email Address',
					fieldName: 'email',
					fieldPlaceholder: '',
					fieldType: 'email',
					value: 'alice@example.com',
					timestamp: Date.now(),
					useCount: 3,
				},
			]
			const items = algo.compute(field, '', history as any, 3)
			if (items.length === 0) throw new Error('Bigram match failed: expected at least 1 suggestion')
			const top = items[0]
			if (top.value !== 'alice@example.com') throw new Error(`Expected alice@example.com, got ${top.value}`)
			if (top.confidence < 0.3) throw new Error(`Confidence too low: ${top.confidence}`)
		})
	)

	// ── Test 7: Cold-start fallback ──
	results.push(
		await runTest('Cold-start fallback suggestions', async () => {
			const field = {
				tagName: 'INPUT',
				type: 'email' as const,
				name: 'email',
				label: 'Email',
				placeholder: 'your.email@company.com',
			}
			const suggestions = generateColdStartSuggestions(field)
			if (suggestions.length === 0) throw new Error('Expected cold-start suggestions for email field')
			const placeholderHint = suggestions.find((s) => s.value === 'your.email@company.com')
			if (!placeholderHint) throw new Error('Placeholder hint missing')
			const emailTemplate = suggestions.find((s) => s.value === 'user@example.com')
			if (!emailTemplate) throw new Error('Email template missing')
			if (emailTemplate.confidence >= placeholderHint.confidence)
				throw new Error('Email template confidence should be lower than placeholder hint')
		})
	)

	// ── Report ──
	const passed = results.filter((r) => r.pass).length
	const failed = results.filter((r) => !r.pass).length
	console.group(`${TEST_TAG} Results: ${passed}/${results.length} passed`)
	for (const r of results) {
		const icon = r.pass ? '✅' : '❌'
		console.log(`${icon} ${r.name} (${r.durationMs}ms)${r.error ? ` — ${r.error}` : ''}`)
	}
	console.groupEnd()

	if (failed > 0) {
		console.error(`${TEST_TAG} ${failed} test(s) FAILED — sidecar may be broken`)
	} else {
		console.log(`${TEST_TAG} All tests passed — sidecar pipeline healthy`)
	}
}
