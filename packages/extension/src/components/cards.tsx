import type {
	AgentActivity,
	AgentErrorEvent,
	AgentStepEvent,
	HistoricalEvent,
	ObservationEvent,
	RetryEvent,
	SidecarActionEvent,
} from '@page-agent/core'
import {
	CheckCircle,
	Eye,
	Focus,
	Globe,
	Keyboard,
	MessageSquare,
	Mouse,
	MousePointerClick,
	MoveVertical,
	RefreshCw,
	Save,
	Sparkles,
	X,
	XCircle,
	Zap,
} from 'lucide-react'
import { Fragment, useState } from 'react'

import { useI18n } from '@/i18n'
import type { Translation } from '@/i18n'
import { cn } from '@/lib/utils'

// Result card for done action
function ResultCard({
	success,
	text,
	children,
}: {
	success: boolean
	text: string
	children?: React.ReactNode
}) {
	const { t } = useI18n()
	return (
		<div
			className={cn(
				'rounded-lg border p-3',
				success ? 'border-green-500/30 bg-green-500/10' : 'border-destructive/30 bg-destructive/10'
			)}
		>
			<div className="flex items-center gap-2 mb-2">
				{success ? (
					<CheckCircle className="size-3.5 text-green-500" />
				) : (
					<XCircle className="size-3.5 text-destructive" />
				)}
				<span
					className={cn(
						'text-xs font-medium',
						success ? 'text-green-600 dark:text-green-400' : 'text-destructive'
					)}
				>
					{t.resultCard.title}: {success ? t.resultCard.success : t.resultCard.failed}
				</span>
			</div>
			<p className="text-[12px] text-foreground pl-5 whitespace-pre-wrap">{text}</p>
			{children}
		</div>
	)
}

// Single reflection item with truncation
function ReflectionItem({ icon, value }: { icon: string; value: string }) {
	const [expanded, setExpanded] = useState(false)

	return (
		<Fragment>
			<span className="text-xs flex justify-center">{icon}</span>
			<span
				className={cn(
					'text-[11px] text-muted-foreground cursor-pointer hover:text-muted-foreground/70',
					!expanded && 'line-clamp-1'
				)}
				onClick={() => setExpanded(!expanded)}
			>
				{value}
			</span>
		</Fragment>
	)
}

// Reflection section in step card
function ReflectionSection({
	reflection,
}: {
	reflection: {
		evaluation_previous_goal?: string
		memory?: string
		next_goal?: string
	}
}) {
	const items = [
		{ icon: '☑️', label: 'eval', value: reflection.evaluation_previous_goal },
		{ icon: '🧠', label: 'memory', value: reflection.memory },
		{ icon: '🎯', label: 'goal', value: reflection.next_goal },
	].filter((item) => item.value)

	if (items.length === 0) return null

	return (
		<div className="mb-2">
			<div className="grid grid-cols-[14px_1fr] gap-x-2 gap-y-2">
				{items.map((item) => (
					<ReflectionItem key={item.label} icon={item.icon} value={item.value!} />
				))}
			</div>
		</div>
	)
}

// Get icon for action type
function ActionIcon({ name, className }: { name: string; className?: string }) {
	const icons: Record<string, React.ReactNode> = {
		click_element_by_index: <Mouse className={className} />,
		input: <Keyboard className={className} />,
		scroll: <MoveVertical className={className} />,
		go_to_url: <Globe className={className} />,
	}
	return icons[name] || <Zap className={className} />
}

// Copy button with "Copied!" feedback
function CopyButton({ text, label }: { text: string; label: string }) {
	const { t } = useI18n()
	const [copied, setCopied] = useState(false)

	return (
		<button
			type="button"
			onClick={() => {
				navigator.clipboard.writeText(text)
				setCopied(true)
				setTimeout(() => setCopied(false), 1500)
			}}
			className="text-[9px] text-muted-foreground hover:text-foreground transition-colors border px-1 rounded shrink-0 cursor-pointer backdrop-blur-xs"
		>
			{copied ? t.resultCard.copied : label}
		</button>
	)
}

// Extract message content by role from raw request
function extractPrompt(rawRequest: unknown, role: 'system' | 'user'): string | null {
	const messages = (rawRequest as { messages?: { role: string; content?: unknown }[] })?.messages
	if (!messages) return null
	if (!Array.isArray(messages)) return null
	const msg =
		role === 'system'
			? messages.find((m) => m.role === role)
			: messages.findLast((m) => m.role === role)
	if (!msg?.content) return null
	return typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content, null, 2)
}

