import type { HistoricalEvent } from '@page-agent/core'
import { type DBSchema, type IDBPDatabase, openDB } from 'idb'

const DB_NAME = 'page-agent-ext'
const DB_VERSION = 4 // bumped for accuracy stores

// ============================================================================
// Existing: Session Records (Task-driven agent)
// ============================================================================

export interface SessionRecord {
	id: string
	task: string
	history: HistoricalEvent[]
	status: 'completed' | 'error'
	createdAt: number
}

// ============================================================================
// New: Context Events (Sidecar continuous observation)
// ============================================================================

export type ContextEventType =
	| 'scroll'
	| 'focus'
	| 'input'
	| 'click'
	| 'mutation'
	| 'tab_activated'
	| 'tab_updated'
	| 'page_visibility'
	| 'reading_detected'
	| 'form_detected'
	| 'selection'
	| 'hover'
	| 'viewport'
export interface ContextEventRecord {
	id: string
	tabId: number
	url: string
	title: string
	domain: string
	type: ContextEventType
	timestamp: number
	data: Record<string, unknown>
}

// ============================================================================
// New: Saved Articles (Reading mode)
// ============================================================================

export interface SavedArticleRecord {
	id: string
	tabId: number
	url: string
	title: string
	domain: string
	markdown: string
	metadata: {
		savedAt: number
		readingScore: number
		dwellTimeMs: number
		wordCount: number
		scrollDepth: number
	}
	images: { src: string; alt?: string; caption?: string }[]
	tables: { html: string; markdown: string }[]
}

// ============================================================================
// New: Annotations / Dataset for cold-start training
// ============================================================================

export interface AnnotationRecord {
	id: string
	tabId: number
	url: string
	domain: string
	eventId: string // links to ContextEventRecord
	label: 'useful' | 'not_useful' | 'correct' | 'incorrect' | 'saved' | 'dismissed'
	annotatedAt: number
	notes?: string
	contextSnapshot: ContextEventRecord[] // surrounding events at annotation time
}

// ============================================================================
// New: Input Values (for form suggestion cold-start)
// ============================================================================

export interface InputValueRecord {
	id: string
	domain: string
	fieldKey: string // normalized field identifier
	fieldLabel: string
	fieldName: string
	fieldPlaceholder: string
	fieldType: string
	value: string
	timestamp: number
	useCount: number
}

// ============================================================================
// Accuracy data (form suggestion quality tracking)
// ============================================================================

