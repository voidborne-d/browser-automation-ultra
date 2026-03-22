#!/usr/bin/env node
/**
 * 小红书热搜抓取脚本
 * Usage: node read-xhs-trending.js
 * 
 * 输出 JSON 数组到 stdout:
 * [{ index, text }]
 * 
 * 原理：打开小红书 explore 页，点击搜索框触发热搜下拉，抓取 .sug-item.query-trending
 */

const { chromium } = require('playwright');
const { humanDelay, humanBrowse, humanScroll, humanClick, humanThink } = require('../utils/human-like');
const { applyStealthToContext } = require('../utils/stealth');

function getCdpUrl() {
  const port = process.env.CDP_PORT || '18800';
  return `http://127.0.0.1:${port}`;
}

function log(msg) { console.error(`[XHS-TRENDING] ${msg}`); }

async function main() {
  let browser;
  try {
    browser = await chromium.connectOverCDP(getCdpUrl());
  } catch (e) {
    log(`CDP connection failed: ${e.message}`);
    process.exit(1);
  }

  const context = browser.contexts()[0];
  await applyStealthToContext(context);
  const page = await context.newPage();

  try {
    log('Navigating to explore page...');
    await page.goto('https://www.xiaohongshu.com/explore', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await humanDelay(2500, 5000);

    // 模拟人类先浏览首页
    await humanBrowse(page, { duration: 3000 });

    // 随机滚动看看内容
    await humanScroll(page, { scrolls: 2, minPause: 800, maxPause: 2000 });
    await humanDelay(1000, 2500);

    // 点击搜索框
    log('Clicking search box...');
    await humanClick(page, '#search-input');
    await humanDelay(1500, 3000);

    // 等热搜加载
    await humanThink(800, 1500);

    // Extract trending items
    const items = await page.evaluate(() => {
      const nodes = document.querySelectorAll('.sug-item.query-trending');
      return Array.from(nodes).map((el, i) => ({
        index: i + 1,
        text: el.textContent.trim()
      }));
    });

    log(`Found ${items.length} trending topics`);

    // 看完热搜停一下再走
    await humanDelay(500, 1500);

    console.log(JSON.stringify(items, null, 2));

  } finally {
    await page.close();
  }
}

main().then(() => process.exit(0)).catch(e => {
  log(`Error: ${e.message}`);
  process.exit(1);
});
