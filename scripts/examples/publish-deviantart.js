#!/usr/bin/env node
/**
 * DeviantArt Publish Script (Playwright via CDP)
 * Usage: node publish-deviantart.js <image-path> <title> <description> <tags-comma-separated>
 * 
 * All waits use manual polling (page.evaluate loops) instead of
 * waitForSelector/waitForFunction which are unreliable over CDP.
 */

const { chromium } = require('playwright');
const path = require('path');

function getCdpUrl() {
  const port = process.env.CDP_PORT || '18800';
  return `http://127.0.0.1:${port}`;
}

function log(msg) { console.log(`[DA] ${msg}`); }
function err(msg) { console.error(`[DA ERROR] ${msg}`); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// Simple polling wait
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
  const [,, imagePath, title, description, tagsStr] = process.argv;
  if (!imagePath || !title) {
    err('Usage: node publish-deviantart.js <image> <title> [description] [tags]');
    process.exit(1);
  }

  const absPath = path.resolve(imagePath);
  const tags = (tagsStr || 'digitalart,abstractart').split(',').map(t => t.trim());
  const desc = description || title;

  log(`Publishing: "${title}"`);
  log(`Image: ${absPath}`);
  log(`Tags: ${tags.join(', ')}`);

  let browser;
  try {
    browser = await chromium.connectOverCDP(getCdpUrl());
  } catch (e) {
    err('Cannot connect to CDP. Is Chrome running?');
    process.exit(1);
  }

  const context = browser.contexts()[0];
  const page = await context.newPage();

  try {
    // 1. Navigate
    log('Navigating...');
    await page.goto('https://www.deviantart.com/studio?new=1', { waitUntil: 'domcontentloaded', timeout: 30000 });
    log('Waiting for dialog...');
    await waitFor(page, () => !!document.querySelector('[role="dialog"]'));
    await sleep(rand(1500, 3000));
    log('Dialog ready');

    // 2. Upload image via filechooser
    log('Uploading image...');
    // Register listener BEFORE clicking, then click
    const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 10000 });
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      const uploadBtn = btns.find(b => b.textContent.includes('Upload Your Art'));
      if (uploadBtn) uploadBtn.click();
    });
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(absPath);
    log('Uploaded via filechooser');

    // 3. Wait for form to appear (title input means upload processed)
    log('Waiting for form...');
    for (let i = 0; i < 40; i++) {
      const hasTitle = await page.evaluate(() => 
        [...document.querySelectorAll('input')].some(i => i.placeholder?.toLowerCase().includes('title'))
      ).catch(() => false);
      if (hasTitle) break;
      await sleep(500);
    }
    await sleep(rand(1000, 2000));
    log('Form loaded');

    // 4. Fill title
    const titleFound = await page.evaluate(() => {
      const inputs = document.querySelectorAll('input');
      for (const inp of inputs) {
        if (inp.placeholder && inp.placeholder.toLowerCase().includes('title')) {
          inp.setAttribute('data-da-title', 'true');
          return inp.value || '(empty)';
        }
      }
      return false;
    });
    if (titleFound !== false) {
      const titleEl = await page.$('input[data-da-title="true"]');
      await titleEl.click();
      await sleep(200);
      await page.keyboard.down('Meta');
      await page.keyboard.press('a');
      await page.keyboard.up('Meta');
      await sleep(100);
      await page.keyboard.type(title, { delay: rand(20, 60) });
      log(`Title set: ${title}`);
    }

    // 5. Remove default tags
    log('Removing default tags...');
    for (let i = 0; i < 10; i++) {
      const removed = await page.evaluate(() => {
        // Find combobox in the submit dialog
        const dialogs = document.querySelectorAll('[role="dialog"]');
        let combobox = null;
        for (const d of dialogs) {
          if (d.textContent.includes('Submit deviation')) {
            combobox = d.querySelector('[role="combobox"]');
            break;
          }
        }
        if (!combobox) return false;
        const btns = combobox.querySelectorAll('button');
        for (const btn of btns) {
          const img = btn.querySelector('img, svg');
          if (img && btn.textContent.trim().length > 0 && btn.textContent.trim().length < 40) {
            img.click();
            return true;
          }
        }
        return false;
      });
      if (!removed) break;
      await sleep(rand(200, 400));
    }

    // 6. Add tags
    log('Adding tags...');
    for (const tag of tags) {
      await page.evaluate(() => {
        const dialogs = document.querySelectorAll('[role="dialog"]');
        for (const d of dialogs) {
          if (d.textContent.includes('Submit deviation')) {
            const input = d.querySelector('[role="combobox"] input');
            if (input) { input.focus(); break; }
          }
        }
      });
      await sleep(rand(150, 400));
      await page.keyboard.type(tag, { delay: rand(15, 40) });
      await page.keyboard.press('Enter');
      await sleep(rand(200, 400));
    }
    log(`Tags added: ${tags.length}`);

    // 6.5 Dismiss tag suggestions dropdown
    await page.keyboard.press('Escape');
    await sleep(rand(300, 600));
    // Click somewhere neutral to ensure focus leaves the tag input
    await page.evaluate(() => {
      const dialogs = document.querySelectorAll('[role="dialog"]');
      for (const d of dialogs) {
        if (d.textContent.includes('Submit deviation')) {
          const heading = d.querySelector('h2, h3, [class*="heading"], [class*="title"]');
          if (heading) { heading.click(); return; }
          d.click();
          return;
        }
      }
    });
    await sleep(rand(300, 600));

    // 7. Fill description
    log('Filling description...');
    const descReady = await page.evaluate(() => {
      // Find ALL contenteditable fields across the page (not limited to one dialog)
      const editables = document.querySelectorAll('[contenteditable="true"]');
      for (const ed of editables) {
        if (ed.offsetHeight >= 50) {
          ed.setAttribute('data-da-desc', 'true');
          return true;
        }
      }
      return false;
    });
    if (descReady) {
      const descEl = await page.$('[data-da-desc="true"]');
      if (descEl) {
        await descEl.click();
        await sleep(rand(300, 600));
        // Clear existing placeholder text
        await page.keyboard.down('Meta');
        await page.keyboard.press('a');
        await page.keyboard.up('Meta');
        await sleep(100);
        // Type description line by line
        const lines = desc.split('\n');
        for (let li = 0; li < lines.length; li++) {
          if (li > 0) await page.keyboard.press('Enter');
          await page.keyboard.type(lines[li], { delay: rand(10, 30) });
        }
        log('Description filled');
      }
    } else {
      log('Description field not found');
    }

    await sleep(rand(1000, 2000));

    // 8. Submit
    log('Submitting...');
    const submitResult = await page.evaluate(() => {
      // Find the Submit button - look for the one inside any dialog that has "Submit deviation" heading
      const dialogs = document.querySelectorAll('[role="dialog"]');
      for (const dialog of dialogs) {
        if (dialog.textContent.includes('Submit deviation')) {
          const btns = [...dialog.querySelectorAll('button')];
          const submitBtn = btns.find(b => b.textContent.trim() === 'Submit');
          if (submitBtn) { submitBtn.click(); return 'clicked'; }
        }
      }
      // Fallback: find any Submit button not in nav/header
      const allBtns = [...document.querySelectorAll('button')];
      const submitBtn = allBtns.find(b => 
        b.textContent.trim() === 'Submit' && !b.closest('nav') && !b.closest('header')
      );
      if (submitBtn) { submitBtn.click(); return 'clicked_fallback'; }
      return 'no_submit';
    });
    log(`Submit: ${submitResult}`);

    // 9. Wait for publish
    await sleep(rand(5000, 8000));

    // 10. Verify
    const finalUrl = page.url();
    const published = await page.evaluate(() => {
      return document.body.textContent.includes('Published just now') ||
             document.body.textContent.includes('Published');
    }).catch(() => false);

    if (published) {
      log(`SUCCESS - Published! URL: ${finalUrl}`);
    } else {
      log(`WARNING - Uncertain. URL: ${finalUrl}`);
    }

  } catch (error) {
    err(error.message);
    process.exit(1);
  } finally {
    await page.close();
  }
}

main().then(() => process.exit(0)).catch(e => { err(e.message); process.exit(1); });