export interface ContextSnapshot {
	pageTitle: string
	url: string
	domain: string
	path: string
	visibleHeadings: string[]
	headingTokens: Record<string, number>
	viewportTokens: Record<string, number>
	articleTokens?: Record<string, number>
	keyPhrases: string[]
	contextEventIds?: string[]
}
export interface AccuracySessionRecord {
	id: string
	sessionId: string
	timestamp: number
	tabId: number
	url: string
	domain: string
	path: string
	field: {
		tagName: string
		type?: string
		name?: string
		id?: string
		placeholder?: string
		label?: string | null
	}
	prefix: string
	algorithmOutputs: Record<
		string,
		{
			suggestions: {
				value: string
				confidence: number
				algorithm: string
				explanation: string
				fieldKey: string
			}[]
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

export interface AlgorithmAccuracyRecord {
	algorithmName: string
	totalTriggers: number
	adoptedCount: number
	exactMatchCount: number
	prefixMatchCount: number
	partialMatchCount: number
	missCount: number
	score: number
	lastUpdated: number
}

// ============================================================================
// DB Schema
// ============================================================================

interface PageAgentDB extends DBSchema {
	sessions: {
		key: string
		value: SessionRecord
		indexes: { 'by-created': number }
	}
	contextEvents: {
		key: string
		value: ContextEventRecord
		indexes: {
			'by-timestamp': number
			'by-tab': number
			'by-domain': string
			'by-type': string
		}
	}
	savedArticles: {
		key: string
		value: SavedArticleRecord
		indexes: {
			'by-saved': number
			'by-domain': string
		}
	}
	annotations: {
		key: string
		value: AnnotationRecord
		indexes: {
			'by-event': string
			'by-domain': string
			'by-timestamp': number
		}
	}
	inputValues: {
		key: string
		value: InputValueRecord
		indexes: {
			'by-domain': string
			'by-field-key': string
			'by-timestamp': number
		}
	}
	accuracySessions: {
		key: string
		value: AccuracySessionRecord
		indexes: {
			'by-timestamp': number
			'by-domain': string
		}
	}
	accuracySummary: {
		key: string
		value: AlgorithmAccuracyRecord
		indexes: object
	}
}

let dbPromise: Promise<IDBPDatabase<PageAgentDB>> | null = null

function getDB() {
	if (!dbPromise) {
		dbPromise = openDB<PageAgentDB>(DB_NAME, DB_VERSION, {
			upgrade(db, oldVersion) {
				if (oldVersion < 1) {
					const sessionsStore = db.createObjectStore('sessions', { keyPath: 'id' })
					sessionsStore.createIndex('by-created', 'createdAt')
				}
				if (oldVersion < 2) {
					const ctxStore = db.createObjectStore('contextEvents', { keyPath: 'id' })
					ctxStore.createIndex('by-timestamp', 'timestamp')
					ctxStore.createIndex('by-tab', 'tabId')
					ctxStore.createIndex('by-domain', 'domain')
					ctxStore.createIndex('by-type', 'type')

					const articlesStore = db.createObjectStore('savedArticles', { keyPath: 'id' })
					articlesStore.createIndex('by-saved', 'metadata.savedAt')
					articlesStore.createIndex('by-domain', 'domain')

					const annoStore = db.createObjectStore('annotations', { keyPath: 'id' })
					annoStore.createIndex('by-event', 'eventId')
					annoStore.createIndex('by-domain', 'domain')
					annoStore.createIndex('by-timestamp', 'annotatedAt')
				}
				if (oldVersion < 3) {
					const inputStore = db.createObjectStore('inputValues', { keyPath: 'id' })
					inputStore.createIndex('by-domain', 'domain')
					inputStore.createIndex('by-field-key', 'fieldKey')
					inputStore.createIndex('by-timestamp', 'timestamp')
				}
				if (oldVersion < 4) {
					const accSessionStore = db.createObjectStore('accuracySessions', { keyPath: 'id' })
					accSessionStore.createIndex('by-timestamp', 'timestamp')
					accSessionStore.createIndex('by-domain', 'domain')
					db.createObjectStore('accuracySummary', { keyPath: 'algorithmName' })
				}
			},
		})
	}
	return dbPromise
}

// ============================================================================
// Sessions (existing)
// ============================================================================

export async function saveSession(
	session: Omit<SessionRecord, 'id' | 'createdAt'>
): Promise<SessionRecord> {
	const db = await getDB()
	const record: SessionRecord = {
		...session,
		id: crypto.randomUUID(),
		createdAt: Date.now(),
	}
	await db.put('sessions', record)
	return record
}

export async function listSessions(): Promise<SessionRecord[]> {
	const db = await getDB()
	const all = await db.getAllFromIndex('sessions', 'by-created')
	return all.reverse()
}

export async function getSession(id: string): Promise<SessionRecord | undefined> {
	const db = await getDB()
	return db.get('sessions', id)
}

export async function deleteSession(id: string): Promise<void> {
	const db = await getDB()
	await db.delete('sessions', id)
}

export async function clearSessions(): Promise<void> {
	const db = await getDB()
	await db.clear('sessions')
}

// ============================================================================
// Context Events (new)
// ============================================================================

export async function saveContextEvent(event: ContextEventRecord): Promise<void> {
	const db = await getDB()
	await db.put('contextEvents', event)
}

export async function saveContextEvents(events: ContextEventRecord[]): Promise<void> {
	const db = await getDB()
	const tx = db.transaction('contextEvents', 'readwrite')
	await Promise.all(events.map((e) => tx.store.put(e)))
	await tx.done
}

/** Query events in a fixed sliding time window (default 5 min) */
export async function queryContextEvents(
	options: {
		tabId?: number
		domain?: string
		type?: ContextEventType
		windowMs?: number
		limit?: number
	} = {}
): Promise<ContextEventRecord[]> {
	const { tabId, domain, type, windowMs = 5 * 60 * 1000, limit = 500 } = options
	const db = await getDB()
	const since = Date.now() - windowMs

	// Use index to query only events within the time window
	const all = await db.getAllFromIndex(
		'contextEvents',
		'by-timestamp',
		IDBKeyRange.lowerBound(since)
	)
	console.log(`[DB] queryContextEvents: ${all.length} events since ${since}, windowMs=${windowMs}`)
	let filtered = all
	if (tabId !== undefined) filtered = filtered.filter((e) => e.tabId === tabId)
	if (domain !== undefined) filtered = filtered.filter((e) => e.domain === domain)
	if (type !== undefined) filtered = filtered.filter((e) => e.type === type)
	filtered.sort((a, b) => a.timestamp - b.timestamp)
	const result = filtered.slice(-limit)
	console.log(`[DB] queryContextEvents: returning ${result.length} events`)
	return result
}

/** Clear ALL context events (called from content script) */
export async function clearOldContextEvents(): Promise<void> {
	const db = await getDB()
	await db.clear('contextEvents')
}

// ============================================================================
// Saved Articles (new)
// ============================================================================

export async function saveArticle(
	article: Omit<SavedArticleRecord, 'id'>
): Promise<SavedArticleRecord> {
	const db = await getDB()
	const record: SavedArticleRecord = {
		...article,
		id: crypto.randomUUID(),
	}
	await db.put('savedArticles', record)
	return record
}

export async function listSavedArticles(
	options: { domain?: string; limit?: number } = {}
): Promise<SavedArticleRecord[]> {
	const db = await getDB()
	if (options.domain) {
		const all = await db.getAllFromIndex('savedArticles', 'by-domain', options.domain)
		return all.reverse().slice(0, options.limit ?? 100)
	}
	const all = await db.getAllFromIndex('savedArticles', 'by-saved')
	return all.reverse().slice(0, options.limit ?? 100)
}

export async function getSavedArticle(id: string): Promise<SavedArticleRecord | undefined> {
	const db = await getDB()
	return db.get('savedArticles', id)
}

export async function deleteSavedArticle(id: string): Promise<void> {
	const db = await getDB()
	await db.delete('savedArticles', id)
}

export async function exportSavedArticlesAsMarkdownBundle(): Promise<Record<string, string>> {
	const articles = await listSavedArticles()
	const bundle: Record<string, string> = {}
	for (const article of articles) {
		const filename = `${article.domain}_${article.id.slice(0, 8)}.md`
		bundle[filename] = article.markdown
	}
	return bundle
}

// ============================================================================
// Annotations / Dataset (new)
// ============================================================================

export async function saveAnnotation(
	annotation: Omit<AnnotationRecord, 'id'>
): Promise<AnnotationRecord> {
	const db = await getDB()
	const record: AnnotationRecord = {
		...annotation,
		id: crypto.randomUUID(),
	}
	await db.put('annotations', record)
	return record
}

export async function listAnnotations(
	options: { domain?: string; label?: string; limit?: number } = {}
): Promise<AnnotationRecord[]> {
	const db = await getDB()
	const all = await db.getAllFromIndex('annotations', 'by-timestamp')
	let filtered = all
	if (options.domain) filtered = filtered.filter((a) => a.domain === options.domain)
	if (options.label) filtered = filtered.filter((a) => a.label === options.label)
	return filtered.reverse().slice(0, options.limit ?? 500)
}

/** Query annotations within a time window around a given timestamp */
export async function queryAnnotationsByTimeRange(
	centerTimestamp: number,
	windowMs: number = 10 * 60 * 1000
): Promise<AnnotationRecord[]> {
	const db = await getDB()
	const all = await db.getAllFromIndex('annotations', 'by-timestamp')
	const min = centerTimestamp - windowMs
	const max = centerTimestamp + windowMs
	return all.filter((a) => a.annotatedAt >= min && a.annotatedAt <= max)
}

/** Export annotations as JSONL for training a local model.
 *  NOTE: Excludes raw contextSnapshot to avoid leaking browsing history.
 */
export async function exportAnnotationsAsJSONL(): Promise<string> {
	const annotations = await listAnnotations({ limit: 10000 })
	const lines = annotations.map((a) =>
		JSON.stringify({
			label: a.label,
			domain: a.domain,
			notes: a.notes,
			timestamp: a.annotatedAt,
			// Intentionally omit contextSnapshot which contains URLs, titles,
			// click coordinates, and field metadata from surrounding events.
		})
	)
	return lines.join('\n')
}

export async function deleteAnnotation(id: string): Promise<void> {
	const db = await getDB()
	await db.delete('annotations', id)
}

// ============================================================================
// Input Values (for form suggestion cold-start)
// ============================================================================

export async function saveInputValue(
	record: Omit<InputValueRecord, 'id'>
): Promise<InputValueRecord> {
	const db = await getDB()
	// Query by domain first (scoped), then filter by fieldKey to avoid
	// loading cross-domain values into memory.
	const domainRecords = await db.getAllFromIndex('inputValues', 'by-domain', record.domain)
	const sameValue = domainRecords.find(
		(e) => e.value === record.value && e.fieldKey === record.fieldKey
	)
	if (sameValue) {
		// Increment useCount instead of creating duplicate
		sameValue.useCount += 1
		sameValue.timestamp = Date.now()
		await db.put('inputValues', sameValue)
		return sameValue
	}
	const newRecord: InputValueRecord = {
		...record,
		id: crypto.randomUUID(),
	}
	await db.put('inputValues', newRecord)
	return newRecord
}

export async function queryInputValues(
	options: {
		domain?: string
		fieldKey?: string
		windowMs?: number
		limit?: number
	} = {}
): Promise<InputValueRecord[]> {
	const { domain, fieldKey, windowMs = 90 * 24 * 60 * 60 * 1000, limit = 500 } = options
	const db = await getDB()
	const since = Date.now() - windowMs

	let candidates: InputValueRecord[]

	if (domain !== undefined) {
		// Scoped query: use domain index to avoid full table scan
		candidates = await db.getAllFromIndex('inputValues', 'by-domain', domain)
		candidates = candidates.filter((e) => e.timestamp >= since)
	} else {
		// Unscoped query: walk the timestamp index backwards with a cursor
		// and stop once we have enough records within the time window.
		candidates = []
		const tx = db.transaction('inputValues', 'readonly')
		const index = tx.store.index('by-timestamp')
		const cursor = await index.openCursor(null, 'prev')
		while (cursor) {
			if (cursor.value.timestamp < since) break
			candidates.push(cursor.value)
			if (candidates.length >= limit * 2) break // oversample to allow post-filtering
			await cursor.continue()
		}
		await tx.done
	}

	if (fieldKey !== undefined) {
		candidates = candidates.filter((e) => e.fieldKey === fieldKey)
	}

	candidates.sort((a, b) => b.timestamp - a.timestamp)
	return candidates.slice(0, limit)
}

export async function clearInputValues(): Promise<void> {
	const db = await getDB()
	await db.clear('inputValues')
}

// ============================================================================
// Accuracy Sessions
// ============================================================================

export async function saveAccuracySession(
	session: AccuracySessionRecord
): Promise<AccuracySessionRecord> {
	const db = await getDB()
	await db.put('accuracySessions', session)
	return session
}

export async function queryAccuracySessions(
	options: { domain?: string; windowMs?: number; limit?: number } = {}
): Promise<AccuracySessionRecord[]> {
	const { domain, windowMs = 90 * 24 * 60 * 60 * 1000, limit = 5000 } = options
	const db = await getDB()
	const since = Date.now() - windowMs
	const all = await db.getAllFromIndex(
		'accuracySessions',
		'by-timestamp',
		IDBKeyRange.lowerBound(since)
	)
	let filtered = all
	if (domain !== undefined) filtered = filtered.filter((e) => e.domain === domain)
	filtered.sort((a, b) => b.timestamp - a.timestamp)
	return filtered.slice(0, limit)
}

export async function clearAccuracySessions(): Promise<void> {
	const db = await getDB()
	await db.clear('accuracySessions')
}

// ============================================================================
// Accuracy Summary
// ============================================================================

export async function saveAccuracySummary(summary: AlgorithmAccuracyRecord): Promise<void> {
	const db = await getDB()
	await db.put('accuracySummary', summary)
}

export async function getAccuracySummary(
	algorithmName: string
): Promise<AlgorithmAccuracyRecord | undefined> {
	const db = await getDB()
	return db.get('accuracySummary', algorithmName)
}

export async function listAccuracySummaries(): Promise<AlgorithmAccuracyRecord[]> {
	const db = await getDB()
	return db.getAll('accuracySummary')
}

export async function clearAccuracySummaries(): Promise<void> {
	const db = await getDB()
	await db.clear('accuracySummary')
}
