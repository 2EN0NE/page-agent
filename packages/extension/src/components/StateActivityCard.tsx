/**
 * ActivityCard — Unified shell for all B-region state cards.
 */
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useState } from 'react'

import { AnnotationBar } from '@/components/AnnotationBar'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

type ActivityType = 'reading' | 'form'

const TYPE_META: Record<
	ActivityType,
	{ icon: string; colorClass: string; borderClass: string; bgClass: string }
> = {
	reading: {
		icon: '📖',
		colorClass: 'text-amber-700 dark:text-amber-400',
		borderClass: 'border-amber-500/30',
		bgClass: 'bg-amber-500/5',
	},
	form: {
		icon: '📝',
		colorClass: 'text-blue-700 dark:text-blue-400',
		borderClass: 'border-blue-500/30',
		bgClass: 'bg-blue-500/5',
	},
}

interface ActivityCardProps {
	type: ActivityType
	domain: string
	url?: string
	tabId?: number
	eventType: 'reading_detected' | 'form_detected'
	eventData: Record<string, unknown>
	onRemove?: () => void
	defaultExpanded?: boolean
	children: React.ReactNode
}

export function StateActivityCard({
	type,
	domain,
	url,
	tabId,
	eventType,
	eventData,
	onRemove,
	defaultExpanded = true,
	children,
}: ActivityCardProps) {
	const { t } = useI18n()
	const [expanded, setExpanded] = useState(defaultExpanded)
	const meta = TYPE_META[type]
	const label = type === 'reading' ? t.activityCard.readingDetected : t.activityCard.formDetected

	return (
		<div className={cn('rounded-lg border p-3 space-y-2', meta.borderClass, meta.bgClass)}>
			{/* ---------- Header ---------- */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2 min-w-0">
					<span className="text-sm shrink-0">{meta.icon}</span>
					<span className={cn('text-xs font-medium truncate', meta.colorClass)}>{label}</span>
				</div>
				<div className="flex items-center gap-0.5 shrink-0">
					<button
						onClick={() => setExpanded(!expanded)}
						className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 cursor-pointer"
						title={expanded ? t.activityCard.collapse : t.activityCard.expand}
					>
						{expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
					</button>
					{onRemove && (
						<button
							onClick={onRemove}
							className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer"
							title={t.activityCard.remove}
						>
							×
						</button>
					)}
				</div>
			</div>

			{/* ---------- Body ---------- */}
			{expanded && <div>{children}</div>}

			{/* ---------- Footer ---------- */}
			<div className="flex items-center justify-between pt-1">
				{/* Domain badge + link */}
				<div className="flex items-center gap-1.5 min-w-0">
					<span className="text-[9px] px-1.5 py-0.5 rounded bg-background/80 border border-border/50 font-medium text-foreground truncate max-w-[140px]">
						{domain}
					</span>
					{url && (
						<a
							href={url}
							target="_blank"
							rel="noopener noreferrer"
							className="text-[9px] text-muted-foreground hover:text-foreground underline cursor-pointer shrink-0"
						>
							{t.activityCard.open}
						</a>
					)}
				</div>

				{/* Annotation bar */}
				{tabId !== undefined && (
					<AnnotationBar
						eventType={eventType}
						eventData={eventData}
						domain={domain}
						tabId={tabId}
						url={url}
					/>
				)}
			</div>
		</div>
	)
}
