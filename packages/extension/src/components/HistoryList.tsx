import {
	ArrowDownToLine,
	ArrowLeft,
	CheckCircle,
	Database,
	History,
	RotateCcw,
	Trash2,
	XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import {
	type SessionRecord,
	clearSessions,
	deleteSession,
	exportAnnotationsAsJSONL,
	listSessions,
} from '@/lib/db'
import { downloadHistoryExport } from '@/lib/history-export'

function timeAgo(ts: number): string {
	const seconds = Math.floor((Date.now() - ts) / 1000)
	if (seconds < 60) return 'just now'
	const minutes = Math.floor(seconds / 60)
	if (minutes < 60) return `${minutes}m ago`
	const hours = Math.floor(minutes / 60)
	if (hours < 24) return `${hours}h ago`
	const days = Math.floor(hours / 24)
	return `${days}d ago`
}

export function HistoryList({
	onSelect,
	onBack,
	onRerun,
}: {
	onSelect: (id: string) => void
	onBack: () => void
	onRerun: (task: string) => void
}) {
	const { t } = useI18n()
	const [sessions, setSessions] = useState<SessionRecord[]>([])
	const [loading, setLoading] = useState(true)

	const load = useCallback(async () => {
		try {
			setSessions(await listSessions())
		} catch (err) {
			console.error('[HistoryList] Failed to load sessions:', err)
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		load()
	}, [load])

	const handleDelete = async (e: React.MouseEvent, id: string) => {
		e.stopPropagation()
		await deleteSession(id)
		setSessions((prev) => prev.filter((s) => s.id !== id))
	}

	const handleExport = (e: React.MouseEvent, session: SessionRecord) => {
		e.stopPropagation()
		downloadHistoryExport(session.task, session.createdAt, session.history)
	}

	const handleRerun = (e: React.MouseEvent, task: string) => {
		e.stopPropagation()
		onRerun(task)
	}

	const handleExportAnnotations = async () => {
		try {
			const jsonl = await exportAnnotationsAsJSONL()
			const blob = new Blob([jsonl], { type: 'application/jsonl' })
			const url = URL.createObjectURL(blob)
			const a = document.createElement('a')
			a.href = url
			a.download = `page-agent-annotations_${new Date().toISOString().slice(0, 10)}.jsonl`
			document.body.appendChild(a)
			a.click()
			document.body.removeChild(a)
			URL.revokeObjectURL(url)
		} catch (err) {
			console.error('[HistoryList] Failed to export annotations:', err)
		}
	}

	return (
		<div className="flex flex-col h-screen bg-background">
			{/* Header */}
			<header className="flex items-center gap-2 border-b px-3 py-2">
				<Button
					variant="ghost"
					size="icon-sm"
					onClick={onBack}
					className="cursor-pointer"
					aria-label={t.common.back}
					title={t.common.back}
				>
					<ArrowLeft className="size-3.5" />
				</Button>
				<span className="text-sm font-medium flex-1">{t.history.title}</span>
				<Button
					variant="ghost"
					size="icon-sm"
					onClick={handleExportAnnotations}
					className="cursor-pointer"
					aria-label={t.history.exportAnnotations}
					title={t.history.exportAnnotations}
				>
					<Database className="size-3.5" />
				</Button>
				{sessions.length > 0 && (
					<Button
						variant="ghost"
						size="sm"
						onClick={async () => {
							await clearSessions()
							setSessions([])
						}}
						className="text-[10px] text-muted-foreground hover:text-destructive cursor-pointer h-6 px-2"
					>
						<Trash2 className="size-3 mr-1" />
						{t.history.clearAll}
					</Button>
				)}
			</header>

			{/* List */}
			<div className="flex-1 overflow-y-auto">
				{loading && (
					<div className="flex flex-col" aria-label={t.history.loading} aria-busy="true">
						{[...Array(4)].map((_, i) => (
							<div key={i} className="flex items-start gap-2 px-3 py-2.5 border-b">
								<div className="size-3.5 mt-0.5 rounded-full bg-muted animate-pulse shrink-0" />
								<div className="flex-1 space-y-1.5">
									<div className="h-2.5 bg-muted animate-pulse rounded w-3/4" />
									<div className="h-2 bg-muted animate-pulse rounded w-1/3" />
								</div>
							</div>
						))}
					</div>
				)}

				{!loading && sessions.length === 0 && (
					<div className="flex flex-col items-center justify-center h-40 gap-2 text-muted-foreground">
						<History className="size-8 opacity-30" />
						<p className="text-xs">{t.history.empty}</p>
					</div>
				)}

				{sessions.map((session) => (
					<div
						key={session.id}
						role="button"
						tabIndex={0}
						onClick={() => onSelect(session.id)}
						className="w-full text-left px-3 py-2.5 border-b hover:bg-muted/50 transition-colors cursor-pointer flex items-start gap-2 group"
					>
						{/* Status icon */}
						{session.status === 'completed' ? (
							<CheckCircle className="size-3.5 text-green-500 shrink-0 mt-0.5" />
						) : (
							<XCircle className="size-3.5 text-destructive shrink-0 mt-0.5" />
						)}

						{/* Content */}
						<div className="flex-1 min-w-0">
							<p className="text-xs font-medium truncate">{session.task}</p>
							<div className="flex items-center mt-0.5">
								<p className="text-[10px] text-muted-foreground">
									{timeAgo(session.createdAt)} · {session.history.length} {t.history.steps}
								</p>
								<div className="flex items-center gap-0.5 ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
									<button
										type="button"
										onClick={(e) => handleRerun(e, session.task)}
										className="p-0.5 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
										title={t.history.runAgain}
										aria-label={`${t.history.runAgain}: ${session.task}`}
									>
										<RotateCcw className="size-3" />
									</button>
									<button
										type="button"
										onClick={(e) => handleExport(e, session)}
										className="p-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
										title={t.history.exportHistory}
										aria-label={`${t.history.exportHistory}: ${session.task}`}
									>
										<ArrowDownToLine className="size-3" />
									</button>
									<button
										type="button"
										onClick={(e) => handleDelete(e, session.id)}
										className="p-0.5 text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
										title={t.history.delete}
										aria-label={`${t.history.delete}: ${session.task}`}
									>
										<Trash2 className="size-3" />
									</button>
								</div>
							</div>
						</div>
					</div>
				))}
			</div>
		</div>
	)
}
