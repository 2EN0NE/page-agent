/**
 * FormFieldCardBody — Body content for the Form activity card.
 */
import { ChevronDown, ChevronUp, Focus } from 'lucide-react'
import { useState } from 'react'

import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { ScannedFormGroup } from '@/sidecar/FormScanner'

interface FormFieldCardBodyProps {
	formGroups: ScannedFormGroup[]
	tabId?: number
	onFocusField?: (selector: string, fieldLabel: string) => void
}

export function FormFieldCardBody({ formGroups, tabId, onFocusField }: FormFieldCardBodyProps) {
	return (
		<div className="space-y-1.5 max-h-[240px] overflow-y-auto pr-1">
			{formGroups.map((group) => (
				<FormGroupSection
					key={group.formId}
					group={group}
					tabId={tabId}
					onFocusField={onFocusField}
				/>
			))}
		</div>
	)
}

function FormGroupSection({
	group,
	tabId,
	onFocusField,
}: {
	group: ScannedFormGroup
	tabId?: number
	onFocusField?: (selector: string, fieldLabel: string) => void
}) {
	const { t } = useI18n()
	const [groupExpanded, setGroupExpanded] = useState(true)

	const handleFocusField = async (selector: string, fieldLabel: string) => {
		if (!tabId) return
		try {
			await chrome.tabs.sendMessage(tabId, {
				type: 'SIDECAR',
				action: 'focus_field_by_selector',
				payload: { selector },
			})
			onFocusField?.(selector, fieldLabel)
		} catch (err) {
			console.warn('[FormFieldCard] Failed to focus field:', err)
		}
	}

	const displayName =
		group.formName ||
		(group.isFormElement
			? `Form (${group.fields.length} fields)`
			: `${t.formCard.formFields} (${group.fields.length})`)

	return (
		<div className="rounded border border-input bg-background/40">
			{/* Form group header */}
			<button
				onClick={() => setGroupExpanded(!groupExpanded)}
				className="w-full flex items-center justify-between px-2 py-1.5 text-left cursor-pointer hover:bg-muted/30 transition-colors"
			>
				<div className="flex items-center gap-1.5 min-w-0">
					<span className="text-[10px] font-medium truncate">{displayName}</span>
					<span className="text-[9px] text-muted-foreground shrink-0">{group.fields.length}</span>
				</div>
				{groupExpanded ? (
					<ChevronUp className="size-3 text-muted-foreground shrink-0" />
				) : (
					<ChevronDown className="size-3 text-muted-foreground shrink-0" />
				)}
			</button>

			{/* Field list */}
			{groupExpanded && (
				<div className="px-2 pb-1.5 space-y-0.5">
					{group.fields.map((field, i) => (
						<button
							key={`${field.selector}-${i}`}
							onClick={() =>
								handleFocusField(
									field.selector,
									field.label || field.name || field.placeholder || t.formCard.unnamed
								)
							}
							className={cn(
								'w-full flex items-center justify-between rounded px-1.5 py-1 text-left transition-colors cursor-pointer group',
								'hover:bg-blue-500/5'
							)}
							title={`${t.formCard.focus}: ${field.label || field.name || field.placeholder || t.formCard.field}`}
						>
							<div className="flex items-center gap-1.5 min-w-0">
								<Focus className="size-3 text-muted-foreground group-hover:text-blue-500 shrink-0" />
								<span className="text-[11px] truncate">
									{field.label || field.name || field.placeholder || t.formCard.unnamed}
								</span>
								{field.type && (
									<span className="text-[8px] px-1 py-0 rounded bg-muted text-muted-foreground uppercase shrink-0">
										{field.type}
									</span>
								)}
							</div>
							<span className="text-[9px] text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0 transition-opacity">
								{t.formCard.focus}
							</span>
						</button>
					))}
				</div>
			)}
		</div>
	)
}
