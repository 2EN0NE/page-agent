/**
 * SuggestionEngine - Pluggable recommendation algorithms for form fill suggestions.
 *
 * Two default algorithms:
 * 1. SemanticFrequency: text similarity of label/name/placeholder + frequency weighting
 * 2. PrefixMatch: prefix-based matching against historical input values
 */
import type { InputValueRecord } from '@/lib/db'

import type { FormField } from './FormDetector'

export interface SuggestionItem {
	value: string
	confidence: number // 0-1
	algorithm: string
	explanation: string
	fieldKey: string
}

export interface SuggestionAlgorithm {
	name: string
	compute(
		field: FormField,
		prefix: string,
		history: InputValueRecord[],
		maxResults: number,
		pageContextKeywords?: string[]
	): SuggestionItem[]
}

// ========================================================================
// Shared: Stop words and utilities
// ========================================================================

const STOP_WORDS = new Set([
	'on',
	'in',
	'the',
	'a',
	'an',
	'to',
	'of',
	'for',
	'with',
	'at',
	'by',
	'from',
	'search',
	'submit',
	'cancel',
	'ok',
	'yes',
	'no',
])

function isStopWord(word: string): boolean {
	return STOP_WORDS.has(word.toLowerCase())
}

function isCjk(char: string): boolean {
	const code = char.charCodeAt(0)
	return code >= 0x4e00 && code <= 0x9fa5
}

function minPrefixLength(prefix: string): number {
	// CJK characters carry more information per character
	if (prefix.length > 0 && isCjk(prefix[0])) return 1
	return 2
}

// ========================================================================
// Algorithm 1: Semantic Relevance + Frequency Matching
// ========================================================================

export class SemanticFrequencyAlgorithm implements SuggestionAlgorithm {
	name = 'semantic_frequency'

	compute(
		field: FormField,
		_prefix: string,
		history: InputValueRecord[],
		maxResults: number,
		pageContextKeywords?: string[]
	): SuggestionItem[] {
		const fieldTokens = this.#shingle(this.#tokenize([field.label, field.name, field.placeholder]))
		const contextSet = new Set(pageContextKeywords ?? [])

		const scored = history
			.filter((h) => this.#typeCompatible(field.type, h.fieldType))
			.map((h) => {
				const histTokens = this.#shingle(this.#tokenize([h.fieldLabel, h.fieldName, h.fieldPlaceholder]))
				const similarity = this.#jaccardSimilarity(fieldTokens, histTokens)
				const frequencyBoost = Math.log1p(h.useCount) / Math.log1p(10)
				const recencyBoost = this.#recencyBoost(h.timestamp)
				let contextBoost = 0
				if (contextSet.size > 0) {
					const valueWords = h.value.toLowerCase().split(/[^a-z0-9一-龥]+/)
					const hits = valueWords.filter((w) => contextSet.has(w)).length
					if (hits > 0) contextBoost = Math.min(0.15, hits * 0.05)
				}
				const confidence = Math.min(
					1,
					similarity * 0.5 + frequencyBoost * 0.3 + recencyBoost * 0.2 + contextBoost
				)
				return {
					value: h.value,
					confidence,
					algorithm: this.name,
					explanation: `Matched "${h.fieldLabel || h.fieldName || h.fieldPlaceholder || 'field'}" (used ${h.useCount} times)`,
					fieldKey: h.fieldKey,
				}
			})
			.filter((s) => s.confidence > 0.15)

		// Deduplicate by value
		const seen = new Map<string, SuggestionItem>()
		for (const s of scored) {
			const existing = seen.get(s.value)
			if (!existing || existing.confidence < s.confidence) {
				seen.set(s.value, s)
			}
		}

		return Array.from(seen.values())
			.sort((a, b) => b.confidence - a.confidence)
			.slice(0, maxResults)
	}

	#tokenize(inputs: (string | undefined | null)[]): string[] {
		const tokens: string[] = []
		for (const input of inputs) {
			if (!input) continue
			const cleaned = input.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, ' ')
			for (const word of cleaned.split(/\s+/)) {
				if (word.length < 2) continue
				if (isStopWord(word)) continue
				tokens.push(word)
			}
		}
		return tokens
	}


	/** Generate unigram + bigram shingles for richer short-text matching */
	#shingle(tokens: string[]): Set<string> {
		const set = new Set<string>()
		for (let i = 0; i < tokens.length; i++) {
			set.add(tokens[i])
			if (i < tokens.length - 1) {
				set.add(`${tokens[i]}_${tokens[i + 1]}`)
			}
		}
		return set
	}
	#jaccardSimilarity(a: Set<string>, b: Set<string>): number {
		if (a.size === 0 && b.size === 0) return 1
		if (a.size === 0 || b.size === 0) return 0
		let intersection = 0
		for (const token of a) {
			if (b.has(token)) intersection++
		}
		const union = a.size + b.size - intersection
		return union > 0 ? intersection / union : 0
	}

	#recencyBoost(timestamp: number): number {
		const ageDays = (Date.now() - timestamp) / (1000 * 60 * 60 * 24)
		return Math.exp(-ageDays / 30) // half-life ~30 days
	}

	#typeCompatible(a?: string, b?: string): boolean {
		if (!a || !b) return true
		if (a === b) return true
		const textTypes = new Set(['text', 'search', 'url', 'tel', 'email'])
		return textTypes.has(a) && textTypes.has(b)
	}
}

