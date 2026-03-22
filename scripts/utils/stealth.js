/**
 * stealth.js — CDP 连接反指纹检测模块
 * 
 * 用于 connectOverCDP 场景：OpenClaw 启动的真实 Chrome + Playwright CDP 遥控
 * 真实 Chrome 的基础指纹（UA/WebGL/Canvas/字体）已经是干净的，
 * 这里只处理 CDP 连接本身暴露的痕迹。
 * 
 * Usage:
 *   const { applyStealthToPage, applyStealthToContext } = require('./utils/stealth');
 *   // 方式1: 对单个 page
 *   const page = await context.newPage();
 *   await applyStealthToPage(page);
 *   // 方式2: 对 context（自动应用到所有新 page）
 *   await applyStealthToContext(context);
 */

/**
 * 核心 stealth 脚本，通过 addInitScript 在页面加载前注入
 * 在 document 的 JS 执行之前运行，所以网站的检测脚本看到的是已修改的值
 */
const STEALTH_INIT_SCRIPT = `
(() => {
  // ═══ 1. 移除 navigator.webdriver 标记 ═══
  // CDP 连接可能将其设为 true，这是最常见的检测点
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
    configurable: true,
  });

  // ═══ 2. 修复 navigator.plugins ═══
  // 真实 Chrome 有插件，自动化环境可能为空
  // 只在 plugins 为空时伪造（真实 Chrome 通常已有插件）
  if (navigator.plugins.length === 0) {
    const fakePluginData = [
      { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
      { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
    ];
    
    const fakePlugins = {
      length: fakePluginData.length,
      item: (i) => fakePluginData[i] || null,
      namedItem: (name) => fakePluginData.find(p => p.name === name) || null,
      refresh: () => {},
      [Symbol.iterator]: function* () {
        for (const p of fakePluginData) yield p;
      },
    };
    
    // 给每个 plugin 添加数字索引
    fakePluginData.forEach((p, i) => {
      fakePlugins[i] = p;
    });
    
    Object.defineProperty(navigator, 'plugins', {
      get: () => fakePlugins,
      configurable: true,
    });
  }

  // ═══ 3. 修复 navigator.languages ═══
  // 确保 languages 不为空（某些自动化环境下可能丢失）
  if (!navigator.languages || navigator.languages.length === 0) {
    Object.defineProperty(navigator, 'languages', {
      get: () => ['zh-CN', 'zh', 'en-US', 'en'],
      configurable: true,
    });
  }

  // ═══ 4. 修复 permissions API ═══
  // 真实浏览器的 Notification permission 是 'default'，
  // 自动化环境可能返回异常值
  const originalQuery = window.Permissions?.prototype?.query;
  if (originalQuery) {
    window.Permissions.prototype.query = function(parameters) {
      if (parameters.name === 'notifications') {
        return Promise.resolve({ state: Notification.permission });
      }
      return originalQuery.call(this, parameters);
    };
  }

  // ═══ 5. 清理 Playwright / CDP 特征变量 ═══
  // 删除可能的 Playwright 内部标记
  const playwrightKeys = [
    '__playwright',
    '__pw_manual',
    '__PW_inspect',
  ];
  for (const key of playwrightKeys) {
    try {
      if (key in window) {
        delete window[key];
      }
    } catch (e) {}
  }

  // 清理 ChromeDriver 特征变量（以 cdc_ 开头）
  for (const key of Object.keys(window)) {
    if (key.startsWith('cdc_') || key.startsWith('$cdc_')) {
      try { delete window[key]; } catch (e) {}
    }
  }

  // ═══ 6. 修复 chrome.runtime ═══
  // 真实 Chrome 有 chrome.runtime，某些检测会检查其存在性
  if (!window.chrome) {
    window.chrome = {};
  }
  if (!window.chrome.runtime) {
    window.chrome.runtime = {
      connect: () => {},
      sendMessage: () => {},
      id: undefined,
    };
  }

  // ═══ 7. 修复 iframe contentWindow ═══
  // 防止通过 iframe 检测 toString() 被篡改
  // (保持原生 toString 行为)

  // ═══ 8. 防止 console.debug 检测 ═══
  // 某些站点通过 console.debug 检测 CDP 是否已连接
  // CDP 的 Runtime.enable 会影响 console 行为
  // 这里不做处理，因为可能干扰正常调试

  // ═══ 9. 伪造 connection 信息 ═══
  // 让 navigator.connection 看起来像正常用户
  if (navigator.connection) {
    try {
      Object.defineProperty(navigator.connection, 'rtt', {
        get: () => 50 + Math.floor(Math.random() * 100), // 50-150ms
        configurable: true,
      });
    } catch (e) {}
  }

  // ═══ 10. WebGL vendor/renderer ═══
  // 真实 Chrome 已经有正确的值，这里只做兜底
  const getParameter = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function(parameter) {
    // UNMASKED_VENDOR_WEBGL
    if (parameter === 37445) {
      const result = getParameter.call(this, parameter);
      return result || 'Google Inc. (Apple)';
    }
    // UNMASKED_RENDERER_WEBGL
    if (parameter === 37446) {
      const result = getParameter.call(this, parameter);
      return result || 'ANGLE (Apple, Apple M1, OpenGL 4.1)';
    }
    return getParameter.call(this, parameter);
  };
})();
`;

/**
 * 对单个 page 应用 stealth
 * 必须在 page.goto() 之前调用
 * @param {import('playwright').Page} page
 */
async function applyStealthToPage(page) {
  await page.addInitScript(STEALTH_INIT_SCRIPT);
  
  // 通过 CDP 直接移除 webdriver 标记（双保险）
  try {
    const client = await page.context().newCDPSession(page);
    await client.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `Object.defineProperty(navigator, 'webdriver', { get: () => undefined });`,
    });
    // 移除 automation controlled 标记
    await client.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        // 移除 window.navigator.webdriver
        delete Object.getPrototypeOf(navigator).webdriver;
      `,
    });
  } catch (e) {
    // CDP session 创建失败不影响主流程
    // addInitScript 已经覆盖了基本场景
  }
}

/**
 * 对整个 context 应用 stealth
 * 所有该 context 下新建的 page 都会自动注入
 * @param {import('playwright').BrowserContext} context
 */
async function applyStealthToContext(context) {
  await context.addInitScript(STEALTH_INIT_SCRIPT);
}

/**
 * 验证 stealth 是否生效（调试用）
 * @param {import('playwright').Page} page
 * @returns {object} 检测结果
 */
async function verifyStealthStatus(page) {
  return await page.evaluate(() => {
    return {
      webdriver: navigator.webdriver,
      webdriverDefined: 'webdriver' in navigator,
      pluginCount: navigator.plugins.length,
      languages: navigator.languages,
      chrome: !!window.chrome,
      chromeRuntime: !!window.chrome?.runtime,
      playwrightGlobals: ['__playwright', '__pw_manual', '__PW_inspect']
        .filter(k => k in window),
      cdcKeys: Object.keys(window).filter(k => k.startsWith('cdc_')),
    };
  });
}

module.exports = {
  applyStealthToPage,
  applyStealthToContext,
  verifyStealthStatus,
  STEALTH_INIT_SCRIPT,
};
