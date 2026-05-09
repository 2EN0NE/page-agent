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

export interface SuggestionContext {
	// === Raw references (lightweight, for tracing and optional fetch) ===
	pageTitle: string
	url: string
	domain: string
	path: string
	contextEventIds?: string[] // References to ContextEventRecord IDs in IndexedDB

	// === Organized / derived content (pre-tokenized for immediate use) ===
	headingTokens: Record<string, number> // TF from visible headings (top 50)
	viewportTokens: Record<string, number> // TF from viewport text (top 100)
	articleTokens?: Record<string, number> // TF from article content (top 100)
	keyPhrases: string[] // Top 15 extracted phrases
}

export interface SuggestionAlgorithm {
	readonly name: string
	readonly description?: string
	readonly version?: string
	compute(
		field: FormField,
		prefix: string,
		history: InputValueRecord[],
		maxResults: number,
		context: SuggestionContext
	): SuggestionItem[] | Promise<SuggestionItem[]>
}

// =======================================================================
// Stop words for English tokenization
// =======================================================================

const STOP_WORDS = new Set([
	'the',
	'and',
	'a',
	'an',
	'is',
	'are',
	'to',
	'of',
	'in',
	'on',
	'at',
	'for',
	'with',
	'as',
	'by',
	'from',
	'that',
	'this',
	'it',
])

// =======================================================================
// Centralized tokenization for context text
// =======================================================================

/**
 * Tokenize text into a term-frequency map.
 *
 * - English: word-level tokenization (lowercased, alphanumeric filtered, stop words removed)
 * - CJK (Chinese/Japanese/Korean): bigram tokenization over characters in CJK range
 *
 * Returns top N terms by frequency to cap map size.
 */
export function tokenizeText(text: string, topN = 100): Record<string, number> {
	const freq = new Map<string, number>()
	const cleaned = text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, ' ')

	for (const word of cleaned.split(/\s+/)) {
		if (!word) continue

		// English / alphanumeric words
		if (/^[a-z0-9]+$/.test(word)) {
			if (word.length >= 2 && !STOP_WORDS.has(word)) {
				freq.set(word, (freq.get(word) ?? 0) + 1)
			}
		}

		// CJK bigrams
		const cjkChars = word.match(/[\u4e00-\u9fa5]/g)
		if (cjkChars && cjkChars.length >= 2) {
			for (let i = 0; i < cjkChars.length - 1; i++) {
				const bigram = cjkChars[i] + cjkChars[i + 1]
				freq.set(bigram, (freq.get(bigram) ?? 0) + 1)
			}
		}
	}

	// Sort by frequency descending and keep top N
	const sorted = Array.from(freq.entries())
		.sort((a, b) => b[1] - a[1])
		.slice(0, topN)
	const result: Record<string, number> = {}
	for (const [term, count] of sorted) {
		result[term] = count
	}
	return result
}

/**
 * Extract top N key phrases (bigrams/trigrams) from the given text using
 * simple frequency scoring. Returns phrases sorted by frequency.
 */
export function extractKeyPhrases(text: string, topN = 15): string[] {
	const cleaned = text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, ' ')
	const words = cleaned.split(/\s+/).filter((w) => w.length >= 2)

	const bigramFreq = new Map<string, number>()
	for (let i = 0; i < words.length - 1; i++) {
		const a = words[i]
		const b = words[i + 1]
		if (STOP_WORDS.has(a) && STOP_WORDS.has(b)) continue
		const phrase = `${a} ${b}`
		bigramFreq.set(phrase, (bigramFreq.get(phrase) ?? 0) + 1)
	}

	const trigramFreq = new Map<string, number>()
	for (let i = 0; i < words.length - 2; i++) {
		const a = words[i]
		const b = words[i + 1]
		const c = words[i + 2]
		if (STOP_WORDS.has(a) && STOP_WORDS.has(b) && STOP_WORDS.has(c)) continue
		const phrase = `${a} ${b} ${c}`
		trigramFreq.set(phrase, (trigramFreq.get(phrase) ?? 0) + 1)
	}

	const allPhrases = new Map<string, number>()
	for (const [phrase, count] of bigramFreq) allPhrases.set(phrase, count)
	for (const [phrase, count] of trigramFreq)
		allPhrases.set(phrase, (allPhrases.get(phrase) ?? 0) + count * 1.5)

	return Array.from(allPhrases.entries())
		.sort((a, b) => b[1] - a[1])
		.slice(0, topN)
		.map(([phrase]) => phrase)
}