// Raw request/response section (collapsible tabs, for debugging)
function RawSection({ rawRequest, rawResponse }: { rawRequest?: unknown; rawResponse?: unknown }) {
	const { t } = useI18n()
	const [activeTab, setActiveTab] = useState<'request' | 'response' | null>(null)

	if (!rawRequest && !rawResponse) return null

	const handleTabClick = (tab: 'request' | 'response') => {
		setActiveTab(activeTab === tab ? null : tab)
	}

	const content =
		activeTab === 'request' ? rawRequest : activeTab === 'response' ? rawResponse : null

	const systemPrompt = activeTab === 'request' ? extractPrompt(rawRequest, 'system') : null
	const userPrompt = activeTab === 'request' ? extractPrompt(rawRequest, 'user') : null

	return (
		<div className="mt-2 border-t border-dashed pt-2">
			<div className="flex items-center gap-3 -my-1">
				{rawRequest != null && (
					<button
						type="button"
						onClick={() => handleTabClick('request')}
						className={cn(
							'text-[10px] mt-0.5 transition-colors border-b cursor-pointer',
							activeTab === 'request'
								? 'text-foreground border-foreground'
								: 'text-muted-foreground border-transparent hover:text-foreground'
						)}
					>
						{t.resultCard.rawRequest}
					</button>
				)}
				{rawResponse != null && (
					<button
						type="button"
						onClick={() => handleTabClick('response')}
						className={cn(
							'text-[10px] mt-0.5 transition-colors border-b cursor-pointer',
							activeTab === 'response'
								? 'text-foreground border-foreground'
								: 'text-muted-foreground border-transparent hover:text-foreground'
						)}
					>
						{t.resultCard.rawResponse}
					</button>
				)}
			</div>
			{content != null && (
				<div className="relative mt-1.5">
					<div className="absolute top-1 right-1 flex gap-1">
						{systemPrompt && <CopyButton text={systemPrompt} label={t.resultCard.copySystem} />}
						{userPrompt && <CopyButton text={userPrompt} label={t.resultCard.copyUser} />}
						<CopyButton text={JSON.stringify(content, null, 4)} label={t.resultCard.copy} />
					</div>
					<pre className="p-2 pt-5 text-[10px] text-foreground/70 bg-muted rounded overflow-x-auto max-h-60 overflow-y-auto">
						{JSON.stringify(content, null, 4)}
					</pre>
				</div>
			)}
		</div>
	)
}

function StepCard({ event }: { event: AgentStepEvent }) {
	const { t } = useI18n()
	return (
		<div className="rounded-lg border-l-2 border-l-blue-500/50 border bg-muted/40 p-2.5">
			<div className="text-[11px] font-semibold text-foreground tracking-wide mb-2">
				{t.stepCard.step} #{event.stepIndex! + 1}
			</div>

			{/* Reflection */}
			{event.reflection && <ReflectionSection reflection={event.reflection} />}

			{/* Action */}
			{event.action && (
				<div>
					<div className="text-[11px] font-semibold text-foreground tracking-wide mb-1">
						{t.stepCard.actions}
					</div>
					<div className="flex items-start gap-2">
						<ActionIcon
							name={event.action.name}
							className="size-3.5 text-blue-500 shrink-0 mt-0.5"
						/>
						<div className="flex-1 min-w-0">
							<p className="text-xs text-foreground/80 mb-0.5 wrap-anywhere break-all line-clamp-1 hover:line-clamp-none">
								<span className="font-medium text-foreground/70">{event.action.name}</span>
								{event.action.name !== 'done' && (
									<span className="text-muted-foreground/70 ml-1.5">
										{JSON.stringify(event.action.input)}
									</span>
								)}
							</p>
							<p className="text-[11px] text-muted-foreground/70 grid grid-cols-[auto_1fr] gap-1.5">
								<span className="">└</span>
								<span className="wrap-anywhere break-all line-clamp-1 hover:line-clamp-3">
									{event.action.output}
								</span>
							</p>
						</div>
					</div>
				</div>
			)}

			{/* Raw Response */}
			<RawSection rawRequest={event.rawRequest} rawResponse={event.rawResponse} />
		</div>
	)
}

function ObservationCard({ event }: { event: ObservationEvent }) {
	return (
		<div className="rounded-lg border-l-2 border-l-green-500/50 border bg-muted/40 p-2.5">
			<div className="flex items-start gap-2">
				<Eye className="size-3.5 text-green-500 shrink-0 mt-0.5" />
				<span className="text-[11px] text-muted-foreground">{event.content}</span>
			</div>
		</div>
	)
}

function RetryCard({ event }: { event: RetryEvent }) {
	return (
		<div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5">
			<div className="flex items-start gap-1.5">
				<RefreshCw className="size-3 text-amber-500 shrink-0 mt-0.5" />
				<span className="text-xs text-amber-600 dark:text-amber-400">
					{event.message} ({event.attempt}/{event.maxAttempts})
				</span>
			</div>
		</div>
	)
}

function ErrorCard({ event }: { event: AgentErrorEvent }) {
	return (
		<div className="rounded-lg border border-destructive/30 bg-destructive/10 p-2.5">
			<div className="flex items-start gap-1.5">
				<XCircle className="size-3 text-destructive shrink-0 mt-0.5" />
				<span className="text-xs text-destructive">{event.message}</span>
			</div>
			<RawSection rawResponse={event.rawResponse} />
		</div>
	)
}

