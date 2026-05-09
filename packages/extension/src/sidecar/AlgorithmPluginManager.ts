/**
 * AlgorithmPluginManager - Plugin registry, dynamic loading, built-in registration.
 *
 * Replaces the hardcoded ALGORITHM_REGISTRY with a dynamic system that supports
 * built-in, rule-based, and sandbox-js custom algorithms.
 */
import type { InputValueRecord } from '@/lib/db'

import type { FormField } from './FormDetector'
import type { SuggestionAlgorithm, SuggestionContext, SuggestionItem } from './SuggestionEngine'

export interface AlgorithmPluginManifest {
	name: string
	version: string
	description: string
	author?: string
	type: 'builtin' | 'rule_based' | 'sandbox_js'
	/** JSON schema for user-configurable parameters (rule-based) */
	configSchema?: Record<string, unknown>
	/** Default configuration */
	defaultConfig?: Record<string, unknown>
}

export interface AlgorithmWithMeta {
	algorithm: SuggestionAlgorithm
	manifest: AlgorithmPluginManifest
	accuracy?: AlgorithmAccuracySummary
}

export interface AlgorithmAccuracySummary {
	score: number
	totalTriggers: number
	adoptedCount: number
	exactMatchCount: number
	prefixMatchCount: number
	partialMatchCount: number
	missCount: number
	lastUpdated: number
}

export class AlgorithmPluginManager {
	#registry = new Map<string, SuggestionAlgorithm>()
	#manifests = new Map<string, AlgorithmPluginManifest>()
	#accuracy = new Map<string, AlgorithmAccuracySummary>()

	registerBuiltIn(algorithm: SuggestionAlgorithm, manifest: AlgorithmPluginManifest): void {
		this.#registry.set(algorithm.name, algorithm)
		this.#manifests.set(algorithm.name, manifest)
	}

	registerPlugin(manifest: AlgorithmPluginManifest, algorithm: SuggestionAlgorithm): void {
		this.#registry.set(manifest.name, algorithm)
		this.#manifests.set(manifest.name, manifest)
	}

	unregister(name: string): boolean {
		return this.#registry.delete(name) && this.#manifests.delete(name)
	}

	getAlgorithm(name: string): SuggestionAlgorithm | undefined {
		return this.#registry.get(name)
	}

	getManifest(name: string): AlgorithmPluginManifest | undefined {
		return this.#manifests.get(name)
	}

	getAlgorithms(): AlgorithmWithMeta[] {
		const result: AlgorithmWithMeta[] = []
		for (const [name, algo] of this.#registry) {
			const manifest = this.#manifests.get(name)
			if (manifest) {
				result.push({
					algorithm: algo,
					manifest,
					accuracy: this.#accuracy.get(name),
				})
			}
		}
		return result
	}

	hasAlgorithm(name: string): boolean {
		return this.#registry.has(name)
	}

	getNames(): string[] {
		return Array.from(this.#registry.keys())
	}

	updateAccuracy(name: string, summary: AlgorithmAccuracySummary): void {
		this.#accuracy.set(name, summary)
	}

	async runAlgorithm(
		name: string,
		field: FormField,
		prefix: string,
		history: InputValueRecord[],
		maxResults: number,
		context: SuggestionContext
	): Promise<SuggestionItem[]> {
		const algo = this.#registry.get(name)
		if (!algo) {
			console.warn(`[AlgorithmPluginManager] Unknown algorithm: ${name}`)
			return []
		}
		try {
			return await algo.compute(field, prefix, history, maxResults, context)
		} catch (err) {
			console.error(`[AlgorithmPluginManager] Algorithm "${name}" threw:`, err)
			return []
		}
	}

	async runAlgorithms(
		names: string[],
		field: FormField,
		prefix: string,
		history: InputValueRecord[],
		maxResults: number,
		context: SuggestionContext
	): Promise<Map<string, SuggestionItem[]>> {
		const results = new Map<string, SuggestionItem[]>()
		for (const name of names) {
			const items = await this.runAlgorithm(name, field, prefix, history, maxResults, context)
			results.set(name, items)
		}
		return results
	}
}

/** Global singleton plugin manager */
export const pluginManager = new AlgorithmPluginManager()
