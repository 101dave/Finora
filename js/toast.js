/** One toast at a time, with an optional action button. */

import { $ } from './dom.js';

let hideTimer = null;

function nodes() {
  return {
    root: $('#toast'),
    message: $('#toastMessage'),
    action: $('#toastAction'),
    close: $('#toastClose'),
  };
}

export function hideToast() {
  const { root, action } = nodes();
  if (!root) return;

  root.hidden = true;
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  if (action) {
    action.hidden = true;
    action.onclick = null;
  }
}

export function toast(message, { actionLabel, onAction, duration = 5200 } = {}) {
  const { root, message: messageNode, action, close } = nodes();
  if (!root || !messageNode) return;

  if (hideTimer) clearTimeout(hideTimer);

  messageNode.textContent = message;

  if (action && actionLabel && onAction) {
    action.hidden = false;
    action.textContent = actionLabel;
    action.onclick = () => {
      hideToast();
      onAction();
    };
  } else if (action) {
    action.hidden = true;
    action.onclick = null;
  }

  if (close) close.onclick = hideToast;

  root.hidden = false;
  hideTimer = setTimeout(hideToast, duration);
}
