/**
 * FormDetector - Detects when the user is interacting with forms
 * and generates contextual fill suggestions based on historical data.
 *
 * Uses pluggable SuggestionEngine algorithms:
 * - semantic_frequency: label similarity + frequency weighting
 * - prefix_match: prefix-based matching against historical values
 */
import { queryInputValues } from '@/lib/db'

import { ContextObserver } from './ContextObserver'
import { type SuggestionItem, isSensitiveField, runSuggestionAlgorithms } from './SuggestionEngine'

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
	#onSuggestions?: (suggestions: FormSuggestion[], fieldLabel: string) => void
	#listeners: (() => void)[] = []
	#inputDebounceTimer: number | null = null

	constructor(
		observer: ContextObserver,
		onSuggestions?: (suggestions: FormSuggestion[], fieldLabel: string) => void
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
	}

	// ========================================================================
	// Private
	// ========================================================================

	#setupListeners() {
		const onFocus = async (e: FocusEvent) => {
			const target = e.target as HTMLElement
			if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
				const field = this.#extractField(target)
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
				// Debounce to avoid querying IndexedDB on every keystroke
				if (this.#inputDebounceTimer) {
					window.clearTimeout(this.#inputDebounceTimer)
				}
				this.#inputDebounceTimer = window.setTimeout(() => {
					this.#inputDebounceTimer = null
					this.#generateAndEmitSuggestions(field, target.value)
				}, 300)
			}
		}
		document.addEventListener('input', onInput, true)
		this.#listeners.push(() => document.removeEventListener('input', onInput, true))
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

	/**
	 * Public API for message-based suggestion requests (e.g. from content script handler).
	 */
	async suggestForField(field: FormField, prefix?: string): Promise<FormSuggestion[]> {
		return this.#generateSuggestions(field, prefix ?? '')
	}

	async #generateAndEmitSuggestions(field: FormField, currentValue: string) {
		const suggestions = await this.#generateSuggestions(field, currentValue)
		if (suggestions.length === 0) return

		this.#onSuggestions?.(suggestions, field.label || field.name || field.placeholder || 'field')

		// Also write to storage for sidepanel real-time sync
		const domain = new URL(window.location.href).hostname
		try {
			await chrome.storage.local.set({
				[`sidecarSuggestions_${this.#observer.tabId}`]: {
					suggestions,
					fieldLabel: field.label || field.name || field.placeholder || 'field',
					url: window.location.href,
					domain,
					timestamp: Date.now(),
				},
			})
		} catch {
			// ignore storage errors
		}
	}

	async #generateSuggestions(field: FormField, currentValue: string): Promise<FormSuggestion[]> {
		if (isSensitiveField(field)) return []

		// Read configured algorithms from storage
		const configResult = await chrome.storage.local.get('advancedConfig')
		const advancedConfig = (configResult.advancedConfig as Record<string, unknown>) ?? {}
		const algorithmNames = (advancedConfig.suggestionAlgorithms as string[] | undefined) ?? [
			'semantic_frequency',
			'prefix_match',
		]

		const domain = new URL(window.location.href).hostname
		const history = await queryInputValues({ domain, limit: 500 })

		// Exclude fieldKeys recently dismissed by the user (7-day penalty window)
		let filteredHistory = history
		try {
			const dismissResult = await chrome.storage.local.get('dismissedSuggestions')
			const dismissed = (dismissResult.dismissedSuggestions as Record<string, number>) ?? {}
			const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
			const dismissedKeys = new Set(
				Object.entries(dismissed)
					.filter(([, ts]) => ts > cutoff)
					.map(([key]) => key)
			)
			if (dismissedKeys.size > 0) {
				filteredHistory = history.filter((h) => !dismissedKeys.has(h.fieldKey))
			}
		} catch {
			// ignore storage read errors
		}

		const items = runSuggestionAlgorithms(field, currentValue, filteredHistory, algorithmNames)

		if (items.length === 0) return []

		return items.map((item) => ({
			field,
			value: item.value,
			confidence: item.confidence,
			algorithm: item.algorithm,
			explanation: item.explanation,
		}))
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
}
