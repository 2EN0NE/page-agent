/**
 * AccuracyCollector unit tests
 */
import { describe, expect, it, vi } from 'vitest'

import { AccuracyCollector, computeMatchQuality } from '../AccuracyCollector'
import type { SuggestionItem } from '../SuggestionEngine'

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

describe('computeMatchQuality', () => {
	const suggestions: SuggestionItem[] = [
		{
			value: 'test@example.com',
			confidence: 0.9,
			algorithm: 'semantic_frequency',
			explanation: '',
			fieldKey: 'email',
		},
		{
			value: 'hello',
			confidence: 0.7,
			algorithm: 'prefix_match',
			explanation: '',
			fieldKey: 'name',
		},
	]

	it('returns adopted when algorithm and value match', () => {
		const result = computeMatchQuality(
			'test@example.com',
			suggestions,
			'semantic_frequency',
			'test@example.com'
		)
		expect(result.category).toBe('adopted')
		expect(result.score).toBe(1.0)
	})

	it('returns exactMatch when value matches exactly', () => {
		const result = computeMatchQuality('test@example.com', suggestions)
		expect(result.category).toBe('exactMatch')
		expect(result.score).toBe(1.0)
	})

	it('returns prefixMatch when suggestion is prefix of final value', () => {
		const result = computeMatchQuality('hello world', [
			{ value: 'hello', confidence: 0.5, algorithm: 'prefix_match', explanation: '', fieldKey: '' },
		])
		expect(result.category).toBe('prefixMatch')
		expect(result.score).toBe(0.7)
	})

	it('returns partialMatch for similar values', () => {
		const result = computeMatchQuality('helo', [
			{ value: 'hello', confidence: 0.5, algorithm: 'prefix_match', explanation: '', fieldKey: '' },
		])
		expect(result.category).toBe('partialMatch')
		expect(result.score).toBe(0.5)
	})

	it('returns miss for unrelated values', () => {
		const result = computeMatchQuality('xyz123', suggestions)
		expect(result.category).toBe('miss')
		expect(result.score).toBe(0)
	})
})

describe('AccuracyCollector', () => {
	it('starts a session and generates an ID', () => {
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
					suggestions: [],
					topValue: null,
					topConfidence: 0,
				},
			},
			contextSnapshot: emptyContextSnapshot,
		})
		expect(typeof sessionId).toBe('string')
		expect(sessionId.length).toBeGreaterThan(0)
	})

	it('records adoption and settles session', () => {
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
							value: 'adopted',
							confidence: 0.9,
							algorithm: 'semantic_frequency',
							explanation: '',
							fieldKey: '',
						},
					],
					topValue: 'adopted',
					topConfidence: 0.9,
				},
			},
			contextSnapshot: emptyContextSnapshot,
		})

		collector.recordAdoption(sessionId, 'semantic_frequency', 'adopted')
		collector.recordSelfFill(sessionId, 'adopted')

		// Wait for debounce
		return new Promise((resolve) => {
			setTimeout(async () => {
				const summaries = await collector.getAllAccuracySummaries()
				expect(summaries.length).toBeGreaterThan(0)
				const summary = summaries.find((s) => s.algorithmName === 'semantic_frequency')
				expect(summary).toBeDefined()
				expect(summary!.adoptedCount).toBe(1)
				expect(summary!.score).toBe(1.0)
				resolve(undefined)
			}, 600)
		})
	})
	it('computes self-filled exact match correctly', () => {
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

		// Wait for debounce
		return new Promise((resolve) => {
			setTimeout(async () => {
				const summaries = await collector.getAllAccuracySummaries()
				const summary = summaries.find((s) => s.algorithmName === 'prefix_match')
				expect(summary).toBeDefined()
				expect(summary!.exactMatchCount).toBe(1)
				expect(summary!.score).toBe(1.0)
				resolve(undefined)
			}, 600)
		})
	})
})
