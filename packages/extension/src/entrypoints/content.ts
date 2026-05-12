import { initPageController } from '@/agent/RemotePageController.content'
import { clearOldContextEvents, queryContextEvents, saveArticle } from '@/lib/db'
import { pluginManager } from '@/sidecar/AlgorithmPluginManager'
import { type ArticleExtraction, extractArticle } from '@/sidecar/ArticleExtractor'
import { ContextObserver } from '@/sidecar/ContextObserver'
import { FormDetector } from '@/sidecar/FormDetector'
import { scanPageForms } from '@/sidecar/FormScanner'
import { ReadingDetector, type ReadingScore } from '@/sidecar/ReadingDetector'
import { RuleBasedAlgorithm, parseRuleBasedConfig } from '@/sidecar/RuleEngine'
import { SandboxJSAlgorithm, parseSandboxJSConfig } from '@/sidecar/SandboxJSAlgorithm'
import { hideSidecarBorder, showSidecarBorder } from '@/sidecar/SidecarBorder'
import { type SidecarState, isSidecarMessage } from '@/sidecar/SidecarMessaging'
import { PrefixMatchAlgorithm, SemanticFrequencyAlgorithm } from '@/sidecar/SuggestionEngine'

// import { DEMO_CONFIG } from '@/agent/constants'

const DEBUG_PREFIX = '[Content]'

// --------------------------------------------------------------------------
// Extension context validity checker
// --------------------------------------------------------------------------

function isExtensionContextValid(): boolean {
	try {
		return !!chrome.runtime.id
	} catch {
		return false
	}
}

function safeStorageGet(
	keys: string | string[] | Record<string, any> | null
): Promise<Record<string, any>> {
	if (!isExtensionContextValid()) return Promise.resolve({})
	return chrome.storage.local.get(keys).catch((err) => {
		const msg = String(err)
		if (
			msg.includes('Extension context invalidated') ||
			msg.includes('Could not establish connection')
		) {
			return {}
		}
		throw err
	})
}

function safeStorageSet(items: Record<string, any>): Promise<void> {
	if (!isExtensionContextValid()) return Promise.resolve()
	return chrome.storage.local.set(items).catch((err) => {
		const msg = String(err)
		if (
			msg.includes('Extension context invalidated') ||
			msg.includes('Could not establish connection')
		) {
			return
		}
		throw err
	})
}

export default defineContentScript({
	matches: ['<all_urls>'],
	runAt: 'document_end',

	main() {
		if (!isExtensionContextValid()) {
			console.warn('[Content] Extension context invalidated on load — skipping sidecar init')
			return
		}

		console.debug(`${DEBUG_PREFIX} Loaded on ${window.location.href}`)
		initPageController()
		initSidecar()

		// if auth token matches, expose agent to page
		safeStorageGet('PageAgentExtUserAuthToken')
			.then((result) => {
				const extToken = result.PageAgentExtUserAuthToken
				if (!extToken) return

				const pageToken = localStorage.getItem('PageAgentExtUserAuthToken')
				if (!pageToken) return
				if (pageToken !== extToken) return

				console.log('[PageAgentExt]: Auth tokens match. Exposing agent to page.')
				exposeAgentToPage().then(() => injectScript('/main-world.js'))
			})
			.catch((err) => {
				console.warn('[Content] Failed to read auth token:', err)
			})
	},
})

// ========================================================================
// Sidecar Initialization
// ========================================================================

let sidecarObserver: ContextObserver | null = null
let readingDetector: ReadingDetector | null = null
let formDetector: FormDetector | null = null
let currentTabId = 0
let sidecarEnabled = false

