# PageAgent Sidepanel 交互设计说明

## 一、整体布局：三区结构

Sidepanel 垂直划分为三个逻辑区域，从上到下依次为 **A → B → C**：

```
┌─────────────────────────────────────────┐
│  A. 状态感知区（固定位置，不可滚动）      │  ← 常驻，最顶级状态
│     [🟢 Context On] [当前页面: github.com]│
│     [事件数: 12] [时间窗口: 5min]         │
├─────────────────────────────────────────┤
│  B. 状态卡片流（固定高度，内部可滚动）    │  ← 文章/表单/阅读等状态卡片
│     ┌─────────────────────────────────┐ │
│     │ 📖 Reading: "How to use AI"    │ │  ← 阅读卡片（常驻不隐藏）
│     │ Score: 78/100 · github.com      │ │
│     └─────────────────────────────────┘ │
│     ┌─────────────────────────────────┐ │
│     │ 📝 Form: "Email address"        │ │  ← 表单识别卡（点击聚焦网页）
│     │ github.com/login                │ │
│     └─────────────────────────────────┘ │
│     ┌─────────────────────────────────┐ │
│     │ 📝 Form: "Password"             │ │  ← 新识别的表单堆叠到下方
│     │ github.com/login                │ │
│     └─────────────────────────────────┘ │
│     ...（滚动查看更多历史卡片）           │
├─────────────────────────────────────────┤
│  C. 交互输入区（固定位置，底部）          │  ← 对话输入 + 弹出建议
│     💡 Suggestions for "Email"          │
│     ┌──────────────┐ ┌──────────────┐  │
│     │alice@... 92% │ │bob@... 78%   │  │
│     └──────────────┘ └──────────────┘  │
│     [Describe your task...        ] [➤]│
└─────────────────────────────────────────┘
```

## 二、区域详细说明

### A. 状态感知区（Context Awareness）

**定位**：最顶级的常驻状态栏，固定位置，不随滚动消失。

**内容**：
- Context 收集开关状态（🟢 On / ⚪ Off）
- 当前页面域名 + 标题
- 当前时间窗口内的事件统计
- 快速入口：Timeline / Saved Articles

**行为**：
- 始终固定在顶部
- 切换标签页时自动刷新当前页面信息
- 不被任何卡片操作影响

### B. 状态卡片流（State Card Stream）

**定位**：固定高度的滚动区域，承载所有"被动感知到的状态"。

**核心原则**：
- **按页面（URL）分组**：每个页面生成一张卡片，不同页面的卡片独立存在
- **卡片常驻不隐藏**：一旦检测到阅读/表单等状态，卡片生成后不再自动消失
- **新卡片堆叠到下方**：最新的在最上面，旧的被推到下面，可滚动查看历史
- **本次会话生命周期**：卡片在当前 sidepanel 打开期间一直存在，关闭后清空

**统一卡片外壳（StateActivityCard）**：

所有 B 区域卡片共享统一的外壳结构，区别仅在 Body 内容：

```
┌─────────────────────────────────────────┐
│ 📖 Reading detected            [−]  [×] │  ← Header
├─────────────────────────────────────────┤
│  … card-specific body content …         │  ← Body（可折叠）
├─────────────────────────────────────────┤
│ [github.com]              👍 👎          │  ← Footer
└─────────────────────────────────────────┘
```

| 区域 | 内容 |
|------|------|
| **Header 左侧** | 类型图标 + 类型名称（📖 Reading detected / 📝 Form detected） |
| **Header 右侧** | [−/+] 折叠/展开按钮、[×] 关闭（移除）按钮 |
| **Body** | 卡片具体内容（阅读分数 / 表单列表） |
| **Footer 左侧** | 页面域名标签 + "open" 跳转链接 |
| **Footer 右侧** | 👍/👎 反馈条（AnnotationBar） |

**卡片类型**（按页面分组）：

| 卡片类型 | 触发条件 | Body 内容 | 边框颜色 |
|---------|---------|-----------|---------|
| **Reading** | 阅读检测分数 > 阈值 | 文章标题 + 阅读分数/字数/停留时长 | 琥珀色 (amber) |
| **Form** | 页面加载后自动扫描 | 该页面所有可填写表单/字段列表 | 蓝色 (blue) |

### B1. 阅读活动卡片（Reading）

**按页面区分**：
- 每个 URL 对应一张活动卡片（type='reading'）
- 同一页面多次阅读 → 更新该 URL 卡片的分数和数据
- 不同页面阅读 → 生成新的活动卡片，旧卡片保留

**外壳**：琥珀色边框，Header 显示 📖 Reading detected

**Body 内容**：
- 文章标题（醒目显示，让用户一眼识别）
- 阅读分数、停留时长、滚动深度、字数
- Save article 按钮

**排序**：按检测时间倒序，最新的在最上面

### B2. 表单活动卡片（Form）

**自动扫描触发**：
- 页面加载完成后，content script 自动扫描所有表单和输入字段
- 扫描结果通过 background 同步到 sidepanel
- 每个 URL 对应一张活动卡片（type='form'）

