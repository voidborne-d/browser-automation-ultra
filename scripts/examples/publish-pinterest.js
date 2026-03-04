#!/usr/bin/env node
/**
 * Pinterest Publish Script (Playwright)
 * Usage: node publish-pinterest.js <image-path> <title> <description> [board-name]
 * 
 * Connects to OpenClaw's existing Chrome via CDP.
 * Requires: Pinterest session already logged in.
 */

const { chromium } = require('playwright');
const { humanDelay, humanClick, humanType, humanThink, humanBrowse } = require('./utils/human-like');

function discoverCdpUrl() {
  const port = process.env.CDP_PORT || '18800';
  return `http://127.0.0.1:${port}`;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Manual polling wait (CDP-safe)
async function waitFor(page, fn, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await page.evaluate(fn).catch(() => false);
    if (result) return result;
    await sleep(500);
  }
  throw new Error(`waitFor timeout after ${timeoutMs}ms`);
}

async function main() {
  const [,, imagePath, title, description, boardName] = process.argv;
  if (!imagePath || !title) {
    console.error('Usage: node publish-pinterest.js <image> <title> [description] [board]');
    process.exit(1);
  }

  const desc = description || title;
  const board = boardName || 'Abstract Digital Art';

  console.log(`[PIN] Publishing: "${title}"`);
  console.log(`[PIN] Image: ${imagePath}`);

  let browser;
  try {
    browser = await chromium.connectOverCDP(discoverCdpUrl());
  } catch (e) {
    console.error('[PIN] Cannot connect to CDP. Is Chrome running?');
    process.exit(1);
  }

  const context = browser.contexts()[0];
  const page = await context.newPage();

  try {
    await page.goto('https://www.pinterest.com/pin-creation-tool/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await humanDelay(3000, 5000);

    // 1. Upload image via file input
    await waitFor(page, () => !!document.querySelector('#storyboard-upload-input, input[type="file"]'), 10000);
    const fileInput = await page.$('#storyboard-upload-input, input[type="file"]');
    await fileInput.setInputFiles(imagePath);
    console.log('[PIN] Image uploaded');
    await humanDelay(3000, 6000);

    // 2. Fill title
    await humanThink(800, 2000);
    const titleReady = await page.evaluate(() => {
      const inputs = document.querySelectorAll('input');
      for (const inp of inputs) {
        if (inp.placeholder && /标题|title/i.test(inp.placeholder) && !inp.disabled) {
          inp.setAttribute('data-pin-title', 'true');
          return true;
        }
      }
      return false;
    });
    if (titleReady) {
      const titleEl = await page.$('input[data-pin-title="true"]');
      await humanClick(page, titleEl);
      await page.keyboard.down('Meta');
      await page.keyboard.press('a');
      await page.keyboard.up('Meta');
      await humanDelay(100, 300);
      await humanType(page, null, title, { minDelay: 50, maxDelay: 160 });
      console.log(`[PIN] Title: ${title}`);
    } else {
      console.log('[PIN] WARN: title input not found');
    }

    // 3. Fill description (Draft.js editor)
    await humanThink(500, 1500);
    const descReady = await page.evaluate(() => !!document.querySelector('.public-DraftEditor-content'));
    if (descReady) {
      const descEl = await page.$('.public-DraftEditor-content');
      await humanClick(page, descEl);
      await humanDelay(200, 500);
      await humanType(page, null, desc, { minDelay: 40, maxDelay: 130 });
      console.log('[PIN] Description set');
    } else {
      console.log('[PIN] WARN: description editor not found');
    }

    // 4. Select board
    const boardBtn = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      const b = btns.find(b => b.textContent.includes('选择一块图板') || b.textContent.includes('Select board') || b.textContent.includes('Abstract Digital Art'));
      if (b) { b.click(); return b.textContent.trim().substring(0, 50); }
      return null;
    });
    if (boardBtn) {
      console.log(`[PIN] Board dropdown clicked: "${boardBtn}"`);
      await humanDelay(1000, 2500);

      // Search for board
      const searchReady = await page.evaluate(() => {
        const inp = document.querySelector('input[placeholder*="搜索" i], input[placeholder*="search" i]');
        if (inp) { inp.setAttribute('data-pin-search', 'true'); return true; }
        return false;
      });
      if (searchReady) {
        const searchEl = await page.$('input[data-pin-search="true"]');
        await humanType(page, searchEl, board, { minDelay: 50, maxDelay: 140 });
        await humanDelay(1000, 2000);
      }

      // Click matching board
      const clicked = await page.evaluate((boardName) => {
        const items = document.querySelectorAll('[role="option"], [role="listbox"] [role="button"], [data-test-id*="board"]');
        for (const item of items) {
          if (item.textContent.includes(boardName)) { item.click(); return item.textContent.trim().substring(0, 50); }
        }
        const all = [...document.querySelectorAll('div, span, button')];
        const match = all.find(el => el.textContent.trim() === boardName && el.offsetParent !== null);
        if (match) { match.click(); return match.textContent.trim(); }
        return null;
      }, board);

      if (clicked) console.log(`[PIN] Board selected: ${clicked}`);
      else console.log('[PIN] WARN: board not found in dropdown');
      await humanDelay(800, 1500);
    } else {
      console.log('[PIN] WARN: board dropdown not found');
    }

    // 5. Click publish
    await humanThink(800, 2000);
    const published = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      const pub = btns.find(b => {
        const text = b.textContent.trim();
        return (text === '发布' || text === 'Publish') && !b.disabled && b.offsetParent !== null;
      });
      if (pub) { pub.click(); return true; }
      return false;
    });

    if (published) {
      console.log('[PIN] Publish button clicked');
    } else {
      console.error('[PIN] ERROR: Publish button not found or disabled');
      process.exit(1);
    }

    // 6. Verify
    await humanDelay(4000, 7000);
    const url = page.url();
    console.log(`[PIN] Final URL: ${url}`);

    const result = await page.evaluate(() => {
      const err = document.querySelector('[data-test-id*="error"], [class*="error"]');
      if (err && err.textContent.trim()) return { error: err.textContent.trim().substring(0, 100) };
      return { ok: true };
    });

    if (result.error) {
      console.error(`[PIN] ERROR: ${result.error}`);
      process.exit(1);
    }

    console.log('[PIN] SUCCESS');

  } catch (err) {
    console.error(`[PIN] Error: ${err.message}`);
    process.exit(1);
  } finally {
    await page.close();
  }
}

main().then(() => process.exit(0)).catch(e => { console.error('[PIN]', e.message); process.exit(1); });
