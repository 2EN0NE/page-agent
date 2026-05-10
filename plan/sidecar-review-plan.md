# PageAgent Sidecar 推荐算法优化计划

## 项目背景
当前分支 `feat-suggest_feedback` 已合并到 main（commit `19757cf`），引入了 sidecar 模式下的连续上下文观察、阅读检测、表单推荐等功能。但在端到端测试和实际使用中暴露出四大类问题，需要系统性修复和建立评估体系。

---

## 一、诊断摘要

### 🔴 P0 功能损坏
1. **表单建议 API 崩溃**：`content.ts` 的 `get_form_suggestions` handler 调用 `formDetector.suggestForField()`，但 `FormDetector` 类中不存在该方法 → 任何表单建议请求都会抛出异常。
2. **设置页面底部遮挡**：`ConfigPanel.tsx` 新增 `fixed bottom-0` 的 footer，在 Advanced 展开后遮挡 Save/Cancel 按钮，小屏幕必现。

### 🟠 P1 体验缺陷
3. **垃圾推荐（"on" 问题）**：`PrefixMatchAlgorithm` 前缀长度下限为 1，且无 stop words 过滤；`SemanticFrequencyAlgorithm` 忽略 prefix，冷启动时历史记录中的高频无意义词（如 "on", "Search"）被高权重推荐。
4. **性能隐患**：`queryInputValues` 使用 `db.getAll('inputValues')` 全表加载后内存过滤，数据累积后 UI 卡顿。
5. **UI 回归风险**：E2E 测试未覆盖按钮文字可见性、布局遮挡、主题对比度，已出现"白色按钮看不到文字"的样式回归。

### 🟡 P2 闭环缺失
6. **算法评估无数据**：`AnnotationRecord` 结构存在，但 `FormSuggestionBar` 的 dismiss/fill 行为未调用 `saveAnnotation`，无法评估默认算法准确率。
7. **上下文利用不足**：`ArticleExtractor` 提取的页面正文未注入 `SuggestionEngine`，推荐算法不知道用户正在阅读什么主题。

### 🟢 P3 架构优化
8. **存储冗余**：ContextEvents 同时写入 content script IndexedDB 和 background IndexedDB，同一份数据存两份。
9. **分词粗糙**：unigram + 暴力正则切分，丢失词序和中文语义关联。

---

## 二、执行计划

### Phase 1: 止血与可用性（P0）

#### Task 1.1 修复表单建议 API 运行时错误
- **文件**：`packages/extension/src/entrypoints/content.ts`
- **问题**：`formDetector.suggestForField(field)` 方法不存在
- **方案**：在 `FormDetector` 中新增 `suggestForField(field, prefix?): Promise<FormSuggestion[]>` 方法，复用 `#generateAndEmitSuggestions` 逻辑，但改为返回 Promise 而非通过回调 emit。
- **验收**：E2E 中新增 "form focus triggers suggestion" 用例，Playwright 验证 sidepanel 出现 suggestion bar。

#### Task 1.2 修复设置页面底部遮挡
- **文件**：`packages/extension/src/components/ConfigPanel.tsx`
- **问题**：底部 `fixed bottom-0` footer 遮挡滚动内容
- **方案**：移除 `fixed bottom-0`，改为普通流式元素；或给滚动容器增加 `pb-10` padding。
- **验收**：E2E 中设置页面展开 Advanced 后滚动到底部，Save 按钮 `toBeInViewport()` 通过。

### Phase 2: 推荐质量与性能（P1）

#### Task 2.1  PrefixMatch 与 stop words 过滤
- **文件**：`packages/extension/src/sidecar/SuggestionEngine.ts`
- **改动**：
  - `PrefixMatchAlgorithm.compute`：`prefix.length < 2` 时直接返回 `[]`（中文可特殊处理为 1）。
  - 新增 `STOP_WORDS` 集合：`new Set(['on','in','the','a','an','to','of','for','with','search','submit','cancel'])`。
  - `SemanticFrequencyAlgorithm` 的 `#tokenize` 中过滤 stop words。
  - `ContextObserver.#maybeStoreInputValue` 中：保存前检查 value 不能全是 stop words，且与 placeholder 相似度 < 0.8。
- **验收**：在空白 profile 下访问搜索引擎，聚焦搜索框后不应推荐 "on"、"Search" 等词。

#### Task 2.2 IndexedDB 游标分页
- **文件**：`packages/extension/src/lib/db.ts`
- **改动**：`queryInputValues` 改用 `db.transaction('inputValues').store.index('by-timestamp').openCursor(null, 'prev')` 游标读取，读够 `limit` 即停。
- **验收**：导入 5000 条测试数据后，表单聚焦到建议弹出耗时 < 100ms。