**外壳**：蓝色边框，Header 显示 📝 Form detected

**Body 内容（按表单分组）**：
```
┌─────────────────────────────────────────┐
│ github.com (23 fields)              [−] │  ← 页面来源 + 字段总数 + 折叠按钮
├─────────────────────────────────────────┤
│ Login Form (3 fields)               [−] │  ← 表单名称 + 字段数 + 折叠按钮
│   ┌─────────────────────────────────┐   │
│   │ 🔍 Email address          Focus │   │  ← 字段名 + 类型标签 + 聚焦按钮
│   │ 🔍 Password               Focus │   │
│   │ 🔍 Remember me            Focus │   │
│   └─────────────────────────────────┘   │
│ Newsletter Form (5 fields)          [−] │  ← 另一个表单
│   ┌─────────────────────────────────┐   │
│   │ 🔍 Full name              Focus │   │
│   │ 🔍 Email                  Focus │   │
│   │ ...                             │   │
│   └─────────────────────────────────┘   │
│ Input Fields (15 fields)            [−] │  ← 不在 form 标签内的输入
│   ...                                   │
└─────────────────────────────────────────┘
```

**排序规则**（单个卡片内）：
1. **完整表单优先**：有 `<form>` 标签的排在前面，orphan input 排在后面
2. **栏位多的优先**：字段数量多的表单排在前面
3. **位置靠上的优先**：在页面中位置更靠上的表单排在前面（作为 tiebreaker）

**交互**：
- 点击字段行 → 发送 `focus_field_by_selector` 消息到 content script
- Content script 找到对应元素 → `focus()` + `scrollIntoView()` + **蓝色边框高亮 2 秒**
- 字段获得焦点后 → C 区域自动弹出 `FormSuggestionBar` 显示填写建议

**展开/折叠/滚动**：
- 整个卡片可折叠（显示/隐藏所有表单）
- 每个表单组可独立折叠
- 卡片内部最大高度限制，字段过多时内部滚动

**FormFieldCard 详细交互**：

```
点击 B 区域字段行
        │
        ▼
sendMessage(tabId, {
  type: 'SIDECAR',
  action: 'focus_field_by_selector',
  payload: { selector: 'input[name="email"]' }
})
        │
        ▼
Content Script: document.querySelector(selector)?.focus()
        │
        ▼
网页字段获得焦点 + 蓝色高亮 2 秒
        │
        ▼
FormDetector 检测到 focus 事件
        │
        ▼
C 区域 FormSuggestionBar 弹出（显示历史值建议）
```

### C. 交互输入区（Interaction Zone）

**定位**：底部固定区域，包含对话输入框和条件弹出的建议条。

**组成**：

1. **FormSuggestionBar**（条件弹出）：
   - 当网页有 focused 输入字段时弹出
   - 显示算法匹配的历史值建议
   - 纵向长条，最多 3 条（等于启用的算法数）
   - 点击建议 → 填充到网页字段

2. **ChatInput**（常驻）：
   - 任务描述输入框
   - Enter 发送任务给 Agent
   - 与建议条互不干扰

**行为**：
- 用户点击 B 区域的 FormFieldCard → 网页字段聚焦 → C 区域自动弹出对应建议
- 用户在网页直接点击字段 → 同样触发 C 区域建议弹出
- 点击 C 区域建议 → 填充网页字段 → 建议条保持（可继续选择其他建议）

## 三、数据流

### 阅读检测流

```
网页阅读行为
    │
    ▼
Content Script: ReadingDetector
    │
    ▼
chrome.storage.local.set({
  [`sidecarReading_${tabId}`]: { score, url, title, domain }
})
    │
    ▼
Sidepanel useSidecar hook 监听到变化
    │
    ▼
App.tsx: readingCards Map 按 URL 更新
    │
    ├── 已有 URL → 更新该卡片分数
    └── 新 URL → 插入新 ReadingCard
```

### 表单扫描流

```
页面加载 / URL 变化
    │
    ▼
Sidepanel 检测到新 URL
    │
    ▼
sendMessage(tabId, { type: 'SIDECAR', action: 'scan_page_forms' })
    │
    ▼
Content Script: FormScanner.scanPageForms()
    │
    ├── 扫描所有 <form> 元素
    ├── 收集 orphan input（不在 form 内的）
    ├── 按规则排序（完整表单优先 → 栏位多的优先 → 上面的优先）
    └── 返回 { url, domain, title, formGroups }
    │
    ▼
Sidepanel: formCards Map 按 URL 存储
    │
    └── 每个 URL 对应一张 FormFieldCard
```

### B 区域渲染

```
readingCards: Map<url, ReadingCardData>
formCards:    Map<url, FormCardData>

合并为 bRegionItems 数组:
  [...readingCards.values(), ...formCards.values()]
    .sort((a, b) => b.timestamp - a.timestamp)  // 最新的在最上面
```