// =======================================================================
// Synonym table for semantic matching
// =======================================================================

const SYNONYM_GROUPS: string[][] = [
	['email', 'e-mail', 'mail'],
	['phone', 'tel', 'telephone', 'mobile', 'cell'],
	['address', 'addr'],
	['name', 'fullname', 'full_name', 'username', 'user_name'],
	['first', 'firstname', 'first_name', 'given'],
	['last', 'lastname', 'last_name', 'surname', 'family'],
	['city', 'town'],
	['state', 'province', 'region'],
	['country', 'nation'],
	['zip', 'zipcode', 'postal', 'postcode'],
	['company', 'organization', 'org', 'employer'],
	['job', 'title', 'position', 'role'],
	['website', 'site', 'url', 'homepage'],
]

function expandSynonyms(tokens: Set<string>): Set<string> {
	const expanded = new Set(tokens)
	for (const token of tokens) {
		for (const group of SYNONYM_GROUPS) {
			if (group.includes(token)) {
				for (const synonym of group) expanded.add(synonym)
			}
		}
	}
	return expanded
}

// =======================================================================
// Similarity helpers
// =======================================================================

function levenshteinSimilarity(a: string, b: string): number {
	const maxLen = Math.max(a.length, b.length)
	if (maxLen === 0) return 1.0
	const dist = levenshteinDistance(a, b)
	return 1 - dist / maxLen
}

function levenshteinDistance(a: string, b: string): number {
	const m = a.length
	const n = b.length
	if (m === 0) return n
	if (n === 0) return m

	const prev = new Uint32Array(n + 1)
	const curr = new Uint32Array(n + 1)
	for (let j = 0; j <= n; j++) prev[j] = j

	for (let i = 1; i <= m; i++) {
		curr[0] = i
		for (let j = 1; j <= n; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1
			curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
		}
		for (let j = 0; j <= n; j++) prev[j] = curr[j]
	}
	return prev[n]
}

function substringOverlap(a: string, b: string): number {
	if (a.length === 0 || b.length === 0) return 0
	let maxLen = 0
	const shorter = a.length <= b.length ? a : b
	const longer = a.length <= b.length ? b : a
	for (let i = 0; i < shorter.length; i++) {
		for (let j = i + 1; j <= shorter.length; j++) {
			const sub = shorter.slice(i, j)
			if (longer.includes(sub) && sub.length > maxLen) {
				maxLen = sub.length
			}
		}
	}
	return maxLen / Math.max(a.length, b.length)
}

// =======================================================================
// Context similarity helpers
// =======================================================================

/**
 * Compute Jaccard similarity between two token-frequency maps (treated as sets).
 */
function jaccardTokenSimilarity(a: Record<string, number>, b: Record<string, number>): number {
	const keysA = new Set(Object.keys(a))
	const keysB = new Set(Object.keys(b))
	if (keysA.size === 0 && keysB.size === 0) return 1
	if (keysA.size === 0 || keysB.size === 0) return 0
	let intersection = 0
	for (const k of keysA) {
		if (keysB.has(k)) intersection++
	}
	const union = keysA.size + keysB.size - intersection
	return union > 0 ? intersection / union : 0
}

/**
 * Merge multiple token-frequency maps with per-source weights into a single
 * weighted token set (treated as a set for Jaccard similarity).
 */
