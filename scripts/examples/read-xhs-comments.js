#!/usr/bin/env node
/**
 * 小红书评论读取脚本
 * Usage: node read-xhs-comments.js [--limit N]
 * 
 * 输出 JSON 数组到 stdout:
 * [{ index, user, relation, comment, time, hasReplyBtn }]
 * 
 * 需要已登录小红书。
 */

const { chromium } = require('playwright');
const { execSync } = require('child_process');
const { humanDelay, humanBrowse, humanScroll, humanClick } = require('../utils/human-like');
const { applyStealthToContext } = require('../utils/stealth');

function getCdpUrl() {
  const port = process.env.CDP_PORT || '18800';
  return `http://127.0.0.1:${port}`;
}

function log(msg) { console.error(`[XHS-READ] ${msg}`); }

async function main() {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) || 20 : 20;

  let browser;
  try {
    browser = await chromium.connectOverCDP(getCdpUrl());
  } catch (e) {
    log('Cannot connect to CDP. Is OpenClaw browser running?');
    process.exit(1);
  }

  const context = browser.contexts()[0];
  await applyStealthToContext(context);
  const page = await context.newPage();

  try {
    await page.goto('https://www.xiaohongshu.com/notification', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await humanDelay(2500, 5000);
    log('Notification page loaded');

    // 模拟人类浏览通知页面
    await humanBrowse(page, { duration: 3000 });

    // 随机滚动看看通知
    await humanScroll(page, { scrolls: 2, minPause: 800, maxPause: 2000 });
    await humanDelay(1000, 2000);

    const comments = await page.evaluate((maxItems) => {
      const results = [];
      const mains = document.querySelectorAll('.main');

      mains.forEach((main, i) => {
        if (results.length >= maxItems) return;

        const userEl = main.querySelector('.user-info a');
        const relationEl = main.querySelector('.user-tag');
        const timeEl = main.querySelector('.interaction-time');
        const contentEl = main.querySelector('.interaction-content');
        const hintEl = main.querySelector('.interaction-hint span:first-child');
        const replyBtn = main.querySelector('.action-reply');

        // Skip non-comment notifications
        if (!contentEl && !hintEl) return;

        const type = hintEl?.textContent?.trim() || '';
        if (!type.includes('评论') && !type.includes('回复')) return;

        results.push({
          index: results.length,
          user: userEl?.textContent?.trim() || '',
          relation: relationEl?.textContent?.trim() || '',
          type: type,
          comment: contentEl?.textContent?.trim() || '',
          time: timeEl?.textContent?.trim() || '',
          hasReplyBtn: !!replyBtn,
          _mainIndex: i,
        });
      });

      // Calculate reply button indices
      const allReplyBtns = document.querySelectorAll('.action-reply');
      const btnToMainIndex = [];
      allReplyBtns.forEach((btn) => {
        const main = btn.closest('.main');
        if (main) {
          const mains = document.querySelectorAll('.main');
          for (let j = 0; j < mains.length; j++) {
            if (mains[j] === main) { btnToMainIndex.push(j); break; }
          }
        }
      });

      results.forEach(item => {
        const btnIdx = btnToMainIndex.indexOf(item._mainIndex);
        item.replyBtnIndex = btnIdx >= 0 ? btnIdx : -1;
        delete item._mainIndex;
      });

      return results;
    }, limit);

    log(`Found ${comments.length} comment(s)`);

    // 读完再随便看看，模拟真人
    await humanDelay(500, 1500);
    await humanScroll(page, { scrolls: 1, minPause: 500, maxPause: 1200 });
    await humanDelay(800, 2000);

    console.log(JSON.stringify(comments, null, 2));

  } catch (error) {
    log(`Error: ${error.message}`);
    process.exit(1);
  } finally {
    await page.close();
  }
}

main().then(() => process.exit(0)).catch(e => { console.error('❌', e.message); process.exit(1); });
