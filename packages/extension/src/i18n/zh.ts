/**
 * 简体中文翻译
 */
export const zh = {
	// Common
	common: {
		back: '返回',
		loading: '加载中...',
		cancel: '取消',
		save: '保存',
		delete: '删除',
		retry: '重试',
		refresh: '刷新',
	},

	// Status
	status: {
		idle: '就绪',
		running: '运行中',
		completed: '完成',
		error: '错误',
	},

	// Header
	header: {
		title: 'Page Agent Sidecar',
		context: '上下文',
		toggleContext: '切换上下文收集',
	},

	// Empty state
	emptyState: {
		title: 'Page Agent Sidecar',
		typing1: 'AI 感知你的浏览行为',
		typing2: '保存文章为 Markdown',
		typing3: '获取表单填写建议',
		typing4: '用自然语言自动执行任务',
	},

	// Context Summary (A region)
	contextSummary: {
		currentContext: '当前上下文',
		viewTimeline: '查看时间轴 →',
		eventsTracked: '个事件已追踪',
		noRecentEvents: '暂无近期事件',
	},

	// Activity Cards (B region)
	activityCard: {
		readingDetected: '检测到阅读',
		formDetected: '检测到表单',
		collapse: '折叠',
		expand: '展开',
		remove: '移除',
		open: '打开',
		wasThisHelpful: '有帮助吗？',
		thanks: '谢谢！',
		useful: '有用',
		notUseful: '没用',
		thinking: '思考中...',
		executing: '执行中',
		done: '完成',
		retrying: '重试中',
	},

	// Reading Card
	readingCard: {
		score: '分数',
		dwell: '停留',
		depth: '深度',
		words: '字数',
		saveArticle: '保存文章',
		saved: '已保存',
	},

	// Form Card
	formCard: {
		focus: '聚焦',
		formFields: '输入字段',
		unnamed: '未命名',
		field: '字段',
	},

	// Form Suggestion Bar (C region)
	suggestionBar: {
		title: (fieldLabel: string) => `「${fieldLabel}」的建议`,
		dismiss: '关闭',
		semantic: '语义',
		prefix: '前缀',
		filled: '已填充',
		source: '来源',
	},

	// Chat Input
	chatInput: {
		placeholder: '描述你的任务...（回车发送）',
		stop: '停止任务',
		send: '发送',
	},

	// Settings
	settings: {
		title: '设置',
		userAuthToken: '用户授权令牌',
		userAuthTokenDesc: '允许网页调用此扩展。',
		showToken: '显示令牌',
		hideToken: '隐藏令牌',
		copyToken: '复制令牌',
		tokenCopied: '令牌已复制',
		manageHub: '管理 Page Agent Hub',
		baseURL: '基础 URL',
		model: '模型',
		apiKey: 'API 密钥',
		showApiKey: '显示 API 密钥',
		hideApiKey: '隐藏 API 密钥',
		language: '响应语言',
		languageSystem: '跟随系统',
		languageEn: 'English',
		languageZh: '中文',
		advanced: '高级',
		maxSteps: '最大步数',
		systemInstruction: '系统指令',
		systemInstructionPlaceholder: '给 Agent 的额外指令...',
		disableNamedToolChoice: '禁用 named tool_choice',
		experimentalLlmsTxt: '实验性 llms.txt 支持',
		experimentalIncludeAllTabs: '实验性包含所有标签页',
		contextWindow: '上下文窗口（分钟）',
		contextWindowDesc: '上下文时间轴回溯的时间范围。',
		suggestionAlgorithms: '建议算法（可配置）',
		algoSemanticFrequency: '语义 + 频率',
		algoPrefixMatch: '前缀匹配',
		suggestionAlgorithmsDesc: '每个算法最多产生5条建议，去重后按置信度排序。',
		accuracy: '准确率',
		accuracyHigh: '高可靠性',
		accuracyModerate: '中等可靠性',
		accuracyLow: '低可靠性',
		accuracyUnknown: '数据不足',
		addCustomAlgorithm: '添加自定义算法',
		accuracyDataStoredInBrowser:
			'算法推荐历史数据存储在浏览器 IndexedDB 中。使用导出功能下载为 JSON。',
		accuracyWindowDays: '推荐历史窗口（天）',
		accuracyWindowDaysDesc: '纳入推荐历史统计的天数。',
		enableAccuracyCollection: '收集算法推荐历史数据',
		exportAccuracyData: '导出算法推荐历史数据',
		importAccuracyData: '导入算法推荐历史数据',
		exportSuccess: '导出成功',
		importSuccess: '导入成功',
		importError: '导入失败：文件格式无效',
		clearAccuracyData: '清空算法推荐历史数据',
		articleSavePath: '文章保存路径',
		articleSavePathDesc: '自动保存 Markdown 文章的文件夹路径。留空则仅在扩展中存储。',
		crossTabContextSync: '跨标签页上下文同步',
		testingApiNotice: '你正在使用测试 API，风险自负。',
	},

	// Algorithm Config Dialog
	algorithmDialog: {
		title: '自定义算法',
		editTitle: '编辑算法',
		name: '算法名称',
		type: '类型',
		typeRuleBased: '基于规则',
		typeSandboxJS: '沙箱 JavaScript',
		config: '配置',
		code: 'JavaScript 代码',
		codePlaceholder:
			'function(field, prefix, history, maxResults) {\n  var results = [];\n  for (var i = 0; i < history.length; i++) {\n    results.push({\n      value: history[i].value,\n      confidence: 0.8,\n      algorithm: "My Algorithm",\n      explanation: "From history",\n      fieldKey: history[i].fieldKey\n    });\n  }\n  return results.slice(0, maxResults);\n}',
		codeHelp:
			'函数接收 (field, prefix, history, maxResults)，必须返回 [{ value, confidence, algorithm, explanation, fieldKey }]。',
		configPlaceholder:
			'{"rules":[{"fieldKeywords":["email"],"staticValues":[{"value":"user@example.com","score":0.9}]}]}',
		configHelp:
			'JSON 对象，包含 "rules" 数组。每条规则可设：fieldKeywords、fieldNamePatterns、prefixes、staticValues、includeHistory、scoreMultiplier。',
		description: '描述',
	},

	// History
	history: {
		title: '历史',
		empty: '暂无历史',
		clearAll: '清空全部',
		exportAnnotations: '导出标注数据集',
		loading: '加载历史中...',
		steps: '步',
		runAgain: '再次运行',
		exportHistory: '导出历史 JSON',
		delete: '删除历史',
	},

	// History Detail
	historyDetail: {
		task: '任务',
		runAgain: '再次运行',
		delete: '删除',
		feedback: '反馈',
	},

	// Saved Articles
	savedArticles: {
		title: '已保存文章',
		empty: '暂无保存的文章。',
		exportAll: '导出全部文章为 Markdown',
		download: '下载',
	},

	// Context Timeline
	contextTimeline: {
		title: '上下文时间轴',
	},

	// Timeline
	timeline: {
		events: {
			scroll: '滚动',
			focus: '聚焦',
			input: '输入',
			click: '点击',
			mutation: 'DOM变动',
			tab: '标签页',
			tabUpdate: '标签页更新',
			visibility: '可见性',
			reading: '阅读',
			form: '表单',
		},
		filters: {
			all: '全部',
		},
		windows: {
			min1: '1 分钟',
			min5: '5 分钟',
			min15: '15 分钟',
			hour1: '1 小时',
			hour3: '3 小时',
			hour24: '24 小时',
		},
		clearAll: '清空所有事件',
		confirmClear: '确定清空所有上下文事件？此操作不可撤销。',
		clearFailed: '清空事件失败',
		stats: {
			events: '个事件',
			domains: '个域名',
			live: '实时',
			autoRefresh: '自动刷新',
		},
		searchPlaceholder: '搜索域名、标题、数据...',
		toggleSort: '切换排序',
		sort: {
			newest: '最新',
			oldest: '最早',
			first: '优先',
		},
		loading: '加载上下文事件中...',
		latest: '最新',
		hideDetails: '隐藏详情',
		showDetails: '显示详情',
		empty: {
			noEvents: '暂无上下文事件。尝试在网页上滚动、点击或输入！',
			noFilterMatch: '当前筛选条件下没有匹配的事件。',
		},
		summary: {
			scrollY: '滚动 Y',
			depth: '深度',
			velocity: '速度',
			field: '字段',
			type: '类型',
			length: '长度',
			target: '目标',
			mutation: 'DOM 结构已更改',
			visible: '页面变为可见',
			hidden: '页面已隐藏',
			dwell: '停留',
		},
	},

	// Sidecar Actions (in history)
	sidecarAction: {
		saveArticle: '保存文章',
		focusField: '聚焦字段',
		fillField: '填充字段',
		selectSuggestion: '选择建议',
		chat: '聊天',
		dismissSuggestion: '关闭建议',
	},

	// Result Card
	resultCard: {
		title: '结果',
		success: '成功',
		failed: '失败',
		copied: '已复制！',
		copy: '复制',
		copySystem: '复制系统',
		copyUser: '复制用户',
		rawRequest: '原始请求',
		rawResponse: '原始响应',
	},

	// Step Card
	stepCard: {
		step: '步骤',
		actions: '动作',
	},

	// Footer
	footer: {
		version: '版本',
		sourceCode: '源代码',
		contact: '联系',
		builtWith: '用 ♥️ 构建',
		inspiredBy: '灵感来自 PageAgent',
	},
} as const
