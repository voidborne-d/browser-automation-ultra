#!/usr/bin/env node
/**
 * 小红书创作平台发布脚本 (Playwright via CDP)
 * Usage: node publish-xiaohongshu.js <image-paths> <title> <description> [tags-comma-separated]
 *
 * image-paths: 单张图片路径，或多张用 | 分隔（如 "a.png|b.png|c.png"）
 * description: 正文内容（不含话题标签）
 * tags: 可选，逗号分隔的话题关键词，如 "抽象艺术,数字艺术,当代艺术"
 *       脚本通过话题按钮触发推荐列表，再点击匹配项关联真实话题。
 *       话题按钮会插入 # 字符，点击推荐项会替换该 # 为完整话题元素。
 *       若推荐列表无匹配，则跳过。
 *
 * 需要已登录小红书创作平台。
 */

const { chromium } = require('playwright');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { humanDelay, humanClick, humanType, humanFillContentEditable, humanBrowse, humanThink, humanScroll, jitterWait } = require('../utils/human-like');
const { applyStealthToContext } = require('../utils/stealth');

function getCdpUrl() {
  const port = process.env.CDP_PORT || '18800';
  return `http://127.0.0.1:${port}`;
}

function log(msg) { console.log(`[XHS] ${msg}`); }
function err(msg) { console.error(`[XHS ERROR] ${msg}`); }

async function addTopicTag(page, wantedTag) {
  // Strategy (based on social-push workflow):
  // 1. Focus the .ProseMirror editor
  // 2. Type "#话题" — triggers topic search dropdown
  // 3. Wait for dropdown to appear
  // 4. Press Enter to confirm the first suggestion
  // 5. If no dropdown appears, clean up with Backspace

  const editor = await page.$('.ProseMirror[contenteditable="true"]');
  if (!editor) return 'no-editor';

  // Focus editor and move cursor to end
  await editor.click();
  await humanDelay(200, 400);
  await page.keyboard.press('End');
  await humanDelay(100, 200);

  // Type space first to separate from previous content
  await humanType(page, null, ' ', { minDelay: 40, maxDelay: 80, typoRate: 0 });
  await humanDelay(200, 500);

  // Type # to trigger topic mode
  await humanType(page, null, '#', { minDelay: 40, maxDelay: 80, typoRate: 0 });
  await humanDelay(500, 1000);

  // Type the tag name character by character with human-like typing
  await humanType(page, null, wantedTag, { minDelay: 70, maxDelay: 180, typoRate: 0 });
  await humanDelay(1200, 2500); // wait for search dropdown to appear

  // Check if a suggestion dropdown appeared
  const hasDropdown = await page.evaluate(() => {
    // Look for any visible suggestion/topic dropdown
    const candidates = document.querySelectorAll(
      '.topic-suggest-list, .suggest-topic, [class*="topic-suggest"], ' +
      '[class*="mention-list"], .tippy-content, [class*="suggestion-list"], ' +
      '[class*="dropdown"]:not([style*="display: none"])'
    );
    for (const el of candidates) {
      if (el.offsetHeight > 0 && el.querySelectorAll('li, [class*="item"]').length > 0) {
        return true;
      }
    }
    return false;
  });

  if (hasDropdown) {
    // Press Enter to confirm the first suggestion
    await page.keyboard.press('Enter');
    await humanDelay(300, 600);
    return 'matched';
  }

  // No dropdown — clean up: delete what we typed
  await page.keyboard.press('Escape');
  await humanDelay(200, 300);
  const toDelete = wantedTag.length + 2; // +2 for space and #
  for (let i = 0; i < toDelete; i++) {
    await page.keyboard.press('Backspace');
    await humanDelay(20, 50);
  }
  await humanDelay(200, 400);

  return 'not-found';
}

