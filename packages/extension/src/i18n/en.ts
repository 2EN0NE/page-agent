/**
 * English translations for Page Agent Sidecar
 */
export const en = {
	// Common
	common: {
		back: 'Back',
		loading: 'Loading...',
		cancel: 'Cancel',
		save: 'Save',
		delete: 'Delete',
		retry: 'Retry',
		refresh: 'Refresh',
	},

	// Status
	status: {
		idle: 'Ready',
		running: 'Running',
		completed: 'Done',
		error: 'Error',
	},

	// Header
	header: {
		title: 'Page Agent Sidecar',
		context: 'Context',
		toggleContext: 'Toggle context collection',
	},

	// Empty state
	emptyState: {
		title: 'Page Agent Sidecar',
		typing1: 'Browse with AI context awareness',
		typing2: 'Save articles as Markdown',
		typing3: 'Get form fill suggestions',
		typing4: 'Automate tasks with natural language',
	},

	// Context Summary (A region)
	contextSummary: {
		currentContext: 'Current context',
		viewTimeline: 'View timeline →',
		eventsTracked: 'events tracked',
		noRecentEvents: 'No recent events',
	},

	// Activity Cards (B region)
	activityCard: {
		readingDetected: 'Reading detected',
		formDetected: 'Form detected',
		collapse: 'Collapse',
		expand: 'Expand',
		remove: 'Remove',
		open: 'open',
		wasThisHelpful: 'Was this helpful?',
		thanks: 'Thanks!',
		useful: 'Useful',
		notUseful: 'Not useful',
		thinking: 'Thinking...',
		executing: 'Executing',
		done: 'Done',
		retrying: 'Retrying',
	},

	// Reading Card
	readingCard: {
		score: 'Score',
		dwell: 'Dwell',
		depth: 'Depth',
		words: 'Words',
		saveArticle: 'Save article',
		saved: 'Saved',
	},

	// Form Card
	formCard: {
		focus: 'Focus',
		formFields: 'Input Fields',
		unnamed: 'unnamed',
		field: 'field',
	},

	// Form Suggestion Bar (C region)
	suggestionBar: {
		title: (fieldLabel: string) => `Suggestions for "${fieldLabel}"`,
		dismiss: 'Dismiss',
		semantic: 'Semantic',
		prefix: 'Prefix',
		filled: 'Filled',
		source: 'Source',
	},

	// Chat Input
	chatInput: {
		placeholder: 'Describe your task... (Enter to send)',
		stop: 'Stop task',
		send: 'Send',
	},

	// Settings
	settings: {
		title: 'Settings',
		userAuthToken: 'User Auth Token',
		userAuthTokenDesc: 'Give a website the ability to call this extension.',
		showToken: 'Show token',
		hideToken: 'Hide token',
		copyToken: 'Copy token',
		tokenCopied: 'Token copied',
		manageHub: 'Manage Page Agent Hub',
		baseURL: 'Base URL',
		model: 'Model',
		apiKey: 'API Key',
		showApiKey: 'Show API key',
		hideApiKey: 'Hide API key',
		language: 'Response Language',
		languageSystem: 'System',
		languageEn: 'English',
		languageZh: '中文',
		advanced: 'Advanced',
		maxSteps: 'Max Steps',
		systemInstruction: 'System Instruction',
		systemInstructionPlaceholder: 'Additional instructions for the agent...',
		disableNamedToolChoice: 'Disable named tool_choice',
		experimentalLlmsTxt: 'Experimental llms.txt support',
		experimentalIncludeAllTabs: 'Experimental include all tabs',
		contextWindow: 'Context Window (minutes)',
		contextWindowDesc: 'How far back the Context Timeline looks for events.',
		suggestionAlgorithms: 'Suggestion Algorithms (Configurable)',
		algoSemanticFrequency: 'Semantic + Frequency',
		algoPrefixMatch: 'Prefix Match',
		suggestionAlgorithmsDesc:
			'Each algorithm produces up to 5 suggestions. Deduplicated and ranked by confidence.',
		accuracy: 'Accuracy',
		accuracyHigh: 'High reliability',
		accuracyModerate: 'Moderate reliability',
		accuracyLow: 'Low reliability',
		accuracyUnknown: 'Not enough data',
		addCustomAlgorithm: 'Add Custom Algorithm',
		accuracyDataStoredInBrowser:
			'Suggestion history is stored locally in browser IndexedDB. Use Export to download as JSON.',
		accuracyWindowDays: 'Suggestion History Window (days)',
		accuracyWindowDaysDesc: 'Number of days to include in suggestion history calculations.',
		enableAccuracyCollection: 'Collect suggestion history',
		exportAccuracyData: 'Export suggestion history',
		importAccuracyData: 'Import suggestion history',
		exportSuccess: 'Export successful',
		importSuccess: 'Import successful',
		importError: 'Import failed: invalid file format',
		clearAccuracyData: 'Clear suggestion history',
		articleSavePath: 'Article Save Path',
		articleSavePathDesc:
			'Folder path for auto-saving articles as Markdown. Leave empty to store in extension only.',
		crossTabContextSync: 'Cross-tab context sync',
		testingApiNotice: 'You are using a testing API. Use at your own risk.',
	},

	// Algorithm Config Dialog
	algorithmDialog: {
		title: 'Custom Algorithm',
		editTitle: 'Edit Algorithm',
		name: 'Algorithm Name',
		type: 'Type',
		typeRuleBased: 'Rule-based',
		typeSandboxJS: 'Sandbox JavaScript',
		config: 'Configuration',
		code: 'JavaScript Code',
		codePlaceholder:
			'function(field, prefix, history, maxResults) {\n  var results = [];\n  for (var i = 0; i < history.length; i++) {\n    results.push({\n      value: history[i].value,\n      confidence: 0.8,\n      algorithm: "My Algorithm",\n      explanation: "From history",\n      fieldKey: history[i].fieldKey\n    });\n  }\n  return results.slice(0, maxResults);\n}',
		codeHelp:
			'Receives (field, prefix, history, maxResults). Must return [{ value, confidence, algorithm, explanation, fieldKey }].',
		configPlaceholder:
			'{"rules":[{"fieldKeywords":["email"],"staticValues":[{"value":"user@example.com","score":0.9}]}]}',
		configHelp:
			'JSON with a "rules" array. Each rule: fieldKeywords, fieldNamePatterns, prefixes, staticValues, includeHistory, scoreMultiplier.',
		description: 'Description',
	},

	// History
	history: {
		title: 'History',
		empty: 'No history yet',
		clearAll: 'Clear All',
		exportAnnotations: 'Export annotation dataset',
		loading: 'Loading history...',
		steps: 'steps',
		runAgain: 'Run again',
		exportHistory: 'Export history JSON',
		delete: 'Delete history',
	},

	// History Detail
	historyDetail: {
		task: 'Task',
		runAgain: 'Run again',
		delete: 'Delete',
		feedback: 'Feedback',
	},

	// Saved Articles
	savedArticles: {
		title: 'Saved Articles',
		empty: 'No saved articles yet.',
		exportAll: 'Export all articles as Markdown',
		download: 'Download',
	},

	// Context Timeline
	contextTimeline: {
		title: 'Context Timeline',
	},

	// Timeline
	timeline: {
		events: {
			scroll: 'Scroll',
			focus: 'Focus',
			input: 'Input',
			click: 'Click',
			mutation: 'DOM Change',
			tab: 'Tab',
			tabUpdate: 'Tab Update',
			visibility: 'Visibility',
			reading: 'Reading',
			form: 'Form',
		},
		filters: {
			all: 'All',
		},
		windows: {
			min1: '1 min',
			min5: '5 min',
			min15: '15 min',
			hour1: '1 hour',
			hour3: '3 hours',
			hour24: '24 hours',
		},
		clearAll: 'Clear all events',
		confirmClear: 'Clear ALL context events? This cannot be undone.',
		clearFailed: 'Failed to clear events',
		stats: {
			events: 'events',
			domains: 'domains',
			live: 'Live',
			autoRefresh: 'Auto-refresh',
		},
		searchPlaceholder: 'Search domain, title, data...',
		toggleSort: 'Toggle sort order',
		sort: {
			newest: 'Newest',
			oldest: 'Oldest',
			first: 'first',
		},
		loading: 'Loading context events...',
		latest: 'Latest',
		hideDetails: 'Hide details',
		showDetails: 'Show details',
		empty: {
			noEvents: 'No context events yet. Try scrolling, clicking, or typing on any webpage!',
			noFilterMatch: 'No events match the current filter.',
		},
		summary: {
			scrollY: 'Scroll Y',
			depth: 'Depth',
			velocity: 'Velocity',
			field: 'Field',
			type: 'Type',
			length: 'Length',
			target: 'Target',
			mutation: 'DOM structure changed',
			visible: 'Page became visible',
			hidden: 'Page hidden',
			dwell: 'Dwell',
		},
	},

	// Sidecar Actions (in history)
	sidecarAction: {
		saveArticle: 'Saved article',
		focusField: 'Focused field',
		fillField: 'Filled field',
		selectSuggestion: 'Selected suggestion',
		chat: 'Chat',
		dismissSuggestion: 'Dismissed suggestion',
	},

	// Result Card
	resultCard: {
		title: 'Result',
		success: 'Success',
		failed: 'Failed',
		copied: 'Copied!',
		copy: 'Copy',
		copySystem: 'Copy System',
		copyUser: 'Copy User',
		rawRequest: 'Raw Request',
		rawResponse: 'Raw Response',
	},

	// Step Card
	stepCard: {
		step: 'Step',
		actions: 'Actions',
	},

	// Footer
	footer: {
		version: 'Version',
		sourceCode: 'Source Code',
		contact: 'Contact',
		builtWith: 'Built with ♥️ by',
		inspiredBy: 'Inspired by PageAgent',
	},
} as const

export type Translation = typeof en
