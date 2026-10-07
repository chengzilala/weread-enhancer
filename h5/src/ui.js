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

/** 注入退出确认弹层样式（仅一次；自带样式，官网与网页版共用） */
function ensureDialogStyle() {
  if (document.getElementById('wreDialogStyle')) {
    return;
  }
  const style = document.createElement('style');
  style.id = 'wreDialogStyle';
  style.textContent = [
    '.wre-dialog-overlay{position:fixed;left:0;top:0;right:0;bottom:0;z-index:9999;',
    'background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;}',
    '.wre-dialog{width:100%;max-width:420px;background:#fff;border-radius:14px;padding:20px 20px 16px;',
    'box-shadow:0 18px 50px rgba(0,0,0,.24);box-sizing:border-box;color:#1a1a1a;font-size:15px;line-height:1.6;}',
    '.wre-dialog__title{font-size:17px;font-weight:600;margin-bottom:8px;}',
    '.wre-dialog__text{margin:0 0 14px;color:#555;}',
    '.wre-dialog__code{display:flex;align-items:center;gap:8px;background:#f5f6f8;border-radius:10px;padding:10px 12px;}',
    '.wre-dialog__code code{flex:1;min-width:0;font-family:ui-monospace,Menlo,Consolas,monospace;',
    'font-size:14px;word-break:break-all;color:#1a1a1a;}',
    '.wre-dialog__copy{flex:none;border:0;background:none;color:#2f6bff;font-size:14px;cursor:pointer;padding:4px;}',
    '.wre-dialog__actions{display:flex;justify-content:flex-end;gap:10px;margin-top:18px;}',
    '.wre-dialog__btn{border:0;border-radius:9px;padding:9px 16px;font-size:14px;cursor:pointer;background:#eef0f3;color:#1a1a1a;}',
    '.wre-dialog__btn--danger{background:#1a1a1a;color:#fff;}',
  ].join('');
  document.head.appendChild(style);
}

let activeSignOutDialog = null;

/**
 * 退出登录确认弹层：先把完整账户码摆出来让用户复制/确认已保存，再真正退出。
 * 账户码就是找回账户的唯一凭证，本机退出后不再持有它 —— 所以这一步必须让用户看见。
 * 返回 Promise<boolean>：true = 已保存并确认退出；false = 取消。
 */
export function confirmSignOut(deviceId) {
  const code = String(deviceId || '');
  ensureDialogStyle();
  return new Promise(function (resolve) {
    if (activeSignOutDialog) {
      return; // 已有弹层，忽略重复触发
    }
    const overlay = document.createElement('div');
    overlay.className = 'wre-dialog-overlay';
    overlay.innerHTML =
      '<div class="wre-dialog" role="dialog" aria-modal="true">' +
      '<div class="wre-dialog__title">退出登录</div>' +
      '<p class="wre-dialog__text">退出后本机会变成一个全新账户。请先保存下面的账户码，' +
      '否则将无法再找回本账户的 Key 与昵称（它们仍加密存在服务端）。</p>' +
      '<div class="wre-dialog__code">' +
      '<code>' + esc(code) + '</code>' +
      '<button class="wre-dialog__copy" type="button" data-wre-dlg="copy">复制账户码</button>' +
      '</div>' +
      '<div class="wre-dialog__actions">' +
      '<button class="wre-dialog__btn" type="button" data-wre-dlg="cancel">取消</button>' +
      '<button class="wre-dialog__btn wre-dialog__btn--danger" type="button" data-wre-dlg="confirm">我已保存，退出登录</button>' +
      '</div>' +
      '</div>';

    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(false);
      }
    }

    function close(result) {
      document.removeEventListener('keydown', onKey, true);
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
      activeSignOutDialog = null;
      resolve(result);
    }

    overlay.addEventListener('click', function (e) {
      const btn = e.target.closest ? e.target.closest('[data-wre-dlg]') : null;
      if (!btn) {
        if (e.target === overlay) {
          close(false); // 点遮罩取消
        }
        return;
      }
      const act = btn.getAttribute('data-wre-dlg');
      if (act === 'copy') {
        copyText(code).then(function (ok) {
          btn.textContent = ok ? '已复制' : '复制失败，请手动选择';
        });
      } else if (act === 'cancel') {
        close(false);
      } else if (act === 'confirm') {
        close(true);
      }
    });

    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    activeSignOutDialog = overlay;
  });
}
