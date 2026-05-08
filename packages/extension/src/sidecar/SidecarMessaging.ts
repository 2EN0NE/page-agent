/**
 * SidecarMessaging - Message bridge between content script (observer)
 * and sidepanel / background.
 *
 * Content script registers a listener. Sidepanel sends messages via
 * chrome.tabs.sendMessage to request sidecar state.
 */
import type { FormSuggestion } from './FormDetector'
import type { ReadingScore } from './ReadingDetector'

export interface SidecarState {
	url: string
	title: string
	readingScore: ReadingScore | null
	recentEvents: number
	lastActivityAt: number
}

export interface SidecarMessage {
	type: 'SIDECAR'
	action:
		| 'get_state'
		| 'get_reading_score'
		| 'get_form_suggestions'
		| 'trigger_save_article'
		| 'query_context_events'
		| 'clear_context_events'
		| 'fill_field'
		| 'focus_field'
		| 'focus_field_by_selector'
		| 'scan_page_forms'
	payload?: Record<string, unknown>
}

export type SidecarResponse =
	| { success: true; state: SidecarState }
	| { success: true; score: ReadingScore }
	| { success: true; suggestions: FormSuggestion[] }
	| { success: true; articleId: string }
	| { success: false; error: string }

export function isSidecarMessage(message: unknown): message is SidecarMessage {
	if (typeof message !== 'object' || message === null) return false
	const m = message as Record<string, unknown>
	return m.type === 'SIDECAR' && typeof m.action === 'string' && m.action.length > 0
}
