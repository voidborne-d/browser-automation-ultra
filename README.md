# Browser Automation Ultra

Zero-token browser automation for [OpenClaw](https://github.com/openclaw/openclaw) agents. Turn expensive browser-tool explorations into replayable Playwright scripts — with built-in CDP conflict management and human-like anti-detection.

## Why

| Problem | Solution |
|---------|----------|
| Browser tool burns ~200k tokens per task | Record once → replay at zero token cost |
| OpenClaw browser and Playwright fight over CDP | `browser-lock.sh` mutex handles it automatically |
| Platforms detect automation (shadow bans, captchas) | `human-like.js` simulates real human behavior |
| Scripts break when UI changes | Explore → Fix loop with browser tool snapshot |

## How It Works

```
┌─────────────────────────────────────────────────┐
│  1. EXPLORE    Use browser tool (snapshot/act)   │
│                to figure out the workflow         │
│                                                   │
│  2. RECORD     Convert steps into a Playwright   │
│                script using the template          │
│                                                   │
│  3. REPLAY     Run via browser-lock.sh            │
│                Zero tokens. Zero conflicts.       │
│                                                   │
│  4. FIX        Script fails? Re-explore the       │
│                failing step, update, retry.        │
└─────────────────────────────────────────────────┘
```

## Quick Start

### 1. Install Playwright

```bash
npm install playwright
```

No browser download needed — scripts connect to OpenClaw's existing Chrome via CDP.

### 2. Copy scripts to your workspace

```bash
cp scripts/browser-lock.sh    your-workspace/scripts/
cp scripts/utils/human-like.js your-workspace/scripts/browser/utils/
cp scripts/playwright-template.js your-workspace/scripts/browser/
chmod +x your-workspace/scripts/browser-lock.sh
```

### 3. Run a script

```bash
./scripts/browser-lock.sh run scripts/browser/my-task.js
```

## Anti-Detection: human-like.js

Every interaction simulates real human behavior:

- **Mouse movement** — Bézier curve trajectories with random jitter (not teleport clicks)
- **Typing** — Gaussian-distributed keystroke timing with 3% typo rate and auto-correction
- **Page browsing** — Random scrolling and mouse wandering before taking action
- **Delays** — Randomized ranges, never fixed millisecond values
- **Cron jitter** — Random offset for scheduled tasks to avoid predictable patterns

```javascript
const { humanClick, humanType, humanDelay, humanBrowse } = require('./utils/human-like');

// ❌ Detected as bot
await element.click();
await input.fill('text');
await page.waitForTimeout(3000);

// ✅ Passes as human
await humanClick(page, 'button.submit');
await humanType(page, 'input[name="title"]', 'text');
await humanDelay(2000, 4000);
```

## CDP Lock Manager: browser-lock.sh

OpenClaw's browser and Playwright both need exclusive CDP access. The lock manager handles this:

```bash
./scripts/browser-lock.sh run script.js        # acquire lock → run → release (300s timeout)
./scripts/browser-lock.sh run --timeout 120 s.js # custom timeout
./scripts/browser-lock.sh status                 # check lock state
./scripts/browser-lock.sh release                # force release stale lock
```

## Example Scripts

Seven production-tested scripts included in `scripts/examples/`:

| Script | Platform | What it does |
|--------|----------|-------------|
| `publish-deviantart.js` | DeviantArt | Upload image → fill title/desc/tags → submit |
| `publish-xiaohongshu.js` | 小红书 | Publish image note with topic tag association |
| `publish-pinterest.js` | Pinterest | Create pin → select board → publish |
| `publish-behance.js` | Behance | Upload project with metadata and categories |
| `read-proton-latest.js` | Proton Mail | Read inbox → output JSON |
| `read-xhs-comments.js` | 小红书 | Read comment notifications → output JSON |
| `reply-xhs-comment.js` | 小红书 | Reply to comment by index |

## Writing New Scripts

Use `scripts/playwright-template.js` as your starting point. Key rules:

```javascript
// ✅ Auto-discover CDP port
const browser = await chromium.connectOverCDP(discoverCdpUrl());

// ✅ Reuse existing context (cookies/login preserved)
const context = browser.contexts()[0];
const page = await context.newPage();

// ✅ Always close page, NEVER close browser
try { /* automation */ } finally { await page.close(); }

// ✅ Always explicit exit (Playwright keeps event loop alive)
process.exit(0);
```

## As an OpenClaw Skill

This repo is packaged as an [OpenClaw AgentSkill](https://docs.openclaw.ai). Install it and agents will automatically use it for browser automation tasks.

See `SKILL.md` for the full skill documentation that agents read.

## License

MIT
