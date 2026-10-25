// 微信悦读 · 网站脚本（无第三方依赖）
(function () {
  "use strict";

  var toggle = document.querySelector(".nav-toggle");
  var nav = document.querySelector(".site-nav");
  if (!toggle || !nav) return;

  toggle.addEventListener("click", function () {
    var open = nav.classList.toggle("open");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  });

  // 点击导航项后自动收起（移动端）
  nav.addEventListener("click", function (e) {
    if (e.target.tagName === "A" && nav.classList.contains("open")) {
      nav.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
    }
  });
})();

// 图片灯箱：点击图库缩略图 / 小程序码按钮看大图（零依赖，Esc / 点背景 / 点关闭按钮退出）
(function () {
  "use strict";

  var links = document.querySelectorAll("a.wre-gal-link");
  if (!links.length) return;

  var box = document.createElement("div");
  box.className = "wre-lightbox";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");

  var img = document.createElement("img");
  img.alt = "";

  var cap = document.createElement("p");
  cap.className = "wre-lb-cap";

  var close = document.createElement("button");
  close.className = "wre-lb-close";
  close.type = "button";
  close.setAttribute("aria-label", "关闭");
  close.textContent = "\u00d7";

  box.appendChild(img);
  box.appendChild(cap);
  box.appendChild(close);
  document.body.appendChild(box);

  function open(src, text) {
    img.src = src;
    cap.textContent = text || "";
    cap.style.display = text ? "" : "none";
    box.classList.add("open");
    document.body.classList.add("wre-lb-open");
  }

  function closeBox() {
    box.classList.remove("open");
    document.body.classList.remove("wre-lb-open");
    img.removeAttribute("src");
  }

  links.forEach(function (a) {
    a.addEventListener("click", function (e) {
      e.preventDefault();
      open(a.getAttribute("data-full") || a.getAttribute("href"),
           a.getAttribute("data-cap") || a.getAttribute("title") || "");
    });
  });

  close.addEventListener("click", function (e) {
    e.stopPropagation();
    closeBox();
  });
  box.addEventListener("click", function (e) {
    if (e.target === box) closeBox();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && box.classList.contains("open")) closeBox();
  });
})();

// 悬停预览：鼠标移到带 data-hover 的按钮上，自动浮出大图（目前用于首页「微信小程序」弹出小程序码）
// 触屏 / 无悬停设备不启用；点按钮仍走上面的灯箱看大图
(function () {
  "use strict";

  var links = document.querySelectorAll("a[data-hover]");
  if (!links.length) return;
  if (window.matchMedia && !window.matchMedia("(hover: hover)").matches) return;

  var card = document.createElement("div");
  card.className = "wre-hover-card";

  var img = document.createElement("img");
  img.alt = "";

  var cap = document.createElement("p");
  cap.className = "wre-hover-cap";

  card.appendChild(img);
  card.appendChild(cap);
  document.body.appendChild(card);

  var shown = false;

  function show(a) {
    if (!img.getAttribute("src")) img.src = a.getAttribute("data-full") || a.getAttribute("href");
    var text = a.getAttribute("data-cap") || a.getAttribute("title") || "";
    cap.textContent = text;
    cap.style.display = text ? "" : "none";

    // 卡片常驻布局（opacity:0），故此处能量到宽度；先定位再显示，避免闪一下
    var r = a.getBoundingClientRect();
    var w = card.offsetWidth;
    var left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8));
    card.style.left = (left + window.pageXOffset) + "px";
    card.style.top = (r.bottom + window.pageYOffset + 10) + "px";
    card.classList.add("open");
    shown = true;
  }

  function hide() {
    if (!shown) return;
    card.classList.remove("open");
    shown = false;
  }

  links.forEach(function (a) {
    a.addEventListener("mouseenter", function () { show(a); });
    a.addEventListener("mouseleave", hide);
    a.addEventListener("focus", function () { show(a); });
    a.addEventListener("blur", hide);
    a.addEventListener("click", hide);
  });
  window.addEventListener("resize", hide);
})();

// 滚动渐入：元素进入视口时加 .wre-in 触发渐入 + 轻微上移（原生 IntersectionObserver）
// 尊重 prefers-reduced-motion：用户关闭动效时直接显示，不做位移；JS 关闭时由 <noscript> 兜底
(function () {
  "use strict";

  var els = document.querySelectorAll(".wre-reveal");
  if (!els.length) return;

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || !("IntersectionObserver" in window)) {
    els.forEach(function (el) { el.classList.add("wre-in"); });
    return;
  }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add("wre-in");
        io.unobserve(entry.target);
      }
    });
  }, { rootMargin: "0px 0px -6% 0px", threshold: 0.06 });

  els.forEach(function (el) { io.observe(el); });
})();

// 顶栏账户入口：已登录（本机存有昵称）显示用户名，未登录才显示「需要登录」
// 登录态与网页版（/app/）、「我的账户」（/account/）共用同一 localStorage 键（wre_account_profile）
(function () {
  "use strict";

  var link = document.querySelector("[data-wre-account-link]");
  if (!link) return;

  function readNickName() {
    try {
      var raw = localStorage.getItem("wre_account_profile");
      var profile = raw ? JSON.parse(raw) : null;
      var name = profile && typeof profile.nickName === "string" ? profile.nickName.trim() : "";
      return name.slice(0, 24);
    } catch (e) {
      return "";
    }
  }

  function sync() {
    var name = readNickName();
    link.textContent = name || "需要登录";
    link.title = name ? "我的账户" : "登录 / 注册账户";
  }

  sync();
  // 从 /account/ 或 /app/ 登录后回到本站（含浏览器前进后退的缓存恢复）
  window.addEventListener("pageshow", sync);
  window.addEventListener("storage", sync);
})();
