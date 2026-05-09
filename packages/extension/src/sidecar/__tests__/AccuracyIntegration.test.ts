/**
 * Accuracy integration tests -- verify that AccuracyCollector + IndexedDB
 * form a closed loop: sessions are persisted, summaries are accumulated,
 * and cross-session reads work correctly.
 */
import { describe, expect, it, vi } from 'vitest'

import { listAccuracySummaries, queryAccuracySessions } from '@/lib/db'

import { AccuracyCollector, computeMatchQuality } from '../AccuracyCollector'

const emptyContextSnapshot = {
	pageTitle: 'Test Page',
	url: 'https://example.com/form',
	domain: 'example.com',
	path: '/form',
	visibleHeadings: ['Test Heading'],
	headingTokens: { test: 1 },
	viewportTokens: { form: 1 },
	keyPhrases: ['test heading'],
}

describe('AccuracyCollector + IndexedDB integration', () => {
	it('persists a settled adoption session to IndexedDB', async () => {
		const collector = new AccuracyCollector()
		const sessionId = collector.startSession({
			timestamp: Date.now(),
			tabId: 1,
			url: 'https://example.com/form',
			domain: 'example.com',
			path: '/form',
			field: { tagName: 'INPUT', type: 'email', name: 'email' },
			prefix: '',
			algorithmOutputs: {
				semantic_frequency: {
					suggestions: [
						{
							value: 'user@example.com',
							confidence: 0.9,
							algorithm: 'semantic_frequency',
							explanation: '',
							fieldKey: '',
						},
					],
					topValue: 'user@example.com',
					topConfidence: 0.9,
				},
			},
			contextSnapshot: emptyContextSnapshot,
		})

		collector.recordAdoption(sessionId, 'semantic_frequency', 'user@example.com')
		collector.recordSelfFill(sessionId, 'user@example.com')

		// Wait for settle debounce (500ms) + a safety margin
		await new Promise((r) => setTimeout(r, 700))

		const sessions = await queryAccuracySessions()
		expect(sessions.length).toBeGreaterThan(0)
		const session = sessions.find((s) => s.sessionId === sessionId)
		expect(session).toBeDefined()
		expect(session!.outcome?.type).toBe('adopted')
		expect(session!.contextSnapshot).toBeDefined()
		expect(session!.contextSnapshot!.pageTitle).toBe('Test Page')

		const summaries = await listAccuracySummaries()
		expect(summaries.length).toBeGreaterThan(0)
		const summary = summaries.find((s) => s.algorithmName === 'semantic_frequency')
		expect(summary).toBeDefined()
		expect(summary!.adoptedCount).toBe(1)
		expect(summary!.totalTriggers).toBe(1)
		expect(summary!.score).toBe(1.0)
	})

	it('persists a self-filled exact match to IndexedDB', async () => {
		const collector = new AccuracyCollector()
		const sessionId = collector.startSession({
			timestamp: Date.now(),
			tabId: 1,
			url: 'https://example.com/form',
			domain: 'example.com',
			path: '/form',
			field: { tagName: 'INPUT', type: 'text', name: 'name' },
			prefix: '',
			algorithmOutputs: {
				prefix_match: {
					suggestions: [
						{
							value: 'John',
							confidence: 0.8,
							algorithm: 'prefix_match',
							explanation: '',
							fieldKey: '',
						},
					],
					topValue: 'John',
					topConfidence: 0.8,
				},
			},
			contextSnapshot: emptyContextSnapshot,
		})

		collector.recordSelfFill(sessionId, 'John')
		await new Promise((r) => setTimeout(r, 700))

		const sessions = await queryAccuracySessions()
		const session = sessions.find((s) => s.sessionId === sessionId)
		expect(session).toBeDefined()
		expect(session!.outcome?.type).toBe('self_filled')
		expect(session!.contextSnapshot).toBeDefined()

		const summaries = await listAccuracySummaries()
		const summary = summaries.find((s) => s.algorithmName === 'prefix_match')
		expect(summary).toBeDefined()
		expect(summary!.exactMatchCount).toBe(1)
		expect(summary!.score).toBe(1.0)
	})

	it('records a miss when final value does not match any suggestion', async () => {
		const collector = new AccuracyCollector()
		const sessionId = collector.startSession({
			timestamp: Date.now(),
			tabId: 1,
			url: 'https://example.com/form',
			domain: 'example.com',
			path: '/form',
			field: { tagName: 'INPUT', type: 'text', name: 'city' },
			prefix: '',
			algorithmOutputs: {
				semantic_frequency: {
					suggestions: [
						{
							value: 'New York',
							confidence: 0.7,
							algorithm: 'semantic_frequency',
							explanation: '',
							fieldKey: '',
						},
					],
					topValue: 'New York',
					topConfidence: 0.7,
				},
			},
			contextSnapshot: emptyContextSnapshot,
		})

		collector.recordSelfFill(sessionId, 'Los Angeles')
		await new Promise((r) => setTimeout(r, 700))

		const summaries = await listAccuracySummaries()
		const summary = summaries.find((s) => s.algorithmName === 'semantic_frequency')
		expect(summary).toBeDefined()
		expect(summary!.missCount).toBe(1)
		expect(summary!.score).toBe(0)
	})

	it('accumulates multiple sessions in IndexedDB', async () => {
		const collector = new AccuracyCollector()

		for (let i = 0; i < 3; i++) {
			const sessionId = collector.startSession({
				timestamp: Date.now() + i,
				tabId: 1,
				url: 'https://example.com/form',
				domain: 'example.com',
				path: '/form',
				field: { tagName: 'INPUT', type: 'email', name: `email_${i}` },
				prefix: '',
				algorithmOutputs: {
					semantic_frequency: {
						suggestions: [
							{
								value: 'test@example.com',
								confidence: 0.9,
								algorithm: 'semantic_frequency',
								explanation: '',
								fieldKey: '',
							},
						],
						topValue: 'test@example.com',
						topConfidence: 0.9,
					},
				},
				contextSnapshot: emptyContextSnapshot,
			})
			collector.recordSelfFill(sessionId, 'test@example.com')
		}

		await new Promise((r) => setTimeout(r, 700))

		const sessions = await queryAccuracySessions()
		expect(sessions.length).toBeGreaterThanOrEqual(3)

		const summaries = await listAccuracySummaries()
		const summary = summaries.find((s) => s.algorithmName === 'semantic_frequency')
		expect(summary).toBeDefined()
		expect(summary!.totalTriggers).toBe(3)
		expect(summary!.exactMatchCount).toBe(3)
		expect(summary!.score).toBe(1.0)
	})

	it('getAccuracySummary reads previously persisted data from IndexedDB', async () => {
		const collector1 = new AccuracyCollector()
		const sessionId = collector1.startSession({
			timestamp: Date.now(),
			tabId: 1,
			url: 'https://example.com/form',
			domain: 'example.com',
			path: '/form',
			field: { tagName: 'INPUT', type: 'text', name: 'username' },
			prefix: '',
			algorithmOutputs: {
				prefix_match: {
					suggestions: [
						{
							value: 'alice',
							confidence: 0.8,
							algorithm: 'prefix_match',
							explanation: '',
							fieldKey: '',
						},
					],
					topValue: 'alice',
					topConfidence: 0.8,
				},
			},
			contextSnapshot: emptyContextSnapshot,
		})

		collector1.recordSelfFill(sessionId, 'alice')
		await new Promise((r) => setTimeout(r, 700))

		// Create a fresh collector (simulates page reload)
		const collector2 = new AccuracyCollector()
		const summary = await collector2.getAccuracySummary('prefix_match')
		expect(summary).toBeDefined()
		expect(summary!.exactMatchCount).toBe(1)
		expect(summary!.totalTriggers).toBe(1)
	})
})

describe('computeMatchQuality edge cases', () => {
	it('returns adopted only when adoptedAlgorithm equals the algorithm being scored', () => {
		const suggestions = [
			{
				value: 'hello',
				confidence: 0.9,
				algorithm: 'semantic_frequency',
				explanation: '',
				fieldKey: '',
			},
		]
		const result = computeMatchQuality('hello', suggestions, 'semantic_frequency', 'hello')
		expect(result.category).toBe('adopted')
		expect(result.score).toBe(1.0)
	})

	it('returns exactMatch for exact value match', () => {
		const suggestions = [
			{
				value: 'hello',
				confidence: 0.9,
				algorithm: 'semantic_frequency',
				explanation: '',
				fieldKey: '',
			},
		]
		const result = computeMatchQuality('hello', suggestions)
		expect(result.category).toBe('exactMatch')
		expect(result.score).toBe(1.0)
	})

	it('returns miss for empty final value', () => {
		const suggestions = [
			{
				value: 'hello',
				confidence: 0.9,
				algorithm: 'semantic_frequency',
				explanation: '',
				fieldKey: '',
			},
		]
		const result = computeMatchQuality('', suggestions)
		expect(result.category).toBe('miss')
		expect(result.score).toBe(0)
	})
})