function initSidecar() {
	if (!isExtensionContextValid()) return

	// Get tab id
	chrome.runtime
		.sendMessage({ type: 'PAGE_CONTROL', action: 'get_my_tab_id' })
		.then((response) => {
			if (!isExtensionContextValid()) return
			currentTabId = (response as { tabId: number | null })?.tabId ?? 0
			safeStorageGet('sidecarEnabled')
				.then((result) => {
					if (!isExtensionContextValid()) return
					sidecarEnabled = result.sidecarEnabled ?? true
					if (sidecarEnabled) {
						startSidecar(currentTabId)
						showSidecarBorder()
					}
				})
				.catch((err) => {
					console.warn('[Sidecar] Failed to read sidecarEnabled, defaulting to true:', err)
					sidecarEnabled = true
					startSidecar(currentTabId)
					showSidecarBorder()
				})
		})
		.catch((err) => {
			if (String(err).includes('Extension context invalidated')) return
			console.warn('[Sidecar] Failed to get tabId, using 0', err)
			currentTabId = 0
			safeStorageGet('sidecarEnabled')
				.then((result) => {
					if (!isExtensionContextValid()) return
					sidecarEnabled = result.sidecarEnabled ?? true
					if (sidecarEnabled) {
						startSidecar(0)
						showSidecarBorder()
					}
				})
				.catch((err) => {
					console.warn('[Sidecar] Failed to read sidecarEnabled, defaulting to true:', err)
					sidecarEnabled = true
					startSidecar(0)
					showSidecarBorder()
				})
		})

	// Listen for sidecar toggle from sidepanel
	const storageHandler = (changes: Record<string, chrome.storage.StorageChange>) => {
		if (!isExtensionContextValid()) return
		if (changes.sidecarEnabled) {
			const newVal = changes.sidecarEnabled.newValue as boolean
			if (newVal !== sidecarEnabled) {
				sidecarEnabled = newVal
				if (newVal) {
					startSidecar(currentTabId)
					showSidecarBorder()
				} else {
					stopSidecar()
					hideSidecarBorder()
				}
			}
		}
	}
	chrome.storage.onChanged.addListener(storageHandler)
}

function startSidecar(tabId: number) {
	// Register built-in suggestion algorithms
	pluginManager.registerBuiltIn(new SemanticFrequencyAlgorithm(), {
		name: 'semantic_frequency',
		version: '2.0',
		description: 'Text similarity of label/name/placeholder + frequency weighting',
		type: 'builtin',
	})
	pluginManager.registerBuiltIn(new PrefixMatchAlgorithm(), {
		name: 'prefix_match',
		version: '2.0',
		description: 'Prefix-based matching against historical input values',
		type: 'builtin',
	})
	loadCustomAlgorithms().catch((err) => {
		console.warn('[Sidecar] Failed to load custom algorithms:', err)
	})

	async function loadCustomAlgorithms() {
		const result = await safeStorageGet('advancedConfig')
		const advancedConfig = result.advancedConfig as
			| {
					algorithms?: {
						id: string
						name: string
						type: string
						enabled: boolean
						config?: Record<string, unknown>
						code?: string
					}[]
			  }
			| undefined
		if (!advancedConfig?.algorithms?.length) return

		for (const algo of advancedConfig.algorithms) {
			if (!algo.id || !algo.type || algo.type === 'builtin') continue
			if (!algo.enabled) continue
			try {
				if (algo.type === 'rule_based') {
					const config = parseRuleBasedConfig(algo.config)
					if (!config) {
						console.warn(`[Sidecar] Invalid rule-based config for "${algo.name}"`)
						continue
					}
					pluginManager.registerPlugin(
						{
							name: algo.id,
							version: '1.0',
							description: config.description || `Custom rule-based algorithm "${algo.name}"`,
							type: 'rule_based',
						},
						new RuleBasedAlgorithm(algo.id, config)
					)
				} else if (algo.type === 'sandbox_js') {
					const config = parseSandboxJSConfig({ ...algo.config, code: algo.code })
					if (!config) {
						console.warn(`[Sidecar] Invalid sandbox JS config for "${algo.name}"`)
						continue
					}
					pluginManager.registerPlugin(
						{
							name: algo.id,
							version: '0.1',
							description: config.description || `Custom sandbox JS algorithm "${algo.name}"`,
							type: 'sandbox_js',
						},
						new SandboxJSAlgorithm(algo.id, config)
					)
				}
			} catch (err) {
				console.warn(`[Sidecar] Failed to register custom algorithm "${algo.name}":`, err)
			}
		}
	}

	if (sidecarObserver) return

	sidecarObserver = new ContextObserver(tabId, { enabled: true })

	readingDetector = new ReadingDetector(sidecarObserver, (score) => {
		if (!isExtensionContextValid()) return
		safeStorageSet({
			[`sidecarReading_${tabId}`]: {
				...score,
				url: window.location.href,
				title: document.title,
				domain: new URL(window.location.href).hostname,
			},
		}).catch((err) => {
			console.warn('[Sidecar] Failed to save reading score:', err)
		})
	})

	formDetector = new FormDetector(sidecarObserver, (suggestions, fieldLabel, sessionId) => {
		if (!isExtensionContextValid()) return
		safeStorageSet({
			[`sidecarForms_${tabId}`]: {
				suggestions,
				fieldLabel,
				sessionId,
				url: window.location.href,
				domain: new URL(window.location.href).hostname,
				timestamp: Date.now(),
			},
		}).catch((err) => {
			console.warn('[Sidecar] Failed to save form suggestions:', err)
		})
	})
}

