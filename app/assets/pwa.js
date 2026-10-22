/**
 * 微信悦读 H5 · PWA 注册脚本
 *
 * 仅在 https / localhost 下注册 Service Worker（其余环境静默跳过）。
 * 注册失败一律静默：不影响页面正常使用。
 */
(function () {
  if (!('serviceWorker' in navigator)) {
    return;
  }
  var loc = window.location;
  var isSecure = loc.protocol === 'https:' ||
    loc.hostname === 'localhost' ||
    loc.hostname === '127.0.0.1';
  if (!isSecure) {
    return;
  }
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('./sw.js').catch(function () {
      // 注册失败静默处理
    });
  });
})();
