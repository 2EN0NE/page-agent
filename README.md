# Page Agent Sidecar

> **中文** | [English](#english)

基于 [PageAgent](https://github.com/alibaba/page-agent) 构建的浏览器 AI Sidecar 扩展。在保留原有任务驱动 Agent 能力的基础上，增加了**持续上下文感知**模式 —— 像一位安静的助手，在你浏览网页时默默观察，适时提供建议。

---

## ✨ 功能

### 🔍 持续上下文感知（Sidecar 模式）
- **上下文时间轴** — 自动记录滚动、点击、输入、聚焦等浏览行为，支持按域名/时间筛选
- **阅读检测** — 智能识别你正在深度阅读的文章，一键保存为 Markdown（支持 YAML frontmatter，兼容 Obsidian）
- **表单填写建议** — 检测页面表单，基于历史输入提供语义 + 前缀匹配建议
- **绿色边框提示** — 当 AI 正在观察当前页面时，页面边缘显示绿色边框 + "AI Context On" 徽章

### 🤖 任务驱动 Agent（原版能力）
- **自然语言操控网页** — 用一句话让 AI 点击按钮、填写表单、抓取数据
- **多页面任务** — 通过 Chrome Extension 在多个标签页间执行复杂工作流
- **自带 LLM** — 支持 OpenAI 兼容接口，可接入任何模型
- **基于文本的 DOM 操作** — 无需截图，无需多模态模型

### 🌐 国际化
- 支持 **中文 / 英文** 双语界面
- 系统提示词语言可独立配置

---

## 📦 安装

### Chrome 扩展（推荐）

1. 下载最新构建包：`page-agent-ext-sidecar-0.1.0_*.zip`
2. 解压到本地文件夹
3. 打开 Chrome → `chrome://extensions` → 打开「开发者模式」
4. 点击「加载已解压的扩展程序」，选择解压后的文件夹
5. 点击浏览器工具栏的扩展图标，或从侧边栏打开 Sidepanel

### 配置

首次使用时需要设置 LLM：
- **Base URL**: 你的 API 端点（如 `https://api.openai.com/v1`）
- **Model**: 模型名称（如 `gpt-4o`）
- **API Key**: 你的 API 密钥
- **语言**: 系统提示词语言（默认中文）

---

## 🚀 使用

### Sidecar 模式（被动感知）

安装后自动启用。当你浏览网页时：

1. **绿色边框**出现 → AI 正在观察当前页面
2. **阅读长文** → Sidepanel 弹出「检测到阅读」卡片，点击保存为 Markdown
3. **聚焦表单字段** → 输入框上方弹出历史填写建议，一键填充
4. **查看时间轴** → 点击 Activity 图标查看所有浏览事件记录

### Agent 模式（主动任务）

在 Sidepanel 底部的输入框中描述任务：

```
帮我把这个页面的价格表格整理成 CSV
```

Agent 会自动分析页面、执行操作、返回结果。

### 保存文章

阅读检测触发后，点击卡片上的「保存文章」：
- 自动提取正文，转换为 Markdown
- 添加 YAML frontmatter（标题、URL、保存时间、阅读分数等）
- 可选：配置自动下载目录（如 `~/Obsidian/Clips`）

---

## 🏗️ 架构

```
┌─────────────────────────────────────────────────────────────┐
│                     Chrome Extension                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ Sidepanel   │  │ Background  │  │ Content Script      │ │
│  │ (React UI)  │◄─┤ (IndexedDB  │◄─┤ (ContextObserver    │ │
│  │             │  │  proxy)     │  │  FormDetector       │ │
│  │ • 三栏布局  │  │             │  │  ReadingDetector)   │ │
│  │ • 状态卡片  │  │             │  │                     │ │
│  │ • 聊天输入  │  │             │  │ • 事件采集          │ │
│  └─────────────┘  └─────────────┘  │ • 表单扫描          │ │
│                                     │ • 阅读评分          │ │
│                                     └─────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 数据流

1. **Content Script** 监听用户交互 → 批量保存到本地 IndexedDB
2. **Background** 作为全局代理，提供跨标签页的 IndexedDB 查询
3. **Sidepanel** 轮询当前标签页状态，渲染 Reading/Form 卡片

---

## 🛠️ 开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm start

# 构建所有包
npm run build

# 构建扩展并打包
npm run build:ext

# 运行 e2e 测试
cd packages/extension && npx playwright test
```

### 项目结构

```
packages/
├── extension/          # Chrome 扩展（Sidepanel + Content Script）
│   ├── src/
│   │   ├── sidecar/    # Sidecar 核心（ContextObserver、Detector、SuggestionEngine）
│   │   ├── agent/      # Agent 逻辑（MultiPageAgent、useAgent）
│   │   ├── components/ # React UI 组件
│   │   └── i18n/       # 中英文翻译
│   └── e2e/            # Playwright 端到端测试
├── core/               # PageAgentCore（无 UI）
├── page-controller/    # DOM 操作和视觉反馈
└── llms/               # LLM 客户端
```

---

## 🙏 致谢

本项目基于 [PageAgent](https://github.com/alibaba/page-agent) 构建，感谢原作者团队的开源工作。

核心 DOM 处理逻辑源自 [browser-use](https://github.com/browser-use/browser-use)。

---

## ⚖️ 许可证

[MIT License](LICENSE)

---

<h2 id="english">English</h2>

> [中文](#page-agent-sidecar) | English

A browser AI Sidecar extension built on top of [PageAgent](https://github.com/alibaba/page-agent). While preserving the original task-driven Agent capabilities, it adds a **continuous context awareness** mode — like a quiet assistant that silently observes as you browse, offering suggestions at the right moment.

---

## ✨ Features

### 🔍 Continuous Context Awareness (Sidecar Mode)
- **Context Timeline** — Automatically records scroll, click, input, focus events; filter by domain/time
- **Reading Detection** — Intelligently identifies articles you're deeply reading; one-click save as Markdown (YAML frontmatter, Obsidian-compatible)
- **Form Fill Suggestions** — Detects page forms, provides semantic + prefix-match suggestions based on history
- **Green Border Indicator** — Green frame + "AI Context On" badge appears when AI is observing the current page

### 🤖 Task-Driven Agent (Original Capability)
- **Natural Language Web Control** — One sentence to click buttons, fill forms, extract data
- **Multi-page Tasks** — Execute complex workflows across browser tabs via Chrome Extension
- **Bring Your Own LLM** — OpenAI-compatible API, works with any model
- **Text-based DOM Manipulation** — No screenshots, no multimodal models needed

### 🌐 Internationalization
- **Chinese / English** bilingual UI
- System prompt language configurable independently

---

## 📦 Installation

### Chrome Extension (Recommended)

1. Download the latest build: `page-agent-ext-sidecar-0.1.0_*.zip`
2. Extract to a local folder
3. Open Chrome → `chrome://extensions` → Enable "Developer mode"
4. Click "Load unpacked", select the extracted folder
5. Click the extension icon in the toolbar, or open from the side panel

### Configuration

First-time setup requires LLM configuration:
- **Base URL**: Your API endpoint (e.g. `https://api.openai.com/v1`)
- **Model**: Model name (e.g. `gpt-4o`)
- **API Key**: Your API key
- **Language**: System prompt language (default: Chinese)

---

## 🚀 Usage

### Sidecar Mode (Passive Awareness)

Enabled automatically after installation. When browsing:

1. **Green border** appears → AI is observing the current page
2. **Reading long content** → "Reading detected" card pops up in Sidepanel, click to save as Markdown
3. **Focus form field** → Historical fill suggestions appear above the input, one-click to fill
4. **View timeline** → Click Activity icon to see all browsing event records

### Agent Mode (Active Tasks)

Describe tasks in the Sidepanel input box:

```
Organize the price table on this page into CSV format
```

The Agent will analyze the page, execute operations, and return results.

### Save Articles

After reading detection triggers, click "Save article":
- Automatically extracts body content, converts to Markdown
- Adds YAML frontmatter (title, URL, save time, reading score, etc.)
- Optional: Configure auto-download directory (e.g. `~/Obsidian/Clips`)

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Chrome Extension                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ Sidepanel   │  │ Background  │  │ Content Script      │ │
│  │ (React UI)  │◄─┤ (IndexedDB  │◄─┤ (ContextObserver    │ │
│  │             │  │  proxy)     │  │  FormDetector       │ │
│  │ • 3-zone    │  │             │  │  ReadingDetector)   │ │
│  │   layout    │  │             │  │                     │ │
│  │ • State     │  │             │  │ • Event capture     │ │
│  │   cards     │  │             │  │ • Form scan         │ │
│  │ • Chat input│  │             │  │ • Reading score     │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Content Script** listens to user interactions → batch saves to local IndexedDB
2. **Background** acts as global proxy, providing cross-tab IndexedDB queries
3. **Sidepanel** polls active tab state, renders Reading/Form cards

---

## 🛠️ Development

```bash
# Install dependencies
npm install

# Start dev server
npm start

# Build all packages
npm run build

# Build and package extension
npm run build:ext

# Run e2e tests
cd packages/extension && npx playwright test
```

### Project Structure

```
packages/
├── extension/          # Chrome Extension (Sidepanel + Content Script)
│   ├── src/
│   │   ├── sidecar/    # Sidecar core (ContextObserver, Detector, SuggestionEngine)
│   │   ├── agent/      # Agent logic (MultiPageAgent, useAgent)
│   │   ├── components/ # React UI components
│   │   └── i18n/       # Chinese/English translations
│   └── e2e/            # Playwright end-to-end tests
├── core/               # PageAgentCore (headless)
├── page-controller/    # DOM operations and visual feedback
└── llms/               # LLM client
```

---

## 🙏 Acknowledgments

This project is built on top of [PageAgent](https://github.com/alibaba/page-agent). Thanks to the original authors for their open-source work.

Core DOM processing logic is derived from [browser-use](https://github.com/browser-use/browser-use).

---

## ⚖️ License

[MIT License](LICENSE)