### Phase 3: UI 回归保护与测试文档化（P1→P2）

#### Task 3.1 E2E 覆盖 UI 可见性
- **文件**：`packages/extension/e2e/extension.spec.ts`
- **新增用例**：
  1. 设置页面滚动后 Save 按钮在视口内。
  2. 所有可见按钮的 `textContent` 非空。
  3. 亮/暗主题切换后按钮对比度可接受（通过 Playwright `getComputedStyle` 检查）。
- **验收**：CI 中 `npx playwright test` 全部通过。

#### Task 3.2 创建测试知识文档
- **文件**：`docs/e2e-testing-guide.md`
- **内容**：
  - 测试分层（构建 → UI → 数据流 → 业务闭环）。
  - UI 回归检查清单（fixed 定位遮挡、按钮对比度、i18n 文本断言最佳实践）。
  - 本地运行命令和调试技巧。
- **验收**：文档合并后，任何贡献者能按文档独立添加 E2E 用例。

### Phase 4: 评估闭环与上下文增强（P2）

#### Task 4.1 建议反馈采集
- **文件**：`packages/extension/src/components/FormSuggestionBar.tsx`
- **改动**：
  - `onFill` 时调用 `saveAnnotation({ label: 'useful', eventId, contextSnapshot, notes: JSON.stringify(suggestions) })`。
  - `onDismiss` 时调用 `saveAnnotation({ label: 'dismissed', ... })`。
  - 在 `queryInputValues` 中，对含 `dismissed` annotation 的 fieldKey 降低权重（或加入短期黑名单）。
- **验收**：IndexedDB 的 annotations store 在真实使用后 24h 内有数据写入。

#### Task 4.2 页面语义注入推荐引擎
- **文件**：`packages/extension/src/sidecar/ContextObserver.ts`, `SuggestionEngine.ts`
- **改动**：
  - `ContextObserver` 初始化时提取页面文章正文（复用 `ArticleExtractor`），计算 top-10 关键词作为 `pageContext`。
  - `SuggestionEngine` 的 `SemanticFrequencyAlgorithm` 在计算 confidence 时，增加 `pageContextBoost`：如果历史记录的 value 包含页面关键词，confidence +0.15。
- **验收**：在 React 技术文章页面，搜索/评论框的推荐优先出现 React 相关历史输入（如有）。

### Phase 5: 架构深度优化（P3）

#### Task 5.1 存储去冗余
- **文件**：`packages/extension/src/sidecar/ContextObserver.ts`, `src/entrypoints/background.ts`
- **改动**：content script 端不再持久化 `contextEvents` 到 IndexedDB，仅保留内存缓冲区（最近 1 分钟）；所有查询走 `QUERY_DB` message 到 background。
- **验收**：content script 刷新页面后，历史事件仍能从 background 查询到。

#### Task 5.2 算法细节优化
- **文件**：`SuggestionEngine.ts`
- **改动**：
  - unigram → bigram Jaccard。
  - 冷启动时（history < 5），从页面同 form 的其他字段值和同域名高频值生成候选。
- **验收**：在全新 profile 下访问常用网站，聚焦搜索框至少能给出 1 个合理候选（非 stop word）。

---

## 三、优先级总览

| 优先级 | 任务 | 影响 |
|--------|------|------|
| **P0** | Task 1.1 修复 `suggestForField` 缺失 | 功能完全不可用 |
| **P0** | Task 1.2 修复 fixed footer 遮挡 | UI 可用性阻塞 |
| **P1** | Task 2.1 PrefixMatch 下限 + stop words | 解决 "on" 垃圾推荐 |
| **P1** | Task 2.2 IndexedDB 游标分页 | 性能与空间隐患 |
| **P1** | Task 3.1 E2E UI 回归保护 | 防止前端再次回退 |
| **P2** | Task 3.2 `docs/e2e-testing-guide.md` | 知识沉淀 |
| **P2** | Task 4.1 建议反馈采集闭环 | 建立评估基础 |
| **P2** | Task 4.2 页面语义注入 | 大幅提升上下文质量 |
| **P3** | Task 5.1 存储去冗余 | 架构优化 |
| **P3** | Task 5.2 bigram / 冷启动兜底 | 长期算法质量 |

---

## 四、风险与依赖

- **DB_VERSION = 3 已发布**：如果修改 IndexedDB schema（如 Task 5.1），需要评估是否 bump DB_VERSION 到 4，否则需保持向后兼容。
- **Playwright E2E 需要构建产物**：`e2e/extension.spec.ts` 依赖 `.output/chrome-mv3`，CI 中需确保先 `npm run build`。
- **i18n 默认 zh-CN**：所有新增 UI 文本必须同步到 `src/i18n/zh.ts` 和 `en.ts`。
