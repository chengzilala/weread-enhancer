/**
 * 微信悦读 H5 · 极简 Service Worker（网络优先）
 *
 * 目的：让 H5 可加主屏、断网时用缓存兜底；同时网络优先，
 *      本地开发不会读到旧文件。
 * 仅处理同源 GET：先走网络，成功写缓存并返回；失败回落到缓存，再不行报错。
 * 非 GET / 跨域请求一律交回浏览器，不拦截。
 */

const CACHE = 'wre-h5-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') {
    return;
  }

  let url;
  try {
    url = new URL(request.url);
  } catch (e) {
    return;
  }
  if (url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE)
            .then((cache) => cache.put(request, copy))
            .catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || Response.error()))
  );
});
