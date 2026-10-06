/**
 * 轻量 UI 工具（零依赖）
 */

/** HTML 转义（所有来自接口/用户的内容都必须过一遍） */
export function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 状态块 HTML：loading / empty / error */
export function stateHtml(kind, text, actionLabel) {
  const icon = kind === 'loading' ? '⏳' : (kind === 'error' ? '⚠️' : '📭');
  const action = actionLabel ? '<button class="wre-btn wre-btn--ghost" data-action="retry">' + esc(actionLabel) + '</button>' : '';
  return '<div class="wre-state wre-state--' + esc(kind) + '">' +
    '<div class="wre-state__icon">' + icon + '</div>' +
    '<div class="wre-state__text">' + esc(text || '') + '</div>' +
    action +
    '</div>';
}

/** 极简 toast */
let toastTimer = null;
export function toast(message) {
  let node = document.getElementById('wreToast');
  if (!node) {
    node = document.createElement('div');
    node.id = 'wreToast';
    node.className = 'wre-toast';
    document.body.appendChild(node);
  }
  node.textContent = String(message || '');
  node.classList.add('is-show');
  if (toastTimer) {
    clearTimeout(toastTimer);
  }
  toastTimer = setTimeout(() => node.classList.remove('is-show'), 2200);
}

/** 复制文本（带降级） */
export async function copyText(text) {
  const value = String(text || '');
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch (e) {
    // 继续走降级
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (e) {
    return false;
  }
}