function stopSidecar() {
	if (sidecarObserver) {
		sidecarObserver.dispose()
		sidecarObserver = null
	}
	readingDetector = null
	formDetector = null
}

// --------------------------------------------------------------------------
// Article extraction (returns data to sidepanel for storage)
// --------------------------------------------------------------------------

function triggerSaveArticle(
	tabId: number,
	score: ReadingScore
): ArticleExtraction & {
	tabId: number
	url: string
	title: string
	domain: string
	readingScore: number
	dwellTimeMs: number
} {
	const extracted = extractArticle(document)
	const url = document.location.href
	const title = document.title
	const domain = new URL(url).hostname

	return {
		...extracted,
		tabId,
		url,
		title,
		domain,
		readingScore: score.score,
		dwellTimeMs: score.dwellTimeMs,
	}
}

// Listen for messages from sidepanel / background
chrome.runtime.onMessage.addListener((message, sender, sendResponse): true | undefined => {
	if (!isExtensionContextValid()) {
		sendResponse({ success: false, error: 'Extension context invalidated' })
		return true
	}
	// Validate sender: only accept messages from our own extension
	if (!sender.id || sender.id !== chrome.runtime.id) {
		sendResponse({ success: false, error: 'Unauthorized sender' })
		return true
	}
	if (!isSidecarMessage(message)) return

	const { action, payload } = message
	const now = Date.now()

	switch (action) {
		case 'get_state': {
			const state: SidecarState = {
				url: window.location.href,
				title: document.title,
				readingScore: readingDetector?.getScore() ?? null,
				recentEvents: sidecarObserver?.eventCount ?? 0,
				lastActivityAt: now,
			}
			sendResponse({ success: true, state })
			return true
		}

		case 'get_reading_score': {
			const score = readingDetector?.getScore() ?? null
			sendResponse({ success: true, score })
			return true
		}

		case 'get_form_suggestions': {
			const field = payload?.field as
				| { tagName: string; type?: string; name?: string; label?: string }
				| undefined
			if (!field || !formDetector) {
				sendResponse({ success: false, error: 'No field provided or detector not ready' })
				return true
			}
			formDetector
				.suggestForField(field)
				.then((suggestions) => {
					sendResponse({ success: true, suggestions })
				})
				.catch((err) => {
					sendResponse({ success: false, error: String(err) })
				})
			return true
		}

		case 'trigger_save_article': {
			const score = readingDetector?.getScore()
			if (!score) {
				sendResponse({ success: false, error: 'Reading detector not ready' })
				return true
			}
			const article = triggerSaveArticle(currentTabId, score)
			sendResponse({ success: true, article })
			return true
		}

		case 'query_context_events': {
			const windowMs = payload?.windowMs as number | undefined
			const limit = payload?.limit as number | undefined
			queryContextEvents({ windowMs, limit })
				.then((events) => {
					// Return newest first
					const sorted = events.sort((a, b) => b.timestamp - a.timestamp)
					console.log(`[Sidecar] query_context_events: returning ${sorted.length} events`)
					sendResponse({ success: true, events: sorted })
				})
				.catch((err) => {
					console.error('[Sidecar] query_context_events failed:', err)
					sendResponse({ success: false, error: String(err) })
				})
			return true
		}

		case 'clear_context_events': {
			clearOldContextEvents()
				.then(() => {
					sendResponse({ success: true })
				})
				.catch((err) => {
					console.error('[Sidecar] clear_context_events failed:', err)
					sendResponse({ success: false, error: String(err) })
				})
			return true
		}

		case 'fill_field': {
			const value = payload?.value as string | undefined
			if (!value) {
				sendResponse({ success: false, error: 'No value provided' })
				return true
			}
			// Find currently focused input element
			const activeEl = document.activeElement
			if (activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement) {
				activeEl.value = value
				activeEl.dispatchEvent(new Event('input', { bubbles: true }))
				activeEl.dispatchEvent(new Event('change', { bubbles: true }))
				// Record as auto-filled
				sidecarObserver?.record('input', {
					tagName: activeEl.tagName,
					type: activeEl.type,
					name: activeEl.getAttribute('name'),
					id: activeEl.id,
					label: null,
					valueLength: value.length,
					autoFilled: true,
				})
				sendResponse({ success: true })
			} else {
				sendResponse({ success: false, error: 'No focused input element found' })
			}
			return true
		}

		case 'focus_field': {
			const fieldData = payload?.field as
				| { label?: string; name?: string; id?: string; type?: string }
				| undefined
			if (!fieldData) {
				sendResponse({ success: false, error: 'No field data provided' })
				return true
			}
			// Try to find the field by various attributes
			let targetEl: HTMLElement | null = null
			if (fieldData.id) {
				targetEl = document.getElementById(fieldData.id)
			}
			if (!targetEl && fieldData.name) {
				targetEl = document.querySelector(
					`input[name="${CSS.escape(fieldData.name)}"], textarea[name="${CSS.escape(fieldData.name)}"]`
				)
			}
			if (!targetEl && fieldData.label) {
				// Try to find by associated label
				const labels = Array.from(document.querySelectorAll('label'))
				const matchedLabel = labels.find((l) =>
					l.textContent?.trim().toLowerCase().includes(fieldData.label!.toLowerCase())
				)
				if (matchedLabel) {
					const forAttr = matchedLabel.getAttribute('for')
					if (forAttr) {
						targetEl = document.getElementById(forAttr)
					} else {
						targetEl = matchedLabel.querySelector('input, textarea')
					}
				}
			}
			if (
				targetEl &&
				(targetEl instanceof HTMLInputElement || targetEl instanceof HTMLTextAreaElement)
			) {
				targetEl.focus()
				targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
				// Briefly highlight the field
				const originalOutline = targetEl.style.outline
				targetEl.style.outline = '2px solid #3b82f6'
				targetEl.style.outlineOffset = '2px'
				setTimeout(() => {
					targetEl!.style.outline = originalOutline
					targetEl!.style.outlineOffset = ''
				}, 2000)
				sendResponse({ success: true })
			} else {
				sendResponse({ success: false, error: 'Field not found on page' })
			}
			return true
		}

		case 'focus_field_by_selector': {
			const selector = payload?.selector as string | undefined
			if (!selector) {
				sendResponse({ success: false, error: 'No selector provided' })
				return true
			}
			let el: HTMLElement | null = null
			try {
				el = document.querySelector(selector) as HTMLElement | null
			} catch {
				sendResponse({ success: false, error: 'Invalid selector' })
				return true
			}
			if (
				el &&
				(el instanceof HTMLInputElement ||
					el instanceof HTMLTextAreaElement ||
					el instanceof HTMLSelectElement)
			) {
				el.focus()
				el.scrollIntoView({ behavior: 'smooth', block: 'center' })
				// Manually dispatch focusin event so FormDetector captures it
				el.dispatchEvent(new FocusEvent('focusin', { bubbles: true, relatedTarget: el }))
				const originalOutline = el.style.outline
				el.style.outline = '2px solid #3b82f6'
				el.style.outlineOffset = '2px'
				setTimeout(() => {
					el.style.outline = originalOutline
					el.style.outlineOffset = ''
				}, 2000)
				sendResponse({ success: true })
			} else {
				sendResponse({ success: false, error: 'Element not found or not focusable' })
			}
			return true
		}

		case 'scan_page_forms': {
			const result = scanPageForms()
			sendResponse({ success: true, result })
			return true
		}

		case 'record_adoption': {
			const { sessionId, algorithm, value } = (payload ?? {}) as Record<string, string>
			if (formDetector && sessionId && algorithm && value) {
				formDetector.recordAdoption(sessionId, algorithm, value)
				sendResponse({ success: true })
			} else {
				sendResponse({
					success: false,
					error: 'Missing parameters or formDetector not initialized',
				})
			}
			return true
		}

		default:
			sendResponse({ success: false, error: `Unknown sidecar action: ${action}` })
			return true
	}
})

