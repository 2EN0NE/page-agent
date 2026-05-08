/**
 * Sidecar UI cards for the sidepanel.
 * - ReadingCardBody: shows reading detection score and save button (body only, no shell)
 * - ContextSummaryCard: shows current page context summary (A-region fixed)
 */
import { CheckCircle, Save } from 'lucide-react'
// --------------------------------------------------------------------------
// Context Summary Card (A-region, stays fixed)
// --------------------------------------------------------------------------

import { Brain } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { ReadingScore } from '@/sidecar/ReadingDetector'

// --------------------------------------------------------------------------
// Reading Card Body (to be wrapped by ActivityCard)
// --------------------------------------------------------------------------

export function ReadingCardBody({
	score,
	onSave,
	saved,
	articleTitle,
}: {
	score: ReadingScore
	onSave: () => void
	saved?: boolean
	articleTitle?: string
}) {
	const { t } = useI18n()
	return (
		<div className="space-y-2">
			{articleTitle && (
				<p className="text-xs font-medium text-foreground truncate" title={articleTitle}>
					{articleTitle}
				</p>
			)}
			<div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
				<span>
					{t.readingCard.score}: <strong className="text-foreground">{score.score}/100</strong>
				</span>
				<span>
					{t.readingCard.dwell}:{' '}
					<strong className="text-foreground">{formatDuration(score.dwellTimeMs)}</strong>
				</span>
				<span>
					{t.readingCard.depth}:{' '}
					<strong className="text-foreground">{Math.round(score.scrollDepth * 100)}%</strong>
				</span>
				<span>
					{t.readingCard.words}: <strong className="text-foreground">{score.wordCount}</strong>
				</span>
			</div>
			<Button
				size="sm"
				variant="outline"
				className="w-full h-7 text-xs cursor-pointer"
				onClick={onSave}
				disabled={saved}
			>
				{saved ? (
					<>
						<CheckCircle className="size-3 mr-1 text-green-500" />
						{t.readingCard.saved}
					</>
				) : (
					<>
						<Save className="size-3 mr-1" />
						{t.readingCard.saveArticle}
					</>
				)}
			</Button>
		</div>
	)
}

export function ContextSummaryCard({
	url,
	title,
	eventCount,
	onViewTimeline,
}: {
	url: string
	title: string
	eventCount: number
	onViewTimeline?: () => void
}) {
	const { t } = useI18n()
	return (
		<div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<Brain className="size-3.5 text-muted-foreground" />
					<span className="text-[11px] font-medium text-muted-foreground">
						{t.contextSummary.currentContext}
					</span>
				</div>
				{onViewTimeline && (
					<button
						onClick={onViewTimeline}
						className="text-[9px] text-muted-foreground hover:text-foreground underline cursor-pointer"
					>
						{t.contextSummary.viewTimeline}
					</button>
				)}
			</div>
			<p className="text-xs font-medium truncate" title={title}>
				{title || 'Untitled'}
			</p>
			<p className="text-[10px] text-muted-foreground truncate" title={url}>
				{url}
			</p>
			<div className="flex items-center gap-1 text-[10px] text-muted-foreground">
				<span
					className={cn(
						'size-1.5 rounded-full',
						eventCount > 0 ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground/40'
					)}
				/>
				{eventCount > 0
					? `${eventCount} ${t.contextSummary.eventsTracked}`
					: t.contextSummary.noRecentEvents}
			</div>
		</div>
	)
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function formatDuration(ms: number): string {
	const seconds = Math.floor(ms / 1000)
	const minutes = Math.floor(seconds / 60)
	if (minutes < 1) return `${seconds}s`
	const hours = Math.floor(minutes / 60)
	if (hours < 1) return `${minutes}m ${seconds % 60}s`
	return `${hours}h ${minutes % 60}m`
}
