#!/usr/bin/env node
/**
 * X/Twitter 推文发布脚本 (Playwright via CDP)
 * Usage: node publish-x-post.js <text> [--draft] [--image path]
 *
 * text:    推文内容（普通账号280字符限制，中文算2字符）
 * --draft: 仅保存草稿，不发布
 * --image: 附带图片路径
 *
 * 需要已登录 X/Twitter。
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { humanDelay, humanClick, humanType, humanBrowse, humanThink } = require('./utils/human-like');

function getCdpUrl() {
  const port = process.env.CDP_PORT || '18800';
  return `http://127.0.0.1:${port}`;
}

function log(msg) { console.log(`[X] ${msg}`); }
function err(msg) { console.error(`[X ERROR] ${msg}`); }

function parseArgs(args) {
  const result = { text: '', draft: false, image: null };
  let i = 0;
  const textParts = [];

  while (i < args.length) {
    if (args[i] === '--draft') {
      result.draft = true;
      i++;
    } else if (args[i] === '--image' && i + 1 < args.length) {
      result.image = args[i + 1];
      i += 2;
    } else {
      textParts.push(args[i]);
      i++;
    }
  }

  result.text = textParts.join(' ');
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.text) {
    console.log('Usage: node publish-x-post.js <text> [--draft] [--image path]');
    console.log('  --draft   Save as draft instead of posting');
    console.log('  --image   Attach an image');
    process.exit(1);
  }

  log(`推文内容: ${args.text.substring(0, 50)}...`);
  log(`模式: ${args.draft ? '保存草稿' : '直接发布'}`);
  if (args.image) log(`图片: ${args.image}`);

  const browser = await chromium.connectOverCDP(getCdpUrl());
  const context = browser.contexts()[0];
  const page = await context.newPage();

  try {
    // 1. 打开发推页面
    log('打开发推页面...');
    await page.goto('https://x.com/compose/post', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await humanBrowse(page);

    // 2. 等待输入框出现
    log('等待输入框...');
    const textbox = page.getByRole('textbox', { name: 'Post text' });
    await textbox.waitFor({ state: 'visible', timeout: 15000 });
    await humanDelay(500, 1000);

    // 3. 点击输入框
    await textbox.click();
    await humanDelay(300, 600);

    // 4. 输入推文内容（逐字输入模拟真人）
    log('输入推文内容...');
    // 对于长文本，分段输入避免超时
    const lines = args.text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) {
        await page.keyboard.press('Enter');
        await humanDelay(200, 500);
      }
      if (lines[i].length > 0) {
        // 逐字符输入，模拟真人打字
        for (const char of lines[i]) {
          await page.keyboard.type(char, { delay: Math.floor(50 + Math.random() * 100) });
        }
        await humanDelay(300, 800);
      }
    }

    await humanDelay(1000, 2000);

    // 5. 上传图片（可选）
    if (args.image) {
      const imgPath = path.resolve(args.image);
      if (!fs.existsSync(imgPath)) {
        err(`图片不存在: ${imgPath}`);
        process.exit(1);
      }

      log('上传图片...');
      // 找到文件上传 input
      const fileInput = page.locator('input[type="file"][accept*="image"]').first();
      await fileInput.setInputFiles(imgPath);
      await humanDelay(2000, 4000); // 等待上传完成

      // 确认图片已上传（检查是否有缩略图）
      log('等待图片上传完成...');
      await page.waitForTimeout(3000); // 图片上传需要时间
    }

    // 6. 检查字数是否超限
    const overLimitEl = await page.locator('text=/exceeded the character limit/').count();
    if (overLimitEl > 0) {
      err('推文超出字数限制！');
      if (args.draft) {
        log('保存到草稿...');
      } else {
        process.exit(1);
      }
    }

    // 7. 发布或保存草稿
    if (args.draft) {
      log('保存草稿...');
      const draftsBtn = page.getByRole('button', { name: 'Drafts' });
      if (await draftsBtn.isVisible()) {
        // 关闭对话框会提示保存草稿
        const closeBtn = page.getByRole('button', { name: 'Close' });
        await closeBtn.click();
        await humanDelay(500, 1000);

        // 等待确认对话框
        const saveDraftBtn = page.getByRole('button', { name: /save/i });
        if (await saveDraftBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await saveDraftBtn.click();
          log('✅ 草稿已保存');
        }
      }
    } else {
      log('发布推文...');
      const postBtn = page.getByRole('button', { name: 'Post', exact: true });

      // 检查按钮是否可用
      const isDisabled = await postBtn.isDisabled();
      if (isDisabled) {
        err('Post 按钮不可用，可能字数超限或内容为空');
        process.exit(1);
      }

      await humanDelay(500, 1000);
      await postBtn.click();

      // 等待发布完成（检查 alert 或页面变化）
      log('等待发布确认...');
      await humanDelay(2000, 3000);

      // 检查是否有 graduated access 提示（新号）
      const gotItBtn = page.getByRole('button', { name: 'Got it' });
      if (await gotItBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await gotItBtn.click();
        log('已关闭新号提示');
      }

      log('✅ 推文发布成功！');
    }

  } catch (e) {
    err(e.message);
    process.exit(1);
  } finally {
    await page.close(); // 绝对不能 browser.close()
  }
}

main().then(() => process.exit(0)).catch(e => { err(e.message); process.exit(1); });
