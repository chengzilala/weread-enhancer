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

// 图片灯箱：点击图库缩略图看大图（零依赖，Esc / 点背景 / 点关闭按钮退出）
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
      open(a.getAttribute("data-full") || a.getAttribute("href"), a.getAttribute("title") || "");
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
