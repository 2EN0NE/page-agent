/**
 * SuggestionEngine unit tests
 */
import { describe, expect, it } from 'vitest'

import {
	PrefixMatchAlgorithm,
	SemanticFrequencyAlgorithm,
	extractKeyPhrases,
	isSensitiveField,
	mergeSuggestions,
	tokenizeText,
} from '../SuggestionEngine'

const emptyContext = {
	pageTitle: '',
	url: 'https://example.com/form',
	domain: 'example.com',
	path: '/form',
	headingTokens: {},
	viewportTokens: {},
	keyPhrases: [],
}

const reactContext = {
	pageTitle: 'React Hooks Tutorial',
	url: 'https://example.com/react-hooks',
	domain: 'example.com',
	path: '/react-hooks',
	headingTokens: { react: 3, hooks: 3, usestate: 2, tutorial: 1 },
	viewportTokens: { react: 5, hooks: 4, javascript: 2, tutorial: 1 },
	keyPhrases: ['react hooks', 'useState tutorial'],
}

describe('SemanticFrequencyAlgorithm', () => {
	const algo = new SemanticFrequencyAlgorithm()

	it('returns suggestions for matching fields', () => {
		const field = { tagName: 'INPUT', type: 'email', name: 'email', label: 'Email' }
		const history = [
			{
				id: '1',
				domain: 'example.com',
				fieldKey: 'email',
				fieldLabel: 'Email',
				fieldName: 'email',
				fieldPlaceholder: '',
				fieldType: 'email',
				value: 'test@example.com',
				timestamp: Date.now(),
				useCount: 5,
			},
		]

		const results = algo.compute(field, '', history, 3, emptyContext)
		expect(results.length).toBeGreaterThan(0)
		expect(results[0].value).toBe('test@example.com')
		expect(results[0].algorithm).toBe('semantic_frequency')
	})

	it('filters by type compatibility', () => {
		const field = { tagName: 'INPUT', type: 'email', name: 'email' }
		const history = [
			{
				id: '1',
				domain: 'example.com',
				fieldKey: 'password',
				fieldLabel: 'Password',
				fieldName: 'password',
				fieldPlaceholder: '',
				fieldType: 'password',
				value: 'secret123',
				timestamp: Date.now(),
				useCount: 1,
			},
		]

		const results = algo.compute(field, '', history, 3, emptyContext)
		expect(results.length).toBe(0)
	})

	it('uses synonym expansion', () => {
		const field = { tagName: 'INPUT', type: 'email', name: 'e-mail' }
		const history = [
			{
				id: '1',
				domain: 'example.com',
				fieldKey: 'email',
				fieldLabel: 'Email',
				fieldName: 'email',
				fieldPlaceholder: '',
				fieldType: 'email',
				value: 'user@example.com',
				timestamp: Date.now(),
				useCount: 2,
			},
		]

		const results = algo.compute(field, '', history, 3, emptyContext)
		expect(results.length).toBeGreaterThan(0)
	})

	it('applies context boost when page tokens match field tokens', () => {
		const field = { tagName: 'INPUT', type: 'text', name: 'react_framework' }
		const history = [
			{
				id: '1',
				domain: 'example.com',
				fieldKey: 'framework',
				fieldLabel: 'React Framework',
				fieldName: 'react_framework',
				fieldPlaceholder: '',
				fieldType: 'text',
				value: 'react',
				timestamp: Date.now(),
				useCount: 1,
			},
			{
				id: '2',
				domain: 'example.com',
				fieldKey: 'framework',
				fieldLabel: 'React Framework',
				fieldName: 'react_framework',
				fieldPlaceholder: '',
				fieldType: 'text',
				value: 'vue',
				timestamp: Date.now(),
				useCount: 1,
			},
		]

		const emptyCtx = { ...emptyContext, headingTokens: {}, viewportTokens: {} }
		const reactCtx = {
			...emptyContext,
			headingTokens: { react: 3, hooks: 2 },
			viewportTokens: { react: 2 },
		}

		const resultsEmpty = algo.compute(field, '', history, 3, emptyCtx)
		const resultsReact = algo.compute(field, '', history, 3, reactCtx)

		// Both should return results
		expect(resultsEmpty.length).toBeGreaterThan(0)
		expect(resultsReact.length).toBeGreaterThan(0)

		// In react context, the 'react' value should have higher confidence
		const reactEmpty = resultsEmpty.find((r) => r.value === 'react')!
		const reactBoosted = resultsReact.find((r) => r.value === 'react')!
		expect(reactBoosted.confidence).toBeGreaterThan(reactEmpty.confidence)
	})
})