function mergeTokenMaps(
	sources: { tokens: Record<string, number>; weight: number }[]
): Record<string, number> {
	const merged: Record<string, number> = {}
	for (const { tokens, weight } of sources) {
		for (const [term] of Object.entries(tokens)) {
			merged[term] = (merged[term] ?? 0) + weight
		}
	}
	return merged
}

// =======================================================================
// Algorithm 1: Semantic Relevance + Frequency Matching
// =======================================================================

export class SemanticFrequencyAlgorithm implements SuggestionAlgorithm {
	name = 'semantic_frequency'
	description = 'Text similarity of label/name/placeholder + frequency weighting'
	version = '2.1'

	compute(
		field: FormField,
		prefix: string,
		history: InputValueRecord[],
		maxResults: number,
		context: SuggestionContext
	): SuggestionItem[] {
		const fieldTokens = this.#tokenize([field.label, field.name, field.placeholder])
		const expandedFieldTokens = expandSynonyms(fieldTokens)

		const prefixLower = prefix.toLowerCase().trim()

		// Build weighted page token set from context
		const pageTokenSet = mergeTokenMaps([
			{ tokens: context.headingTokens, weight: 2.0 },
			{ tokens: context.articleTokens ?? {}, weight: 1.5 },
			{ tokens: context.viewportTokens, weight: 1.0 },
		])

		const scored = history
			.filter((h) => this.#typeCompatible(field.type, h.fieldType))
			.map((h) => {
				const histTokens = this.#tokenize([h.fieldLabel, h.fieldName, h.fieldPlaceholder])
				const expandedHistTokens = expandSynonyms(histTokens)

				// Weighted similarity: label (0.5) > name (0.3) > placeholder (0.2)
				const labelSim = this.#fieldSimilarity(field.label ?? '', h.fieldLabel ?? '')
				const nameSim = this.#fieldSimilarity(field.name ?? '', h.fieldName ?? '')
				const placeholderSim = this.#fieldSimilarity(
					field.placeholder ?? '',
					h.fieldPlaceholder ?? ''
				)
				const weightedSim = labelSim * 0.5 + nameSim * 0.3 + placeholderSim * 0.2

				// Hybrid metric: Jaccard + edit distance + substring overlap
				const jaccard = this.#jaccardSimilarity(expandedFieldTokens, expandedHistTokens)
				const editSim = levenshteinSimilarity(
					(field.label ?? field.name ?? '').toLowerCase(),
					(h.fieldLabel ?? h.fieldName ?? '').toLowerCase()
				)
				const subOverlap = substringOverlap(
					(field.label ?? field.name ?? '').toLowerCase(),
					(h.fieldLabel ?? h.fieldName ?? '').toLowerCase()
				)
				const hybridSim = jaccard * 0.4 + editSim * 0.35 + subOverlap * 0.25

				// Combine weighted and hybrid
				const similarity = weightedSim * 0.6 + hybridSim * 0.4

				// Prefix-aware scoring
				let prefixBoost: number
				if (prefixLower && prefixLower.length > 0) {
					const valLower = h.value.toLowerCase()
					if (valLower.startsWith(prefixLower)) {
						prefixBoost = 0.15
					} else if (valLower.includes(prefixLower)) {
						prefixBoost = 0.05
					}
				}

				// Context boost: Jaccard similarity between expanded field tokens and page tokens
				const contextSim = jaccardTokenSimilarity(
					Object.fromEntries(Array.from(expandedFieldTokens).map((t) => [t, 1])),
					pageTokenSet
				)
				const contextBoost = Math.min(0.12, contextSim * 0.12)

				const frequencyBoost = Math.log1p(h.useCount) / Math.log1p(10)
				const recencyBoost = this.#recencyBoost(h.timestamp)
				const confidence = Math.min(
					1,
					similarity * 0.45 +
						prefixBoost +
						contextBoost +
						frequencyBoost * 0.25 +
						recencyBoost * 0.15
				)
				return {
					value: h.value,
					confidence,
					algorithm: this.name,
					explanation: `Matched "${h.fieldLabel || h.fieldName || h.fieldPlaceholder || 'field'}" (used ${h.useCount} times)`,
					fieldKey: h.fieldKey,
				}
			})
			.filter((s) => s.confidence > 0.25)

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

	#tokenize(inputs: (string | undefined | null)[]): Set<string> {
		const tokens = new Set<string>()
		for (const input of inputs) {
			if (!input) continue
			const cleaned = input.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, ' ')
			for (const word of cleaned.split(/\s+/)) {
				if (word.length >= 2) tokens.add(word)
				// Chinese tokenization: keep single chars for CJK
				if (/[\u4e00-\u9fa5]/.test(word)) {
					for (let i = 0; i < word.length - 1; i++) {
						tokens.add(word.slice(i, i + 2))
					}
				}
			}
		}
		return tokens
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

