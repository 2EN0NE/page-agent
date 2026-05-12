/**
 * AlgorithmConfigDialog - Dialog for adding/configuring custom algorithms
 */
import { useEffect, useState } from 'react'

import type { AlgorithmConfig } from '@/agent/useAgent'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'

interface AlgorithmConfigDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	editingAlgorithm?: AlgorithmConfig
	onSave: (config: AlgorithmConfig) => void
}

export function AlgorithmConfigDialog({
	open,
	onOpenChange,
	editingAlgorithm,
	onSave,
}: AlgorithmConfigDialogProps) {
	const { t } = useI18n()
	const [name, setName] = useState('')
	const [type, setType] = useState<'rule_based' | 'sandbox_js'>('rule_based')
	const [description, setDescription] = useState('')
	const [code, setCode] = useState('')
	const [config, setConfig] = useState('')
	const [error, setError] = useState('')

	useEffect(() => {
		if (editingAlgorithm) {
			setName(editingAlgorithm.name)
			setType(editingAlgorithm.type as 'rule_based' | 'sandbox_js')
			setDescription(editingAlgorithm.description ?? '')
			setCode(editingAlgorithm.code ?? '')
			setConfig(editingAlgorithm.config ? JSON.stringify(editingAlgorithm.config, null, 2) : '')
		} else {
			setName('')
			setType('rule_based')
			setDescription('')
			setCode('')
			setConfig('')
		}
		setError('')
	}, [editingAlgorithm, open])

	if (!open) return null

	const handleSave = () => {
		if (!name.trim()) {
			setError('Name is required')
			return
		}
		if (type === 'sandbox_js' && !code.trim()) {
			setError('Code is required for sandbox JS algorithms')
			return
		}
		let parsedConfig: Record<string, unknown> | undefined
		if (type === 'rule_based' && config.trim()) {
			try {
				parsedConfig = JSON.parse(config.trim())
			} catch {
				setError('Configuration must be valid JSON')
				return
			}
		}
		const algo: AlgorithmConfig = {
			id: editingAlgorithm?.id ?? `custom_${name.trim()}_${Date.now()}`,
			name: name.trim(),
			type,
			enabled: editingAlgorithm?.enabled ?? true,
			description: description.trim() || undefined,
			config: type === 'rule_based' ? parsedConfig : undefined,
			code: type === 'sandbox_js' ? code.trim() : undefined,
		}
		onSave(algo)
		onOpenChange(false)
	}

	const handleClose = () => {
		onOpenChange(false)
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
			<div className="bg-background rounded-lg border shadow-lg w-full max-w-md mx-4 p-4 space-y-4">
				<div className="flex items-center justify-between">
					<h3 className="text-sm font-semibold">
						{editingAlgorithm ? t.algorithmDialog.editTitle : t.algorithmDialog.title}
					</h3>
					<button
						onClick={handleClose}
						className="text-muted-foreground hover:text-foreground cursor-pointer text-xs"
					>
						✕
					</button>
				</div>

				{error && <p className="text-[11px] text-red-500">{error}</p>}

				<div className="space-y-1">
					<label className="text-[11px] text-muted-foreground">{t.algorithmDialog.name}</label>
					<Input
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="my-algorithm"
						className="text-xs h-8"
					/>
				</div>

				<div className="space-y-1">
					<label className="text-[11px] text-muted-foreground">{t.algorithmDialog.type}</label>
					<select
						value={type}
						onChange={(e) => setType(e.target.value as 'rule_based' | 'sandbox_js')}
						className="h-8 text-xs rounded-md border border-input bg-background px-2 w-full cursor-pointer"
					>
						<option value="rule_based">{t.algorithmDialog.typeRuleBased}</option>
						<option value="sandbox_js">{t.algorithmDialog.typeSandboxJS}</option>
					</select>
				</div>

				<div className="space-y-1">
					<label className="text-[11px] text-muted-foreground">
						{t.algorithmDialog.description}
					</label>
					<Input
						value={description}
						onChange={(e) => setDescription(e.target.value)}
						placeholder="Optional description..."
						className="text-xs h-8"
					/>
				</div>

				{type === 'sandbox_js' && (
					<div className="space-y-1">
						<label className="text-[11px] text-muted-foreground">{t.algorithmDialog.code}</label>
						<textarea
							value={code}
							onChange={(e) => setCode(e.target.value)}
							placeholder={t.algorithmDialog.codePlaceholder}
							rows={6}
							className="text-xs rounded-md border border-input bg-background px-3 py-2 resize-y min-h-[120px] w-full font-mono"
						/>
						<p className="text-[10px] text-muted-foreground leading-relaxed">
							{t.algorithmDialog.codeHelp}
						</p>
					</div>
				)}

				{type === 'rule_based' && (
					<div className="space-y-1">
						<label className="text-[11px] text-muted-foreground">{t.algorithmDialog.config}</label>
						<textarea
							value={config}
							onChange={(e) => setConfig(e.target.value)}
							placeholder={t.algorithmDialog.configPlaceholder}
							rows={6}
							className="text-xs rounded-md border border-input bg-background px-3 py-2 resize-y min-h-[120px] w-full font-mono"
						/>
						<p className="text-[10px] text-muted-foreground leading-relaxed">
							{t.algorithmDialog.configHelp}
						</p>
					</div>
				)}

				<div className="flex gap-2 pt-2">
					<Button
						variant="outline"
						onClick={handleClose}
						className="flex-1 h-8 text-xs cursor-pointer"
					>
						{t.common.cancel}
					</Button>
					<Button onClick={handleSave} className="flex-1 h-8 text-xs cursor-pointer">
						{t.common.save}
					</Button>
				</div>
			</div>
		</div>
	)
}
