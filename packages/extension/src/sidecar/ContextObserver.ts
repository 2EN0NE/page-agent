/**
 * ContextObserver - Continuous user interaction observation for sidecar mode.
 * Runs in content script. Collects scroll/focus/input/click/mutation/page events
 * and flushes them to IndexedDB in batches.
 *
 * Sliding window: events are retained server-side (IndexedDB) with a 24h TTL.
 * Queries use a configurable look-back (default 5 min).
 */
import {
	type ContextEventRecord,
	type ContextEventType,
	saveContextEvents,
	saveInputValue,
} from '@/lib/db'

import { extractArticle } from './ArticleExtractor'
import { isSensitiveField, isStopWord } from './SuggestionEngine'

const FLUSH_INTERVAL_MS = 1000
const SCROLL_DEBOUNCE_MS = 500
const MUTATION_DEBOUNCE_MS = 1000
const MAX_BATCH_SIZE = 100

function generateId(): string {
	try {
		return self.crypto.randomUUID()
	} catch {
		return `${Date.now()}-${Math.random().toString(36).slice(2)}`
	}
}

export interface ContextObserverConfig {
	enabled?: boolean
	flushIntervalMs?: number
	scrollDebounceMs?: number
}

export class ContextObserver {
	#tabId: number
	#enabled: boolean
	#events: ContextEventRecord[] = []
	#periodicTimer: number | null = null
	#microTimer: number | null = null
	#listeners: (() => void)[] = []
	#mutationObserver: MutationObserver | null = null
	#scrollTimer: number | null = null
	#mutationTimer: number | null = null
	#lastScrollY = 0
	#lastScrollTime = 0
	#pageStartTime = Date.now()
	#isVisible = !document.hidden

