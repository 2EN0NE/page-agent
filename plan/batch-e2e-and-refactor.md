# Batch Plan: E2E Skill Registration + Sidecar Refactor

## Research Summary

### Existing State
- **Extension E2E**: Playwright config exists (`packages/extension/playwright.config.ts`) but `package.json` has no `test:e2e` script. Tests only cover basic UI presence, not regression.
- **Build**: Extension builds via `npm run build:ext` (delegates to `wxt zip` in workspace). E2E depends on `.output/chrome-mv3`.
- **Project docs**: `AGENTS.md` exists with architecture overview but no E2E or testing instructions.
- **Claude config**: `.claude/settings.local.json` exists with permissions; no skills registered yet.
- **Known bugs**: `FormDetector.suggestForField` missing (runtime crash), ConfigPanel fixed footer occlusion, "on" garbage suggestions, full-table scan in `queryInputValues`.
- **I18n**: Default zh-CN; all new UI text must sync to `zh.ts` and `en.ts`.

### E2E Recipe (applies to all extension units)
```bash
# 1. Install deps
npm install

# 2. Build extension (required before E2E)
npm run build:ext

# 3. Run E2E suite
cd packages/extension
npx playwright test

# 4. Debug UI mode (optional)
npx playwright test --ui

# 5. Run specific test file
npx playwright test e2e/extension.spec.ts
```

**Precondition for every extension unit**: `npm run build:ext` must succeed and produce `.output/chrome-mv3/`.

---

## Work Units

### Phase A: E2E Infrastructure (spawn first)
These units establish the testing skill, docs, and baseline E2E coverage. They have no inter-dependencies and can run in parallel.

#### Unit 1: E2E Skill + AGENTS.md Update
- **Files**: `.claude/skills/e2e-testing.md`, `AGENTS.md`, `packages/extension/package.json`, `package.json`
- **Change**:
  - Create `.claude/skills/e2e-testing.md` with skill metadata, E2E recipe, UI regression checklist, and trigger strategy (git hook + CI + Claude convention).
  - Update `AGENTS.md` with an "E2E Testing" section referencing the skill and explaining how workers verify changes.
  - Add `"test:e2e": "cd packages/extension && npx playwright test"` to root `package.json` scripts.
  - Add `"test:e2e": "wxt build && npx playwright test"` to `packages/extension/package.json` scripts.

#### Unit 2: Baseline E2E Coverage — UI Regression
- **Files**: `packages/extension/e2e/extension.spec.ts`, `packages/extension/playwright.config.ts`
- **Change**:
  - Add test: Settings Advanced scroll → Save button in viewport.
  - Add test: All visible buttons have non-empty text (visible-text assertion).
  - Add test: Form focus on example page → suggestion bar appears (requires a local static HTML fixture or example.com manipulation).
  - Add `testMatch` or organize tests into `e2e/smoke/` and `e2e/regression/` if needed.

#### Unit 3: E2E Testing Guide Document
- **Files**: `docs/e2e-testing-guide.md`
- **Change**:
  - Testing layers (build → UI → data flow → business闭环).
  - UI regression checklist (fixed-position occlusion, button contrast, i18n assertion best practices).
  - Trigger strategy: `pre-push` hook for smoke tests, CI for full suite, Claude conversation convention.
  - Local run commands and debugging tips.

### Phase B: Sidecar Refactor (spawn after Phase A completes)
These units depend on Phase A because every change must be verifiable via the new E2E suite.

#### Unit 4: P0 Bugfix — suggestForField + Footer Occlusion
- **Files**: `packages/extension/src/sidecar/FormDetector.ts`, `packages/extension/src/components/ConfigPanel.tsx`
- **Change**:
  - Add `suggestForField(field, prefix?): Promise<FormSuggestion[]>` to `FormDetector`, reusing private logic.
  - Remove `fixed bottom-0` from ConfigPanel footer or add scroll padding so Save/Cancel remain accessible.