describe('PrefixMatchAlgorithm', () => {
	const algo = new PrefixMatchAlgorithm()

	it('matches by prefix', () => {
		const field = { tagName: 'INPUT', type: 'text', name: 'name' }
		const history = [
			{
				id: '1',
				domain: 'example.com',
				fieldKey: 'name',
				fieldLabel: 'Name',
				fieldName: 'name',
				fieldPlaceholder: '',
				fieldType: 'text',
				value: 'Alice',
				timestamp: Date.now(),
				useCount: 3,
			},
		]

		const results = algo.compute(field, 'Al', history, 3, emptyContext)
		expect(results.length).toBeGreaterThan(0)
		expect(results[0].value).toBe('Alice')
	})

	it('supports fuzzy prefix matching', () => {
		const field = { tagName: 'INPUT', type: 'text', name: 'name' }
		const history = [
			{
				id: '1',
				domain: 'example.com',
				fieldKey: 'name',
				fieldLabel: 'Name',
				fieldName: 'name',
				fieldPlaceholder: '',
				fieldType: 'text',
				value: 'Alexander',
				timestamp: Date.now(),
				useCount: 1,
			},
		]

		const results = algo.compute(field, 'Alexndr', history, 3, emptyContext)
		expect(results.length).toBeGreaterThan(0)
	})

	it('returns fallback on empty prefix', () => {
		const field = { tagName: 'INPUT', type: 'text', name: 'name' }
		const history = [
			{
				id: '1',
				domain: 'example.com',
				fieldKey: 'name',
				fieldLabel: 'Name',
				fieldName: 'name',
				fieldPlaceholder: '',
				fieldType: 'text',
				value: 'Bob',
				timestamp: Date.now(),
				useCount: 5,
			},
		]

		const results = algo.compute(field, '', history, 3, emptyContext)
		expect(results.length).toBeGreaterThan(0)
	})

	it('applies small context boost to historical values matching page context', () => {
		const field = { tagName: 'INPUT', type: 'text', name: 'query' }
		const history = [
			{
				id: '1',
				domain: 'example.com',
				fieldKey: 'query',
				fieldLabel: 'Query',
				fieldName: 'query',
				fieldPlaceholder: '',
				fieldType: 'text',
				value: 'react hooks',
				timestamp: Date.now(),
				useCount: 1,
			},
		]

		const emptyCtx = { ...emptyContext, headingTokens: {}, viewportTokens: {} }
		const reactCtx = {
			...emptyContext,
			headingTokens: { react: 3, hooks: 2 },
			viewportTokens: { react: 2 },
		}

		const resultsEmpty = algo.compute(field, '', history, 3, emptyCtx)
		const resultsReact = algo.compute(field, '', history, 3, reactCtx)

		expect(resultsEmpty.length).toBeGreaterThan(0)
		expect(resultsReact.length).toBeGreaterThan(0)

		// In react context, the value should have slightly higher confidence
		expect(resultsReact[0].confidence).toBeGreaterThan(resultsEmpty[0].confidence)
	})
})

describe('tokenizeText', () => {
	it('tokenizes English text and removes stop words', () => {
		const result = tokenizeText('The quick brown fox jumps over the lazy dog')
		expect(result.quick).toBe(1)
		expect(result.brown).toBe(1)
		expect(result.fox).toBe(1)
		expect(result.the).toBeUndefined()
	})

	it('tokenizes CJK text with bigrams', () => {
		const result = tokenizeText('中华人民共和国')
		expect(result['中华']).toBe(1)
		expect(result['华人']).toBe(1)
		expect(result['人民']).toBe(1)
	})

	it('returns top N terms only', () => {
		const text = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ')
		const result = tokenizeText(text, 50)
		expect(Object.keys(result).length).toBeLessThanOrEqual(50)
	})
})

describe('extractKeyPhrases', () => {
	it('extracts bigrams and trigrams', () => {
		const result = extractKeyPhrases('React hooks are great. React hooks tutorial.', 5)
		expect(result.length).toBeGreaterThan(0)
		expect(result.some((p) => p.includes('react'))).toBe(true)
	})

	it('limits to top N phrases', () => {
		const result = extractKeyPhrases('a b c d e f g h i j k l m n o p', 3)
		expect(result.length).toBeLessThanOrEqual(3)
	})
})

describe('mergeSuggestions', () => {
	it('deduplicates and boosts agreement', () => {
		const results = new Map([
			[
				'semantic_frequency',
				[
					{
						value: 'Alice',
						confidence: 0.8,
						algorithm: 'semantic_frequency',
						explanation: '',
						fieldKey: '',
					},
				],
			],
			[
				'prefix_match',
				[
					{
						value: 'Alice',
						confidence: 0.7,
						algorithm: 'prefix_match',
						explanation: '',
						fieldKey: '',
					},
				],
			],
		])

		const merged = mergeSuggestions(results, 3)
		expect(merged.length).toBe(1)
		expect(merged[0].value).toBe('Alice')
		expect(merged[0].confidence).toBeGreaterThan(0.8)
	})

	it('ensures diversity across algorithms', () => {
		const results = new Map([
			[
				'semantic_frequency',
				[
					{
						value: 'Alice',
						confidence: 0.9,
						algorithm: 'semantic_frequency',
						explanation: '',
						fieldKey: '',
					},
					{
						value: 'Alicia',
						confidence: 0.6,
						algorithm: 'semantic_frequency',
						explanation: '',
						fieldKey: '',
					},
				],
			],
			[
				'prefix_match',
				[
					{
						value: 'Bob',
						confidence: 0.8,
						algorithm: 'prefix_match',
						explanation: '',
						fieldKey: '',
					},
				],
			],
		])

		const merged = mergeSuggestions(results, 3)
		const values = merged.map((s) => s.value)
		expect(values).toContain('Alice')
		expect(values).toContain('Bob')
	})
})

describe('isSensitiveField', () => {
	it('detects password fields', () => {
		expect(isSensitiveField({ tagName: 'INPUT', type: 'password', name: 'pwd' })).toBe(true)
	})

	it('detects credit card fields', () => {
		expect(isSensitiveField({ tagName: 'INPUT', name: 'ccnum' })).toBe(true)
	})

	it('allows normal fields', () => {
		expect(isSensitiveField({ tagName: 'INPUT', type: 'text', name: 'username' })).toBe(false)
	})
})