async function main() {
  const [,, imagePathArg, title, description, tagsStr] = process.argv;
  if (!imagePathArg || !title) {
    err('Usage: node publish-xiaohongshu.js <image|img1|img2|img3> <title> [description] [tags]');
    process.exit(1);
  }

  // Support multiple images separated by |
  const imagePaths = imagePathArg.split('|').map(p => p.trim()).filter(Boolean);
  const absPaths = imagePaths.map(p => path.resolve(p));
  for (const ap of absPaths) {
    if (!fs.existsSync(ap)) {
      err(`File not found: ${ap}`);
      process.exit(1);
    }
  }
  const desc = description || '';
  const wantedTags = tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(Boolean) : [];

  log(`Publishing: "${title}"`);
  log(`Images (${absPaths.length}): ${absPaths.map(p => path.basename(p)).join(', ')}`);
  if (wantedTags.length) log(`Wanted tags: ${wantedTags.join(', ')}`);

  // 发布前随机等待 1-5 分钟，避免固定时间发布
  if (process.env.XHS_NO_JITTER !== '1') {
    await jitterWait(1, 5);
  }

  let browser;
  try {
    browser = await chromium.connectOverCDP(getCdpUrl());
  } catch (e) {
    err('Cannot connect to CDP. Is OpenClaw browser running?');
    process.exit(1);
  }

  const context = browser.contexts()[0];
  await applyStealthToContext(context);
  const page = await context.newPage();

  try {
    // ===== 1. Navigate to publish page =====
    await page.goto('https://creator.xiaohongshu.com/publish/publish?from=homepage&target=image', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await humanDelay(2000, 4000);
    log('Publish page loaded');

    // 模拟人类浏览页面（先看看发布页面）
    await humanBrowse(page, { duration: 3000 });
    await humanScroll(page, { scrolls: 1, minPause: 500, maxPause: 1200 });

    // ===== 2. Upload image(s) =====
    const fileInput = await page.$('input[type="file"]');
    if (!fileInput) { err('File input not found'); process.exit(1); }
    await fileInput.setInputFiles(absPaths);
    log(`${absPaths.length} image(s) uploaded`);
    // More images need more time to process
    const uploadWait = absPaths.length > 1 ? [6000, 10000] : [4000, 7000];
    await humanDelay(...uploadWait);

    // ===== 3. Fill title =====
    const titleInput = await page.$('input[placeholder*="标题"]');
    if (titleInput) {
      await humanThink(800, 2000);
      await humanType(page, 'input[placeholder*="标题"]', title, { minDelay: 60, maxDelay: 200 });
      log(`Title: ${title}`);
    }

    // ===== 4. Fill description =====
    if (desc) {
      await humanThink(1000, 2500);
      await humanFillContentEditable(page, '[contenteditable="true"]', desc, { minDelay: 40, maxDelay: 150 });
      log('Description filled');
    }

    // ===== 5. Add topic tags =====
    if (wantedTags.length > 0) {
      let added = 0;
      for (const tag of wantedTags) {
        const result = await addTopicTag(page, tag);
        if (result.startsWith('matched')) {
          added++;
          log(`Tag: #${tag} ✅ (${result})`);
        } else {
          log(`Tag: #${tag} ⏭ (${result})`);
        }
        await humanDelay(200, 600);
      }
      log(`Tags: ${added}/${wantedTags.length} added`);

      // Final cleanup: remove ALL leftover bare # or suggestion spans
      await page.evaluate(() => {
        const editor = document.querySelector('[contenteditable="true"]');
        if (!editor) return;
        editor.querySelectorAll('.suggestion').forEach(s => s.remove());
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        for (const node of nodes) {
          if (node.parentElement.closest('.tiptap-topic')) continue;
          if (node.parentElement.closest('.content-hide')) continue;
          // Remove ALL # characters from non-topic text nodes
          const cleaned = node.textContent.replace(/#/g, '').replace(/\s{2,}/g, ' ');
          if (cleaned.trim()) {
            node.textContent = cleaned;
          } else {
            node.remove();
          }
        }
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }

    // ===== 6. Original declaration =====
    try {
      const origCheckbox = await page.$('input[type="checkbox"]:near(:text("原创声明"))');
      if (origCheckbox) {
        const checked = await origCheckbox.isChecked();
        if (!checked) {
          await humanClick(page, origCheckbox);
          await humanDelay(1000, 2000);
          const agreeEl = await page.$('text=我已阅读并同意');
          if (agreeEl) { await humanClick(page, agreeEl); await humanDelay(500, 1000); }
          const declareBtn = await page.$('button:has-text("声明原创"):not([disabled])');
          if (declareBtn) { await humanClick(page, declareBtn); log('Original declaration ✅'); await humanDelay(1000, 2000); }
        }
      }
    } catch (e) { log('Original declaration skipped'); }

    // ===== 7. Publish =====
    await page.screenshot({ path: '/tmp/xhs-before-publish.png' });
    await humanThink(1000, 3000); // 发布前停顿，模拟检查
    const publishBtn = await page.$('button:has-text("发布")');
    if (!publishBtn) { err('Publish button not found'); process.exit(1); }
    await humanClick(page, publishBtn);
    log('Publish clicked');
    await humanDelay(4000, 7000);

    const currentUrl = page.url();
    // After successful publish, XHS resets to blank upload page (URL stays /publish/publish)
    // Check if the form was reset (no image/title present) as a success indicator
    const formState = await page.evaluate(() => {
      const titleInput = document.querySelector('input[placeholder*="标题"]') || document.querySelector('.c-input_inner');
      const hasTitle = titleInput && titleInput.value && titleInput.value.length > 0;
      const hasImage = !!document.querySelector('.img-container img, .c-image_inner, [class*="coverImg"]');
      const errEls = [...document.querySelectorAll('[class*="error"],[class*="toast"],[class*="warning"]')].map(e => e.textContent).filter(Boolean);
      return { hasTitle, hasImage, errors: errEls };
    });

    if (!currentUrl.includes('/publish/publish')) {
      log('SUCCESS ✅ (navigated away)');
    } else if (formState.errors.length > 0) {
      err(formState.errors.join('; '));
    } else if (!formState.hasTitle && !formState.hasImage) {
      // Form was reset to blank = publish succeeded
      log('SUCCESS ✅');
    } else {
      log('WARNING - Still on publish page (form not reset)');
    }
    await page.screenshot({ path: '/tmp/xhs-after-publish.png' });

  } catch (error) {
    err(error.message);
    await page.screenshot({ path: '/tmp/xhs-publish-error.png' }).catch(() => {});
    process.exit(1);
  } finally {
    await page.close();
  }
}

main().then(() => process.exit(0)).catch(e => { console.error('❌', e.message); process.exit(1); });
