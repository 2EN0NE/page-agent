import { handlePageControlMessage } from '@/agent/RemotePageController.background'
import { handleTabControlMessage, setupTabEventsPort } from '@/agent/TabsController.background'
import {
	clearOldContextEvents,
	queryContextEvents,
	queryInputValues,
	saveContextEvents,
} from '@/lib/db'

export default defineBackground(() => {
	console.log('[Background] Service Worker started')

	// tab change events
	setupTabEventsPort()

	// generate user auth token
	chrome.storage.local.get('PageAgentExtUserAuthToken').then((result) => {
		if (result.PageAgentExtUserAuthToken) return
		const userAuthToken = crypto.randomUUID()
		chrome.storage.local.set({ PageAgentExtUserAuthToken: userAuthToken })
	})

	// message proxy
	chrome.runtime.onMessage.addListener((message, sender, sendResponse): true | undefined => {
		if (message.type === 'TAB_CONTROL') {
			return handleTabControlMessage(message, sender, sendResponse)
		} else if (message.type === 'PAGE_CONTROL') {
			return handlePageControlMessage(message, sender, sendResponse)
		} else if (message.type === 'QUERY_DB') {
			// Global IndexedDB query proxy — reads from background's own IndexedDB
			handleDBQuery(message, sendResponse)
			return true
		} else if (message.type === 'SYNC_DB') {
			// Receive events from content scripts and store in background's global IndexedDB
			handleDBSync(message, sendResponse)
			return true
		} else {
			sendResponse({ error: 'Unknown message type' })
			return
		}
	})

	// external messages (from localhost launcher page via externally_connectable)
	chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
		if (message.type === 'OPEN_HUB') {
			openOrFocusHubTab(message.wsPort).then(() => {
				if (sender.tab?.id) chrome.tabs.remove(sender.tab.id)
				sendResponse({ ok: true })
			})
			return true
		}
	})

	// setup
	chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})
})

// ========================================================================
// Global DB Query Handler (sidepanel → background → IndexedDB)
// ========================================================================

async function handleDBQuery(
	message: { action: string; payload?: Record<string, unknown> },
	sendResponse: (response: unknown) => void
) {
	try {
		switch (message.action) {
			case 'query_context_events': {
				const opts = message.payload ?? {}
				const events = await queryContextEvents({
					windowMs: (opts.windowMs as number) ?? undefined,
					limit: (opts.limit as number) ?? undefined,
					tabId: (opts.tabId as number) ?? undefined,
					domain: (opts.domain as string) ?? undefined,
					type: (opts.type as any) ?? undefined,
				})
				console.log(`[Background] query_context_events: returning ${events.length} events`)
				sendResponse({ success: true, events })
				break
			}
			case 'clear_context_events': {
				await clearOldContextEvents()
				console.log('[Background] clear_context_events: done')
				sendResponse({ success: true })
				break
			}
			case 'query_input_values': {
				const opts = message.payload ?? {}
				const values = await queryInputValues({
					domain: (opts.domain as string) ?? undefined,
					fieldKey: (opts.fieldKey as string) ?? undefined,
					windowMs: (opts.windowMs as number) ?? undefined,
					limit: (opts.limit as number) ?? undefined,
				})
				console.log(`[Background] query_input_values: returning ${values.length} values`)
				sendResponse({ success: true, values })
				break
			}
			default:
				sendResponse({ success: false, error: `Unknown DB action: ${message.action}` })
		}
	} catch (err) {
		console.error('[Background] DB query failed:', err)
		sendResponse({ success: false, error: String(err) })
	}
}

// ========================================================================
// DB Sync Handler (content script → background → IndexedDB)
// ========================================================================

async function handleDBSync(
	message: { action: string; payload?: Record<string, unknown> },
	sendResponse: (response: unknown) => void
) {
	try {
		if (message.action === 'sync_context_events') {
			const events = (message.payload?.events as any[]) ?? []
			if (events.length > 0) {
				await saveContextEvents(events)
				console.log(`[Background] Synced ${events.length} events from content script`)
			}
			sendResponse({ success: true, synced: events.length })
		} else {
			sendResponse({ success: false, error: `Unknown sync action: ${message.action}` })
		}
	} catch (err) {
		console.error('[Background] DB sync failed:', err)
		sendResponse({ success: false, error: String(err) })
	}
}

async function openOrFocusHubTab(wsPort: number) {
	const hubUrl = chrome.runtime.getURL('hub.html')
	const existing = await chrome.tabs.query({ url: `${hubUrl}*` })

	if (existing.length > 0 && existing[0].id) {
		await chrome.tabs.update(existing[0].id, {
			active: true,
			url: `${hubUrl}?ws=${wsPort}`,
		})
		return
	}

	await chrome.tabs.create({ url: `${hubUrl}?ws=${wsPort}`, pinned: true })
}
