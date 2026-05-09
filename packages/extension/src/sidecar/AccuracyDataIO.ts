/**
 * AccuracyDataIO - Export and import accuracy data via chrome.downloads / file picker.
 *
 * The extension has no filesystem access, so we use:
 *   - chrome.downloads.download() for export
 *   - <input type="file"> + FileReader for import
 */
import {
	type AccuracySessionRecord,
	type AlgorithmAccuracyRecord,
	clearAccuracySessions,
	clearAccuracySummaries,
	listAccuracySummaries,
	queryAccuracySessions,
	saveAccuracySession,
	saveAccuracySummary,
} from '@/lib/db'

export interface AccuracyExportPayload {
	version: 1
	exportedAt: number
	sessions: AccuracySessionRecord[]
	summaries: AlgorithmAccuracyRecord[]
}

export async function exportAccuracyData(): Promise<void> {
	const [sessions, summaries] = await Promise.all([
		queryAccuracySessions({ limit: 10000 }),
		listAccuracySummaries(),
	])

	const payload: AccuracyExportPayload = {
		version: 1,
		exportedAt: Date.now(),
		sessions,
		summaries,
	}

	const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
	const blobUrl = URL.createObjectURL(blob)
	const filename = `page-agent-accuracy-${new Date().toISOString().slice(0, 10)}.json`

	try {
		await chrome.downloads.download({
			url: blobUrl,
			filename,
			saveAs: true,
		})
	} finally {
		// Delay revoking to give Chrome time to start the download
		setTimeout(() => URL.revokeObjectURL(blobUrl), 30000)
	}
}

export async function importAccuracyData(
	file: File
): Promise<{ sessions: number; summaries: number }> {
	const text = await file.text()
	let payload: unknown
	try {
		payload = JSON.parse(text)
	} catch {
		throw new Error('Invalid JSON')
	}

	if (typeof payload !== 'object' || payload === null) {
		throw new Error('Invalid format: expected object')
	}

	const p = payload as Record<string, unknown>
	if (p.version !== 1) {
		throw new Error(`Unsupported export version: ${p.version}`)
	}

	const sessions = Array.isArray(p.sessions) ? (p.sessions as AccuracySessionRecord[]) : []
	const summaries = Array.isArray(p.summaries) ? (p.summaries as AlgorithmAccuracyRecord[]) : []

	// Validate shapes loosely
	for (const s of sessions) {
		if (!s.id || typeof s.timestamp !== 'number') {
			throw new Error('Invalid session record in import file')
		}
	}
	for (const s of summaries) {
		if (!s.algorithmName || typeof s.score !== 'number') {
			throw new Error('Invalid summary record in import file')
		}
	}

	// Merge: overwrite existing records by key
	for (const s of sessions) {
		await saveAccuracySession(s)
	}
	for (const s of summaries) {
		await saveAccuracySummary(s)
	}

	return { sessions: sessions.length, summaries: summaries.length }
}

export async function clearAllAccuracyData(): Promise<void> {
	await Promise.all([clearAccuracySessions(), clearAccuracySummaries()])
}
