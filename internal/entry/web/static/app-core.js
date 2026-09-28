/* Compatibility boundary for the incremental frontend migration. */
(function (global) {
  'use strict';

  const listeners = new Map();
  const state = { value: {}, version: 0 };

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character]));
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || (body.code !== undefined && body.code !== 0)) {
      const error = new Error(body.msg || body.error || response.statusText || `HTTP ${response.status}`);
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body.data !== undefined ? body.data : body;
  }

  function dom(id) { return document.getElementById(id); }
  function query(selector) { return document.querySelector(selector); }
  function notify(message, target = 'toast', kind = '') {
    if (target && target !== 'toast') {
      const inline = dom(target);
      if (inline) {
        inline.textContent = '';
        inline.className = 'notice';
      }
    }
    const toast = dom('toast');
    if (!toast) return;
    const text = String(message || '');
    if (!text) return;
    toast.textContent = text;
    toast.className = `toast ${kind}`.trim();
    clearTimeout(toast._timer);
    void toast.offsetWidth;
    toast.classList.add('toast-pop');
    toast._timer = setTimeout(() => {
      toast.textContent = '';
      toast.className = 'toast';
    }, 4500);
  }
  const commandRoutes = Object.freeze({
    start: '/api/v2/commands/start',
    continue: '/api/v2/commands/continue',
    steer: '/api/v2/commands/steer',
    reopen: '/api/v2/commands/reopen',
    writingRules: '/api/v2/commands/writing-rules',
    pause: '/api/v2/commands/pause',
    abort: '/api/v2/commands/abort',
  });

  function getState() {
    return state.value;
  }

  function setState(next, meta = {}) {
    const previous = state.value;
    state.value = typeof next === 'function' ? next(previous) : { ...previous, ...next };
    state.version += 1;
    emit('state', { previous, current: state.value, meta, version: state.version });
    return state.value;
  }

  function on(name, listener) {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(listener);
    return () => listeners.get(name)?.delete(listener);
  }

  function emit(name, payload) {
    listeners.get(name)?.forEach((listener) => listener(payload));
  }

  global.AINovelCore = Object.freeze({
    api,
    esc,
    dom,
    query,
    notify,
    commandRoutes,
    store: Object.freeze({ getState, setState, on }),
    events: Object.freeze({ on, emit }),
  });
}(window));