// ========================================================================
// Algorithm 2: Historical Similar Operation Prefix Matching
// ========================================================================

export class PrefixMatchAlgorithm implements SuggestionAlgorithm {
	name = 'prefix_match'

	compute(
		field: FormField,
		prefix: string,
		history: InputValueRecord[],
		maxResults: number
	): SuggestionItem[] {
		if (!prefix || prefix.length < minPrefixLength(prefix)) return []

		const prefixLower = prefix.toLowerCase()

		const matches = history
			.filter((h) => {
				if (!this.#typeCompatible(field.type, h.fieldType)) return false
				if (!h.value.toLowerCase().startsWith(prefixLower)) return false
				const fieldSim = this.#fieldSimilarity(field, h)
				return fieldSim > 0.3
			})
			.map((h) => {
				const fieldSim = this.#fieldSimilarity(field, h)
				const prefixBoost = h.value.toLowerCase() === prefixLower ? 1.0 : 0.8
				const freqBoost = Math.log1p(h.useCount) / Math.log1p(10)
				const confidence = Math.min(1, fieldSim * 0.3 + prefixBoost * 0.5 + freqBoost * 0.2)
				return {
					value: h.value,
					confidence,
					algorithm: this.name,
					explanation: `Prefix match on "${h.fieldLabel || h.fieldName || 'field'}"`,
					fieldKey: h.fieldKey,
				}
			})

		const seen = new Map<string, SuggestionItem>()
		for (const s of matches) {
			const existing = seen.get(s.value)
			if (!existing || existing.confidence < s.confidence) {
				seen.set(s.value, s)
			}
		}

		return Array.from(seen.values())
			.sort((a, b) => b.confidence - a.confidence)
			.slice(0, maxResults)
	}

	#fieldSimilarity(field: FormField, h: InputValueRecord): number {
		const tokens = [
			(field.label ?? '').toLowerCase(),
			(field.name ?? '').toLowerCase(),
			(field.placeholder ?? '').toLowerCase(),
		]
		const histTokens = [
			h.fieldLabel.toLowerCase(),
			h.fieldName.toLowerCase(),
			h.fieldPlaceholder.toLowerCase(),
		]
		let matches = 0
		let total = 0
		for (const t of tokens) {
			if (!t) continue
			for (const c of histTokens) {
				if (!c) continue
				total++
				if (t.includes(c) || c.includes(t)) matches++
			}
		}
		return total > 0 ? matches / total : 0
	}

	#typeCompatible(a?: string, b?: string): boolean {
		if (!a || !b) return true
		if (a === b) return true
		const textTypes = new Set(['text', 'search', 'url', 'tel', 'email'])
		return textTypes.has(a) && textTypes.has(b)
	}
}

