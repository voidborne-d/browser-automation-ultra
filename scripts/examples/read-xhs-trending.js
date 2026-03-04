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

function getCdpUrl() {
  const port = process.env.CDP_PORT || '18800';
  return `http://127.0.0.1:${port}`;
}

function log(msg) { console.error(`[XHS-TRENDING] ${msg}`); }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  let browser;
  try {
    browser = await chromium.connectOverCDP(getCdpUrl());
  } catch (e) {
    log(`CDP connection failed: ${e.message}`);
    process.exit(1);
  }

  const context = browser.contexts()[0];
  const page = await context.newPage();

  try {
    log('Navigating to explore page...');
    await page.goto('https://www.xiaohongshu.com/explore', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(2000 + Math.random() * 1000);

    // Click search box to trigger trending dropdown
    log('Clicking search box...');
    const searchInput = page.locator('#search-input');
    await searchInput.click();
    await sleep(1500 + Math.random() * 1000);

    // Extract trending items
    const items = await page.evaluate(() => {
      const nodes = document.querySelectorAll('.sug-item.query-trending');
      return Array.from(nodes).map((el, i) => ({
        index: i + 1,
        text: el.textContent.trim()
      }));
    });

    log(`Found ${items.length} trending topics`);
    console.log(JSON.stringify(items, null, 2));

  } finally {
    await page.close();
  }
}

main().then(() => process.exit(0)).catch(e => {
  log(`Error: ${e.message}`);
  process.exit(1);
});
