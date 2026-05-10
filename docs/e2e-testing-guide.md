# E2E Testing Guide

## Overview

This project uses **Playwright** to run end-to-end tests against the built Chrome extension. The E2E suite validates builds, UI regressions, data persistence, and critical user flows.

---

## Test Layers

| Layer | Scope | Location | When to update |
|-------|-------|----------|----------------|
| **Build** | Extension artifacts exist and manifest is valid | `e2e/extension.spec.ts` — `Extension Loading` | Every PR |
| **UI Regression** | Layout occlusion, button visibility, theme contrast | `e2e/extension.spec.ts` — `UI Regression` | Every UI change |
| **Data Flow** | IndexedDB stores, cross-tab storage sync | `e2e/extension.spec.ts` — `IndexedDB Persistence` | Every storage schema change |
| **Business闭环** | Form focus → suggestion → fill → annotation | `e2e/extension.spec.ts` — future flow tests | Every algorithm / detector change |

---

## Quick Start

```bash
# Install dependencies
npm install

# Build the extension (required before E2E)
npm run build:ext

# Run all E2E tests
cd packages/extension
npx playwright test

# Run in UI debug mode
npx playwright test --ui

# Run a specific test file
npx playwright test e2e/extension.spec.ts

# Run smoke tests only
npx playwright test --grep @smoke
```

---

## UI Regression Checklist

Before submitting any extension UI change, verify the following manually or via E2E assertions:

- [ ] **No layout occlusion**: Scroll through every scrollable panel. Confirm that `fixed` or `sticky` elements do not cover interactive buttons (Save, Cancel, Focus, etc.).
- [ ] **Button text visible**: Every visible button must have either non-empty text content or an accessible `aria-label`. Icon-only buttons are acceptable **only** with `aria-label`.
- [ ] **i18n key sync**: New user-visible strings must be added to both `packages/extension/src/i18n/zh.ts` and `en.ts`. Use `aria-label` or `data-testid` in E2E selectors instead of raw visible text to reduce i18n fragility.
- [ ] **Theme contrast**: If you add new color classes, visually inspect both light and dark themes. For automated safety, consider asserting `getComputedStyle(el).color` against the background in Playwright.

---

## Trigger Strategy

| Stage | Trigger | Scope | Purpose |
|-------|---------|-------|---------|
| Local dev | `npm run test:e2e` | Full suite | Final verification before pushing |
| Git hook | `pre-push` | Smoke tests | Catch broken builds before they reach remote |
| CI | GitHub Actions / other CI | Full suite | Gate PR merges |
| Claude Code | Conversation convention | Relevant subset | Agent asks the user to run E2E when the change touches UI, storage, or algorithms |

### Recommended pre-push hook

Add to `.husky/pre-push` (if using husky):

```bash
#\!/bin/sh
npm run test:e2e -- --grep @smoke
```

---

## Project Structure

```
packages/extension/
├── e2e/
│   └── extension.spec.ts          # Main E2E test file
├── playwright.config.ts           # Playwright configuration
└── .output/chrome-mv3/            # Built extension (required for E2E)
```

### Playwright configuration highlights

- **Browser**: Chromium with extension loading flags (`--load-extension`, `--disable-extensions-except`)
- **Workers**: `1` in CI (extension tests are safer serialized), `undefined` locally (parallel)
- **Retries**: `2` in CI, `0` locally
- **Trace**: `on-first-retry` for debugging flaky tests

---

## Writing New E2E Tests

### Pattern for UI regression tests

```typescript
import { expect, test } from '@playwright/test'

test('My new panel does not occlude buttons', async ({ page }) => {
  // Open the panel
  await page.locator('[aria-label="My Panel"]').click()
  // Expand all sections that might push buttons down
  await page.locator('button:has-text("Expand"]').click()
  // Scroll to bottom
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  // Assert critical button is still reachable
  const submit = page.locator('button:has-text("Submit")')
  await expect(submit).toBeInViewport()
  await expect(submit).toBeEnabled()
})
```

### Pattern for button visibility tests

```typescript
test('All visible buttons have accessible labels', async ({ page }) => {
  const buttons = await page.locator('button').all()
  for (const btn of buttons) {
    if (\!(await btn.isVisible())) continue
    const text = (await btn.textContent())?.trim()
    const aria = await btn.getAttribute('aria-label')
    expect(text || aria).toBeTruthy()
  }
})
```

---

## Debugging Tips

- **Extension not loading**: Verify `.output/chrome-mv3/manifest.json` exists and has `manifest_version: 3`. Run `npm run build:ext` and check for build errors.
- **Flaky tests**: Use `npx playwright test --ui` to step through interactively. Increase `actionTimeout` in `playwright.config.ts` if the machine is slow.
- **Storage leaks between tests**: Playwright persistent contexts share storage. Clear `chrome.storage.local` and IndexedDB in `test.beforeEach` if tests are order-dependent.
- **Headed vs headless**: The current config runs headed (`headless: false`) because Chrome extensions often behave differently in headless mode. CI should use a virtual display (e.g., `xvfb-run`) if needed.

---

## Related Files

- `.claude/skills/e2e-testing.md` — Claude Code skill for automated agents
- `AGENTS.md` — Project-wide agent instructions including E2E conventions
- `packages/extension/playwright.config.ts` — Test runner configuration
- `packages/extension/e2e/extension.spec.ts` — Test implementations
