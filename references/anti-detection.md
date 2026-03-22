# Anti-Detection Rules for Browser Automation Scripts

## Why This Matters

Platforms like Xiaohongshu, DeviantArt, Pinterest, Behance use behavioral analysis and fingerprint detection to identify automation. Violations result in shadow bans, captcha loops, or account suspension.

## Two Layers of Defense

### Layer 1: Stealth (CDP Fingerprint Removal)

`stealth.js` removes traces left by the CDP connection itself. Since we use `connectOverCDP` to control a **real Chrome** (not Playwright's bundled Chromium), the base fingerprint (UA, WebGL, Canvas, fonts, TLS) is already clean. Stealth only patches what CDP exposes:

| What it fixes | How |
|---------------|-----|
| `navigator.webdriver = true` | `defineProperty` override + CDP `addScriptToEvaluateOnNewDocument` |
| Empty `navigator.plugins` | Fake 3 standard Chrome plugins (fallback only) |
| Empty `navigator.languages` | Set to `['zh-CN', 'zh', 'en-US', 'en']` |
| Playwright globals (`__playwright`, `__pw_manual`) | Delete from `window` |
| ChromeDriver variables (`cdc_*`) | Delete from `window` |
| Missing `chrome.runtime` | Create stub object |
| Permissions API anomalies | Fix notification permission query |
| `navigator.connection.rtt` | Randomize 50-150ms |
| WebGL vendor/renderer empty | Fallback to real Apple M1 values |

**Usage:**
```javascript
const { applyStealthToContext } = require('./utils/stealth');

const context = browser.contexts()[0];
await applyStealthToContext(context);  // BEFORE creating pages
const page = await context.newPage();
```

Apply to context (not page) so all new pages inherit stealth automatically.

### Layer 2: Human-Like Behavior

`human-like.js` makes all interactions look human. This is the behavioral layer.

## Rules

### 1. No Fixed Delays

```javascript
// ❌ NEVER
await page.waitForTimeout(3000);

// ✅ ALWAYS
await humanDelay(2000, 4000);
await humanThink(1000, 3000); // before form fills
```

### 2. No Instant Text Injection

```javascript
// ❌ NEVER — no keydown/keyup events, detected by frontend monitoring
await input.fill(text);
await page.evaluate(() => { input.value = text; });
const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
nativeSetter.call(input, text);

// ✅ ALWAYS — real keystroke events with variable timing
await humanType(page, 'input[name="title"]', text);
await humanFillContentEditable(page, '[contenteditable="true"]', text);
```

### 3. No Teleport Clicks

```javascript
// ❌ NEVER — coordinates jump instantly, no mousemove events
await element.click();
await page.click('button.submit');

// ✅ ALWAYS — bezier curve mouse path → random hover → press/release jitter
await humanClick(page, 'button.submit');
await humanClick(page, elementHandle); // also accepts element handles
```

### 4. Page Browsing Simulation Required

```javascript
// ❌ NEVER — open page then immediately operate
await page.goto(url);
await page.fill('input', text); // too fast

// ✅ ALWAYS — simulate human reading the page first
await page.goto(url, { waitUntil: 'domcontentloaded' });
await humanDelay(2000, 4000);  // page load settling
await humanBrowse(page);       // scroll + mouse wander
await humanThink(800, 2000);   // pause before action
await humanType(page, 'input', text);
```

### 5. Cron Time Jitter

```javascript
// ❌ NEVER — publish at exact same time every day
// cron: 0 10 * * *

// ✅ ALWAYS — add random offset at script start
const { jitterWait } = require('./utils/human-like');
await jitterWait(1, 15); // random 1-15 minute delay

// ✅ ALSO — use OpenClaw cron stagger
// openclaw cron edit <id> --stagger 30m
```

### 6. page.evaluate() Usage

```javascript
// ✅ OK — reading DOM state
const count = await page.evaluate(() => document.querySelectorAll('.item').length);

// ✅ OK — clicking from a dynamic list (no other way)
await page.evaluate((idx) => document.querySelectorAll('.tag')[idx].click(), index);

// ❌ NEVER — injecting text or triggering form submission
await page.evaluate((t) => { document.querySelector('input').value = t; }, text);
```

### 7. setInputFiles Exception

File upload has no human-like alternative. Direct call allowed:

```javascript
await fileInput.setInputFiles(path);
```

But always add random delays around it:

```javascript
await humanThink(500, 1500);
await fileInput.setInputFiles(imagePath);
await humanDelay(3000, 6000); // wait for upload processing
```

### 8. Stealth Must Be Applied Before Navigation

```javascript
// ❌ WRONG — stealth after page creation has no effect on initial load
const page = await context.newPage();
await applyStealthToPage(page);
await page.goto(url); // first load already exposed webdriver=true

// ✅ RIGHT — stealth on context before page creation
await applyStealthToContext(context);
const page = await context.newPage();
await page.goto(url); // clean from the start
```

## What stealth.js CANNOT fix

- **Server-side behavior analysis**: publishing frequency, content patterns, login IP patterns — these are account-level signals, not browser fingerprint issues
- **CDP event subscription detection**: if a site detects that `Runtime.enable` or `Page.enable` CDP domains are active, there's no way to hide this from inside the page
- **TLS fingerprint**: the real Chrome's TLS stack is already genuine, so this is not a concern for `connectOverCDP`

## human-like.js Function Reference

### humanDelay(minMs, maxMs) → Promise<number>
Random delay using uniform distribution. Returns actual ms waited.

### humanThink(minMs, maxMs) → Promise<number>
Alias for longer delays (default 1500-4000ms). Use before form interactions.

### humanClick(page, selectorOrElement, opts?) → Promise<void>
1. Resolves element bounding box
2. Picks random point within element (not always center)
3. Generates bezier curve mouse path from random viewport position
4. Moves mouse along path with 3-12ms steps
5. Hovers 80-250ms
6. mousedown → 40-120ms → mouseup
7. Post-click pause 100-400ms

Options: `{ timeout: 10000, button: 'left' }`

### humanType(page, selector, text, opts?) → Promise<void>
1. If selector provided, humanClick on it first
2. Types each character with gaussian-distributed delay
3. 3% chance of typo (adjacent QWERTY key) → auto-backspace → correct key
4. Extra pause after punctuation/spaces (30% chance)

Options: `{ minDelay: 50, maxDelay: 180, typoRate: 0.03 }`

### humanFillContentEditable(page, selector, text, opts?) → Promise<void>
humanClick on element, then type line-by-line with Enter between lines.

### humanBrowse(page, opts?) → Promise<void>
Simulates 2-5s of page browsing: random scrolls + mouse movements + pauses.

### humanScroll(page, opts?) → Promise<void>
2-5 scroll events with random direction (80% down, 20% up). 500-2000ms between scrolls.

### jitterWait(minMinutes, maxMinutes) → Promise<number>
Waits random minutes. Logs the wait time. Returns ms waited.

### jitterSchedule(baseMinutes, range) → number
Returns baseMinutes ± range (for schedule calculation, not waiting).

## stealth.js Function Reference

### applyStealthToContext(context) → Promise<void>
Apply stealth patches to a BrowserContext. All pages created from this context will inherit stealth. **Call before `context.newPage()`.**

### applyStealthToPage(page) → Promise<void>
Apply stealth to a single page (CDP session + addInitScript). Use when you can't apply to context. **Call before `page.goto()`.**

### verifyStealthStatus(page) → Promise<object>
Debug helper. Returns detection status:
```json
{
  "webdriver": undefined,
  "webdriverDefined": false,
  "pluginCount": 3,
  "languages": ["zh-CN", "zh", "en-US", "en"],
  "chrome": true,
  "chromeRuntime": true,
  "playwrightGlobals": [],
  "cdcKeys": []
}
```
