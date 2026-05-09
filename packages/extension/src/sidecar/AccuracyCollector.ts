/**
 * AccuracyCollector - Session tracking, outcome recording, match computation.
 *
 * Tracks every suggestion trigger and determines whether each algorithm
 * produced a useful result based on user behavior.
 */
import {
	type AccuracySessionRecord,
	type AlgorithmAccuracyRecord,
	type ContextSnapshot,
	getAccuracySummary as getDbAccuracySummary,
	listAccuracySummaries,
	saveAccuracySession,
	saveAccuracySummary,
} from '@/lib/db'

import type { FormField } from './FormDetector'
import type { SuggestionItem } from './SuggestionEngine'

export interface SuggestionSession {
	sessionId: string
	timestamp: number
	tabId: number
	url: string
	domain: string
	path: string
	field: FormField
	prefix: string
	algorithmOutputs: Record<
		string,
		{
			suggestions: SuggestionItem[]
			topValue: string | null
			topConfidence: number
		}
	>
	outcome?: {
		type: 'adopted' | 'self_filled' | 'ignored' | 'dismissed'
		finalValue?: string
		adoptedAlgorithm?: string
		adoptedValue?: string
		settledAt: number
	}
	contextSnapshot?: ContextSnapshot
}

export type MatchCategory = 'adopted' | 'exactMatch' | 'prefixMatch' | 'partialMatch' | 'miss'

export interface MatchResult {
	category: MatchCategory
	score: number
	matchedValue?: string
}

const SCORE_WEIGHTS: Record<Exclude<MatchCategory, 'miss'>, number> = {
	adopted: 1.0,
	exactMatch: 1.0,
	prefixMatch: 0.7,
	partialMatch: 0.5,
}

/** Normalize Levenshtein distance to 0-1 similarity */
function levenshteinSimilarity(a: string, b: string): number {
	const maxLen = Math.max(a.length, b.length)
	if (maxLen === 0) return 1.0
	const dist = levenshteinDistance(a, b)
	return 1 - dist / maxLen
}

function levenshteinDistance(a: string, b: string): number {
	const m = a.length
	const n = b.length
	if (m === 0) return n
	if (n === 0) return m

	const prev = new Uint32Array(n + 1)
	const curr = new Uint32Array(n + 1)
	for (let j = 0; j <= n; j++) prev[j] = j

	for (let i = 1; i <= m; i++) {
		curr[0] = i
		for (let j = 1; j <= n; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1
			curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
		}
		// swap
		for (let j = 0; j <= n; j++) prev[j] = curr[j]
	}
	return prev[n]
}

export function computeMatchQuality(
	finalValue: string,
	algoSuggestions: SuggestionItem[],
	adoptedAlgorithm?: string,
	adoptedValue?: string
): MatchResult {
	const fv = finalValue.trim().toLowerCase()
	if (!fv) return { category: 'miss', score: 0 }

	// Check if this algorithm's suggestion was directly adopted
	if (adoptedAlgorithm && adoptedValue) {
		const av = adoptedValue.trim().toLowerCase()
		for (const s of algoSuggestions) {
			if (s.value.trim().toLowerCase() === av) {
				return { category: 'adopted', score: SCORE_WEIGHTS.adopted, matchedValue: s.value }
			}
		}
	}

	// Exact match
	for (const s of algoSuggestions) {
		if (s.value.trim().toLowerCase() === fv) {
			return { category: 'exactMatch', score: SCORE_WEIGHTS.exactMatch, matchedValue: s.value }
		}
	}

	// Prefix match (suggestion is prefix of final value)
	for (const s of algoSuggestions) {
		const sv = s.value.trim().toLowerCase()
		if (sv.length > 0 && fv.startsWith(sv)) {
			return { category: 'prefixMatch', score: SCORE_WEIGHTS.prefixMatch, matchedValue: s.value }
		}
	}

	// Partial match by similarity
	for (const s of algoSuggestions) {
		const sim = levenshteinSimilarity(s.value.trim().toLowerCase(), fv)
		if (sim > 0.7) {
			return { category: 'partialMatch', score: SCORE_WEIGHTS.partialMatch, matchedValue: s.value }
		}
	}

	return { category: 'miss', score: 0 }
}

export class AccuracyCollector {
	#activeSessions = new Map<string, SuggestionSession>()
	#fieldSessions = new Map<string, string>() // key -> sessionId
	#summaryCache = new Map<string, AlgorithmAccuracyRecord>()
	#debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

