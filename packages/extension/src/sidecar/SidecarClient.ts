/**
 * SidecarClient - Utilities for the sidepanel to communicate with
 * the sidecar running in the active tab's content script.
 *
 * All sendMessage calls gracefully handle "Extension context invalidated"
 * which occurs when the extension is reloaded while content scripts
 * are still running on open tabs.
 */
import type { ContextEventRecord } from '@/lib/db'
import type { ArticleExtraction } from '@/sidecar/ArticleExtractor'

import type { FormSuggestion } from './FormDetector'
import type { ReadingScore } from './ReadingDetector'
import type { SidecarState } from './SidecarMessaging'

function isExtensionValid(): boolean {
	try {
		// Accessing chrome.runtime.id throws if context is invalidated
		return !!chrome.runtime.id
	} catch {
		return false
	}
}

function handleContextError(err: unknown, action: string): null {
	const msg = String(err)
	if (
		msg.includes('Extension context invalidated') ||
		msg.includes('Receiving end does not exist')
	) {
		console.warn(
			`[SidecarClient] ${action}: Extension context invalidated — reload the page to reconnect`
		)
	} else {
		console.error(`[SidecarClient] ${action} failed:`, err)
	}
	return null
}

export async function getSidecarState(tabId: number): Promise<SidecarState | null> {
	if (!isExtensionValid()) return null
	try {
		const res = await chrome.tabs.sendMessage(tabId, {
			type: 'SIDECAR',
			action: 'get_state',
		})
		return res?.success ? res.state : null
	} catch (err) {
		return handleContextError(err, 'getSidecarState')
	}
}

export async function getReadingScore(tabId: number): Promise<ReadingScore | null> {
	if (!isExtensionValid()) return null
	try {
		const res = await chrome.tabs.sendMessage(tabId, {
			type: 'SIDECAR',
			action: 'get_reading_score',
		})
		return res?.success ? res.score : null
	} catch (err) {
		return handleContextError(err, 'getReadingScore')
	}
}

export async function getFormSuggestions(
	tabId: number,
	field: { tagName: string; type?: string; name?: string; label?: string }
): Promise<FormSuggestion[]> {
	if (!isExtensionValid()) return []
	try {
		const res = await chrome.tabs.sendMessage(tabId, {
			type: 'SIDECAR',
			action: 'get_form_suggestions',
			payload: { field },
		})
		return res?.success ? res.suggestions : []
	} catch (err) {
		return handleContextError(err, 'getFormSuggestions') ?? []
	}
}

export async function triggerSaveArticle(tabId: number): Promise<
	| (ArticleExtraction & {
			tabId: number
			url: string
			title: string
			domain: string
			readingScore: number
			dwellTimeMs: number
	  })
	| null
> {
	if (!isExtensionValid()) return null
	try {
		const res = await chrome.tabs.sendMessage(tabId, {
			type: 'SIDECAR',
			action: 'trigger_save_article',
		})
		return res?.success ? res.article : null
	} catch (err) {
		return handleContextError(err, 'triggerSaveArticle')
	}
}

/**
 * Query context events via background script (global, no tab dependency).
 * Falls back to content script query if background fails.
 */
export async function queryContextEventsGlobal(
	options: {
		windowMs?: number
		limit?: number
		tabId?: number
		domain?: string
		type?: string
	} = {}
): Promise<{ events: ContextEventRecord[]; source: string; error?: string }> {
	if (!isExtensionValid())
		return { events: [], source: 'none', error: 'Extension context invalidated' }

	// Try background first (global, no tab dependency)
	try {
		const res = await chrome.runtime.sendMessage({
			type: 'QUERY_DB',
			action: 'query_context_events',
			payload: options,
		})
		if (res?.success) {
			console.log(
				`[SidecarClient] queryContextEventsGlobal: ${res.events.length} events from background`
			)
			return { events: res.events, source: 'background' }
		}
		console.warn('[SidecarClient] background query failed:', res?.error)
	} catch (err) {
		console.warn('[SidecarClient] background query error:', err)
	}

	// Fallback: try active tab content script
	try {
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
		if (!tab?.id) {
			return { events: [], source: 'none', error: 'No active tab' }
		}
		const res = await chrome.tabs.sendMessage(tab.id, {
			type: 'SIDECAR',
			action: 'query_context_events',
			payload: options,
		})
		if (res?.success) {
			console.log(
				`[SidecarClient] queryContextEventsGlobal: ${res.events.length} events from tab ${tab.id}`
			)
			return { events: res.events, source: 'tab-fallback' }
		}
		return { events: [], source: 'none', error: res?.error || 'Tab query returned no events' }
	} catch (err) {
		const errMsg = err instanceof Error ? err.message : String(err)
		return { events: [], source: 'none', error: errMsg }
	}
}

export async function clearContextEventsGlobal(): Promise<boolean> {
	if (!isExtensionValid()) return false
	try {
		const res = await chrome.runtime.sendMessage({
			type: 'QUERY_DB',
			action: 'clear_context_events',
		})
		return res?.success ?? false
	} catch (err) {
		return handleContextError(err, 'clearContextEventsGlobal') ?? false
	}
}

export async function fillFieldInTab(tabId: number, value: string): Promise<boolean> {
	if (!isExtensionValid()) return false
	try {
		const res = await chrome.tabs.sendMessage(tabId, {
			type: 'SIDECAR',
			action: 'fill_field',
			payload: { value },
		})
		return res?.success ?? false
	} catch (err) {
		return handleContextError(err, 'fillFieldInTab') ?? false
	}
}

export async function getActiveTabId(): Promise<number | null> {
	if (!isExtensionValid()) return null
	try {
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
		return tab?.id ?? null
	} catch (err) {
		return handleContextError(err, 'getActiveTabId')
	}
}
