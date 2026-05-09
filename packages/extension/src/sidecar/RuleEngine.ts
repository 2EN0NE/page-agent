/**
 * RuleEngine - Simple rule-based suggestion algorithm interpreter.
 *
 * Rules are evaluated against a FormField + history to produce suggestions.
 * No external dependencies; all computation is local.
 */
import type { InputValueRecord } from '@/lib/db'

import type { FormField } from './FormDetector'
import type { SuggestionAlgorithm, SuggestionContext, SuggestionItem } from './SuggestionEngine'

export interface RuleBasedConfig {
	/** Human-readable description of what this algorithm does */
	description?: string
	/** Ordered list of rules; first matching rule wins per value */
	rules: SuggestionRule[]
}

export interface SuggestionRule {
	/** Keywords to match against field label / name / placeholder (case-insensitive, OR) */
	fieldKeywords?: string[]
	/** Regex patterns to match against field name attribute */
	fieldNamePatterns?: string[]
	/** Regex patterns to match against field type (e.g. "email", "tel") */
	fieldTypePatterns?: string[]
	/** Require the user-typed prefix to start with one of these strings */
	prefixes?: string[]
	/** Static values to suggest when this rule matches */
	staticValues?: { value: string; score: number; explanation?: string }[]
	/** Whether to include values from history when this rule matches */
	includeHistory?: boolean
	/** Additional filter on history: only include items whose fieldKey matches these patterns */
	historyFieldKeyPatterns?: string[]
	/** Score multiplier for history items matched by this rule (default: 1.0) */
	scoreMultiplier?: number
	/** Cap the number of suggestions from this rule */
	maxResults?: number
}

function matchesField(rule: SuggestionRule, field: FormField): boolean {
	const haystack = [field.label, field.name, field.placeholder]
		.filter(Boolean)
		.join(' ')
		.toLowerCase()

	if (rule.fieldKeywords?.length) {
		const matched = rule.fieldKeywords.some((kw) => haystack.includes(kw.toLowerCase()))
		if (!matched) return false
	}

	if (rule.fieldNamePatterns?.length) {
		const matched = rule.fieldNamePatterns.some((pat) => {
			try {
				return new RegExp(pat, 'i').test(field.name || '')
			} catch {
				return false
			}
		})
		if (!matched) return false
	}

	if (rule.fieldTypePatterns?.length) {
		const matched = rule.fieldTypePatterns.some((pat) => {
			try {
				return new RegExp(pat, 'i').test(field.type || '')
			} catch {
				return false
			}
		})
		if (!matched) return false
	}

	return true
}

function matchesPrefix(rule: SuggestionRule, prefix: string): boolean {
	if (!rule.prefixes?.length) return true
	if (!prefix) return true
	return rule.prefixes.some((p) => prefix.toLowerCase().startsWith(p.toLowerCase()))
}

function filterHistory(rule: SuggestionRule, history: InputValueRecord[]): InputValueRecord[] {
	if (!rule.historyFieldKeyPatterns?.length) return history
	return history.filter((h) =>
		rule.historyFieldKeyPatterns!.some((pat) => {
			try {
				return new RegExp(pat, 'i').test(h.fieldKey)
			} catch {
				return false
			}
		})
	)
}

export class RuleBasedAlgorithm implements SuggestionAlgorithm {
	readonly name: string
	readonly description?: string
	readonly version = '1.0'
	#config: RuleBasedConfig

	constructor(name: string, config: RuleBasedConfig) {
		this.name = name
		this.description = config.description
		this.#config = config
	}

	compute(
		field: FormField,
		prefix: string,
		history: InputValueRecord[],
		maxResults: number,
		_context: SuggestionContext
	): SuggestionItem[] {
		const items: SuggestionItem[] = []
		const seen = new Set<string>()

		for (const rule of this.#config.rules) {
			if (!matchesField(rule, field)) continue
			if (!matchesPrefix(rule, prefix)) continue

			const multiplier = rule.scoreMultiplier ?? 1.0
			const cap = rule.maxResults ?? maxResults

			if (rule.staticValues) {
				for (const sv of rule.staticValues) {
					if (items.length >= maxResults) break
					if (seen.has(sv.value)) continue
					seen.add(sv.value)
					items.push({
						value: sv.value,
						confidence: Math.min(1.0, sv.score * multiplier),
						algorithm: this.name,
						explanation:
							sv.explanation ?? `Matched rule for ${field.name || field.label || 'field'}`,
						fieldKey: field.name || field.label || field.id || 'unknown',
					})
					if (items.length >= cap) break
				}
			}

			if (rule.includeHistory) {
				const filtered = filterHistory(rule, history)
				for (const h of filtered) {
					if (items.length >= maxResults) break
					if (seen.has(h.value)) continue
					seen.add(h.value)
					items.push({
						value: h.value,
						confidence: Math.min(1.0, 0.75 * multiplier),
						algorithm: this.name,
						explanation: `Historical value for ${h.fieldKey}`,
						fieldKey: h.fieldKey,
					})
					if (items.length >= cap) break
				}
			}

			if (items.length >= maxResults) break
		}

		return items
	}
}

/** Parse and validate a user-provided rule-based config. */
export function parseRuleBasedConfig(raw: Record<string, unknown>): RuleBasedConfig | null {
	if (!Array.isArray(raw.rules)) {
		console.warn('[RuleEngine] Config missing "rules" array')
		return null
	}
	const rules: SuggestionRule[] = []
	for (const r of raw.rules) {
		if (typeof r !== 'object' || r === null) continue
		const rule = r as Record<string, unknown>
		rules.push({
			fieldKeywords: Array.isArray(rule.fieldKeywords)
				? rule.fieldKeywords.filter((x): x is string => typeof x === 'string')
				: undefined,
			fieldNamePatterns: Array.isArray(rule.fieldNamePatterns)
				? rule.fieldNamePatterns.filter((x): x is string => typeof x === 'string')
				: undefined,
			fieldTypePatterns: Array.isArray(rule.fieldTypePatterns)
				? rule.fieldTypePatterns.filter((x): x is string => typeof x === 'string')
				: undefined,
			prefixes: Array.isArray(rule.prefixes)
				? rule.prefixes.filter((x): x is string => typeof x === 'string')
				: undefined,
			staticValues: Array.isArray(rule.staticValues)
				? rule.staticValues
						.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
						.map((sv) => ({
							// eslint-disable-next-line @typescript-eslint/no-base-to-string
							value: String(sv.value ?? ''),
							score: typeof sv.score === 'number' ? sv.score : 0.8,
							explanation: typeof sv.explanation === 'string' ? sv.explanation : undefined,
						}))
				: undefined,
			includeHistory: typeof rule.includeHistory === 'boolean' ? rule.includeHistory : false,
			historyFieldKeyPatterns: Array.isArray(rule.historyFieldKeyPatterns)
				? rule.historyFieldKeyPatterns.filter((x): x is string => typeof x === 'string')
				: undefined,
			scoreMultiplier: typeof rule.scoreMultiplier === 'number' ? rule.scoreMultiplier : undefined,
			maxResults: typeof rule.maxResults === 'number' ? rule.maxResults : undefined,
		})
	}
	return {
		description: typeof raw.description === 'string' ? raw.description : undefined,
		rules,
	}
}