// ... rest of exposeAgentToPage remains unchanged

async function exposeAgentToPage() {
	if (!isExtensionContextValid()) return

	const { MultiPageAgent } = await import('@/agent/MultiPageAgent')
	console.log('[PageAgentExt]: MultiPageAgent loaded')

	let multiPageAgent: InstanceType<typeof MultiPageAgent> | null = null

	window.addEventListener('message', async (e) => {
		if (e.source !== window) return
		if (!isExtensionContextValid()) return

		const data = e.data
		if (typeof data !== 'object' || data === null) return
		if (data.channel !== 'PAGE_AGENT_EXT_REQUEST') return

		const { action, payload, id } = data

		switch (action) {
			case 'execute': {
				if (multiPageAgent && multiPageAgent.status === 'running') {
					window.postMessage(
						{
							channel: 'PAGE_AGENT_EXT_RESPONSE',
							id,
							action: 'execute_result',
							error: 'Agent is already running a task. Please wait until it finishes.',
						},
						'*'
					)
					return
				}

				try {
					const { task, config } = payload
					const { systemInstruction, ...agentConfig } = config

					multiPageAgent?.dispose()

					multiPageAgent = new MultiPageAgent({
						...agentConfig,
						instructions: systemInstruction ? { system: systemInstruction } : undefined,
					})

					multiPageAgent.addEventListener('statuschange', () => {
						if (!multiPageAgent) return
						window.postMessage(
							{
								channel: 'PAGE_AGENT_EXT_RESPONSE',
								id,
								action: 'status_change_event',
								payload: multiPageAgent.status,
							},
							'*'
						)
					})

					multiPageAgent.addEventListener('activity', (event) => {
						if (!multiPageAgent) return
						window.postMessage(
							{
								channel: 'PAGE_AGENT_EXT_RESPONSE',
								id,
								action: 'activity_event',
								payload: (event as CustomEvent).detail,
							},
							'*'
						)
					})

					multiPageAgent.addEventListener('historychange', () => {
						if (!multiPageAgent) return
						window.postMessage(
							{
								channel: 'PAGE_AGENT_EXT_RESPONSE',
								id,
								action: 'history_change_event',
								payload: multiPageAgent.history,
							},
							'*'
						)
					})

					const result = await multiPageAgent.execute(task)

					window.postMessage(
						{
							channel: 'PAGE_AGENT_EXT_RESPONSE',
							id,
							action: 'execute_result',
							payload: result,
						},
						'*'
					)
				} catch (error) {
					window.postMessage(
						{
							channel: 'PAGE_AGENT_EXT_RESPONSE',
							id,
							action: 'execute_result',
							error: (error as Error).message,
						},
						'*'
					)
				}

				break
			}

			case 'stop': {
				multiPageAgent?.stop()
				break
			}

			default:
				console.warn(`${DEBUG_PREFIX} Unknown action from page:`, action)
				break
		}
	})
}
