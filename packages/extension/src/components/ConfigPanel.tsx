import {
	Copy,
	CornerUpLeft,
	Download,
	ExternalLink,
	Eye,
	EyeOff,
	FoldVertical,
	Scale,
	Trash2,
	UnfoldVertical,
	Upload,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { siGithub } from 'simple-icons'
import { toast } from 'sonner'

import { DEMO_BASE_URL, DEMO_MODEL, isTestingEndpoint } from '@/agent/constants'
import type { AlgorithmConfig, ExtConfig, LanguagePreference } from '@/agent/useAgent'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useI18n } from '@/i18n'
import {
	clearAllAccuracyData,
	exportAccuracyData,
	importAccuracyData,
} from '@/sidecar/AccuracyDataIO'

import { AlgorithmConfigDialog } from './AlgorithmConfigDialog'

interface ConfigPanelProps {
	config: ExtConfig | null
	onSave: (config: ExtConfig) => Promise<void>
	onClose: () => void
}

function defaultAlgorithms(): AlgorithmConfig[] {
	return [
		{
			id: 'semantic_frequency',
			name: 'Semantic Frequency',
			type: 'builtin',
			enabled: true,
			source: 'semantic_frequency',
			description: 'Text similarity of label/name/placeholder + frequency weighting',
		},
		{
			id: 'prefix_match',
			name: 'Prefix Match',
			type: 'builtin',
			enabled: true,
			source: 'prefix_match',
			description: 'Prefix-based matching against historical input values',
		},
	]
}

function getCloneTemplate(algoId: string): string {
	if (algoId === 'semantic_frequency') {
		return `// Clone of Semantic Frequency Algorithm
// Scores history items by token overlap with field text

function tokenize(text) {
  if (!text) return [];
  return text.toLowerCase().split(/[^a-z0-9\\u4e00-\\u9fa5]+/).filter(Boolean);
}

var fieldText = [field.label, field.name, field.placeholder].filter(Boolean).join(' ');
var fieldTokens = tokenize(fieldText);
var fieldKey = [field.tagName, field.name, field.type].filter(Boolean).join('|');

var scored = [];
for (var i = 0; i < history.length; i++) {
  var h = history[i];
  var valTokens = tokenize(h.value);
  var overlap = 0;
  for (var ft = 0; ft < fieldTokens.length; ft++) {
    for (var vt = 0; vt < valTokens.length; vt++) {
      if (fieldTokens[ft] === valTokens[vt]) overlap++;
    }
  }
  var confidence = Math.min(0.5 + overlap * 0.15 + (h.count ? h.count * 0.02 : 0), 0.95);
  if (confidence > 0.4 || overlap > 0) {
    scored.push({
      value: h.value,
      confidence: confidence,
      algorithm: 'Semantic Frequency (Custom)',
      explanation: 'Overlap: ' + overlap + (h.count ? ', used ' + h.count + 'x' : ''),
      fieldKey: fieldKey
    });
  }
}

scored.sort(function(a, b) { return b.confidence - a.confidence; });
return scored.slice(0, maxResults);`
	}
	if (algoId === 'prefix_match') {
		return `// Clone of Prefix Match Algorithm
// Filters history items by prefix matching

var fieldKey = [field.tagName, field.name, field.type].filter(Boolean).join('|');
var prefixLower = (prefix || '').toLowerCase();
var results = [];

for (var i = 0; i < history.length; i++) {
  var h = history[i];
  var val = h.value.toLowerCase();
  if (!prefixLower || val.indexOf(prefixLower) === 0) {
    var score = prefixLower ? prefixLower.length / Math.max(val.length, 1) : 0.3;
    results.push({
      value: h.value,
      confidence: Math.min(0.4 + score + (h.count ? h.count * 0.02 : 0), 0.9),
      algorithm: 'Prefix Match (Custom)',
      explanation: prefixLower ? 'Starts with "' + prefixLower + '"' : 'No prefix',
      fieldKey: fieldKey
    });
  }
}

results.sort(function(a, b) { return b.confidence - a.confidence; });
return results.slice(0, maxResults);`
	}
	return `// Cloned from built-in algorithm
// Available variables: field, prefix, history, maxResults
// Must return array of { value, confidence, algorithm, explanation, fieldKey }

return [];`
}

