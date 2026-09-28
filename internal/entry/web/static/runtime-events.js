/* SSE events and streaming output for the writing workspace. */
(function (global) {
  'use strict';

  const core = global.AINovelCore;
  const events = document.getElementById('events');
  const streamView = document.getElementById('stream');
  const MAX_EVENT_ITEMS = 500;
  const MAX_STREAM_ROUNDS = 32;
  const MAX_STREAM_CHARS = 256 * 1024;
  const STREAM_SEPARATOR = '\n\n';
  let streamRounds = [''];
  let streamChars = 0;
  let pendingStreamText = '';
  let streamNeedsRebuild = false;
  let streamRenderFrame = 0;
  let streamAutoFollow = true;
  let eventSource = null;
  let streamSource = null;
  let eventReconnectTimer = 0;
  let streamReconnectTimer = 0;
  let onRefresh = () => {};

  function esc(value) {
    if (core?.esc) return core.esc(value);
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character]));
  }

  async function api(path, options = {}) {
    if (core?.api) return core.api(path, options);
    const response = await fetch(path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || (body.code !== undefined && body.code !== 0)) {
      throw new Error(body.msg || body.error || response.statusText || `HTTP ${response.status}`);
    }
    return body.data !== undefined ? body.data : body;
  }

  function isNearBottom(element, threshold = 72) {
    if (!element) return true;
    return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold;
  }

  function appendEvent(event, scroll = true) {
    if (!events) return;
    const follow = scroll && isNearBottom(events);
    const element = document.createElement('div');
    element.className = event.Level === 'error' ? 'event-error' : event.Level === 'warn' ? 'event-warn' : '';
    element.innerHTML = `<span class="event-time">${esc(new Date(event.Time || event.time || Date.now()).toLocaleTimeString())}</span><strong>${esc(event.Category || event.category || 'EVENT')}</strong> ${esc(event.Summary || event.summary || event.Detail || event.detail || '')}`;
    events.appendChild(element);
    while (events.childElementCount > MAX_EVENT_ITEMS) events.firstElementChild.remove();
    if (follow) events.scrollTop = events.scrollHeight;
  }

  function trimStreamHistory() {
    while (streamRounds.length > MAX_STREAM_ROUNDS) {
      streamChars -= streamRounds.shift().length;
      streamNeedsRebuild = true;
    }
    while (streamChars > MAX_STREAM_CHARS && streamRounds.length > 1) {
      streamChars -= streamRounds.shift().length;
      streamNeedsRebuild = true;
    }
    if (streamChars > MAX_STREAM_CHARS) {
      streamRounds[0] = streamRounds[0].slice(-MAX_STREAM_CHARS);
      streamChars = streamRounds[0].length;
      streamNeedsRebuild = true;
    }
  }

  function queueStreamPayload(payload = {}) {
    if (payload.clear) {
      streamRounds.push('');
      pendingStreamText += STREAM_SEPARATOR;
    } else {
      const kind = String(payload.kind || '');
      const delta = kind === 'tool' && payload.tool
        ? `\n${String(payload.tool)}\n`
        : String(payload.delta || payload.text || '');
      if (!delta) return;
      streamRounds[streamRounds.length - 1] += delta;
      streamChars += delta.length;
      pendingStreamText += delta;
    }
    trimStreamHistory();
    if (!streamRenderFrame) {
      streamRenderFrame = window.requestAnimationFrame(() => {
        streamRenderFrame = 0;
        renderPendingStream();
      });
    }
  }

  function renderPendingStream() {
    if (!streamView || (!pendingStreamText && !streamNeedsRebuild)) return;
    if (streamNeedsRebuild) {
      streamView.textContent = streamRounds.join(STREAM_SEPARATOR);
    } else if (pendingStreamText) {
      let textNode = streamView.firstChild;
      if (!textNode) {
        textNode = document.createTextNode('');
        streamView.appendChild(textNode);
      }
      if (textNode.nodeType === Node.TEXT_NODE && !textNode.nextSibling) {
        textNode.appendData(pendingStreamText);
      } else {
        streamView.textContent = streamRounds.join(STREAM_SEPARATOR);
      }
    }
    pendingStreamText = '';
    streamNeedsRebuild = false;
    if (streamAutoFollow) streamView.scrollTop = streamView.scrollHeight;
  }

  function flushStreamRender() {
    if (streamRenderFrame) window.cancelAnimationFrame(streamRenderFrame);
    streamRenderFrame = 0;
    renderPendingStream();
  }

  async function replay() {
    try {
      const items = await api('/api/v2/replay');
      for (const item of items || []) {
        if (item.kind === 'ui_event') appendEvent({ Time: item.time, Category: item.category, Summary: item.summary }, false);
        if (item.kind === 'stream_clear') queueStreamPayload({ clear: true });
        if (item.kind === 'stream_delta') queueStreamPayload(item.payload || {});
      }
      if (events) events.scrollTop = events.scrollHeight;
      flushStreamRender();
    } catch (_) { /* Replay is optional after startup or a workspace switch. */ }
  }

  function connectEvents() {
    window.clearTimeout(eventReconnectTimer);
    eventSource?.close();
    const source = new EventSource('/api/v2/events');
    eventSource = source;
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        appendEvent(payload);
        const category = (payload.type || payload.Type || payload.Category || '').toString();
        if (category.startsWith('image.job')) {
          global.ComfyUI?.onJobEvent(payload.data || payload.Payload || payload);
          if (category === 'image.job.completed') global.WorkbenchShell?.refreshNovelImages?.();
        }
      } catch (_) { /* Keep the event stream alive when one payload is malformed. */ }
      onRefresh();
    };
    source.onerror = () => {
      if (eventSource !== source) return;
      source.close();
      eventSource = null;
      eventReconnectTimer = window.setTimeout(connectEvents, 2500);
    };
  }

  function connectStream() {
    window.clearTimeout(streamReconnectTimer);
    streamSource?.close();
    const source = new EventSource('/api/v2/stream');
    streamSource = source;
    source.onmessage = (event) => {
      try { queueStreamPayload(JSON.parse(event.data)); }
      catch (_) { /* Keep the stream alive when one delta is malformed. */ }
    };
    source.onerror = () => {
      if (streamSource !== source) return;
      source.close();
      streamSource = null;
      streamReconnectTimer = window.setTimeout(connectStream, 2500);
    };
  }

  function connect(options = {}) {
    if (typeof options.onRefresh === 'function') onRefresh = options.onRefresh;
    connectEvents();
    connectStream();
  }

  function reset(options = {}) {
    if (events) events.innerHTML = '';
    streamRounds = [''];
    streamChars = 0;
    pendingStreamText = '';
    streamNeedsRebuild = true;
    flushStreamRender();
    connect(options);
  }

  function dispose() {
    eventSource?.close();
    streamSource?.close();
    eventSource = null;
    streamSource = null;
    window.clearTimeout(eventReconnectTimer);
    window.clearTimeout(streamReconnectTimer);
  }

  streamView?.addEventListener('scroll', () => {
    streamAutoFollow = isNearBottom(streamView);
  }, { passive: true });

  global.WritingRuntime = Object.freeze({
    appendEvent,
    connect,
    dispose,
    flushStreamRender,
    replay,
    reset,
  });
}(window));