#### Unit 5: P1 Quality — Stop Words + Prefix Floor
- **Files**: `packages/extension/src/sidecar/SuggestionEngine.ts`, `packages/extension/src/sidecar/ContextObserver.ts`
- **Change**:
  - `PrefixMatchAlgorithm`: require `prefix.length >= 2` (English), ` >= 1` (CJK).
  - Add `STOP_WORDS` set; filter in `#tokenize` and in `#maybeStoreInputValue` (reject values that are all stop words or highly similar to placeholder).

#### Unit 6: P1 Performance — IndexedDB Cursor Pagination
- **Files**: `packages/extension/src/lib/db.ts`
- **Change**:
  - Rewrite `queryInputValues` to use `openCursor(null, 'prev')` on `by-timestamp` index; stop after `limit` records.
  - Keep backward compatibility with existing schema (no DB_VERSION bump required).

#### Unit 7: P2 Feedback Loop — Annotation Capture
- **Files**: `packages/extension/src/components/FormSuggestionBar.tsx`, `packages/extension/src/lib/db.ts`, `packages/extension/src/sidecar/SuggestionEngine.ts`
- **Change**:
  - On fill: `saveAnnotation({ label: 'useful', ... })`.
  - On dismiss: `saveAnnotation({ label: 'dismissed', ... })`.
  - In `queryInputValues` or `runSuggestionAlgorithms`, reduce weight for fieldKeys with recent `dismissed` annotations.

#### Unit 8: P2 Context — Page Semantic Injection
- **Files**: `packages/extension/src/sidecar/ContextObserver.ts`, `packages/extension/src/sidecar/SuggestionEngine.ts`, `packages/extension/src/sidecar/ArticleExtractor.ts`
- **Change**:
  - `ContextObserver` extracts article keywords (top-10 TF or simple frequency) on init and stores as `pageContext`.
  - `SemanticFrequencyAlgorithm` adds `pageContextBoost` when historical value contains page keywords.

#### Unit 9: P3 Architecture — Cross-Tab Sync Config Switch
- **Files**: `packages/extension/src/agent/useAgent.ts`, `packages/extension/src/components/ConfigPanel.tsx`, `packages/extension/src/sidecar/ContextObserver.ts`, `packages/extension/src/entrypoints/background.ts`
- **Change**:
  - Add `crossTabContextSync: boolean` to `AdvancedConfig` (default `true`).
  - `ContextObserver` only flushes to background via `SYNC_DB` when enabled; when disabled, keeps only in-memory buffer and queries go through `QUERY_DB` to background.
  - UI: add toggle in ConfigPanel Advanced section.

#### Unit 10: P3 Algorithm — Bigram + Cold-Start Fallback
- **Files**: `packages/extension/src/sidecar/SuggestionEngine.ts`
- **Change**:
  - Replace unigram Jaccard with bigram Jaccard in both algorithms.
  - When `history.length < 5`, generate candidates from: (a) sibling field values in same form, (b) domain-level frequent values from a lightweight in-memory cache.

---

## Dependencies

```
Phase A (Units 1-3)  ──parallel──
         │
         ▼ (after all Phase A PRs land)
Phase B (Units 4-10) ──parallel── (Unit 4 first recommended for P0 fixes)
```

Reason: Phase B changes must be validated by the E2E infrastructure created in Phase A. Workers for Phase B should rebase on latest main after Phase A merges.

---

## Worker Instructions (shared template)

After you finish implementing the change:
1. **Simplify** — Invoke the `Skill` tool with `skill: "simplify"` to review and clean up your changes.
2. **Run unit tests** — Run `npm run typecheck` and `npm run lint`. If tests fail, fix them.
3. **Test end-to-end** — Follow the E2E recipe: `npm run build:ext` then `cd packages/extension && npx playwright test`. If the unit is in Phase B and the E2E suite is not yet on main, run the E2E that exists.
4. **Commit and push** — Commit with a clear conventional-commit message, push branch, and create PR with `gh pr create`.
5. **Report** — End with `PR: <url>` or `PR: none — <reason>`.

---

## Code Conventions

- All code and comments in English (per AGENTS.md).
- Use explicit typing for exported/public APIs.
- Prettier config: single quote, semi false, tabs, printWidth 100.
- i18n: add new keys to both `src/i18n/zh.ts` and `src/i18n/en.ts`.
- Do not hide errors; make them visible and actionable.
