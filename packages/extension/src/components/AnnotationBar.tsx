/**
 * AnnotationBar - Simple thumbs up/down for user feedback on sidecar suggestions.
 * Feedback is stored as AnnotationRecords for future model training.
 */
import { ThumbsDown, ThumbsUp } from 'lucide-react'
import { useState } from 'react'

import { useI18n } from '@/i18n'
import { saveAnnotation } from '@/lib/db'
import { queryContextEvents } from '@/lib/db'

export function AnnotationBar({
	eventType,
	eventData,
	domain,
	tabId,
	url,
}: {
	eventType: string
	eventData: Record<string, unknown>
	domain: string
	tabId: number
	url?: string
}) {
	const { t } = useI18n()
	const [submitted, setSubmitted] = useState<'useful' | 'not_useful' | null>(null)

	const handleAnnotate = async (label: 'useful' | 'not_useful') => {
		if (submitted) return
		setSubmitted(label)

		// Grab surrounding context events for training dataset
		const contextSnapshot = await queryContextEvents({
			tabId,
			windowMs: 60_000,
			limit: 20,
		})

		await saveAnnotation({
			tabId,
			url: url || window.location.href,
			domain,
			eventId: `${eventType}_${Date.now()}`,
			label,
			annotatedAt: Date.now(),
			notes: JSON.stringify(eventData),
			contextSnapshot,
		})
	}

	return (
		<div className="flex items-center justify-end gap-1 pt-1 border-t border-dashed">
			<span className="text-[9px] text-muted-foreground mr-1">
				{submitted ? t.activityCard.thanks : t.activityCard.wasThisHelpful}
			</span>
			<button
				onClick={() => handleAnnotate('useful')}
				disabled={!!submitted}
				className={`p-0.5 rounded cursor-pointer ${submitted === 'useful' ? 'text-green-600 bg-green-500/10' : 'text-muted-foreground hover:text-foreground'}`}
				title={t.activityCard.useful}
			>
				<ThumbsUp className="size-3" />
			</button>
			<button
				onClick={() => handleAnnotate('not_useful')}
				disabled={!!submitted}
				className={`p-0.5 rounded cursor-pointer ${submitted === 'not_useful' ? 'text-destructive bg-destructive/10' : 'text-muted-foreground hover:text-foreground'}`}
				title={t.activityCard.notUseful}
			>
				<ThumbsDown className="size-3" />
			</button>
		</div>
	)
}
