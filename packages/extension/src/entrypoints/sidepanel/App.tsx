import type { HistoricalEvent, SidecarActionEvent } from '@page-agent/core'
import { Activity, BookOpen, History, Send, Settings, Square } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ConfigPanel } from '@/components/ConfigPanel'
import { ContextTimelinePanel } from '@/components/ContextTimelinePanel'
import { FormFieldCardBody } from '@/components/FormFieldCard'
import { FormSuggestionBar } from '@/components/FormSuggestionBar'
import { HistoryDetail } from '@/components/HistoryDetail'
import { HistoryList } from '@/components/HistoryList'
import { SavedArticlesPanel } from '@/components/SavedArticlesPanel'
import { ReadingCardBody } from '@/components/SidecarCards'
import { ContextSummaryCard } from '@/components/SidecarCards'
import { StateActivityCard } from '@/components/StateActivityCard'
import { EmptyState, Logo, MotionOverlay, StatusDot } from '@/components/misc'
import { Button } from '@/components/ui/button'
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupTextarea,
} from '@/components/ui/input-group'
import { Switch } from '@/components/ui/switch'
import { useI18n } from '@/i18n'
import { saveSession } from '@/lib/db'
import { cn } from '@/lib/utils'
import type { ScannedFormGroup } from '@/sidecar/FormScanner'
import type { ReadingScore } from '@/sidecar/ReadingDetector'

import { useAgent } from '../../agent/useAgent'
import { useSidecar } from '../../sidecar/useSidecar'

type View =
	| { name: 'chat' }
	| { name: 'config' }
	| { name: 'history' }
	| { name: 'history-detail'; sessionId: string }
	| { name: 'saved-articles' }
	| { name: 'context-timeline' }

// --------------------------------------------------------------------------
// B region card types — grouped by URL
// --------------------------------------------------------------------------

interface ReadingCardData {
	id: string
	url: string
	domain: string
	title: string
	score: ReadingScore
	saved: boolean
	timestamp: number
}

interface FormCardData {
	id: string
	url: string
	domain: string
	formGroups: ScannedFormGroup[]
	timestamp: number
}