	#fieldSimilarity(a: string, b: string): number {
		const al = a.toLowerCase().trim()
		const bl = b.toLowerCase().trim()
		if (!al || !bl) return 0
		if (al === bl) return 1
		if (al.includes(bl) || bl.includes(al)) return 0.8
		return levenshteinSimilarity(al, bl)
	}
}

// =======================================================================
// Algorithm 2: Historical Similar Operation Prefix Matching
// =======================================================================

export class PrefixMatchAlgorithm implements SuggestionAlgorithm {
	name = 'prefix_match'
	description = 'Prefix-based matching against historical input values'
	version = '2.1'

	compute(
		field: FormField,
		prefix: string,
		history: InputValueRecord[],
		maxResults: number,
		context: SuggestionContext
	): SuggestionItem[] {
		const prefixLower = prefix.toLowerCase().trim()
		const hasPrefix = prefixLower.length > 0

		// Filter by type compatibility
		let candidates = history.filter((h) => this.#typeCompatible(field.type, h.fieldType))

		if (hasPrefix) {
			// Fuzzy prefix: startsWith OR edit distance <= 2
			candidates = candidates.filter((h) => {
				const valLower = h.value.toLowerCase()
				if (valLower.startsWith(prefixLower)) return true
				if (Math.abs(valLower.length - prefixLower.length) <= 2) {
					const dist = levenshteinDistance(valLower.slice(0, prefixLower.length + 2), prefixLower)
					if (dist <= 2) return true
				}
				// Substring matching: prefix anywhere in value
				if (valLower.includes(prefixLower)) return true
				// Field-name prefix matching: match against historical labels/names
				const histLabel = (h.fieldLabel + ' ' + h.fieldName).toLowerCase()
				if (histLabel.includes(prefixLower)) return true
				return false
			})
		}

		// Build weighted page token set from context
		const pageTokenSet = mergeTokenMaps([
			{ tokens: context.headingTokens, weight: 2.0 },
			{ tokens: context.articleTokens ?? {}, weight: 1.5 },
			{ tokens: context.viewportTokens, weight: 1.0 },
		])

		const matches = candidates.map((h) => {
			const fieldSim = this.#fieldSimilarity(field, h)
			const valLower = h.value.toLowerCase()

			let prefixBoost: number
			if (!hasPrefix) {
				// Empty prefix fallback: boost by useCount + recency
				prefixBoost = 0.5
			} else if (valLower === prefixLower) {
				prefixBoost = 1.0
			} else if (valLower.startsWith(prefixLower)) {
				prefixBoost = 0.8
			} else if (valLower.includes(prefixLower)) {
				prefixBoost = 0.5
			} else {
				prefixBoost = 0.3
			}

			// Context boost: cosine-like similarity between historical value tokens and page tokens
			const histValueTokens = tokenizeText(h.value, 50)
			const contextSim = jaccardTokenSimilarity(histValueTokens, pageTokenSet)
			const contextBoost = Math.min(0.08, contextSim * 0.08)

			const freqBoost = Math.log1p(h.useCount) / Math.log1p(10)
			const recencyBoost = this.#recencyBoost(h.timestamp)
			const confidence = Math.min(
				1,
				fieldSim * 0.25 + prefixBoost * 0.4 + contextBoost + freqBoost * 0.2 + recencyBoost * 0.15
			)
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

	#recencyBoost(timestamp: number): number {
		const ageDays = (Date.now() - timestamp) / (1000 * 60 * 60 * 24)
		return Math.exp(-ageDays / 30)
	}
}

// =======================================================================
// Engine Registry & Runner
// =======================================================================

export const ALGORITHM_REGISTRY: Record<string, new () => SuggestionAlgorithm> = {
	semantic_frequency: SemanticFrequencyAlgorithm,
	prefix_match: PrefixMatchAlgorithm,
}

export const MAX_ALGORITHMS = 3

export async function runSuggestionAlgorithms(
	field: FormField,
	prefix: string,
	history: InputValueRecord[],
	algorithmNames: string[],
	context: SuggestionContext
): Promise<Map<string, SuggestionItem[]>> {
	// Limit to MAX_ALGORITHMS
	const names = algorithmNames.slice(0, MAX_ALGORITHMS)
	const results = new Map<string, SuggestionItem[]>()
	for (const name of names) {
		const AlgorithmClass = ALGORITHM_REGISTRY[name]
		if (!AlgorithmClass) {
			console.warn(`[SuggestionEngine] Unknown algorithm: ${name}`)
			continue
		}
		const algo = new AlgorithmClass()
		// Each algorithm produces up to 5 candidates for diversity
		results.set(name, await algo.compute(field, prefix, history, 5, context))
	}
	return results
}

export function mergeSuggestions(
	results: Map<string, SuggestionItem[]>,
	maxResults = MAX_ALGORITHMS
): SuggestionItem[] {
	const all: SuggestionItem[] = []
	for (const items of results.values()) {
		all.push(...items)
	}

	// Merge: deduplicate by value, boost confidence if multiple algorithms agree
	const merged = new Map<string, SuggestionItem & { algoCount: number }>()
	for (const s of all) {
		const existing = merged.get(s.value)
		if (!existing) {
			merged.set(s.value, { ...s, algoCount: 1 })
		} else {
			existing.confidence = Math.min(1, existing.confidence + s.confidence * 0.3)
			existing.algoCount += 1
			existing.explanation = `${existing.explanation}; ${s.explanation}`
		}
	}

	// Cross-algorithm agreement boost
	for (const item of merged.values()) {
		if (item.algoCount > 1) {
			item.confidence = Math.min(1, item.confidence + 0.1 * (item.algoCount - 1))
		}
	}

	// Result diversity: if algorithms disagree strongly, return top from each
	const sorted = Array.from(merged.values()).sort((a, b) => b.confidence - a.confidence)

	// Simple diversity heuristic: ensure we don't just take top N from one algo
	const byAlgo = new Map<string, SuggestionItem[]>()
	for (const s of sorted) {
		const algo = s.algorithm
		if (!byAlgo.has(algo)) byAlgo.set(algo, [])
		byAlgo.get(algo)!.push(s)
	}

	const diverse: SuggestionItem[] = []
	let round = 0
	while (diverse.length < maxResults) {
		let added = false
		for (const [, items] of byAlgo) {
			if (items[round] && diverse.length < maxResults) {
				diverse.push(items[round])
				added = true
			}
		}
		if (!added) break
		round++
	}

	return diverse
}

// =======================================================================
// Sensitive field detection (privacy guard)
// =======================================================================

const SENSITIVE_PATTERNS = [
	/password|passwd|pwd|pass/i,
	/cvv|cvc|security.?code/i,
	/ssn|social.?security/i,
	/credit.?card|card.?number|ccnum/i,
	/bank.?account|routing/i,
]

export function isSensitiveField(field: FormField): boolean {
	const text = [field.label, field.name, field.placeholder, field.id, field.type].join(' ')
	return SENSITIVE_PATTERNS.some((p) => p.test(text))
}