// Sidecar action card — renders user interactions from B/C regions
function SidecarActionCard({ event }: { event: SidecarActionEvent }) {
	const { t } = useI18n()
	const getActionInfo = () => {
		switch (event.action) {
			case 'save_article':
				return {
					icon: <Save className="size-3 text-amber-500 shrink-0 mt-0.5" />,
					label: t.sidecarAction.saveArticle,
					color: 'text-amber-600 dark:text-amber-400',
					bg: 'bg-amber-500/5 border-amber-500/20',
				}
			case 'focus_field':
				return {
					icon: <Focus className="size-3 text-blue-500 shrink-0 mt-0.5" />,
					label: t.sidecarAction.focusField,
					color: 'text-blue-600 dark:text-blue-400',
					bg: 'bg-blue-500/5 border-blue-500/20',
				}
			case 'fill_field':
				return {
					icon: <Keyboard className="size-3 text-purple-500 shrink-0 mt-0.5" />,
					label: t.sidecarAction.fillField,
					color: 'text-purple-600 dark:text-purple-400',
					bg: 'bg-purple-500/5 border-purple-500/20',
				}
			case 'select_suggestion':
				return {
					icon: <MousePointerClick className="size-3 text-green-500 shrink-0 mt-0.5" />,
					label: t.sidecarAction.selectSuggestion,
					color: 'text-green-600 dark:text-green-400',
					bg: 'bg-green-500/5 border-green-500/20',
				}
			case 'send_chat':
				return {
					icon: <MessageSquare className="size-3 text-foreground shrink-0 mt-0.5" />,
					label: t.sidecarAction.chat,
					color: 'text-foreground',
					bg: 'bg-muted/40 border-border',
				}
			case 'dismiss_suggestion':
				return {
					icon: <X className="size-3 text-muted-foreground shrink-0 mt-0.5" />,
					label: t.sidecarAction.dismissSuggestion,
					color: 'text-muted-foreground',
					bg: 'bg-muted/20 border-border/50',
				}
		}
	}

	const info = getActionInfo()
	const payload = event.payload
	const payloadText = Object.entries(payload)
		.filter(([, v]) => typeof v === 'string' || typeof v === 'number')
		.map(([k, v]) => `${k}: ${v}`)
		.join(' · ')

	return (
		<div className={cn('rounded-lg border-l-2 p-2.5', info.bg)}>
			<div className="flex items-start gap-2">
				{info.icon}
				<div className="flex-1 min-w-0">
					<span className={cn('text-[11px] font-medium', info.color)}>{info.label}</span>
					{payloadText && (
						<p className="text-[10px] text-muted-foreground truncate" title={payloadText}>
							{payloadText}
						</p>
					)}
				</div>
				<span className="text-[9px] text-muted-foreground shrink-0">
					{new Date(event.timestamp).toLocaleTimeString([], {
						hour: '2-digit',
						minute: '2-digit',
						second: '2-digit',
					})}
				</span>
			</div>
		</div>
	)
}

// History event card component
export function EventCard({ event }: { event: HistoricalEvent }) {
	// Done action - show as result card
	if (event.type === 'step' && event.action?.name === 'done') {
		const input = event.action.input as { text?: string; success?: boolean }
		return (
			<>
				<StepCard event={event as AgentStepEvent} />
				<ResultCard
					success={input?.success ?? true}
					text={input?.text || event.action.output || ''}
				/>
			</>
		)
	}

	if (event.type === 'step') {
		return <StepCard event={event as AgentStepEvent} />
	}

	if (event.type === 'observation') {
		return <ObservationCard event={event as ObservationEvent} />
	}

	if (event.type === 'retry') {
		return <RetryCard event={event as RetryEvent} />
	}

	if (event.type === 'error') {
		return <ErrorCard event={event as AgentErrorEvent} />
	}

	if (event.type === 'sidecar_action') {
		return <SidecarActionCard event={event as SidecarActionEvent} />
	}

	return null
}

// Activity card with animation
export function ActivityCard({ activity }: { activity: AgentActivity }) {
	const { t } = useI18n()
	const getActivityInfo = () => {
		switch (activity.type) {
			case 'thinking':
				return { text: t.activityCard.thinking, color: 'text-blue-500' }
			case 'executing':
				return { text: `${t.activityCard.executing} ${activity.tool}...`, color: 'text-amber-500' }
			case 'executed':
				return { text: `${t.activityCard.done}: ${activity.tool}`, color: 'text-green-500' }
			case 'retrying':
				return {
					text: `${t.activityCard.retrying} (${activity.attempt}/${activity.maxAttempts})...`,
					color: 'text-amber-500',
				}
			case 'error':
				return { text: activity.message, color: 'text-destructive' }
		}
	}

	const info = getActivityInfo()

	return (
		<div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-2.5 animate-pulse">
			<div className="relative">
				<Sparkles className={cn('size-3.5', info.color)} />
				<span
					className={cn(
						'absolute -top-0.5 -right-0.5 size-1.5 rounded-full animate-ping',
						activity.type === 'thinking'
							? 'bg-blue-500'
							: activity.type === 'executing'
								? 'bg-amber-500'
								: activity.type === 'retrying'
									? 'bg-amber-500'
									: activity.type === 'error'
										? 'bg-destructive'
										: 'bg-green-500'
					)}
				/>
			</div>
			<span className={cn('text-xs', info.color)}>{info.text}</span>
		</div>
	)
}
