/**
 * FormSuggestionBar - Vertical suggestion list shown above the chat input.
 */
import { Lightbulb, X, Zap } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { FormSuggestion } from '@/sidecar/FormDetector'

interface FormSuggestionBarProps {
	fieldLabel: string
	suggestions: FormSuggestion[]
	sessionId?: string
	onFill: (value: string) => void
	onAdopt?: (sessionId: string, algorithm: string, value: string) => void
	onDismiss?: () => void
}

export function FormSuggestionBar({
	fieldLabel,
	suggestions,
	sessionId,
	onFill,
	onAdopt,
	onDismiss,
}: FormSuggestionBarProps) {
	const { t } = useI18n()
	const [dismissed, setDismissed] = useState(false)
	const [filled, setFilled] = useState<Set<string>>(new Set())

	if (dismissed || suggestions.length === 0) return null

	const handleFill = (value: string, algorithm: string) => {
		onFill(value)
		setFilled((prev) => new Set(prev).add(value))
		if (sessionId && onAdopt) {
			onAdopt(sessionId, algorithm, value)
		}
	}

	return (
		<div className="border-t bg-blue-500/5 px-3 py-2 space-y-1.5 shadow-[0_-4px_12px_rgba(0,0,0,0.08)] dark:shadow-[0_-4px_12px_rgba(0,0,0,0.25)] relative z-10">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-1.5">
					<Lightbulb className="size-3 text-blue-500" />
					<span className="text-[10px] font-medium text-blue-700 dark:text-blue-400">
						{t.suggestionBar.title(fieldLabel)}
					</span>
				</div>
				<button
					onClick={() => {
						setDismissed(true)
						onDismiss?.()
					}}
					className="text-muted-foreground hover:text-foreground cursor-pointer"
					title={t.suggestionBar.dismiss}
				>
					<X className="size-3" />
				</button>
			</div>

			<div className="space-y-1">
				{suggestions.map((s, i) => (
					<button
						key={`${s.value}-${i}`}
						onClick={() => handleFill(s.value, s.algorithm)}
						disabled={filled.has(s.value)}
						className={cn(
							'w-full flex items-center justify-between rounded-md px-2.5 py-1.5 text-left transition-colors cursor-pointer',
							filled.has(s.value)
								? 'bg-green-500/10 border border-green-500/20'
								: 'bg-background/60 border border-input hover:border-blue-400/50 hover:bg-blue-500/5'
						)}
					>
						<div className="flex items-center gap-2 min-w-0">
							<span className="text-[11px] font-medium truncate">{s.value}</span>
							<span
								className="text-[9px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 shrink-0 font-medium"
								title={s.explanation}
							>
								{t.suggestionBar.source}:{' '}
								{s.algorithm === 'semantic_frequency'
									? t.suggestionBar.semantic
									: s.algorithm === 'prefix_match'
										? t.suggestionBar.prefix
										: s.algorithm}
							</span>
						</div>
						<div className="flex items-center gap-1.5 shrink-0">
							<span className="text-[10px] text-muted-foreground">
								{Math.round(s.confidence * 100)}%
							</span>
							{filled.has(s.value) ? (
								<span className="text-[9px] text-green-600 dark:text-green-400 font-medium">
									{t.suggestionBar.filled}
								</span>
							) : (
								<Zap className="size-3 text-blue-500" />
							)}
						</div>
					</button>
				))}
			</div>
		</div>
	)
}