## 四、状态卡片生命周期

### 阅读活动卡片生命周期

```
用户在某页面阅读文章
        │
        ▼
ReadingDetector 检测到阅读状态
        │
        ▼
生成活动卡片（type='reading', key = URL）
        │
        ├── 该 URL 已有卡片 → 更新分数 + 标题
        └── 该 URL 无卡片 → 插入新卡片到顶部
        │
        ▼
用户继续阅读 / 切换到其他页面
        │
        ▼
同一 URL → 卡片数据实时更新
不同 URL → 新活动卡片生成，旧卡片保留在下方
        │
        ▼
用户点击 Save → 卡片标记为"已保存"（绿色边框）
用户点击 👍/👎 → 反馈数据存入 annotations
用户点击 × → 卡片从 B 区域移除
        │
        ▼
Sidepanel 关闭 → 所有卡片清空
Sidepanel 重新打开 → 从 storage 恢复活跃的阅读/表单状态
```

### 表单活动卡片生命周期

```
页面加载完成 / 用户切换到新标签页
        │
        ▼
Sidepanel 检测到 URL 变化
        │
        ▼
发送 scan_page_forms 到 content script
        │
        ▼
FormScanner 扫描页面所有表单和输入字段
        │
        ▼
生成活动卡片（type='form', key = URL）
        │
        ├── 该 URL 已有卡片 → 替换为最新扫描结果
        └── 该 URL 无卡片 → 插入新卡片到顶部
        │
        ▼
卡片 Body 显示该页面所有可填写的表单/字段
        │
        ▼
用户点击某个字段行
        │
        ▼
网页对应字段获得焦点 + 蓝色高亮
        │
        ▼
C 区域弹出 FormSuggestionBar（填写建议）
        │
        ▼
用户选择建议值 → 填充到网页字段
        │
        ▼
用户可继续点击其他字段行，或折叠/展开表单组
用户点击 × → 卡片从 B 区域移除
```

## 五、与原有系统的兼容性

| 原有组件 | 新位置 | 变化 |
|---------|--------|------|
| ContextSummaryCard | A 区域 | 常驻固定，不滚动 |
| ReadingCard | B 区域（包在 StateActivityCard 内）| **按 URL 分组**，Body 只保留阅读数据 |
| FormSuggestionCard | （移除）| 被 Form 活动卡片替代 |
| **StateActivityCard**（新） | B 区域统一外壳 | 所有卡片共享：Header（类型+折叠+关闭）+ Footer（域名+👍👎） |
| **FormFieldCardBody**（新） | B 区域 | 纯 Body 内容：页面所有可填写表单 |
| FormSuggestionBar | C 区域 | 位置不变，点击 B 区域字段后弹出 |
| Chat Input | C 区域 | 位置不变 |
| Agent Task History | （暂不显示）| 任务模式保留，但不在 sidecar 常驻显示 |

## 六、关键设计决策

1. **为什么 B 区域卡片要用统一外壳？**
   - 阅读卡片和表单卡片的 Header/Footer 功能高度重合（类型标签、折叠、关闭、域名、反馈）
   - 统一外壳降低视觉噪音，用户只需关注 Body 内容差异
   - 新增卡片类型时（如 Shopping detected、Video detected）可直接复用外壳

2. **为什么阅读卡片要按页面区分？**
   - 用户可能在多个页面同时有阅读行为（多标签页）
   - 每个页面的文章标题和阅读进度不同，混在一起无法区分
   - 按页面分组让用户一眼知道"这是哪篇文章"，决定是否保存

3. **为什么表单卡片要自动扫描整个页面？**
   - 用户进入页面时可能不知道有哪些字段可以填写
   - 提前扫描并展示所有可填写字段，给用户全局视图
   - 避免用户逐个 focus 字段才能看到建议的低效交互

4. **为什么表单卡片内要按表单分组并排序？**
   - 完整表单（有 `<form>` 标签）通常比孤立 input 更重要
   - 栏位多的表单通常是主要表单（如注册表单 vs 搜索框）
   - 位置靠上的表单通常是用户优先关注的

5. **为什么 B 区域卡片不隐藏？**
   - 被动感知的价值在于"我注意到了这些"，隐藏等于丢弃信息
   - 用户可能稍后回来处理（比如读完文章后保存）
   - 堆叠方式避免信息过载，同时保留历史上下文

6. **为什么 FormFieldCard 点击字段要聚焦网页并高亮？**
   - 让用户在复杂页面中快速定位到目标字段
   - 蓝色高亮提供视觉反馈，确认操作成功
   - 聚焦后自动触发 C 区域建议，形成完整闭环

7. **为什么 B 区域底部不做渐变淡出？**
   - `overflow-y: auto` 容器中 `position: absolute` 的渐变会随内容滚动
   - `position: sticky` 在 Chrome Sidepanel 中的行为不稳定
   - 主题切换时渐变颜色需要精确匹配背景色，维护成本高
   - B 区域本身有滚动能力，用户自然知道下方还有更多内容
