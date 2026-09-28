/* Writing-page interactions live here while app.js is migrated incrementally. */
(function (global) {
  'use strict';

  const dashboard = document.getElementById('dashboard');
  const toggle = document.getElementById('writing-log-toggle');
  const close = document.getElementById('writing-log-close');
  if (!dashboard || !toggle) return;

  function setRuntimeDetailsOpen(open) {
    const next = Boolean(open);
    dashboard.classList.toggle('writing-events-open', next);
    toggle.setAttribute('aria-expanded', next ? 'true' : 'false');
    toggle.textContent = next ? '收起详情' : '运行详情';
  }

  toggle.addEventListener('click', () => {
    setRuntimeDetailsOpen(!dashboard.classList.contains('writing-events-open'));
  });
  close?.addEventListener('click', () => setRuntimeDetailsOpen(false));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && dashboard.classList.contains('writing-events-open')) {
      setRuntimeDetailsOpen(false);
    }
  });

  global.WritingView = Object.freeze({
    closeRuntimeDetails: () => setRuntimeDetailsOpen(false),
    setRuntimeDetailsOpen,
  });
}(window));
