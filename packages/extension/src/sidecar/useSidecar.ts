/**
 * useSidecar - React hook for connecting the sidepanel to the sidecar
 * running in the active tab's content script.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { saveArticle as saveArticleToDB } from '@/lib/db'
import type { FormSuggestion } from '@/sidecar/FormDetector'
import type { ReadingScore } from '@/sidecar/ReadingDetector'

import {
	fillFieldInTab,
	getActiveTabId,
	getReadingScore,
	getSidecarState,
	recordAdoptionInTab,
	triggerSaveArticle,
} from './SidecarClient'
import type { SidecarState } from './SidecarMessaging'

export interface SidecarInfo {
	loading: boolean
	tabId: number | null
	state: SidecarState | null
	readingScore: ReadingScore | null
	lastSavedArticleId: string | null
	enabled: boolean
}

export function useSidecar(pollInterval = 3000) {
	const [info, setInfo] = useState<SidecarInfo>({
		loading: true,
		tabId: null,
		state: null,
		readingScore: null,
		lastSavedArticleId: null,
		enabled: true,
	})
	const timerRef = useRef<number | null>(null)

	// Load enabled state
	useEffect(() => {
		chrome.storage.local.get('sidecarEnabled').then((result) => {
			const val = result.sidecarEnabled
			setInfo((prev) => ({
				...prev,
				enabled: (val === undefined ? true : val) as boolean,
			}))
		})
	}, [])

	// Listen for enabled state changes
	useEffect(() => {
		const handler = (changes: Record<string, chrome.storage.StorageChange>) => {
			if (changes.sidecarEnabled) {
				setInfo((prev) => ({
					...prev,
					enabled: changes.sidecarEnabled.newValue as boolean,
				}))
			}
		}
		chrome.storage.local.onChanged.addListener(handler)
		return () => chrome.storage.local.onChanged.removeListener(handler)
	}, [])

	const refresh = useCallback(async () => {
		const tabId = await getActiveTabId()
		if (!tabId) {
			setInfo((prev) => ({ ...prev, loading: false, tabId: null }))
			return
		}

		const [state, readingScore] = await Promise.all([
			getSidecarState(tabId),
			getReadingScore(tabId),
		])

		setInfo((prev) => ({
			...prev,
			loading: false,
			tabId,
			state,
			readingScore,
		}))
	}, [])

	const saveArticle = useCallback(async () => {
		const tabId = info.tabId
		if (!tabId) return null
		const article = await triggerSaveArticle(tabId)
		if (!article) return null

		// Save to sidepanel's IndexedDB (same origin as sidepanel)
		const record = await saveArticleToDB({
			tabId: article.tabId,
			url: article.url,
			title: article.title,
			domain: article.domain,
			markdown: article.markdown,
			metadata: {
				savedAt: Date.now(),
				readingScore: article.readingScore,
				dwellTimeMs: article.dwellTimeMs,
				wordCount: article.metadata.wordCount,
				scrollDepth: 0,
			},
			images: article.images,
			tables: article.tables,
		})
		setInfo((prev) => ({ ...prev, lastSavedArticleId: record.id }))
		return record.id
	}, [info.tabId])

	const toggleSidecar = useCallback(async () => {
		const newVal = !info.enabled
		await chrome.storage.local.set({ sidecarEnabled: newVal })
		setInfo((prev) => ({ ...prev, enabled: newVal }))
	}, [info.enabled])

	useEffect(() => {
		refresh()
		timerRef.current = window.setInterval(refresh, pollInterval)
		return () => {
			if (timerRef.current) clearInterval(timerRef.current)
		}
	}, [refresh, pollInterval])

	// Listen for tab activation changes — refresh immediately when user switches tabs
	useEffect(() => {
		const onActivated = () => refresh()
		const onUpdated = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
			// Only refresh on meaningful changes, not loading progress or favicon changes
			if (changeInfo.status === 'complete' || changeInfo.url) {
				refresh()
			}
		}
		chrome.tabs.onActivated.addListener(onActivated)
		chrome.tabs.onUpdated.addListener(onUpdated)
		return () => {
			chrome.tabs.onActivated.removeListener(onActivated)
			chrome.tabs.onUpdated.removeListener(onUpdated)
		}
	}, [refresh])

	// Also listen to storage changes for real-time form suggestions
	const [formSuggestions, setFormSuggestions] = useState<{
		tabId: number
		suggestions: FormSuggestion[]
		fieldLabel: string
		url: string
		sessionId?: string
	} | null>(null)

	useEffect(() => {
		const handler = (changes: Record<string, chrome.storage.StorageChange>) => {
			for (const [key, change] of Object.entries(changes)) {
				if (key.startsWith('sidecarForms_')) {
					const tabId = parseInt(key.replace('sidecarForms_', ''), 10)
					const data = change.newValue as
						| {
								suggestions: FormSuggestion[]
								fieldLabel: string
								url: string
								sessionId?: string
						  }
						| undefined
					if (data && data.suggestions.length > 0) {
						setFormSuggestions({
							tabId,
							suggestions: data.suggestions,
							fieldLabel: data.fieldLabel,
							url: data.url,
							sessionId: data.sessionId,
						})
					} else {
						setFormSuggestions(null)
					}
				}
			}
		}
		chrome.storage.local.onChanged.addListener(handler)
		return () => chrome.storage.local.onChanged.removeListener(handler)
	}, [])

	const fillField = useCallback(
		async (value: string) => {
			const tabId = info.tabId
			if (!tabId) return false
			return fillFieldInTab(tabId, value)
		},
		[info.tabId]
	)

	const recordAdoption = useCallback(
		async (sessionId: string, algorithm: string, value: string) => {
			const tabId = info.tabId
			if (!tabId) return false
			return recordAdoptionInTab(tabId, sessionId, algorithm, value)
		},
		[info.tabId]
	)

	return {
		...info,
		refresh,
		saveArticle,
		toggleSidecar,
		formSuggestions,
		fillField,
		recordAdoption,
	}
}
