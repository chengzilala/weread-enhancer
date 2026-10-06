/**
 * 匿名使用统计（移动端 M13「插件使用量」的数据来源 · 插件侧）
 *
 * 只做一件事：插件启动时，若当天还没报过，向自建云函数上报一次「活跃」事件。
 *
 * 上报内容（白名单，最小化）：
 *   ① 随机匿名标识（本机生成一次、纯随机 UUID，不含任何个人信息）
 *   ② 插件版本号  ③ 事件名（active）。日期由服务端按天记录（客户端不传）。
 *
 * 明令禁止上报：阅读数据、wrk- / AI Key、书目、笔记内容、IP、浏览器指纹、微信读书账号。
 *
 * 开关：默认开启；在插件「阅读设置」内可一键关闭（wreState.telemetryEnabled=false），
 *       关闭后不再上报。数据保留 90 天，到期只留聚合计数（云函数负责）。
 *
 * 部署：M13 服务端就绪后，把「云开发控制台 → HTTP 访问服务」里为云函数绑定的访问地址
 *       填到下面 TELEMETRY_ENDPOINT（形如 https://<envId>.service.tcloudbase.com/report）。
 *       留空 = 完全不上报（本模块静默跳过，不影响插件任何功能）。
 */
(function () {
  'use strict';

  // ↓↓↓ 部署后填写：云开发 HTTP 访问服务地址（留空则不上报）
  const TELEMETRY_ENDPOINT = '';
  // ↑↑↑

  const PREFIX = '[Wechat-Reader-Enhancer][telemetry]';
  const WRE_PREFIX = '[Wechat-Reader-Enhancer]';
  const STATE_KEY = 'wreState';
  const ANON_ID_KEY = 'wreTelemetryAnonId';
  const LAST_REPORT_KEY = 'wreTelemetryLastReport';
  const REPORT_DELAY_MS = 3000; // 延后上报，不抢页面加载

  function pad2(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  /** 本机日期 YYYY-MM-DD（仅用于「当天是否已报」，与上报内容无关） */
  function today() {
    const d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /** 纯随机 UUID：优先 crypto，退化到 Math.random；都不含任何个人信息 */
  function randomId() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
      }
      if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
        const bytes = new Uint8Array(16);
        window.crypto.getRandomValues(bytes);
        let out = '';
        for (let i = 0; i < bytes.length; i += 1) {
          out += pad2(bytes[i].toString(16)).slice(-2);
        }
        return out;
      }
    } catch (err) {
      // 落到下面的 Math.random
    }
    let fallback = '';
    for (let i = 0; i < 32; i += 1) {
      fallback += Math.floor(Math.random() * 16).toString(16);
    }
    return fallback;
  }

  function storageGet(keys) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(keys, (res) => resolve(res || {}));
      } catch (err) {
        resolve({});
      }
    });
  }

  function storageSet(obj) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set(obj, () => resolve());
      } catch (err) {
        resolve();
      }
    });
  }

  function extensionVersion() {
    try {
      return chrome.runtime.getManifest().version;
    } catch (err) {
      return '';
    }
  }

  function log(level, message, meta) {
    const printable = meta
      ? WRE_PREFIX + ' ' + PREFIX + ' ' + message + ' ' + JSON.stringify(meta)
      : WRE_PREFIX + ' ' + PREFIX + ' ' + message;
    if (level === 'warn') {
      console.warn(printable);
    } else {
      console.log(printable);
    }
  }

  /**
   * 上报一次「活跃」。每天最多一次；仅在开关开启、且已配置上报地址时进行。
   * 失败静默（不影响使用），下次加载会重试。
   */
  async function reportActive(state) {
    if (!TELEMETRY_ENDPOINT) {
      log('info', '未配置上报地址，跳过匿名统计');
      return;
    }
    const data = await storageGet([STATE_KEY, ANON_ID_KEY, LAST_REPORT_KEY]);
    const effectiveState = state || data[STATE_KEY] || {};
    if (effectiveState.telemetryEnabled === false) {
      log('info', '匿名统计已关闭，不上报');
      return;
    }
    const day = today();
    if (data[LAST_REPORT_KEY] === day) {
      return; // 今天已报过
    }
    let anonId = data[ANON_ID_KEY];
    if (!anonId) {
      anonId = randomId();
      await storageSet({ [ANON_ID_KEY]: anonId });
    }
    const payload = {
      action: 'opsReport',
      anonId: anonId,
      version: extensionVersion(),
      event: 'active',
    };
    let res;
    try {
      // 用 text/plain 走「简单请求」，不触发预检；服务端已配 CORS 头，可读回执
      res = await fetch(TELEMETRY_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      // 网络失败：不记「已报」，下次加载再试
      log('warn', '匿名统计上报失败（网络）', { error: String(err) });
      return;
    }
    // 无论服务端是否接受，都记「今天已报」，避免同一会话反复发送
    await storageSet({ [LAST_REPORT_KEY]: day });
    if (!res || !res.ok) {
      log('warn', '匿名统计上报未成功', { status: res && res.status });
      return;
    }
    log('info', '已上报匿名使用统计', { version: payload.version });
  }

  /** 插件初始化完成后调用（延迟上报，不抢加载） */
  function schedule(state) {
    setTimeout(() => {
      reportActive(state).catch(() => {});
    }, REPORT_DELAY_MS);
  }

  // no-export 的模块：挂到 window 供 content.js 调用
  window.WRETelemetry = { reportActive: reportActive, schedule: schedule };
})();