export default function App() {
	const [view, setView] = useState<View>({ name: 'chat' })
	const [inputValue, setInputValue] = useState('')
	const textareaRef = useRef<HTMLTextAreaElement>(null)

	// B region: URL-keyed Maps for persistent per-page cards
	const [readingCards, setReadingCards] = useState<Map<string, ReadingCardData>>(new Map())
	const [formCards, setFormCards] = useState<Map<string, FormCardData>>(new Map())
	const readingCardsRef = useRef(readingCards)
	readingCardsRef.current = readingCards
	const formCardsRef = useRef(formCards)
	formCardsRef.current = formCards

	const {
		status,
		history,
		activity,
		currentTask,
		config,
		execute,
		stop,
		configure,
		recordSidecarAction,
	} = useAgent()
	const sidecar = useSidecar(3000)
	const { t } = useI18n()

	// ------------------------------------------------------------------------
	// Sidecar action persistence (auto-save to IndexedDB)
	// ------------------------------------------------------------------------
	const pendingSidecarRef = useRef<SidecarActionEvent[]>([])
	const sidecarSaveTimerRef = useRef<number | null>(null)

	const flushSidecarSession = useCallback(async () => {
		if (pendingSidecarRef.current.length === 0) return
		const events = [...pendingSidecarRef.current]
		pendingSidecarRef.current = []
		try {
			await saveSession({
				task: `Sidecar (${new Date().toLocaleTimeString()})`,
				history: events as HistoricalEvent[],
				status: 'completed',
			})
			console.log(`[App] Auto-saved sidecar session with ${events.length} events`)
		} catch (err) {
			console.error('[App] Failed to auto-save sidecar session:', err)
		}
	}, [])

	const handleSidecarAction = useCallback(
		(action: SidecarActionEvent['action'], payload?: Record<string, unknown>) => {
			// 1. Notify agent if running (so sidecar actions appear in task history too)
			recordSidecarAction(action, payload)

			// 2. Accumulate for auto-save
			const event: SidecarActionEvent = {
				type: 'sidecar_action',
				action,
				payload: payload ?? {},
				timestamp: Date.now(),
			}
			pendingSidecarRef.current.push(event)

			// 3. Debounced auto-save (5s)
			if (sidecarSaveTimerRef.current) clearTimeout(sidecarSaveTimerRef.current)
			sidecarSaveTimerRef.current = window.setTimeout(flushSidecarSession, 5000)
		},
		[recordSidecarAction, flushSidecarSession]
	)

	// Flush pending sidecar actions before unload (sync write to localStorage)
	useEffect(() => {
		const handler = () => {
			if (pendingSidecarRef.current.length > 0) {
				try {
					localStorage.setItem('page-agent-pending', JSON.stringify(pendingSidecarRef.current))
				} catch {
					// Ignore quota errors
				}
			}
		}
		window.addEventListener('beforeunload', handler)
		return () => window.removeEventListener('beforeunload', handler)
	}, [])

	// On mount: restore any pending events from previous session
	useEffect(() => {
		try {
			const saved = localStorage.getItem('page-agent-pending')
			if (saved) {
				const events = JSON.parse(saved) as SidecarActionEvent[]
				if (events.length > 0) {
					pendingSidecarRef.current = events
					flushSidecarSession()
				}
				localStorage.removeItem('page-agent-pending')
			}
		} catch {
			// Ignore parse errors
		}
	}, [])

	// ------------------------------------------------------------------------
	// B1. Reading detection → per-URL card (create new or update existing)
	// ------------------------------------------------------------------------

	useEffect(() => {
		if (!sidecar.readingScore?.isReading || !sidecar.state?.url) return
		const url = sidecar.state.url
		const title = sidecar.state.title || 'Untitled'
		const domain = new URL(url).hostname

		setReadingCards((prev) => {
			const next = new Map(prev)
			const existing = next.get(url)
			if (existing) {
				// Update score for this URL
				next.set(url, {
					...existing,
					score: sidecar.readingScore!,
					title,
					timestamp: Date.now(),
				})
			} else {
				// Create new card for this URL
				next.set(url, {
					id: `reading-${Date.now()}`,
					url,
					domain,
					title,
					score: sidecar.readingScore!,
					saved: false,
					timestamp: Date.now(),
				})
			}
			return next
		})
	}, [
		sidecar.readingScore?.isReading,
		sidecar.readingScore?.score,
		sidecar.state?.url,
		sidecar.state?.title,
	])

	// ------------------------------------------------------------------------
	// B2. Page form scan → per-URL card (triggered on page navigation)
	// ------------------------------------------------------------------------

	const lastScannedUrlRef = useRef<string>('')

	useEffect(() => {
		const url = sidecar.state?.url
		const tabId = sidecar.tabId
		if (!url || !tabId || !sidecar.enabled) return
		if (lastScannedUrlRef.current === url) return
		lastScannedUrlRef.current = url

		// Scan page forms via content script
		chrome.tabs
			.sendMessage(tabId, { type: 'SIDECAR', action: 'scan_page_forms' })
			.then((res: any) => {
				if (!res?.success || !res.result?.formGroups?.length) return
				const result = res.result
				setFormCards((prev) => {
					const next = new Map(prev)
					next.set(result.url, {
						id: `form-${Date.now()}`,
						url: result.url,
						domain: result.domain,
						formGroups: result.formGroups,
						timestamp: Date.now(),
					})
					return next
				})
			})
			.catch(() => {
				// Silently ignore if content script not ready
			})
	}, [sidecar.state?.url, sidecar.tabId, sidecar.enabled])

	const markReadingSaved = useCallback((url: string) => {
		setReadingCards((prev) => {
			const next = new Map(prev)
			const card = next.get(url)
			if (card) next.set(url, { ...card, saved: true })
			return next
		})
	}, [])

	const removeReadingCard = useCallback((url: string) => {
		setReadingCards((prev) => {
			const next = new Map(prev)
			next.delete(url)
			return next
		})
	}, [])

	const removeFormCard = useCallback((url: string) => {
		setFormCards((prev) => {
			const next = new Map(prev)
			next.delete(url)
			return next
		})
	}, [])

	// ------------------------------------------------------------------------
	// Combine B region cards: all readings + all forms, sorted by timestamp desc
	// ------------------------------------------------------------------------

	const bRegionItems = useMemo(() => {
		const items: (
			| { kind: 'reading'; data: ReadingCardData }
			| { kind: 'form'; data: FormCardData }
		)[] = []
		for (const data of readingCards.values()) {
			items.push({ kind: 'reading', data })
		}
		for (const data of formCards.values()) {
			items.push({ kind: 'form', data })
		}
		// Sort: newest first
		items.sort((a, b) => b.data.timestamp - a.data.timestamp)
		return items
	}, [readingCards, formCards])

	// ------------------------------------------------------------------------
	// Agent task
	// ------------------------------------------------------------------------

	const prevStatusRef = useRef(status)
	useEffect(() => {
		const prev = prevStatusRef.current
		prevStatusRef.current = status
		if (
			prev === 'running' &&
			(status === 'completed' || status === 'error') &&
			history.length > 0 &&
			currentTask
		) {
			saveSession({ task: currentTask, history, status }).catch((err) =>
				console.error('[SidePanel] Failed to save session:', err)
			)
		}
	}, [status, history, currentTask])

	const runTask = useCallback(
		(task: string) => {
			const normalizedTask = task.trim()
			if (!normalizedTask || status === 'running') return
			setInputValue('')
			setView({ name: 'chat' })
			handleSidecarAction('send_chat', { task: normalizedTask })
			execute(normalizedTask).catch((error) => {
				console.error('[SidePanel] Failed to execute task:', error)
			})
		},
		[execute, status, handleSidecarAction]
	)

	const handleSubmit = useCallback(
		(e?: React.SyntheticEvent) => {
			e?.preventDefault()
			runTask(inputValue)
		},
		[inputValue, runTask]
	)

	const handleStop = useCallback(() => {
		console.log('[SidePanel] Stopping task...')
		stop()
	}, [stop])

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
			e.preventDefault()
			handleSubmit()
		}
	}

	// --- View routing ---

	if (view.name === 'config') {
		return (
			<ConfigPanel
				config={config}
				onSave={async (newConfig) => {
					await configure(newConfig)
				}}
				onClose={() => setView({ name: 'chat' })}
			/>
		)
	}
	if (view.name === 'history') {
		return (
			<HistoryList
				onSelect={(id) => setView({ name: 'history-detail', sessionId: id })}
				onBack={() => setView({ name: 'chat' })}
				onRerun={runTask}
			/>
		)
	}
	if (view.name === 'history-detail') {
		return (
			<HistoryDetail
				sessionId={view.sessionId}
				onBack={() => setView({ name: 'history' })}
				onRerun={runTask}
			/>
		)
	}
	if (view.name === 'saved-articles') {
		return <SavedArticlesPanel onBack={() => setView({ name: 'chat' })} />
	}
	if (view.name === 'context-timeline') {
		return <ContextTimelinePanel onBack={() => setView({ name: 'chat' })} />
	}

	// ------------------------------------------------------------------------
	// Main layout: A (fixed) + B (scrollable cards) + C (input)
	// ------------------------------------------------------------------------

	const isRunning = status === 'running'
	const showEmptyState = !isRunning && bRegionItems.length === 0

	return (
		<div className="relative flex flex-col h-screen bg-background">
			<MotionOverlay active={isRunning} />

			{/* ========== Header ========== */}
			<header className="flex items-center justify-between border-b px-3 py-2 shrink-0">
				<div className="flex items-center gap-2">
					<Logo className="size-5" />
					<span className="text-sm font-medium">Page Agent Ext</span>
				</div>
				<div className="flex items-center gap-1">
					<StatusDot status={status} />
					<div className="flex items-center gap-1.5 mr-1 px-1.5 py-0.5 rounded-md bg-green-500/5 border border-green-500/10">
						<span
							className={cn(
								'size-1.5 rounded-full',
								sidecar.enabled ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground/30'
							)}
						/>
						<span className="text-[10px] text-muted-foreground">Context</span>
						<Switch
							checked={sidecar.enabled}
							onCheckedChange={sidecar.toggleSidecar}
							className="scale-75 origin-left"
							aria-label={t.header.toggleContext}
						/>
					</div>
					<Button
						variant="ghost"
						size="icon-sm"
						onClick={() => setView({ name: 'context-timeline' })}
						className="cursor-pointer"
						aria-label={t.contextTimeline.title}
						title={t.contextTimeline.title}
					>
						<Activity className="size-3.5" />
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						onClick={() => setView({ name: 'saved-articles' })}
						className="cursor-pointer"
						aria-label={t.savedArticles.title}
						title={t.savedArticles.title}
					>
						<BookOpen className="size-3.5" />
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						onClick={() => setView({ name: 'history' })}
						className="cursor-pointer"
						aria-label={t.history.title}
						title={t.history.title}
					>
						<History className="size-3.5" />
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						onClick={() => setView({ name: 'config' })}
						className="cursor-pointer"
						aria-label={t.settings.title}
						title={t.settings.title}
					>
						<Settings className="size-3.5" />
					</Button>
				</div>
			</header>

			{/* ========== A. Context Awareness (fixed) ========== */}
			{sidecar.enabled && sidecar.state && (
				<div className="shrink-0 border-b bg-background">
					<div className="px-3 py-2">
						<ContextSummaryCard
							url={sidecar.state.url}
							title={sidecar.state.title}
							eventCount={sidecar.state.recentEvents}
							onViewTimeline={() => setView({ name: 'context-timeline' })}
						/>
					</div>
				</div>
			)}

			{/* ========== B. State Card Stream (scrollable) ========== */}
			<div className="flex-1 overflow-y-auto min-h-0">
				<div className="p-3 space-y-2">
					{/* Per-page state cards wrapped in unified ActivityCard */}
					{bRegionItems.map((item) => {
						const isCurrentUrl = sidecar.state?.url === item.data.url
						if (item.kind === 'reading') {
							return (
								<StateActivityCard
									key={item.data.id}
									type="reading"
									domain={item.data.domain}
									url={item.data.url}
									tabId={sidecar.tabId ?? undefined}
									eventType="reading_detected"
									eventData={{
										score: item.data.score.score,
										wordCount: item.data.score.wordCount,
										scrollDepth: item.data.score.scrollDepth,
									}}
									onRemove={() => removeReadingCard(item.data.url)}
									defaultExpanded={isCurrentUrl}
								>
									<ReadingCardBody
										score={item.data.score}
										articleTitle={item.data.title}
										onSave={async () => {
											const id = await sidecar.saveArticle()
											markReadingSaved(item.data.url)
											handleSidecarAction('save_article', {
												url: item.data.url,
												title: item.data.title,
												articleId: id,
											})
											// Auto-download if save path configured
											if (id && config?.articleSavePath) {
												try {
													const { getSavedArticle } = await import('@/lib/db')
													const article = await getSavedArticle(id)
													if (article) {
														const filename = `${article.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)}.md`
														const blob = new Blob([article.markdown], { type: 'text/markdown' })
														const blobUrl = URL.createObjectURL(blob)
														await chrome.downloads.download({
															url: blobUrl,
															filename: `${config.articleSavePath.replace(/\/$/, '')}/${filename}`,
															saveAs: false,
														})
														URL.revokeObjectURL(blobUrl)
													}
												} catch (err) {
													console.error('[App] Failed to auto-download article:', err)
												}
											}
										}}
										saved={item.data.saved}
									/>
								</StateActivityCard>
							)
						}
						if (item.kind === 'form') {
							return (
								<StateActivityCard
									key={item.data.id}
									type="form"
									domain={item.data.domain}
									url={item.data.url}
									tabId={sidecar.tabId ?? undefined}
									eventType="form_detected"
									eventData={{
										formGroups: item.data.formGroups.length,
										fields: item.data.formGroups.reduce((sum, g) => sum + g.fields.length, 0),
									}}
									onRemove={() => removeFormCard(item.data.url)}
									defaultExpanded={isCurrentUrl}
								>
									<FormFieldCardBody
										formGroups={item.data.formGroups}
										tabId={sidecar.tabId ?? undefined}
										onFocusField={(selector, fieldLabel) => {
											handleSidecarAction('focus_field', {
												url: item.data.url,
												selector,
												fieldLabel,
											})
										}}
									/>
								</StateActivityCard>
							)
						}
						return null
					})}

					{/* Empty state */}
					{showEmptyState && <EmptyState />}
				</div>
			</div>

			{/* ========== C. Interaction Zone (fixed bottom) ========== */}
			<div className="shrink-0">
				{/* Form suggestion bar (pops up when focused field has suggestions) */}
				{sidecar.enabled &&
					sidecar.formSuggestions &&
					sidecar.tabId === sidecar.formSuggestions.tabId && (
						<FormSuggestionBar
							fieldLabel={sidecar.formSuggestions.fieldLabel}
							suggestions={sidecar.formSuggestions.suggestions}
							sessionId={sidecar.formSuggestions.sessionId}
							onFill={(value) => {
								sidecar.fillField(value)
								handleSidecarAction('select_suggestion', {
									fieldLabel: sidecar.formSuggestions!.fieldLabel,
									value,
									url: sidecar.formSuggestions!.url,
								})
							}}
							onAdopt={(sessionId, algorithm, value) => {
								sidecar.recordAdoption(sessionId, algorithm, value)
							}}
							onDismiss={() => {
								chrome.storage.local.remove(`sidecarForms_${sidecar.tabId}`)
								handleSidecarAction('dismiss_suggestion', {
									fieldLabel: sidecar.formSuggestions!.fieldLabel,
									url: sidecar.formSuggestions!.url,
								})
							}}
						/>
					)}

				{/* Chat input */}
				<footer className="border-t p-3">
					<InputGroup className="relative rounded-lg">
						<InputGroupTextarea
							ref={textareaRef}
							placeholder={t.chatInput.placeholder}
							value={inputValue}
							onChange={(e) => setInputValue(e.target.value)}
							onKeyDown={handleKeyDown}
							disabled={isRunning}
							className="text-xs pr-12 min-h-10"
						/>
						<InputGroupAddon align="inline-end" className="absolute bottom-0 right-0">
							{isRunning ? (
								<InputGroupButton
									size="icon-sm"
									variant="destructive"
									onClick={handleStop}
									className="size-7"
									aria-label={t.chatInput.stop}
									title={t.chatInput.stop}
								>
									<Square className="size-3" />
								</InputGroupButton>
							) : (
								<InputGroupButton
									size="icon-sm"
									variant="default"
									onClick={() => handleSubmit()}
									disabled={!inputValue.trim()}
									className="size-7 cursor-pointer"
									aria-label={t.chatInput.send}
									title={t.chatInput.send}
								>
									<Send className="size-3" />
								</InputGroupButton>
							)}
						</InputGroupAddon>
					</InputGroup>
				</footer>
			</div>
		</div>
	)
}
