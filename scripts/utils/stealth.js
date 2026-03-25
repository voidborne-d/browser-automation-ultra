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
  // 真实 Chrome 有完整的 chrome.runtime，无扩展时也存在基础结构
  // 反爬脚本常检查 chrome.runtime 是否存在且功能完整
  if (!window.chrome) {
    window.chrome = {};
  }
  if (!window.chrome.runtime) {
    // 模拟真实 Chrome 的 runtime 对象（无扩展安装时的状态）
    const runtime = {
      // 标准属性
      id: undefined,
      
      // 标准方法 — 返回 undefined 或抛出标准错误
      connect: function() {
        throw new Error('Could not establish connection. Receiving end does not exist.');
      },
      sendMessage: function() {
        throw new Error('Could not establish connection. Receiving end does not exist.');
      },
      getURL: function(path) { return ''; },
      getManifest: function() { return undefined; },
      
      // 事件对象（最常被检测）
      onConnect: {
        addListener: function() {},
        removeListener: function() {},
        hasListener: function() { return false; },
      },
      onMessage: {
        addListener: function() {},
        removeListener: function() {},
        hasListener: function() { return false; },
      },
      onInstalled: {
        addListener: function() {},
        removeListener: function() {},
        hasListener: function() { return false; },
      },
    };
    
    // 让所有方法的 toString 看起来像原生代码
    const nativeToString = 'function () { [native code] }';
    for (const key of Object.keys(runtime)) {
      if (typeof runtime[key] === 'function') {
        runtime[key].toString = () => nativeToString;
      }
    }
    
    window.chrome.runtime = runtime;
  }
  
  // 确保 chrome.csi 和 chrome.loadTimes 存在（真实 Chrome 有这些）
  if (!window.chrome.csi) {
    window.chrome.csi = function() {
      return {
        startE: Date.now(),
        onloadT: Date.now(),
        pageT: Math.random() * 1000 + 500,
        tran: 15,
      };
    };
  }
  if (!window.chrome.loadTimes) {
    window.chrome.loadTimes = function() {
      return {
        commitLoadTime: Date.now() / 1000,
        connectionInfo: 'h2',
        finishDocumentLoadTime: Date.now() / 1000,
        finishLoadTime: Date.now() / 1000,
        firstPaintAfterLoadTime: 0,
        firstPaintTime: Date.now() / 1000,
        navigationType: 'Other',
        npnNegotiatedProtocol: 'h2',
        requestTime: Date.now() / 1000 - 0.5,
        startLoadTime: Date.now() / 1000 - 0.5,
        wasAlternateProtocolAvailable: false,
        wasFetchedViaSpdy: true,
        wasNpnNegotiated: true,
      };
    };
  }

  // ═══ 7. 修复 iframe contentWindow ═══
  // 防止通过 iframe 检测 toString() 被篡改
  // (保持原生 toString 行为)

  // ═══ 8. 防止 console.debug 检测 ═══
  // 某些站点通过 console.debug 检测 CDP 是否已连接
  // CDP 的 Runtime.enable 会影响 console 行为
  // 这里不做处理，因为可能干扰正常调试

  // ═══ 9. 修复 connection 信息 ═══
  // rtt=0 是自动化环境的典型特征，真实用户通常 50-300ms
  // 即使移除了 --disable-background-networking，初始值可能仍为 0
  if (navigator.connection) {
    const originalRtt = navigator.connection.rtt;
    if (originalRtt === 0 || originalRtt === undefined) {
      try {
        Object.defineProperty(navigator.connection, 'rtt', {
          get: () => 50 + Math.floor(Math.random() * 100), // 50-150ms
          configurable: true,
          enumerable: true,
        });
      } catch (e) {}
    }
    // downlink=10 固定值也可疑，加点抖动
    const originalDownlink = navigator.connection.downlink;
    if (originalDownlink === 10) {
      try {
        Object.defineProperty(navigator.connection, 'downlink', {
          get: () => 5 + Math.random() * 10, // 5-15 Mbps
          configurable: true,
          enumerable: true,
        });
      } catch (e) {}
    }
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
