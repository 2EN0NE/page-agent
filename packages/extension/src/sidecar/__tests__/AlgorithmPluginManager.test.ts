/**
 * AlgorithmPluginManager unit tests
 */
import { describe, expect, it } from 'vitest'

import { AlgorithmPluginManager } from '../AlgorithmPluginManager'
import { PrefixMatchAlgorithm, SemanticFrequencyAlgorithm } from '../SuggestionEngine'

const emptyContext = {
	pageTitle: '',
	url: 'https://example.com/form',
	domain: 'example.com',
	path: '/form',
	headingTokens: {},
	viewportTokens: {},
	keyPhrases: [],
}

describe('AlgorithmPluginManager', () => {
	it('registers built-in algorithms', () => {
		const manager = new AlgorithmPluginManager()
		manager.registerBuiltIn(new SemanticFrequencyAlgorithm(), {
			name: 'semantic_frequency',
			version: '2.0',
			description: 'Test',
			type: 'builtin',
		})
		expect(manager.hasAlgorithm('semantic_frequency')).toBe(true)
		expect(manager.getNames()).toContain('semantic_frequency')
	})

	it('unregisters algorithms', () => {
		const manager = new AlgorithmPluginManager()
		manager.registerBuiltIn(new PrefixMatchAlgorithm(), {
			name: 'prefix_match',
			version: '2.0',
			description: 'Test',
			type: 'builtin',
		})
		expect(manager.hasAlgorithm('prefix_match')).toBe(true)
		manager.unregister('prefix_match')
		expect(manager.hasAlgorithm('prefix_match')).toBe(false)
	})

	it('runs algorithms and returns results', async () => {
		const manager = new AlgorithmPluginManager()
		manager.registerBuiltIn(new SemanticFrequencyAlgorithm(), {
			name: 'semantic_frequency',
			version: '2.0',
			description: 'Test',
			type: 'builtin',
		})

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

		const results = await manager.runAlgorithm(
			'semantic_frequency',
			field,
			'',
			history,
			3,
			emptyContext
		)
		expect(Array.isArray(results)).toBe(true)
	})

	it('runs multiple algorithms', async () => {
		const manager = new AlgorithmPluginManager()
		manager.registerBuiltIn(new SemanticFrequencyAlgorithm(), {
			name: 'semantic_frequency',
			version: '2.0',
			description: 'Test',
			type: 'builtin',
		})
		manager.registerBuiltIn(new PrefixMatchAlgorithm(), {
			name: 'prefix_match',
			version: '2.0',
			description: 'Test',
			type: 'builtin',
		})

		const field = { tagName: 'INPUT', type: 'text', name: 'name', label: 'Name' }
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

		const results = await manager.runAlgorithms(
			['semantic_frequency', 'prefix_match'],
			field,
			'A',
			history,
			3,
			emptyContext
		)
		expect(results.size).toBe(2)
		expect(results.has('semantic_frequency')).toBe(true)
		expect(results.has('prefix_match')).toBe(true)
	})

	it('returns empty array for unknown algorithm', async () => {
		const manager = new AlgorithmPluginManager()
		const results = await manager.runAlgorithm(
			'unknown',
			{ tagName: 'INPUT' },
			'',
			[],
			3,
			emptyContext
		)
		expect(results).toEqual([])
	})
})