	startSession(session: Omit<SuggestionSession, 'sessionId'>): string {
		const sessionId = crypto.randomUUID()
		const fullSession: SuggestionSession = { ...session, sessionId }

		// If same field already has an active session, settle it first
		const fieldKey = this.#makeFieldKey(session)
		const existingSessionId = this.#fieldSessions.get(fieldKey)
		if (existingSessionId && existingSessionId !== sessionId) {
			const existing = this.#activeSessions.get(existingSessionId)
			if (existing) {
				this.#settleSession(existing, { type: 'ignored', settledAt: Date.now() })
			}
		}

		this.#activeSessions.set(sessionId, fullSession)
		this.#fieldSessions.set(fieldKey, sessionId)

		// Persist raw session immediately
		this.#persistSession(fullSession).catch((err) => {
			console.error('[AccuracyCollector] Failed to persist session:', err)
		})

		return sessionId
	}

	recordAdoption(sessionId: string, algorithm: string, value: string): void {
		const session = this.#activeSessions.get(sessionId)
		if (!session) return
		session.outcome = {
			type: 'adopted',
			adoptedAlgorithm: algorithm,
			adoptedValue: value,
			settledAt: Date.now(),
		}
	}

	recordSelfFill(sessionId: string, finalValue: string): void {
		const session = this.#activeSessions.get(sessionId)
		if (!session) return

		// Debounce to avoid settling on every keystroke
		const existingTimer = this.#debounceTimers.get(sessionId)
		if (existingTimer) globalThis.clearTimeout(existingTimer)

		const timer = globalThis.setTimeout(() => {
			this.#debounceTimers.delete(sessionId)
			const s = this.#activeSessions.get(sessionId)
			if (!s) return
			// If already adopted, settle with the existing outcome instead of overwriting
			if (s.outcome?.type === 'adopted') {
				this.#settleSession(s, s.outcome)
				return
			}
			s.outcome = {
				type: 'self_filled',
				finalValue,
				settledAt: Date.now(),
			}
			this.#settleSession(s, s.outcome)
		}, 500)

		this.#debounceTimers.set(sessionId, timer)
	}

	recordDismiss(sessionId: string): void {
		const session = this.#activeSessions.get(sessionId)
		if (!session) return
		this.#settleSession(session, { type: 'dismissed', settledAt: Date.now() })
	}

	/** Settle any remaining active sessions for a tab (e.g. on tab switch) */
	settleTabSessions(tabId: number): void {
		for (const [sessionId, session] of this.#activeSessions) {
			if (session.tabId === tabId) {
				this.#settleSession(session, { type: 'ignored', settledAt: Date.now() })
			}
		}
	}

	/** Settle all active sessions */
	settleAll(): void {
		for (const [sessionId, session] of this.#activeSessions) {
			this.#settleSession(session, { type: 'ignored', settledAt: Date.now() })
		}
	}

	async getAccuracySummary(
		algorithmName: string,
		windowDays = 30
	): Promise<AlgorithmAccuracyRecord | undefined> {
		// In-memory cache first
		const cached = this.#summaryCache.get(algorithmName)
		if (cached) return cached

		// Fall back to IndexedDB (background script's DB)
		try {
			const dbRecord = await getDbAccuracySummary(algorithmName)
			if (dbRecord) {
				this.#summaryCache.set(algorithmName, dbRecord)
			}
			return dbRecord
		} catch (err) {
			console.error('[AccuracyCollector] Failed to load summary from DB:', err)
			return undefined
		}
	}

	async getAllAccuracySummaries(): Promise<AlgorithmAccuracyRecord[]> {
		try {
			const dbRecords = await listAccuracySummaries()
			// Merge into cache so subsequent reads are fast
			for (const r of dbRecords) {
				this.#summaryCache.set(r.algorithmName, r)
			}
			return dbRecords
		} catch (err) {
			console.error('[AccuracyCollector] Failed to load summaries from DB:', err)
			return Array.from(this.#summaryCache.values())
		}
	}

	#settleSession(session: SuggestionSession, outcome: SuggestionSession['outcome']): void {
		if (!outcome) return
		session.outcome = outcome

		// Clear field mapping
		const fieldKey = this.#makeFieldKey(session)
		const mappedSessionId = this.#fieldSessions.get(fieldKey)
		if (mappedSessionId === session.sessionId) {
			this.#fieldSessions.delete(fieldKey)
		}

		// Clear debounce timer
		const timer = this.#debounceTimers.get(session.sessionId)
		if (timer) {
			globalThis.clearTimeout(timer)
			this.#debounceTimers.delete(session.sessionId)
		}

		// Compute match results for each algorithm
		for (const [algoName, output] of Object.entries(session.algorithmOutputs)) {
			const match = computeMatchQuality(
				outcome.finalValue ?? outcome.adoptedValue ?? '',
				output.suggestions,
				outcome.adoptedAlgorithm,
				outcome.adoptedValue
			)
			this.#updateSummary(algoName, match.category)
		}

		// Persist updated session
		this.#persistSession(session).catch((err) => {
			console.error('[AccuracyCollector] Failed to persist settled session:', err)
		})

		// Persist summary
		this.#persistSummaries().catch((err) => {
			console.error('[AccuracyCollector] Failed to persist summaries:', err)
		})

		// Remove from active
		this.#activeSessions.delete(session.sessionId)
	}

	#updateSummary(algoName: string, category: MatchCategory): void {
		const existing = this.#summaryCache.get(algoName)
		const summary: AlgorithmAccuracyRecord = existing ?? {
			algorithmName: algoName,
			totalTriggers: 0,
			adoptedCount: 0,
			exactMatchCount: 0,
			prefixMatchCount: 0,
			partialMatchCount: 0,
			missCount: 0,
			score: 0,
			lastUpdated: Date.now(),
		}
		summary.totalTriggers += 1
		switch (category) {
			case 'adopted':
				summary.adoptedCount += 1
				break
			case 'exactMatch':
				summary.exactMatchCount += 1
				break
			case 'prefixMatch':
				summary.prefixMatchCount += 1
				break
			case 'partialMatch':
				summary.partialMatchCount += 1
				break
			case 'miss':
				summary.missCount += 1
				break
		}
		const weighted =
			summary.adoptedCount * 1.0 +
			summary.exactMatchCount * 1.0 +
			summary.prefixMatchCount * 0.7 +
			summary.partialMatchCount * 0.5
		summary.score = summary.totalTriggers > 0 ? weighted / summary.totalTriggers : 0
		summary.lastUpdated = Date.now()
		this.#summaryCache.set(algoName, summary)
	}

	#makeFieldKey(session: Pick<SuggestionSession, 'domain' | 'path' | 'field'>): string {
		const { domain, path, field } = session
		const fieldId = `${field.name ?? ''}|${field.id ?? ''}|${field.label ?? ''}|${field.placeholder ?? ''}|${field.type ?? ''}`
		return `${domain}::${path}::${fieldId}`
	}

	async #persistSession(session: SuggestionSession): Promise<void> {
		const record: AccuracySessionRecord = {
			id: session.sessionId,
			sessionId: session.sessionId,
			timestamp: session.timestamp,
			tabId: session.tabId,
			url: session.url,
			domain: session.domain,
			path: session.path,
			field: session.field,
			prefix: session.prefix,
			algorithmOutputs: session.algorithmOutputs,
			outcome: session.outcome,
			contextSnapshot: session.contextSnapshot,
		}
		// Relay to background script so data lands in extension-origin IndexedDB
		// (content-script IndexedDB is isolated to the web page origin).
		// Falls back to local write when chrome.runtime is unavailable (tests).
		try {
			if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
				await chrome.runtime.sendMessage({
					type: 'SYNC_DB',
					action: 'sync_accuracy_session',
					payload: { session: record },
				})
				return
			}
		} catch (err) {
			console.error(
				'[AccuracyCollector] Failed to relay session to background, falling back to local write:',
				err
			)
		}
		await saveAccuracySession(record)
	}

	async #persistSummaries(): Promise<void> {
		const summaries = Array.from(this.#summaryCache.values())
		if (summaries.length === 0) return
		try {
			if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
				await chrome.runtime.sendMessage({
					type: 'SYNC_DB',
					action: 'sync_accuracy_summary',
					payload: { summaries },
				})
				return
			}
		} catch (err) {
			console.error(
				'[AccuracyCollector] Failed to relay summaries to background, falling back to local write:',
				err
			)
		}
		for (const summary of summaries) {
			await saveAccuracySummary(summary)
		}
	}
}

/** Global singleton accuracy collector */
export const accuracyCollector = new AccuracyCollector()
