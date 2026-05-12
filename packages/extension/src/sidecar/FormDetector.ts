/**
 * FormDetector - Detects when the user is interacting with forms
 * and generates contextual fill suggestions based on historical data.
 *
 * Uses pluggable SuggestionEngine algorithms:
 * - semantic_frequency: label similarity + frequency weighting
 * - prefix_match: prefix-based matching against historical values
 */
import { queryInputValues } from '@/lib/db'
import type { ContextSnapshot } from '@/lib/db'

import { accuracyCollector } from './AccuracyCollector'
import { pluginManager } from './AlgorithmPluginManager'
import { extractArticle } from './ArticleExtractor'
import { ContextObserver } from './ContextObserver'
import {
	MAX_ALGORITHMS,
	type SuggestionContext,
	type SuggestionItem,
	extractKeyPhrases,
	isSensitiveField,
	mergeSuggestions,
	tokenizeText,
} from './SuggestionEngine'

export interface FormField {
	tagName: string
	type?: string
	name?: string
	id?: string
	placeholder?: string
	label?: string | null
}

export interface FormSuggestion {
	field: FormField
	value: string
	confidence: number // 0-1
	algorithm: string
	explanation: string
}

export class FormDetector {
	#observer: ContextObserver
	#onSuggestions?: (
		suggestions: FormSuggestion[],
		fieldLabel: string,
		sessionId: string | null
	) => void
	#listeners: (() => void)[] = []
	#inputDebounceTimer: number | null = null
	#activeSessionId: string | null = null
	#activeFieldKey: string | null = null

	constructor(
		observer: ContextObserver,
		onSuggestions?: (
			suggestions: FormSuggestion[],
			fieldLabel: string,
			sessionId: string | null
		) => void
	) {
		this.#observer = observer
		this.#onSuggestions = onSuggestions
		this.#setupListeners()
	}

	dispose() {
		this.#listeners.forEach((remove) => remove())
		this.#listeners = []
		if (this.#inputDebounceTimer) {
			window.clearTimeout(this.#inputDebounceTimer)
			this.#inputDebounceTimer = null
		}
		if (this.#activeSessionId) {
			accuracyCollector.recordDismiss(this.#activeSessionId)
			this.#activeSessionId = null
		}
		this.#activeFieldKey = null
		this.#hasUserTyped = false
	}

	// ========================================================================
	// Public: record adoption from UI
	// ========================================================================

	recordAdoption(sessionId: string, algorithm: string, value: string): void {
		accuracyCollector.recordAdoption(sessionId, algorithm, value)
	}

	recordSelfFill(sessionId: string, finalValue: string): void {
		accuracyCollector.recordSelfFill(sessionId, finalValue)
		this.#activeSessionId = null
	}

	// ========================================================================
	// Public: get suggestions for a specific field
	// ========================================================================

	async suggestForField(field: FormField): Promise<FormSuggestion[]> {
		if (isSensitiveField(field)) return []

		const configResult = await chrome.storage.local.get('advancedConfig')
		const advancedConfig = (configResult.advancedConfig as Record<string, unknown>) ?? {}
		const algorithms = (advancedConfig.algorithms as
			| { id: string; name: string; type: string; enabled: boolean; source?: string }[]
			| undefined) ?? [
			{
				id: 'semantic_frequency',
				name: 'Semantic Frequency',
				type: 'builtin',
				enabled: true,
				source: 'semantic_frequency',
			},
			{
				id: 'prefix_match',
				name: 'Prefix Match',
				type: 'builtin',
				enabled: true,
				source: 'prefix_match',
			},
		]
		const algorithmNames = algorithms.filter((a) => a.enabled).map((a) => a.id)

		const domain = new URL(window.location.href).hostname
		const history = await queryInputValues({ domain, limit: 500 })
		const context = this.#buildContext()

		const results = await pluginManager.runAlgorithms(
			algorithmNames,
			field,
			'',
			history,
			5,
			context
		)
		const items = mergeSuggestions(results, MAX_ALGORITHMS)

		return items.map((item) => ({
			field,
			value: item.value,
			confidence: item.confidence,
			algorithm: item.algorithm,
			explanation: item.explanation,
		}))
	}

	// ========================================================================
	// Private
	// ========================================================================

	#setupListeners() {
		const onFocus = async (e: FocusEvent) => {
			const target = e.target as HTMLElement
			if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
				const field = this.#extractField(target)
				this.#activeFieldKey = this.#fieldKey(field)
				this.#hasUserTyped = false
				this.#observer.record('form_detected', { field })
				await this.#generateAndEmitSuggestions(field, target.value)
			}
		}
		document.addEventListener('focusin', onFocus, true)
		this.#listeners.push(() => document.removeEventListener('focusin', onFocus, true))

		const onInput = async (e: Event) => {
			const target = e.target as HTMLInputElement | HTMLTextAreaElement
			if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
				const field = this.#extractField(target)
				const fieldKey = this.#fieldKey(field)
				// Only clear suggestions for the currently active field
				if (this.#activeFieldKey !== fieldKey) return
				this.#hasUserTyped = true
				// Debounce clearing suggestions to avoid flicker on rapid typing
				if (this.#inputDebounceTimer) {
					window.clearTimeout(this.#inputDebounceTimer)
				}
				this.#inputDebounceTimer = window.setTimeout(() => {
					this.#inputDebounceTimer = null
					this.#clearSuggestions(field)
				}, 300)
			}
		}
		document.addEventListener('input', onInput, true)
		this.#listeners.push(() => document.removeEventListener('input', onInput, true))

		const onBlur = async (e: FocusEvent) => {
			const target = e.target as HTMLElement
			if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
				// Settle the active session with the final value
				if (this.#activeSessionId && target.value) {
					accuracyCollector.recordSelfFill(this.#activeSessionId, target.value)
				}
				this.#activeSessionId = null
				this.#activeFieldKey = null
				this.#hasUserTyped = false
				if (this.#inputDebounceTimer) {
					window.clearTimeout(this.#inputDebounceTimer)
					this.#inputDebounceTimer = null
				}
			}
		}
		document.addEventListener('focusout', onBlur, true)
		this.#listeners.push(() => document.removeEventListener('focusout', onBlur, true))
	}

	#extractField(target: HTMLInputElement | HTMLTextAreaElement): FormField {
		return {
			tagName: target.tagName,
			type: target.type,
			name: target.getAttribute('name') ?? undefined,
			id: target.id || undefined,
			placeholder: target.placeholder || undefined,
			label: this.#getLabelText(target),
		}
	}

	async #generateAndEmitSuggestions(field: FormField, currentValue: string) {
		if (isSensitiveField(field)) return

		// Read configured algorithms from storage
		const configResult = await chrome.storage.local.get('advancedConfig')
		const advancedConfig = (configResult.advancedConfig as Record<string, unknown>) ?? {}
		const algorithms = (advancedConfig.algorithms as
			| { id: string; name: string; type: string; enabled: boolean; source?: string }[]
			| undefined) ?? [
			{
				id: 'semantic_frequency',
				name: 'Semantic Frequency',
				type: 'builtin',
				enabled: true,
				source: 'semantic_frequency',
			},
			{
				id: 'prefix_match',
				name: 'Prefix Match',
				type: 'builtin',
				enabled: true,
				source: 'prefix_match',
			},
		]
		const algorithmNames = algorithms.filter((a) => a.enabled).map((a) => a.id)

		const enableAccuracyCollection =
			(advancedConfig.enableAccuracyCollection as boolean | undefined) ?? true

		const url = new URL(window.location.href)
		const domain = url.hostname
		const path = url.pathname
		const history = await queryInputValues({ domain, limit: 500 })

		// Build context snapshot for algorithms and accuracy tracking
		const context = this.#buildContext()

		// Run all enabled algorithms through the plugin manager
		const results = await pluginManager.runAlgorithms(
			algorithmNames,
			field,
			currentValue,
			history,
			5,
			context
		)

		// Merge with diversity strategy
		const items = mergeSuggestions(results, MAX_ALGORITHMS)

		if (items.length === 0) return

		// Start accuracy collection session
		if (enableAccuracyCollection) {
			const algorithmOutputs: Record<
				string,
				{ suggestions: SuggestionItem[]; topValue: string | null; topConfidence: number }
			> = {}
			for (const [algoName, suggestions] of results) {
				algorithmOutputs[algoName] = {
					suggestions,
					topValue: suggestions[0]?.value ?? null,
					topConfidence: suggestions[0]?.confidence ?? 0,
				}
			}

			const contextSnapshot: ContextSnapshot = {
				pageTitle: context.pageTitle,
				url: context.url,
				domain: context.domain,
				path: context.path,
				visibleHeadings: this.#getVisibleHeadings(),
				headingTokens: context.headingTokens,
				viewportTokens: context.viewportTokens,
				articleTokens: context.articleTokens,
				keyPhrases: context.keyPhrases,
				contextEventIds: context.contextEventIds,
			}

			this.#activeSessionId = accuracyCollector.startSession({
				timestamp: Date.now(),
				tabId: this.#observer.tabId,
				url: window.location.href,
				domain,
				path,
				field,
				prefix: currentValue,
				algorithmOutputs,
				contextSnapshot,
			})
		}

		const suggestions: FormSuggestion[] = items.map((item) => ({
			field,
			value: item.value,
			confidence: item.confidence,
			algorithm: item.algorithm,
			explanation: item.explanation,
		}))

		this.#onSuggestions?.(
			suggestions,
			field.label || field.name || field.placeholder || 'field',
			this.#activeSessionId
		)
	}

	/**
	 * Build a SuggestionContext from the current page state.
	 * Tokenizes headings, viewport text, and optionally article content.
	 */
	#buildContext(): SuggestionContext {
		const url = new URL(window.location.href)
		const visibleHeadings = this.#getVisibleHeadings()
		const viewportText = this.#getViewportText()

		// Try article extraction with a 100ms timeout
		let articleText = ''
		try {
			const start = performance.now()
			const extraction = extractArticle(document)
			if (performance.now() - start < 100) {
				articleText = extraction.markdown.slice(0, 3000)
			}
		} catch {
			// Skip article extraction if it fails or times out
		}

		const headingTokens = tokenizeText(visibleHeadings.join(' '), 50)
		const viewportTokens = tokenizeText(viewportText, 100)
		const articleTokens = articleText ? tokenizeText(articleText, 100) : undefined
		const keyPhrases = extractKeyPhrases(
			visibleHeadings.join(' ') + ' ' + articleText.slice(0, 2000),
			15
		)

		return {
			pageTitle: document.title,
			url: window.location.href,
			domain: url.hostname,
			path: url.pathname,
			headingTokens,
			viewportTokens,
			articleTokens,
			keyPhrases,
		}
	}

	#getVisibleHeadings(): string[] {
		try {
			const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6')
			const result: string[] = []
			for (const h of headings) {
				const rect = h.getBoundingClientRect()
				if (rect.top >= 0 && rect.bottom <= window.innerHeight) {
					const text = h.textContent?.trim()
					if (text) result.push(text)
				}
			}
			return result.slice(0, 10)
		} catch {
			return []
		}
	}

	#getViewportText(): string {
		try {
			const elements = document.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, td, th')
			const texts: string[] = []
			for (const el of elements) {
				const rect = el.getBoundingClientRect()
				if (rect.top >= 0 && rect.bottom <= window.innerHeight) {
					const text = el.textContent?.trim()
					if (text) texts.push(text)
				}
			}
			return texts.slice(0, 20).join(' ').slice(0, 1000)
		} catch {
			return ''
		}
	}

	#getLabelText(el: HTMLElement): string | null {
		const labelledBy = el.getAttribute('aria-labelledby')
		if (labelledBy) {
			const labelEl = document.getElementById(labelledBy)
			if (labelEl) return labelEl.textContent?.trim() ?? null
		}
		const ariaLabel = el.getAttribute('aria-label')
		if (ariaLabel) return ariaLabel
		if (el.id) {
			const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
			if (label) return label.textContent?.trim() ?? null
		}
		const parentLabel = el.closest('label')
		if (parentLabel) return parentLabel.textContent?.trim() ?? null
		return (el as HTMLInputElement).placeholder || null
	}

	#fieldKey(field: FormField): string {
		return `${field.tagName}:${field.type}:${field.name}:${field.id}`
	}

	#clearSuggestions(field: FormField) {
		this.#onSuggestions?.(
			[],
			field.label || field.name || field.placeholder || 'field',
			this.#activeSessionId
		)
	}
}