	constructor(tabId: number, config: ContextObserverConfig = {}) {
		this.#tabId = tabId
		this.#enabled = config.enabled ?? true

		if (this.#enabled) {
			this.#setupListeners()
			this.#periodicTimer = window.setInterval(
				() => this.#flush(),
				config.flushIntervalMs ?? FLUSH_INTERVAL_MS
			)
			this.#extractPageContext()
		}
	}

	async #extractPageContext() {
		try {
			const article = extractArticle(document)
			const text = `${article.metadata.title} ${article.metadata.description ?? ''} ${article.markdown}`
			const words = text
				.toLowerCase()
				.replace(/[^a-z0-9一-龥]+/g, ' ')
				.split(/\s+/)
				.filter((w) => w.length >= 3 && !isStopWord(w))
			const freq = new Map<string, number>()
			for (const w of words) {
				freq.set(w, (freq.get(w) ?? 0) + 1)
			}
			const top = Array.from(freq.entries())
				.sort((a, b) => b[1] - a[1])
				.slice(0, 10)
				.map(([w]) => w)
			await chrome.storage.local.set({
				[`pageContext_${this.#tabId}`]: {
					keywords: top,
					url: window.location.href,
					timestamp: Date.now(),
				},
			})
		} catch {
			// ignore extraction errors
		}
	}

	// ========================================================================
	// Public API
	// ========================================================================

	get tabId() {
		return this.#tabId
	}

	get eventCount() {
		return this.#events.length
	}

	dispose() {
		if (this.#periodicTimer) {
			window.clearInterval(this.#periodicTimer)
			this.#periodicTimer = null
		}
		if (this.#microTimer) {
			window.clearTimeout(this.#microTimer)
			this.#microTimer = null
		}
		this.#listeners.forEach((remove) => remove())
		this.#listeners = []
		this.#mutationObserver?.disconnect()
		this.#mutationObserver = null
		if (this.#scrollTimer) window.clearTimeout(this.#scrollTimer)
		if (this.#mutationTimer) window.clearTimeout(this.#mutationTimer)
		this.#flush() // final flush
	}

	/**
	 * Manually record an event (used by detectors).
	 */
	record(type: ContextEventType, data: Record<string, unknown> = {}) {
		const record: ContextEventRecord = {
			id: generateId(),
			tabId: this.#tabId,
			url: window.location.href,
			title: document.title,
			domain: new URL(window.location.href).hostname,
			type,
			timestamp: Date.now(),
			data,
		}
		this.#events.push(record)
		// Immediate flush for large batches, micro-flush for small ones
		if (this.#events.length >= MAX_BATCH_SIZE) {
			if (this.#microTimer) {
				window.clearTimeout(this.#microTimer)
				this.#microTimer = null
			}
			this.#flush()
		} else if (!this.#microTimer) {
			this.#microTimer = window.setTimeout(() => {
				this.#microTimer = null
				this.#flush()
			}, 200)
		}
	}

	// ========================================================================
	// Internal: Event Listeners
	// ========================================================================

	#setupListeners() {
		// Scroll (debounced)
		const onScroll = () => {
			if (this.#scrollTimer) window.clearTimeout(this.#scrollTimer)
			this.#scrollTimer = window.setTimeout(() => {
				const now = Date.now()
				const scrollY = window.scrollY
				const delta = scrollY - this.#lastScrollY
				const duration = now - this.#lastScrollTime
				this.#lastScrollY = scrollY
				this.#lastScrollTime = now

				this.record('scroll', {
					scrollY,
					scrollHeight: document.documentElement.scrollHeight,
					clientHeight: window.innerHeight,
					delta,
					duration,
					velocity: duration > 0 ? Math.abs(delta) / duration : 0,
				})
			}, SCROLL_DEBOUNCE_MS)
		}
		window.addEventListener('scroll', onScroll, { passive: true })
		this.#listeners.push(() => window.removeEventListener('scroll', onScroll))

		// Focus (input/textarea/select)
		const onFocus = (e: FocusEvent) => {
			const target = e.target as HTMLElement
			if (
				target instanceof HTMLInputElement ||
				target instanceof HTMLTextAreaElement ||
				target instanceof HTMLSelectElement
			) {
				const label = this.#getLabelText(target)
				this.record('focus', {
					tagName: target.tagName,
					type: (target as HTMLInputElement).type,
					name: target.getAttribute('name'),
					id: target.id,
					placeholder: (target as HTMLInputElement).placeholder,
					label,
					rect: target.getBoundingClientRect().toJSON?.() ?? null,
				})
			}
		}
		document.addEventListener('focusin', onFocus, true)
		this.#listeners.push(() => document.removeEventListener('focusin', onFocus, true))

		// Input (value changes)
		const onInput = (e: Event) => {
			const target = e.target as HTMLInputElement | HTMLTextAreaElement
			if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
				const label = this.#getLabelText(target)
				this.record('input', {
					tagName: target.tagName,
					type: target.type,
					name: target.getAttribute('name'),
					id: target.id,
					label,
					valueLength: target.value.length,
					// never record actual values for privacy
				})
				// Store value in inputValues if not sensitive
				this.#maybeStoreInputValue(target, label)
			}
		}
		document.addEventListener('input', onInput, true)
		this.#listeners.push(() => document.removeEventListener('input', onInput, true))

		// Click
		const onClick = (e: MouseEvent) => {
			const target = e.target as HTMLElement
			this.record('click', {
				tagName: target.tagName,
				id: target.id,
				className: target.className,
				text: target.textContent?.slice(0, 200) ?? null,
				x: e.clientX,
				y: e.clientY,
			})
		}
		document.addEventListener('click', onClick, true)
		this.#listeners.push(() => document.removeEventListener('click', onClick, true))

		// Page visibility
		const onVisibility = () => {
			const nowVisible = !document.hidden
			if (nowVisible !== this.#isVisible) {
				this.#isVisible = nowVisible
				this.record('page_visibility', {
					visible: nowVisible,
					pageDwellTime: Date.now() - this.#pageStartTime,
				})
			}
		}
		document.addEventListener('visibilitychange', onVisibility)
		this.#listeners.push(() => document.removeEventListener('visibilitychange', onVisibility))

		// MutationObserver (DOM changes)
		if (document.body) {
			this.#mutationObserver = new MutationObserver(() => {
				if (this.#mutationTimer) window.clearTimeout(this.#mutationTimer)
				this.#mutationTimer = window.setTimeout(() => {
					this.record('mutation', {
						url: window.location.href,
						title: document.title,
					})
				}, MUTATION_DEBOUNCE_MS)
			})
			this.#mutationObserver.observe(document.body, {
				childList: true,
				subtree: true,
				attributes: false,
			})
		} else {
			console.warn('[ContextObserver] document.body not available, skipping MutationObserver')
		}
	}

	// ========================================================================
	// Internal: Flush to IndexedDB
	// ========================================================================

	async #flush() {
		if (this.#events.length === 0) return
		const batch = this.#events.splice(0, this.#events.length)
		try {
			await saveContextEvents(batch)
			console.log(`[ContextObserver] Flushed ${batch.length} events to IndexedDB`)
			// Sync to background for global cross-tab access
			// (content script and background have different origins → different IndexedDBs)
			chrome.runtime
				.sendMessage({
					type: 'SYNC_DB',
					action: 'sync_context_events',
					payload: { events: batch },
				})
				.catch((err) => {
					// Silently ignore sync errors — local DB is the source of truth
					console.warn('[ContextObserver] Background sync failed:', err)
				})
		} catch (err) {
			console.error('[ContextObserver] Flush failed:', err)
			// Re-enqueue failed events at the BACK (not front) so new events
			// don't get stuck behind permanently-failing old events.
			if (this.#events.length + batch.length <= MAX_BATCH_SIZE * 2) {
				this.#events.push(...batch)
			}
		}
	}

	// ========================================================================
	// Helpers
	// ========================================================================

	#getLabelText(el: HTMLElement): string | null {
		// aria-labelledby
		const labelledBy = el.getAttribute('aria-labelledby')
		if (labelledBy) {
			const labelEl = document.getElementById(labelledBy)
			if (labelEl) return labelEl.textContent?.trim() ?? null
		}
		// aria-label
		const ariaLabel = el.getAttribute('aria-label')
		if (ariaLabel) return ariaLabel
		// <label for="id">
		if (el.id) {
			const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
			if (label) return label.textContent?.trim() ?? null
		}
		// parent <label>
		const parentLabel = el.closest('label')
		if (parentLabel) return parentLabel.textContent?.trim() ?? null
		// placeholder as fallback
		return (el as HTMLInputElement).placeholder || null
	}

	/**
	 * Store input value for suggestion cold-start, if not sensitive.
	 */
	async #maybeStoreInputValue(
		target: HTMLInputElement | HTMLTextAreaElement,
		label: string | null
	) {
		const field = {
			tagName: target.tagName,
			type: target.type,
			name: target.getAttribute('name') ?? undefined,
			id: target.id || undefined,
			placeholder: target.placeholder || undefined,
			label,
		}
		if (isSensitiveField(field)) return
		const value = target.value.trim()
		if (!value || value.length > 200) return
		// Reject values that are all stop words
		const valueWords = value.toLowerCase().split(/[^a-z0-9一-龥]+/).filter((w) => w.length > 0)
		if (valueWords.length > 0 && valueWords.every((w) => isStopWord(w))) return
		// Reject values too similar to placeholder (UI noise)
		const placeholder = target.placeholder?.trim().toLowerCase() ?? ''
		if (placeholder && value.toLowerCase() === placeholder) return
		const fieldKey = [label, target.getAttribute('name'), target.id, target.placeholder]
			.filter(Boolean)
			.join('|')
			.slice(0, 200)
		try {
			await saveInputValue({
				domain: new URL(window.location.href).hostname,
				fieldKey,
				fieldLabel: label ?? '',
				fieldName: target.getAttribute('name') ?? '',
				fieldPlaceholder: target.placeholder ?? '',
				fieldType: target.type,
				value,
				timestamp: Date.now(),
				useCount: 1,
			})
		} catch (err) {
			console.warn('[ContextObserver] Failed to save input value:', err)
		}
	}
}
