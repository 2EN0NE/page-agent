import {
	Copy,
	CornerUpLeft,
	ExternalLink,
	Eye,
	EyeOff,
	FoldVertical,
	Loader2,
	Scale,
	UnfoldVertical,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { siGithub } from 'simple-icons'

import { DEMO_BASE_URL, DEMO_MODEL, isTestingEndpoint } from '@/agent/constants'
import type { ExtConfig, LanguagePreference } from '@/agent/useAgent'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useI18n } from '@/i18n'

interface ConfigPanelProps {
	config: ExtConfig | null
	onSave: (config: ExtConfig) => Promise<void>
	onClose: () => void
}

export function ConfigPanel({ config, onSave, onClose }: ConfigPanelProps) {
	const { t } = useI18n()
	const [baseURL, setBaseURL] = useState(config?.baseURL || DEMO_BASE_URL)
	const [model, setModel] = useState(config?.model || DEMO_MODEL)
	const [apiKey, setApiKey] = useState(config?.apiKey)
	const [language, setLanguage] = useState<LanguagePreference>(config?.language)
	const [maxSteps, setMaxSteps] = useState(config?.maxSteps)
	const [systemInstruction, setSystemInstruction] = useState(config?.systemInstruction ?? '')
	const [experimentalLlmsTxt, setExperimentalLlmsTxt] = useState(
		config?.experimentalLlmsTxt ?? false
	)
	const [experimentalIncludeAllTabs, setExperimentalIncludeAllTabs] = useState(
		config?.experimentalIncludeAllTabs ?? false
	)
	const [disableNamedToolChoice, setDisableNamedToolChoice] = useState(
		config?.disableNamedToolChoice ?? false
	)
	const [contextWindowMinutes, setContextWindowMinutes] = useState(
		config?.contextWindowMinutes ?? 5
	)
	const [suggestionAlgorithms, setSuggestionAlgorithms] = useState<Set<string>>(
		new Set(config?.suggestionAlgorithms ?? ['semantic_frequency', 'prefix_match'])
	)
	const [articleSavePath, setArticleSavePath] = useState(config?.articleSavePath ?? '')
	const [advancedOpen, setAdvancedOpen] = useState(false)
	const [saving, setSaving] = useState(false)
	const [userAuthToken, setUserAuthToken] = useState('')
	const [copied, setCopied] = useState(false)
	const [showToken, setShowToken] = useState(false)
	const [showApiKey, setShowApiKey] = useState(false)

	const [prevConfig, setPrevConfig] = useState(config)
	if (prevConfig !== config) {
		setPrevConfig(config)
		setBaseURL(config?.baseURL || DEMO_BASE_URL)
		setModel(config?.model || DEMO_MODEL)
		setApiKey(config?.apiKey)
		setLanguage(config?.language)
		setMaxSteps(config?.maxSteps)
		setSystemInstruction(config?.systemInstruction ?? '')
		setExperimentalLlmsTxt(config?.experimentalLlmsTxt ?? false)
		setExperimentalIncludeAllTabs(config?.experimentalIncludeAllTabs ?? false)
		setDisableNamedToolChoice(config?.disableNamedToolChoice ?? false)
		setContextWindowMinutes(config?.contextWindowMinutes ?? 5)
		setSuggestionAlgorithms(
			new Set(config?.suggestionAlgorithms ?? ['semantic_frequency', 'prefix_match'])
		)
		setArticleSavePath(config?.articleSavePath ?? '')
	}

	// Poll for user auth token every second until found
	useEffect(() => {
		let interval: NodeJS.Timeout | null = null

		const fetchToken = async () => {
			const result = await chrome.storage.local.get('PageAgentExtUserAuthToken')
			const token = result.PageAgentExtUserAuthToken
			if (typeof token === 'string' && token) {
				setUserAuthToken(token)
				if (interval) {
					clearInterval(interval)
					interval = null
				}
			}
		}

		fetchToken()
		interval = setInterval(fetchToken, 1000)

		return () => {
			if (interval) clearInterval(interval)
		}
	}, [])

	const handleCopyToken = async () => {
		if (userAuthToken) {
			await navigator.clipboard.writeText(userAuthToken)
			setCopied(true)
			setTimeout(() => setCopied(false), 2000)
		}
	}

	const handleSave = async () => {
		setSaving(true)
		try {
			await onSave({
				apiKey,
				baseURL,
				model,
				language,
				maxSteps: maxSteps || undefined,
				systemInstruction: systemInstruction || undefined,
				experimentalLlmsTxt,
				experimentalIncludeAllTabs,
				disableNamedToolChoice,
				contextWindowMinutes: contextWindowMinutes || 5,
				suggestionAlgorithms: Array.from(suggestionAlgorithms) as (
					| 'semantic_frequency'
					| 'prefix_match'
				)[],
				articleSavePath: articleSavePath || undefined,
			})
		} finally {
			setSaving(false)
		}
	}

	return (
		<div className="flex flex-col gap-4 p-4 relative">
			<div className="flex items-center justify-between">
				<h2 className="text-base font-semibold">{t.settings.title}</h2>
				<Button
					variant="ghost"
					size="icon-sm"
					onClick={onClose}
					className="absolute top-2 right-3 cursor-pointer"
					aria-label={t.common.back}
				>
					<CornerUpLeft className="size-3.5" />
				</Button>
			</div>

			{/* User Auth Token Section */}
			<div className="flex flex-col gap-1.5 p-3 bg-muted/50 rounded-md border">
				<label htmlFor="user-auth-token" className="text-xs font-medium text-muted-foreground">
					{t.settings.userAuthToken}
				</label>
				<p className="text-[10px] text-muted-foreground mb-1">{t.settings.userAuthTokenDesc}</p>
				<div className="flex gap-2 items-center">
					<Input
						id="user-auth-token"
						readOnly
						value={
							userAuthToken
								? showToken
									? userAuthToken
									: `${userAuthToken.slice(0, 4)}${'•'.repeat(userAuthToken.length - 8)}${userAuthToken.slice(-4)}`
								: t.common.loading
						}
						className="text-xs h-8 font-mono bg-background"
					/>
					<Button
						variant="outline"
						size="icon"
						className="h-8 w-8 shrink-0 cursor-pointer"
						onClick={() => setShowToken(!showToken)}
						disabled={!userAuthToken}
						aria-label={showToken ? t.settings.hideToken : t.settings.showToken}
						aria-pressed={showToken}
					>
						{showToken ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
					</Button>
					<Button
						variant="outline"
						size="icon"
						className="h-8 w-8 shrink-0 cursor-pointer"
						onClick={handleCopyToken}
						disabled={!userAuthToken}
						aria-label={t.settings.copyToken}
					>
						{copied ? <span className="">✓</span> : <Copy className="size-3" />}
					</Button>
					<span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
						{copied ? t.settings.tokenCopied : ''}
					</span>
				</div>
			</div>

			{/* Hub link */}
			<a
				href="/hub.html"
				target="_blank"
				rel="noopener noreferrer"
				className="flex items-center justify-between p-3 rounded-md border bg-muted/50 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors"
			>
				{t.settings.manageHub}
				<ExternalLink className="size-3" />
			</a>

			<div className="flex flex-col gap-1.5">
				<label htmlFor="base-url" className="text-xs text-muted-foreground">
					{t.settings.baseURL}
				</label>
				<Input
					id="base-url"
					placeholder="https://api.openai.com/v1"
					value={baseURL}
					onChange={(e) => setBaseURL(e.target.value)}
					className="text-xs h-8"
				/>
			</div>

			{/* Testing API notice */}
			{isTestingEndpoint(baseURL) && (
				<div className="p-2.5 rounded-md border border-amber-500/30 bg-amber-500/5 text-[11px] text-muted-foreground leading-relaxed">
					<Scale className="size-3 inline-block mr-1 -mt-0.5 text-amber-600" />
					{t.settings.testingApiNotice}
				</div>
			)}

			<div className="flex flex-col gap-1.5">
				<label htmlFor="model" className="text-xs text-muted-foreground">
					{t.settings.model}
				</label>
				<Input
					id="model"
					placeholder="gpt-5.1"
					value={model}
					onChange={(e) => setModel(e.target.value)}
					className="text-xs h-8"
				/>
			</div>

			<div className="flex flex-col gap-1.5">
				<label htmlFor="api-key" className="text-xs text-muted-foreground">
					{t.settings.apiKey}
				</label>
				<div className="flex gap-2 items-center">
					<Input
						id="api-key"
						type={showApiKey ? 'text' : 'password'}
						value={apiKey}
						onChange={(e) => setApiKey(e.target.value)}
						className="text-xs h-8"
					/>
					<Button
						variant="outline"
						size="icon"
						className="h-8 w-8 shrink-0 cursor-pointer"
						onClick={() => setShowApiKey(!showApiKey)}
						aria-label={showApiKey ? t.settings.hideApiKey : t.settings.showApiKey}
					>
						{showApiKey ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
					</Button>
				</div>
			</div>

			<div className="flex flex-col gap-1.5">
				<label className="text-xs text-muted-foreground">{t.settings.language}</label>
				<select
					value={language ?? ''}
					onChange={(e) => setLanguage((e.target.value || undefined) as LanguagePreference)}
					className="h-8 text-xs rounded-md border border-input bg-background px-2 cursor-pointer"
				>
					<option value="">{t.settings.languageSystem}</option>
					<option value="en-US">{t.settings.languageEn}</option>
					<option value="zh-CN">{t.settings.languageZh}</option>
				</select>
			</div>

			{/* Advanced Config */}
			<button
				type="button"
				onClick={() => setAdvancedOpen(!advancedOpen)}
				className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer mt-1 font-bold"
			>
				{t.settings.advanced}
				{advancedOpen ? <FoldVertical className="size-3" /> : <UnfoldVertical className="size-3" />}
			</button>

			{advancedOpen && (
				<>
					<div className="flex flex-col gap-1.5">
						<label htmlFor="max-steps" className="text-xs text-muted-foreground">
							{t.settings.maxSteps}
						</label>
						<Input
							id="max-steps"
							type="number"
							placeholder="40"
							min={1}
							max={200}
							value={maxSteps ?? ''}
							onChange={(e) => setMaxSteps(e.target.value ? Number(e.target.value) : undefined)}
							className="text-xs h-8 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]"
						/>
					</div>

					<div className="flex flex-col gap-1.5">
						<label className="text-xs text-muted-foreground">{t.settings.systemInstruction}</label>
						<textarea
							placeholder={t.settings.systemInstructionPlaceholder}
							value={systemInstruction}
							onChange={(e) => setSystemInstruction(e.target.value)}
							rows={3}
							className="text-xs rounded-md border border-input bg-background px-3 py-2 resize-y min-h-[60px]"
						/>
					</div>

					<label className="flex items-center justify-between cursor-pointer">
						<span className="text-xs text-muted-foreground">
							{t.settings.disableNamedToolChoice}
						</span>
						<Switch checked={disableNamedToolChoice} onCheckedChange={setDisableNamedToolChoice} />
					</label>

					<label className="flex items-center justify-between cursor-pointer">
						<span className="text-xs text-muted-foreground">{t.settings.experimentalLlmsTxt}</span>
						<Switch checked={experimentalLlmsTxt} onCheckedChange={setExperimentalLlmsTxt} />
					</label>

					<label className="flex items-center justify-between cursor-pointer">
						<span className="text-xs text-muted-foreground">
							{t.settings.experimentalIncludeAllTabs}
						</span>
						<Switch
							checked={experimentalIncludeAllTabs}
							onCheckedChange={setExperimentalIncludeAllTabs}
						/>
					</label>

					<div className="flex flex-col gap-1.5">
						<label htmlFor="context-window" className="text-xs text-muted-foreground">
							{t.settings.contextWindow}
						</label>
						<Input
							id="context-window"
							type="number"
							placeholder="5"
							min={1}
							max={60}
							value={contextWindowMinutes}
							onChange={(e) => setContextWindowMinutes(Number(e.target.value) || 5)}
							className="text-xs h-8"
						/>
						<p className="text-[10px] text-muted-foreground">{t.settings.contextWindowDesc}</p>
					</div>

					<div className="flex flex-col gap-1.5">
						<label className="text-xs text-muted-foreground">
							{t.settings.suggestionAlgorithms}
						</label>
						<div className="flex flex-col gap-1">
							{[
								{ id: 'semantic_frequency', label: t.settings.algoSemanticFrequency },
								{ id: 'prefix_match', label: t.settings.algoPrefixMatch },
							].map((algo) => (
								<label key={algo.id} className="flex items-center gap-2 cursor-pointer">
									<input
										type="checkbox"
										checked={suggestionAlgorithms.has(algo.id)}
										onChange={(e) => {
											const next = new Set(suggestionAlgorithms)
											if (e.target.checked) {
												if (next.size < 3) next.add(algo.id)
											} else {
												next.delete(algo.id)
											}
											setSuggestionAlgorithms(next)
										}}
										className="size-3 cursor-pointer"
										disabled={!suggestionAlgorithms.has(algo.id) && suggestionAlgorithms.size >= 3}
									/>
									<span className="text-[11px] text-muted-foreground">{algo.label}</span>
								</label>
							))}
						</div>
						<p className="text-[10px] text-muted-foreground">
							{t.settings.suggestionAlgorithmsDesc}
						</p>
					</div>

					<div className="flex flex-col gap-1.5">
						<label htmlFor="article-save-path" className="text-xs text-muted-foreground">
							{t.settings.articleSavePath}
						</label>
						<Input
							id="article-save-path"
							placeholder="~/Obsidian/Clips or /path/to/folder"
							value={articleSavePath}
							onChange={(e) => setArticleSavePath(e.target.value)}
							className="text-xs h-8"
						/>
						<p className="text-[10px] text-muted-foreground">{t.settings.articleSavePathDesc}</p>
					</div>
				</>
			)}

			<div className="flex gap-2 mt-2">
				<Button variant="outline" onClick={onClose} className="flex-1 h-8 text-xs cursor-pointer">
					{t.common.cancel}
				</Button>
				<Button
					onClick={handleSave}
					disabled={saving}
					className="flex-1 h-8 text-xs cursor-pointer"
				>
					{saving ? <Loader2 className="size-3 animate-spin" /> : t.common.save}
				</Button>
			</div>

			{/* Footer */}
			<div className="mt-4 mb-4 pt-4 border-t border-border/50 flex gap-2 justify-between text-[10px] text-muted-foreground">
				<div className="flex flex-col justify-between">
					<span>
						{t.footer.version} <span className="font-mono">v{__VERSION__}</span>
					</span>

					<a
						href="https://github.com/2EN0NE/page-agent"
						target="_blank"
						rel="noopener noreferrer"
						className="flex items-center gap-1 hover:text-foreground"
					>
						<svg role="img" viewBox="0 0 24 24" className="size-3 fill-current">
							<path d={siGithub.path} />
						</svg>
						<span>{t.footer.sourceCode}</span>
					</a>
				</div>

				<div className="flex flex-col items-end">
					<span className="flex items-center gap-1">
						<span>{t.footer.contact}</span>
					</span>
				</div>
			</div>

			{/* attribute */}
			<div className="text-[10px] text-muted-foreground bg-background flex justify-around py-2">
				<span className="leading-loose">
					{t.footer.builtWith}
					<span className="underline hover:text-foreground cursor-default">2EN0NE</span>
					{' · '}
					{t.footer.inspiredBy}
				</span>
			</div>
		</div>
	)
}
