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

import { isSensitiveField } from './SuggestionEngine'

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
	#lastViewportText: string | null = null
	#hoverTimer: number | null = null
	#lastHoveredElement: string | null = null
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
		if (this.#hoverTimer) window.clearTimeout(this.#hoverTimer)
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

				// Record viewport content if it changed
				const viewportText = this.#getViewportText()
				if (viewportText && viewportText !== this.#lastViewportText) {
					this.#lastViewportText = viewportText
					this.record('viewport', {
						scrollY,
						viewportText,
						headings: this.#getVisibleHeadings(),
					})
				}
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

		// Text selection
		let lastSelection = ''
		const onSelectionChange = () => {
			const selection = document.getSelection()
			const text = selection?.toString().trim().slice(0, 500) ?? ''
			if (text && text !== lastSelection) {
				lastSelection = text
				const anchorNode = selection?.anchorNode?.parentElement
				this.record('selection', {
					text,
					tagName: anchorNode?.tagName ?? null,
					id: anchorNode?.id ?? null,
				})
			}
		}
		document.addEventListener('selectionchange', onSelectionChange)
		this.#listeners.push(() => document.removeEventListener('selectionchange', onSelectionChange))

		// Hover (debounced, per-element dedup)
		const onMouseOver = (e: MouseEvent) => {
			const target = e.target as HTMLElement
			if (!target) return
			const elementKey = `${target.tagName}#${target.id}.${target.className}`
			if (elementKey === this.#lastHoveredElement) return

			if (this.#hoverTimer) {
				window.clearTimeout(this.#hoverTimer)
			}
			this.#hoverTimer = window.setTimeout(() => {
				this.#hoverTimer = null
				this.#lastHoveredElement = elementKey
				this.record('hover', {
					tagName: target.tagName,
					id: target.id || null,
					className: target.className || null,
					text: target.textContent?.slice(0, 200) ?? null,
					x: e.clientX,
					y: e.clientY,
				})
			}, 800)
		}
		document.addEventListener('mouseover', onMouseOver, true)
		this.#listeners.push(() => document.removeEventListener('mouseover', onMouseOver, true))
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
	 * Extract visible text from viewport elements (headings, paragraphs, list items).
	 */
	#getViewportText(): string | null {
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
			return texts.slice(0, 20).join(' | ').slice(0, 1000) || null
		} catch {
			return null
		}
	}

	/**
	 * Extract visible heading texts from the viewport.
	 */
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
