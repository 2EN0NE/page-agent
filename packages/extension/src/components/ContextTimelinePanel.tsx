/**
 * ContextTimelinePanel - Interactive timeline of user browsing context events.
 */
import {
	Activity,
	ArrowDown,
	ArrowUp,
	Eye,
	Keyboard,
	MousePointerClick,
	RefreshCw,
	RotateCcw,
	ScrollText,
	Search,
	Target,
	Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import type { ContextEventRecord, ContextEventType } from '@/lib/db'
import { cn } from '@/lib/utils'
import { clearContextEventsGlobal, queryContextEventsGlobal } from '@/sidecar/SidecarClient'

export function ContextTimelinePanel({ onBack }: { onBack: () => void }) {
	const { t } = useI18n()

	const [events, setEvents] = useState<ContextEventRecord[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [filter, setFilter] = useState<ContextEventType | 'all'>('all')
	const [search, setSearch] = useState('')
	const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest')
	const [windowMs, setWindowMs] = useState(5 * 60 * 1000)
	const [autoRefresh, setAutoRefresh] = useState(true)
	const timerRef = useRef<number | null>(null)
	const listRef = useRef<HTMLDivElement>(null)

	const EVENT_META = useMemo(
		() =>
			({
				scroll: {
					label: t.timeline.events.scroll,
					icon: <ScrollText className="size-3.5" />,
					color: 'text-blue-600 dark:text-blue-400',
					bg: 'bg-blue-500/10 border-blue-500/20',
				},
				focus: {
					label: t.timeline.events.focus,
					icon: <Target className="size-3.5" />,
					color: 'text-purple-600 dark:text-purple-400',
					bg: 'bg-purple-500/10 border-purple-500/20',
				},
				input: {
					label: t.timeline.events.input,
					icon: <Keyboard className="size-3.5" />,
					color: 'text-amber-600 dark:text-amber-400',
					bg: 'bg-amber-500/10 border-amber-500/20',
				},
				click: {
					label: t.timeline.events.click,
					icon: <MousePointerClick className="size-3.5" />,
					color: 'text-green-600 dark:text-green-400',
					bg: 'bg-green-500/10 border-green-500/20',
				},
				mutation: {
					label: t.timeline.events.mutation,
					icon: <RotateCcw className="size-3.5" />,
					color: 'text-cyan-600 dark:text-cyan-400',
					bg: 'bg-cyan-500/10 border-cyan-500/20',
				},
				tab_activated: {
					label: t.timeline.events.tab,
					icon: <Activity className="size-3.5" />,
					color: 'text-pink-600 dark:text-pink-400',
					bg: 'bg-pink-500/10 border-pink-500/20',
				},
				tab_updated: {
					label: t.timeline.events.tabUpdate,
					icon: <Activity className="size-3.5" />,
					color: 'text-pink-600 dark:text-pink-400',
					bg: 'bg-pink-500/10 border-pink-500/20',
				},
				page_visibility: {
					label: t.timeline.events.visibility,
					icon: <Eye className="size-3.5" />,
					color: 'text-slate-600 dark:text-slate-400',
					bg: 'bg-slate-500/10 border-slate-500/20',
				},
				reading_detected: {
					label: t.timeline.events.reading,
					icon: <ScrollText className="size-3.5" />,
					color: 'text-orange-600 dark:text-orange-400',
					bg: 'bg-orange-500/10 border-orange-500/20',
				},
				form_detected: {
					label: t.timeline.events.form,
					icon: <Target className="size-3.5" />,
					color: 'text-indigo-600 dark:text-indigo-400',
					bg: 'bg-indigo-500/10 border-indigo-500/20',
				},
			}) as Record<
				ContextEventType,
				{ label: string; icon: React.ReactNode; color: string; bg: string }
			>,
		[t]
	)

	const FILTER_OPTIONS: { type: ContextEventType | 'all'; label: string }[] = useMemo(
		() => [
			{ type: 'all', label: t.timeline.filters.all },
			{ type: 'scroll', label: t.timeline.events.scroll },
			{ type: 'focus', label: t.timeline.events.focus },
			{ type: 'input', label: t.timeline.events.input },
			{ type: 'click', label: t.timeline.events.click },
			{ type: 'mutation', label: t.timeline.events.mutation },
			{ type: 'reading_detected', label: t.timeline.events.reading },
			{ type: 'form_detected', label: t.timeline.events.form },
		],
		[t]
	)

	const TIME_WINDOW_OPTIONS = useMemo(
		() => [
			{ label: t.timeline.windows.min1, ms: 60 * 1000 },
			{ label: t.timeline.windows.min5, ms: 5 * 60 * 1000 },
			{ label: t.timeline.windows.min15, ms: 15 * 60 * 1000 },
			{ label: t.timeline.windows.hour1, ms: 60 * 60 * 1000 },
			{ label: t.timeline.windows.hour3, ms: 3 * 60 * 60 * 1000 },
			{ label: t.timeline.windows.hour24, ms: 24 * 60 * 60 * 1000 },
		],
		[t]
	)

	const load = useCallback(async () => {
		setLoading(true)
		setError(null)
		try {
			const result = await queryContextEventsGlobal({
				windowMs,
				limit: 500,
			})
			console.log(
				`[ContextTimelinePanel] Loaded ${result.events.length} events from ${result.source}`
			)
			if (result.error) {
				setError(`Query issue: ${result.error} (source: ${result.source})`)
			}
			setEvents(result.events)
		} catch (err) {
			console.error('[ContextTimelinePanel] Failed to load events:', err)
			setError(err instanceof Error ? err.message : 'Failed to load events')
		} finally {
			setLoading(false)
		}
	}, [windowMs])

	useEffect(() => {
		load()
		if (autoRefresh) {
			timerRef.current = window.setInterval(load, 3000)
		}
		return () => {
			if (timerRef.current) clearInterval(timerRef.current)
		}
	}, [load, autoRefresh])

	// Refresh immediately when user switches tabs
	useEffect(() => {
		const handleTabChange = () => load()
		chrome.tabs.onActivated.addListener(handleTabChange)
		chrome.tabs.onUpdated.addListener(handleTabChange)
		return () => {
			chrome.tabs.onActivated.removeListener(handleTabChange)
			chrome.tabs.onUpdated.removeListener(handleTabChange)
		}
	}, [load])

	// Filter + search + sort
	const filteredEvents = useMemo(() => {
		let result = events
		if (filter !== 'all') {
			result = result.filter((e) => e.type === filter)
		}
		if (search.trim()) {
			const kw = search.toLowerCase()
			result = result.filter(
				(e) =>
					e.domain.toLowerCase().includes(kw) ||
					(e.title ?? '').toLowerCase().includes(kw) ||
					JSON.stringify(e.data).toLowerCase().includes(kw)
			)
		}
		if (sortOrder === 'newest') {
			result = [...result].sort((a, b) => b.timestamp - a.timestamp)
		} else {
			result = [...result].sort((a, b) => a.timestamp - b.timestamp)
		}
		return result
	}, [events, filter, search, sortOrder])

	const stats = useMemo(() => {
		const domains = new Set(events.map((e) => e.domain))
		return {
			total: events.length,
			filtered: filteredEvents.length,
			domains: domains.size,
			byType: events.reduce<Record<string, number>>((acc, e) => {
				acc[e.type] = (acc[e.type] || 0) + 1
				return acc
			}, {}),
		}
	}, [events, filteredEvents.length])

	const handleClearAll = async () => {
		if (!confirm(t.timeline.confirmClear)) return
		const ok = await clearContextEventsGlobal()
		if (ok) {
			setEvents([])
		} else {
			setError(t.timeline.clearFailed)
		}
	}

	return (
		<div className="flex flex-col h-screen bg-background">
			{/* Header */}
			<header className="flex items-center justify-between border-b px-3 py-2 shrink-0">
				<Button variant="ghost" size="sm" onClick={onBack} className="cursor-pointer">
					← {t.common.back}
				</Button>
				<span className="text-sm font-medium">{t.contextTimeline.title}</span>
				<div className="flex items-center gap-1">
					<Button
						variant="ghost"
						size="icon-sm"
						onClick={load}
						title={t.common.refresh}
						className="cursor-pointer"
					>
						<RefreshCw className="size-4" />
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						onClick={handleClearAll}
						title={t.timeline.clearAll}
						className="cursor-pointer text-destructive hover:text-destructive"
					>
						<Trash2 className="size-4" />
					</Button>
				</div>
			</header>

			{/* Stats Bar */}
			<div className="px-3 py-2 border-b bg-muted/20 shrink-0">
				<div className="flex items-center justify-between">
					<span className="text-[10px] text-muted-foreground">
						<strong className="text-foreground">{stats.filtered}</strong> / {stats.total}{' '}
						{t.timeline.stats.events}
						{stats.domains > 1 && (
							<span className="ml-1">
								· {stats.domains} {t.timeline.stats.domains}
							</span>
						)}
						{autoRefresh && (
							<span className="ml-1 inline-flex items-center gap-1">
								<span className="size-1.5 rounded-full bg-green-500 animate-pulse" />
								{t.timeline.stats.live}
							</span>
						)}
					</span>
					<label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer">
						<input
							type="checkbox"
							checked={autoRefresh}
							onChange={(e) => setAutoRefresh(e.target.checked)}
							className="size-3"
						/>
						{t.timeline.stats.autoRefresh}
					</label>
				</div>
				{/* Type distribution */}
				<div className="flex flex-wrap gap-1 mt-1.5">
					{Object.entries(stats.byType)
						.sort(([, a], [, b]) => b - a)
						.slice(0, 5)
						.map(([type, count]) => {
							const meta = EVENT_META[type as ContextEventType]
							if (!meta) return null
							return (
								<span
									key={type}
									className={cn('text-[9px] px-1.5 py-0.5 rounded-full border', meta.bg)}
								>
									{meta.label}: {count}
								</span>
							)
						})}
				</div>
			</div>

			{/* Controls: Search + Window + Sort */}
			<div className="px-3 py-2 border-b shrink-0 space-y-2">
				{/* Search */}
				<div className="relative">
					<Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
					<input
						type="text"
						placeholder={t.timeline.searchPlaceholder}
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						className="w-full h-7 pl-7 pr-2 text-[11px] rounded-md border border-input bg-background"
					/>
				</div>
				<div className="flex items-center gap-2">
					{/* Time window */}
					<select
						value={windowMs}
						onChange={(e) => setWindowMs(Number(e.target.value))}
						className="h-6 text-[10px] rounded-md border border-input bg-background px-1.5 cursor-pointer"
					>
						{TIME_WINDOW_OPTIONS.map((opt) => (
							<option key={opt.ms} value={opt.ms}>
								{opt.label}
							</option>
						))}
					</select>
					{/* Sort toggle */}
					<button
						onClick={() => setSortOrder((prev) => (prev === 'newest' ? 'oldest' : 'newest'))}
						className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded border border-input cursor-pointer"
						title={t.timeline.toggleSort}
					>
						{sortOrder === 'newest' ? (
							<>
								<ArrowDown className="size-3" /> {t.timeline.sort.newest}
							</>
						) : (
							<>
								<ArrowUp className="size-3" /> {t.timeline.sort.oldest}
							</>
						)}
						{t.timeline.sort.first}
					</button>
				</div>
				{/* Type filter pills */}
				<div className="flex gap-1 overflow-x-auto no-scrollbar">
					{FILTER_OPTIONS.map((opt) => (
						<button
							key={opt.type}
							onClick={() => setFilter(opt.type)}
							className={cn(
								'text-[10px] px-2 py-1 rounded-full border transition-colors cursor-pointer whitespace-nowrap shrink-0',
								filter === opt.type
									? 'bg-foreground text-background border-foreground'
									: 'bg-background text-muted-foreground border-input hover:border-foreground/30'
							)}
						>
							{opt.label}
						</button>
					))}
				</div>
			</div>

			{/* Timeline */}
			<div ref={listRef} className="flex-1 overflow-y-auto p-3 space-y-2">
				{loading && (
					<p className="text-xs text-muted-foreground text-center py-8">{t.timeline.loading}</p>
				)}

				{error && (
					<div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-center">
						<p className="text-[11px] text-destructive">{error}</p>
						<button
							onClick={load}
							className="text-[10px] text-muted-foreground hover:text-foreground underline cursor-pointer mt-1"
						>
							{t.common.retry}
						</button>
					</div>
				)}

				{!loading && !error && filteredEvents.length === 0 && (
					<div className="text-center py-12 space-y-2">
						<Activity className="size-8 text-muted-foreground/30 mx-auto" />
						<p className="text-xs text-muted-foreground">
							{events.length === 0 ? t.timeline.empty.noEvents : t.timeline.empty.noFilterMatch}
						</p>
					</div>
				)}

				{filteredEvents.map((event, index) => (
					<EventCard
						key={event.id}
						event={event}
						isLatest={sortOrder === 'newest' ? index === 0 : index === filteredEvents.length - 1}
						isConsecutive={index > 0 && filteredEvents[index - 1].type === event.type}
						rank={sortOrder === 'newest' ? index + 1 : filteredEvents.length - index}
						meta={EVENT_META[event.type]}
					/>
				))}
			</div>
		</div>
	)
}

// --------------------------------------------------------------------------
// Single Event Card
// --------------------------------------------------------------------------

function EventCard({
	event,
	isLatest,
	isConsecutive,
	rank,
	meta,
}: {
	event: ContextEventRecord
	isLatest: boolean
	isConsecutive: boolean
	rank: number
	meta?: { label: string; icon: React.ReactNode; color: string; bg: string }
}) {
	const { t } = useI18n()
	const [expanded, setExpanded] = useState(false)
	const safeMeta = meta || {
		label: event.type,
		icon: <Activity className="size-3.5" />,
		color: 'text-muted-foreground',
		bg: 'bg-muted/30',
	}

	const timeStr = new Date(event.timestamp).toLocaleTimeString('en-US', {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false,
	})
	const relativeTime = getRelativeTime(event.timestamp)

	return (
		<div
			className={cn(
				'relative rounded-lg border p-2.5 transition-all',
				safeMeta.bg,
				isLatest && !isConsecutive && 'ring-1 ring-green-500/30'
			)}
		>
			{/* Latest indicator */}
			{isLatest && !isConsecutive && (
				<div className="absolute -top-1.5 -right-1.5">
					<span className="flex size-2.5">
						<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
						<span className="relative inline-flex rounded-full size-2.5 bg-green-500" />
					</span>
				</div>
			)}

			<div className="flex items-start gap-2">
				{/* Icon */}
				<div
					className={cn(
						'size-7 rounded-full flex items-center justify-center shrink-0 mt-0.5',
						safeMeta.color,
						safeMeta.bg
					)}
				>
					{safeMeta.icon}
				</div>

				{/* Content */}
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-1.5 mb-0.5">
						<span className={cn('text-[11px] font-medium', safeMeta.color)}>{safeMeta.label}</span>
						<span className="text-[9px] text-muted-foreground">·</span>
						<span className="text-[9px] text-muted-foreground" title={timeStr}>
							{relativeTime}
						</span>
						{isLatest && (
							<span className="text-[9px] px-1 py-0 rounded bg-green-500/10 text-green-600 dark:text-green-400">
								{t.timeline.latest}
							</span>
						)}
						<span className="text-[9px] text-muted-foreground/50 ml-auto">#{rank}</span>
					</div>

					{/* Domain badge + URL */}
					<div className="flex items-center gap-1.5 mb-1">
						<span className="text-[9px] px-1 py-0.5 rounded bg-background/80 border border-border/50 font-medium text-foreground truncate max-w-[120px]">
							{event.domain}
						</span>
						{event.title && (
							<span className="text-[10px] text-muted-foreground truncate flex-1">
								— {event.title}
							</span>
						)}
					</div>

					{/* Event-specific summary */}
					<EventSummary event={event} t={t} />

					{/* Expandable raw data */}
					{Object.keys(event.data).length > 0 && (
						<button
							onClick={() => setExpanded(!expanded)}
							className="text-[9px] text-muted-foreground hover:text-foreground mt-1 cursor-pointer underline decoration-dotted"
						>
							{expanded ? t.timeline.hideDetails : t.timeline.showDetails}
						</button>
					)}
					{expanded && (
						<pre className="mt-1 p-1.5 rounded bg-background/60 text-[9px] text-muted-foreground overflow-x-auto">
							{JSON.stringify(event.data, null, 2)}
						</pre>
					)}
				</div>
			</div>
		</div>
	)
}

function EventSummary({ event, t }: { event: ContextEventRecord; t: Translation }) {
	const d = event.data

	switch (event.type) {
		case 'scroll':
			return (
				<p className="text-[10px] text-muted-foreground">
					{t.timeline.summary.scrollY}: <strong>{Math.round((d.scrollY as number) || 0)}</strong> ·{' '}
					{t.timeline.summary.depth}:{' '}
					<strong>
						{Math.round((((d.scrollY as number) || 0) / ((d.scrollHeight as number) || 1)) * 100)}%
					</strong>
					{d.velocity
						? ` · ${t.timeline.summary.velocity}: ${(d.velocity as number).toFixed(2)} px/ms`
						: ''}
				</p>
			)
		case 'focus':
			return (
				<p className="text-[10px] text-muted-foreground">
					{t.timeline.summary.field}:{' '}
					<strong>
						{(d.label as string) ||
							(d.name as string) ||
							(d.placeholder as string) ||
							t.formCard.unnamed}
					</strong>
					{d.type ? ` · ${t.timeline.summary.type}: ${d.type as string}` : ''}
				</p>
			)
		case 'input':
			return (
				<p className="text-[10px] text-muted-foreground">
					{t.timeline.summary.field}:{' '}
					<strong>{(d.label as string) || (d.name as string) || t.formCard.unnamed}</strong>
					{d.valueLength !== undefined
						? ` · ${t.timeline.summary.length}: ${d.valueLength as number}`
						: ''}
				</p>
			)
		case 'click':
			return (
				<p className="text-[10px] text-muted-foreground">
					{t.timeline.summary.target}: <strong>{(d.tagName as string) || 'unknown'}</strong>
					{d.text
						? ` · "${(d.text as string).slice(0, 40)}${(d.text as string).length > 40 ? '...' : ''}"`
						: ''}
				</p>
			)
		case 'mutation':
			return <p className="text-[10px] text-muted-foreground">{t.timeline.summary.mutation}</p>
		case 'page_visibility':
			return (
				<p className="text-[10px] text-muted-foreground">
					{d.visible ? t.timeline.summary.visible : t.timeline.summary.hidden}
					{d.pageDwellTime
						? ` · ${t.timeline.summary.dwell}: ${Math.round((d.pageDwellTime as number) / 1000)}s`
						: ''}
				</p>
			)
		case 'reading_detected':
			return (
				<p className="text-[10px] text-muted-foreground">
					{t.readingCard.score}: <strong>{d.score}/100</strong> · {t.readingCard.words}:{' '}
					{d.wordCount} · {t.readingCard.depth}: {Math.round((d.scrollDepth as number) * 100)}%
				</p>
			)
		case 'form_detected':
			return (
				<p className="text-[10px] text-muted-foreground">
					{t.timeline.summary.field}:{' '}
					<strong>
						{(d.field as { label?: string; name?: string })?.label ||
							(d.field as { label?: string; name?: string })?.name ||
							t.formCard.unnamed}
					</strong>
				</p>
			)
		default:
			return null
	}
}

function getRelativeTime(timestamp: number): string {
	const diff = Date.now() - timestamp
	const seconds = Math.floor(diff / 1000)
	if (seconds < 10) return 'just now'
	if (seconds < 60) return `${seconds}s ago`
	const minutes = Math.floor(seconds / 60)
	if (minutes < 60) return `${minutes}m ago`
	const hours = Math.floor(minutes / 60)
	return `${hours}h ago`
}
