import { ArrowLeft, RotateCcw, ThumbsDown, ThumbsUp, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import {
	type AnnotationRecord,
	type SessionRecord,
	deleteSession,
	getSession,
	queryAnnotationsByTimeRange,
} from '@/lib/db'

import { EventCard } from './cards'

export function HistoryDetail({
	sessionId,
	onBack,
	onRerun,
}: {
	sessionId: string
	onBack: () => void
	onRerun: (task: string) => void
}) {
	const { t } = useI18n()
	const [session, setSession] = useState<SessionRecord | null>(null)
	const [annotations, setAnnotations] = useState<AnnotationRecord[]>([])

	useEffect(() => {
		getSession(sessionId).then((s) => {
			const data = s ?? null
			setSession(data)
			if (data) {
				// Load annotations around this session's time
				queryAnnotationsByTimeRange(data.createdAt, 30 * 60 * 1000).then((annos) => {
					setAnnotations(annos)
				})
			}
		})
	}, [sessionId])

	if (!session) {
		return (
			<div className="flex items-center justify-center h-screen text-xs text-muted-foreground">
				{t.common.loading}
			</div>
		)
	}

	return (
		<div className="flex flex-col h-screen bg-background">
			{/* Header */}
			<header className="flex items-center gap-2 border-b px-3 py-2">
				<Button variant="ghost" size="icon-sm" onClick={onBack} className="cursor-pointer">
					<ArrowLeft className="size-3.5" />
				</Button>
				<span className="text-sm font-medium truncate">{t.history.title}</span>
			</header>

			{/* Task */}
			<div className="border-b px-3 py-2 bg-muted/30">
				<div className="text-[10px] text-muted-foreground uppercase tracking-wide">
					{t.historyDetail.task}
				</div>
				<div className="text-xs font-medium" title={session.task}>
					{session.task}
				</div>
				<div className="mt-2 flex items-center gap-2">
					<button
						type="button"
						onClick={() => onRerun(session.task)}
						className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
					>
						<RotateCcw className="size-3" />
						{t.historyDetail.runAgain}
					</button>
					<button
						type="button"
						onClick={async () => {
							await deleteSession(sessionId)
							onBack()
						}}
						className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
					>
						<Trash2 className="size-3" />
						{t.historyDetail.delete}
					</button>
				</div>
			</div>

			{/* Events (read-only) */}
			<div className="flex-1 overflow-y-auto p-3 space-y-2">
				{session.history.map((event, index) => (
					<EventCard key={index} event={event} />
				))}

				{/* Annotations attached to this session */}
				{annotations.length > 0 && (
					<div className="pt-4 border-t border-dashed mt-4">
						<div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-2">
							{t.historyDetail.feedback} ({annotations.length})
						</div>
						<div className="space-y-1.5">
							{annotations.map((anno) => (
								<div
									key={anno.id}
									className="flex items-center gap-2 rounded border bg-muted/20 px-2 py-1.5"
								>
									{anno.label === 'useful' ? (
										<ThumbsUp className="size-3 text-green-500 shrink-0" />
									) : (
										<ThumbsDown className="size-3 text-destructive shrink-0" />
									)}
									<div className="flex-1 min-w-0">
										<span className="text-[10px] text-muted-foreground truncate">
											{anno.domain}
										</span>
										{anno.notes && (
											<p className="text-[10px] text-foreground truncate" title={anno.notes}>
												{anno.notes}
											</p>
										)}
									</div>
									<span className="text-[9px] text-muted-foreground shrink-0">
										{new Date(anno.annotatedAt).toLocaleTimeString([], {
											hour: '2-digit',
											minute: '2-digit',
										})}
									</span>
								</div>
							))}
						</div>
					</div>
				)}
			</div>
		</div>
	)
}