export function ConfigPanel({ config, onSave, onClose }: ConfigPanelProps) {
	const { t } = useI18n()
	const [baseURL, setBaseURL] = useState(config?.baseURL || DEMO_BASE_URL)
	const [advancedOpen, setAdvancedOpen] = useState(false)
	const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const [userAuthToken, setUserAuthToken] = useState('')
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
	const [algorithms, setAlgorithms] = useState<AlgorithmConfig[]>(
		config?.algorithms ?? defaultAlgorithms()
	)
	const [articleSavePath, setArticleSavePath] = useState(config?.articleSavePath ?? '')
	const [accuracyWindowDays, setAccuracyWindowDays] = useState(config?.accuracyWindowDays ?? 30)
	const [enableAccuracyCollection, setEnableAccuracyCollection] = useState(
		config?.enableAccuracyCollection ?? true
	)
	const [copied, setCopied] = useState(false)
	const importFileRef = useRef<HTMLInputElement>(null)
	const [showToken, setShowToken] = useState(false)
	const [showApiKey, setShowApiKey] = useState(false)
	const [algoDialogOpen, setAlgoDialogOpen] = useState(false)
	const [editingAlgo, setEditingAlgo] = useState<AlgorithmConfig | undefined>(undefined)
	const [accuracySummaries, setAccuracySummaries] = useState<
		Record<string, { score: number; totalTriggers: number }>
	>({})

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
		setAlgorithms(config?.algorithms ?? defaultAlgorithms())
		setArticleSavePath(config?.articleSavePath ?? '')
		setAccuracyWindowDays(config?.accuracyWindowDays ?? 30)
		setEnableAccuracyCollection(config?.enableAccuracyCollection ?? true)
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

	// Load accuracy summaries from IndexedDB
	useEffect(() => {
		const load = async () => {
			const { listAccuracySummaries } = await import('@/lib/db')
			const summaries = await listAccuracySummaries()
			const map: Record<string, { score: number; totalTriggers: number }> = {}
			for (const s of summaries) {
				map[s.algorithmName] = { score: s.score, totalTriggers: s.totalTriggers }
			}
			setAccuracySummaries(map)
		}
		load()
	}, [])

	const handleCopyToken = async () => {
		if (userAuthToken) {
			await navigator.clipboard.writeText(userAuthToken)
			setCopied(true)
			setTimeout(() => setCopied(false), 2000)
		}
	}

	const buildConfig = (): ExtConfig => ({
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
		algorithms: algorithms.length > 0 ? algorithms : undefined,
		articleSavePath: articleSavePath || undefined,
		accuracyWindowDays: accuracyWindowDays || 30,
		enableAccuracyCollection,
	})

	const triggerAutoSave = (immediate = false) => {
		if (autoSaveTimerRef.current) {
			clearTimeout(autoSaveTimerRef.current)
		}
		const save = () => {
			onSave(buildConfig()).catch((err) => {
				console.error('[ConfigPanel] Auto-save failed:', err)
			})
		}
		if (immediate) {
			save()
		} else {
			autoSaveTimerRef.current = setTimeout(save, 500)
		}
	}

	// Auto-save non-algorithm settings when they change
	const isFirstRender = useRef(true)
	useEffect(() => {
		if (isFirstRender.current) {
			isFirstRender.current = false
			return
		}
		triggerAutoSave()
	}, [
		baseURL,
		model,
		apiKey,
		language,
		maxSteps,
		systemInstruction,
		experimentalLlmsTxt,
		experimentalIncludeAllTabs,
		disableNamedToolChoice,
		contextWindowMinutes,
		articleSavePath,
		accuracyWindowDays,
		enableAccuracyCollection,
	])

	function getAccuracyBadge(algoId: string) {
		const summary = accuracySummaries[algoId]
		if (!summary || summary.totalTriggers === 0) {
			return (
				<span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-muted">
					{t.settings.accuracyUnknown}
				</span>
			)
		}
		const pct = Math.round(summary.score * 100)
		const [colorClass, label] =
			pct >= 70
				? ['text-green-700 bg-green-100', t.settings.accuracyHigh]
				: pct >= 40
					? ['text-yellow-700 bg-yellow-100', t.settings.accuracyModerate]
					: ['text-red-700 bg-red-100', t.settings.accuracyLow]
		return (
			<span
				className={`text-[10px] px-1.5 py-0.5 rounded ${colorClass}`}
				title={`${summary.totalTriggers} sessions`}
			>
				{t.settings.accuracy}: {pct}% ({label})
			</span>
		)
	}

	const enabledCount = algorithms.filter((a) => a.enabled).length

	return (
		<div className="flex flex-col gap-4 p-4 relative min-h-screen bg-background">
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
							{algorithms.map((algo) => (
								<div key={algo.id} className="flex items-center gap-2">
									<input
										type="checkbox"
										checked={algo.enabled}
										onChange={(e) => {
											if (e.target.checked && enabledCount >= 3) return
											setAlgorithms((prev) =>
												prev.map((a) =>
													a.id === algo.id ? { ...a, enabled: e.target.checked } : a
												)
											)
											triggerAutoSave(true)
										}}
										className="size-3 cursor-pointer"
										disabled={!algo.enabled && enabledCount >= 3}
									/>
									<span className="text-[11px] text-muted-foreground flex-1">
										{algo.name}
										<span className="text-[9px] text-muted-foreground/60 ml-1">({algo.type})</span>
									</span>
									{getAccuracyBadge(algo.id)}
									<Button
										variant="ghost"
										size="icon-sm"
										className="h-6 w-6 cursor-pointer"
										onClick={() => {
											if (algo.type === 'builtin') {
												// Clone builtin to sandbox_js for editing
												const cloned: AlgorithmConfig = {
													id: `${algo.id}_clone_${Date.now()}`,
													name: `${algo.name} (Custom)`,
													type: 'sandbox_js',
													enabled: false,
													code: getCloneTemplate(algo.id),
												}
												setEditingAlgo(cloned)
												setAlgoDialogOpen(true)
											} else {
												setEditingAlgo(algo)
												setAlgoDialogOpen(true)
											}
										}}
										aria-label={algo.type === 'builtin' ? 'Clone' : 'Edit'}
									>
										{algo.type === 'builtin' ? (
											<span className="text-[9px]">Clone</span>
										) : (
											<ExternalLink className="size-3" />
										)}
									</Button>
									<Button
										variant="ghost"
										size="icon-sm"
										className="h-6 w-6 cursor-pointer text-red-500"
										onClick={() => {
											setAlgorithms((prev) => prev.filter((a) => a.id !== algo.id))
											triggerAutoSave(true)
										}}
										aria-label="Delete"
									>
										<Trash2 className="size-3" />
									</Button>
								</div>
							))}
						</div>
						<p className="text-[10px] text-muted-foreground">
							{t.settings.suggestionAlgorithmsDesc}
						</p>
					</div>

					<Button
						variant="outline"
						size="sm"
						className="h-7 text-[11px] cursor-pointer w-fit"
						onClick={() => {
							setEditingAlgo(undefined)
							setAlgoDialogOpen(true)
						}}
					>
						+ {t.settings.addCustomAlgorithm}
					</Button>

					<div className="flex flex-col gap-1.5">
						<label className="flex items-center justify-between cursor-pointer">
							<span className="text-xs text-muted-foreground">
								{t.settings.enableAccuracyCollection}
							</span>
							<Switch
								checked={enableAccuracyCollection}
								onCheckedChange={setEnableAccuracyCollection}
							/>
						</label>
					</div>
					<p className="text-[10px] text-muted-foreground">
						Data is stored locally in browser IndexedDB. Use Export to download as JSON.
					</p>
					<div className="flex flex-wrap gap-2">
						<Button
							variant="outline"
							size="sm"
							className="h-7 text-[11px] cursor-pointer"
							onClick={async () => {
								try {
									await exportAccuracyData()
									toast.success(t.settings.exportSuccess)
								} catch (err) {
									toast.error(String(err))
								}
							}}
						>
							<Download className="size-3 mr-1" />
							{t.settings.exportAccuracyData}
						</Button>
						<Button
							variant="outline"
							size="sm"
							className="h-7 text-[11px] cursor-pointer"
							onClick={() => importFileRef.current?.click()}
						>
							<Upload className="size-3 mr-1" />
							{t.settings.importAccuracyData}
						</Button>
						<input
							ref={importFileRef}
							type="file"
							accept=".json"
							className="hidden"
							onChange={async (e) => {
								const file = e.target.files?.[0]
								if (!file) return
								try {
									await importAccuracyData(file)
									toast.success(t.settings.importSuccess)
								} catch (err) {
									toast.error(String(err))
								}
								e.target.value = ''
							}}
						/>
						<Button
							variant="outline"
							size="sm"
							className="h-7 text-[11px] cursor-pointer text-red-500"
							onClick={async () => {
								try {
									await clearAllAccuracyData()
									toast.success(t.settings.clearSuccess)
								} catch (err) {
									toast.error(String(err))
								}
							}}
						>
							<Trash2 className="size-3 mr-1" />
							{t.settings.clearAccuracyData}
						</Button>
					</div>

					<div className="flex flex-col gap-1.5">
						<label htmlFor="accuracy-window" className="text-xs text-muted-foreground">
							{t.settings.accuracyWindowDays}
						</label>
						<Input
							id="accuracy-window"
							type="number"
							placeholder="30"
							min={1}
							max={365}
							value={accuracyWindowDays}
							onChange={(e) => setAccuracyWindowDays(Number(e.target.value) || 30)}
							className="text-xs h-8"
						/>
						<p className="text-[10px] text-muted-foreground">{t.settings.accuracyWindowDaysDesc}</p>
					</div>

					<div className="flex flex-col gap-1.5">
						<label htmlFor="article-save-path" className="text-xs text-muted-foreground">
							{t.settings.articleSavePath}
						</label>
						<Input
							id="article-save-path"
							placeholder="~/Obsidian/Clips"
							value={articleSavePath}
							onChange={(e) => setArticleSavePath(e.target.value)}
							className="text-xs h-8"
						/>
						<p className="text-[10px] text-muted-foreground">{t.settings.articleSavePathDesc}</p>
					</div>
				</>
			)}

			{/* GitHub link */}
			<div className="flex items-center gap-2 mt-2 text-[10px] text-muted-foreground">
				<a
					href="https://github.com/alibaba/page-agent"
					target="_blank"
					rel="noopener noreferrer"
					className="flex items-center gap-1 hover:text-foreground transition-colors"
				>
					<svg
						className="size-3"
						viewBox="0 0 24 24"
						dangerouslySetInnerHTML={{ __html: siGithub.svg }}
						fill="currentColor"
					/>
					<span>Star on GitHub</span>
				</a>
			</div>

			<AlgorithmConfigDialog
				open={algoDialogOpen}
				onOpenChange={setAlgoDialogOpen}
				editingAlgorithm={editingAlgo}
				onSave={(algo) => {
					setAlgorithms((prev) => {
						const exists = prev.some((a) => a.id === algo.id)
						if (exists) {
							return prev.map((a) => (a.id === algo.id ? algo : a))
						}
						return [...prev, algo]
					})
					setEditingAlgo(undefined)
					triggerAutoSave(true)
				}}
			/>
		</div>
	)
}