// ========================================================================
// Engine Registry & Runner
// ========================================================================

export const ALGORITHM_REGISTRY: Record<string, new () => SuggestionAlgorithm> = {
	semantic_frequency: SemanticFrequencyAlgorithm,
	prefix_match: PrefixMatchAlgorithm,
}

export const MAX_ALGORITHMS = 3

export function runSuggestionAlgorithms(
	field: FormField,
	prefix: string,
	history: InputValueRecord[],
	algorithmNames: string[],
	pageContextKeywords?: string[]
): SuggestionItem[] {
	// Limit to MAX_ALGORITHMS
	const names = algorithmNames.slice(0, MAX_ALGORITHMS)
	const all: SuggestionItem[] = []
	for (const name of names) {
		const AlgorithmClass = ALGORITHM_REGISTRY[name]
		if (!AlgorithmClass) {
			console.warn(`[SuggestionEngine] Unknown algorithm: ${name}`)
			continue
		}
		const algo = new AlgorithmClass()
		// Each algorithm produces exactly 1 best candidate
		all.push(...algo.compute(field, prefix, history, 1, pageContextKeywords))
	}

	// Merge: deduplicate by value, boost confidence if multiple algorithms agree
	const merged = new Map<string, SuggestionItem>()
	for (const s of all) {
		const existing = merged.get(s.value)
		if (!existing) {
			merged.set(s.value, s)
		} else {
			existing.confidence = Math.min(1, existing.confidence + s.confidence * 0.3)
			existing.explanation = `${existing.explanation}; ${s.explanation}`
		}
	}

	return Array.from(merged.values())
		.sort((a, b) => b.confidence - a.confidence)
		.slice(0, MAX_ALGORITHMS)
}

// ========================================================================
// Cold-start fallback
// ========================================================================

const COLD_START_GENERIC_PLACEHOLDERS = [
	'search',
	'type here',
	'enter',
	'input',
	'查找',
	'搜索',
	'请输入',
	'请输',
]

export function generateColdStartSuggestions(field: FormField): SuggestionItem[] {
	const items: SuggestionItem[] = []
	const ph = field.placeholder?.trim()
	if (ph && ph.length >= 3 && ph.length <= 100) {
		const lower = ph.toLowerCase()
		const isGeneric = COLD_START_GENERIC_PLACEHOLDERS.some((g) => lower.includes(g))
		if (!isGeneric) {
			items.push({
				value: ph,
				confidence: 0.25,
				algorithm: 'cold_start',
				explanation: 'Placeholder hint',
				fieldKey: 'cold_start',
			})
		}
	}
	// Type-based format templates
	if (field.type === 'email') {
		items.push({
			value: 'user@example.com',
			confidence: 0.2,
			algorithm: 'cold_start',
			explanation: 'Email format template',
			fieldKey: 'cold_start',
		})
	} else if (field.type === 'url') {
		items.push({
			value: 'https://example.com',
			confidence: 0.2,
			algorithm: 'cold_start',
			explanation: 'URL format template',
			fieldKey: 'cold_start',
		})
	} else if (field.type === 'tel') {
		items.push({
			value: '+1 555-0100',
			confidence: 0.2,
			algorithm: 'cold_start',
			explanation: 'Phone format template',
			fieldKey: 'cold_start',
		})
	}
	return items
}


// ========================================================================
// Sensitive field detection (privacy guard)
// ========================================================================

const SENSITIVE_PATTERNS = [
	/password|passwd|pwd|pass/i,
	/cvv|cvc|security.?code/i,
	/ssn|social.?security/i,
	/credit.?card|card.?number|ccnum/i,
	/bank.?account|routing/i,
]

export { isStopWord }

export function isSensitiveField(field: FormField): boolean {
	const text = [field.label, field.name, field.placeholder, field.id, field.type].join(' ')
	return SENSITIVE_PATTERNS.some((p) => p.test(text))
}
