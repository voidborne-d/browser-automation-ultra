#!/usr/bin/env node
/**
 * Behance Publish Script (Playwright via CDP)
 * Usage: ./scripts/browser-lock.sh run scripts/browser/publish-behance.js <image-path> <title> <description> <tags-csv> <categories-csv>
 * 
 * Connects to OpenClaw's existing Chrome via CDP.
 * Requires: Behance (Adobe) session already logged in.
 */

const { chromium } = require('playwright');
const path = require('path');
const { humanDelay, humanClick, humanType, humanThink, humanBrowse } = require('../utils/human-like');

function discoverCdpUrl() {
  const port = process.env.CDP_PORT || '18800';
  return `http://127.0.0.1:${port}`;
}

function log(msg) { console.log(`[BE] ${msg}`); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// Manual polling wait (CDP-safe, no waitForSelector)
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
  const [,, imagePath, title, description, tagsStr, categoriesStr] = process.argv;
  if (!imagePath || !title) {
    console.error('Usage: node publish-behance.js <image> <title> [description] [tags] [categories]');
    process.exit(1);
  }

  const absPath = path.resolve(imagePath);
  const tags = (tagsStr || 'digital art,abstract art,generative art').split(',').map(t => t.trim());
  const categories = (categoriesStr || '数码艺术,插图,美术').split(',').map(c => c.trim());
  const desc = description || title;

  log(`Publishing: "${title}"`);
  log(`Tags: ${tags.join(', ')}`);
  log(`Categories: ${categories.join(', ')}`);

  let browser;
  try {
    browser = await chromium.connectOverCDP(discoverCdpUrl());
  } catch (e) {
    console.error('❌ Cannot connect to CDP:', e.message);
    process.exit(1);
  }

  const context = browser.contexts()[0];
  const page = await context.newPage();

  try {
    // ===== 1. Open editor =====
    await page.goto('https://www.behance.net/portfolio/editor', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await humanDelay(3000, 5000);

    // Dismiss popups
    for (let i = 0; i < 3; i++) {
      const closed = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('button, a')];
        const dismiss = btns.find(b => /Continue to editor|继续转到编辑器|Maybe later|稍后/.test(b.textContent));
        if (dismiss) { dismiss.click(); return true; }
        return false;
      });
      if (closed) await humanDelay(800, 1500);
      else break;
    }
    log('Editor opened');
    await humanBrowse(page, { duration: 2000 });

    // ===== 2. Upload image via file input (qqfile) =====
    const addImgBtn = await page.$('button:has-text("Add an Image"), button:has-text("Add Photo")');
    if (addImgBtn) await humanClick(page, addImgBtn);
    await humanDelay(800, 1500);

    const fileInput = await page.$('input[name="qqfile"]');
    if (fileInput) {
      await fileInput.setInputFiles(absPath);
      log('Image uploaded via file input');
    } else {
      const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 10000 });
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find(b => /图像|Image|添加图像/.test(b.textContent));
        if (btn) btn.click();
      });
      const fileChooser = await fileChooserPromise;
      await fileChooser.setFiles(absPath);
      log('Image uploaded via filechooser');
    }

    await humanDelay(6000, 10000);
    log('Upload processing complete');

    // ===== 3. Click "继续" (Continue) =====
    await humanThink(1000, 2000);
    const clicked = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b => /^继续$|^Continue$/.test(b.textContent.trim()));
      if (btn) { btn.click(); return true; }
      return false;
    });
    if (clicked) log('Clicked Continue');
    else throw new Error('Continue button not found');
    await humanDelay(2000, 4000);

    // ===== 4. Wait for publish dialog =====
    await waitFor(page, () => !!document.querySelector('dialog, [role="dialog"]'), 10000);
    log('Publish dialog opened');

    // 4a. Title
    await humanThink(500, 1500);
    const titleSet = await page.evaluate(() => {
      const inputs = document.querySelectorAll('input');
      for (const inp of inputs) {
        if (inp.placeholder && /标题|title|项目/i.test(inp.placeholder)) {
          inp.setAttribute('data-be-title', 'true');
          return true;
        }
      }
      return false;
    });
    if (titleSet) {
      const titleEl = await page.$('input[data-be-title="true"]');
      await humanClick(page, titleEl);
      await page.keyboard.down('Meta');
      await page.keyboard.press('a');
      await page.keyboard.up('Meta');
      await humanDelay(100, 300);
      await humanType(page, null, title, { minDelay: 50, maxDelay: 160 });
      log(`Title set: ${title}`);
    } else {
      log('WARNING: Title input not found');
    }

    // 4b. Tags
    await humanThink(300, 800);
    const tagReady = await page.evaluate(() => {
      const inputs = document.querySelectorAll('input');
      for (const inp of inputs) {
        if (inp.placeholder && /关键字|tag/i.test(inp.placeholder)) {
          inp.setAttribute('data-be-tag', 'true');
          return true;
        }
      }
      return false;
    });
    if (tagReady) {
      const tagInput = await page.$('input[data-be-tag="true"]');
      for (const tag of tags) {
        await humanClick(page, tagInput);
        await humanType(page, null, tag, { minDelay: 40, maxDelay: 120 });
        await page.keyboard.press('Enter');
        await humanDelay(300, 700);
      }
      log(`Tags added: ${tags.join(', ')}`);
    } else {
      log('WARNING: Tag input not found');
    }

    // 4c. Categories
    const viewAllClicked = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b => /查看全部|View All/i.test(b.textContent));
      if (btn) { btn.click(); return true; }
      return false;
    });
    if (viewAllClicked) {
      await humanDelay(1500, 2500);
      log('Category modal opened');

      for (const cat of categories) {
        const checked = await page.evaluate((catName) => {
          const labels = [...document.querySelectorAll('label, span, div')];
          for (const el of labels) {
            if (el.textContent.trim() === catName) {
              const cb = el.closest('label, div')?.querySelector('input[type="checkbox"]') 
                || el.previousElementSibling;
              if (cb && cb.type === 'checkbox' && !cb.checked) {
                cb.click();
                return true;
              }
            }
          }
          return false;
        }, cat);
        log(checked ? `Category selected: ${cat}` : `WARNING: Category not found: ${cat}`);
        await humanDelay(300, 700);
      }

      const doneClicked = await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find(b => /^完成$|^Done$/.test(b.textContent.trim()));
        if (btn) { btn.click(); return true; }
        return false;
      });
      if (doneClicked) log('Category selection done');
      await humanDelay(800, 1500);
    } else {
      log('WARNING: Category button not found');
    }

    // 4d. Description
    await humanThink(500, 1200);
    const descSet = await page.evaluate(() => {
      const textareas = document.querySelectorAll('textarea');
      for (const ta of textareas) {
        if (ta.placeholder && /描述|description/i.test(ta.placeholder)) {
          ta.setAttribute('data-be-desc', 'true');
          return true;
        }
      }
      return false;
    });
    if (descSet) {
      const descEl = await page.$('textarea[data-be-desc="true"]');
      await humanClick(page, descEl);
      await humanDelay(200, 500);
      await humanType(page, null, desc, { minDelay: 30, maxDelay: 100 });
      log('Description set');
    } else {
      log('WARNING: Description textarea not found');
    }

    // ===== 5. Click Publish =====
    await humanThink(1500, 3000);
    // Wait for publish button to be enabled
    for (let i = 0; i < 30; i++) {
      const ready = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('button')];
        const pub = btns.find(b => /^发布$|^Publish$/.test(b.textContent.trim()));
        return pub && !pub.disabled;
      }).catch(() => false);
      if (ready) break;
      await sleep(500);
    }
    const published = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      const pub = btns.find(b => /^发布$|^Publish$/.test(b.textContent.trim()));
      if (pub && !pub.disabled) { pub.click(); return true; }
      return false;
    });
    if (published) log('Clicked Publish');
    else throw new Error('Publish button not found or disabled');

    await humanDelay(6000, 10000);

    // ===== 6. Verify =====
    const finalUrl = page.url();
    log(`Final URL: ${finalUrl}`);

    if (finalUrl.includes('gallery') || finalUrl.includes('freeonart') || !finalUrl.includes('editor')) {
      log('✅ SUCCESS — Project published!');
    } else {
      log('⚠️ Uncertain — check manually');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    await page.close();
  }
}

main().then(() => process.exit(0)).catch(e => {
  console.error('❌', e.message);
  process.exit(1);
});
