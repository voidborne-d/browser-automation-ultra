#!/usr/bin/env node
/**
 * 小红书评论回复脚本
 * Usage: node reply-xhs-comment.js <comment-index> <reply-text>
 * 
 * comment-index: 第几条评论 (0-based, 对应 read-xhs-comments.js 输出的 index)
 * reply-text: 回复内容
 * 
 * 需要已登录小红书。
 */

const { chromium } = require('playwright');
const { execSync } = require('child_process');
const { humanDelay, humanClick, humanType, humanThink, humanBrowse, humanScroll } = require('../utils/human-like');
const { applyStealthToContext } = require('../utils/stealth');

function getCdpUrl() {
  const port = process.env.CDP_PORT || '18800';
  return `http://127.0.0.1:${port}`;
}

function log(msg) { console.log(`[XHS-REPLY] ${msg}`); }
function err(msg) { console.error(`[XHS-REPLY ERROR] ${msg}`); }

async function main() {
  const [,, indexStr, replyText] = process.argv;
  if (indexStr === undefined || !replyText) {
    err('Usage: node reply-xhs-comment.js <comment-index> <reply-text>');
    process.exit(1);
  }
  const targetIndex = parseInt(indexStr);

  log(`Replying to comment #${targetIndex}: "${replyText}"`);

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
    await page.goto('https://www.xiaohongshu.com/notification', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await humanDelay(2500, 5000);
    log('Notification page loaded');

    // 模拟先浏览通知页
    await humanBrowse(page, { duration: 3000 });
    await humanScroll(page, { scrolls: 2, minPause: 600, maxPause: 1500 });
    await humanDelay(800, 2000);

    // Click the reply button for the target comment
    const replyBtns = await page.$$('.action-reply');
    if (targetIndex >= replyBtns.length) {
      err(`index ${targetIndex} out of range (${replyBtns.length} reply buttons)`);
      process.exit(1);
    }

    // 用 humanClick 点击回复按钮
    await humanClick(page, replyBtns[targetIndex]);
    log('Reply button clicked');
    await humanDelay(1000, 2000);

    // 等待回复输入框出现
    const ta = await page.waitForSelector('input[placeholder^="回复"]', { timeout: 5000 }).catch(() => null)
      || await page.waitForSelector('textarea.comment-input', { timeout: 2000 }).catch(() => null);
    if (!ta) { err('reply input not found'); process.exit(1); }

    // 先看看输入框，模拟思考要回什么
    await humanThink(1000, 3000);

    // 点击输入框并打字
    await humanClick(page, ta);
    await humanDelay(300, 800);
    await humanType(page, null, replyText, { minDelay: 60, maxDelay: 200 });
    log('Reply text typed');

    // 打完再看一眼，模拟检查
    await humanThink(800, 2000);

    // Click send button
    const sendBtn = await page.$('div.submit, button.submit, button.send-btn');
    if (!sendBtn) {
      // Fallback: 通过 evaluate 查找发送按钮并用 humanClick
      const sendSelector = await page.evaluate(() => {
        const all = [...document.querySelectorAll('button, div, span')]
          .filter(el => el.textContent.trim() === '发送' && el.offsetHeight > 0 && el.children.length === 0);
        if (all.length > 0) {
          // 给它加个临时 id 以便 humanClick 使用
          all[0].id = '__xhs_send_btn__';
          return '#__xhs_send_btn__';
        }
        return null;
      });
      if (!sendSelector) { err('send button not found'); process.exit(1); }
      await humanClick(page, sendSelector);
    } else {
      await humanClick(page, sendBtn);
    }
    log('Send clicked');
    await humanDelay(2000, 4000);

    // Verify
    const verified = await page.evaluate(() => {
      const ta = document.querySelector('input[placeholder^="回复"]') || document.querySelector('textarea.comment-input');
      return ta ? (ta.offsetHeight > 0 ? 'still visible' : 'hidden') : 'gone';
    });

    if (verified === 'gone' || verified === 'hidden') {
      log('SUCCESS - Reply sent');
    } else {
      log(`WARNING - textarea ${verified}, reply may not have sent`);
    }

    // 回复完再看一下，像真人
    await humanDelay(1000, 2500);

  } catch (error) {
    err(error.message);
    process.exit(1);
  } finally {
    await page.close();
  }
}

main().then(() => process.exit(0)).catch(e => { console.error('❌', e.message); process.exit(1); });
