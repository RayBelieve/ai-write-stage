/* Shared workbench navigation, export menu, and image browser shell. */
(function (global) {
  'use strict';

  const core = global.AINovelCore;
  const $ = (id) => document.getElementById(id);
  const deps = { api: null, notify: () => {} };

  function esc(value) {
    if (core?.esc) return core.esc(value);
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character]));
  }
  async function api(path, options = {}) {
    if (deps.api) return deps.api(path, options);
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
  function configure(options = {}) {
    if (options.api) deps.api = options.api;
    if (options.notify) deps.notify = options.notify;
  }

  function showView(name) {
    if (!name) return;
    document.body.dataset.view = name;
    global.WritingView?.closeRuntimeDetails?.();
    document.querySelectorAll('.view').forEach((view) => view.classList.toggle('active-view', view.id === name));
    document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.view === name));
    if (name === 'galgame') global.Galgame?.load();
    if (name === 'api-settings') global.ModelSettings?.load();
    if (name === 'app-settings') global.Settings?.load();
    if (name === 'prompts') global.Prompts?.load();
    if (name === 'image-generation') global.ImageGeneration?.load();
  }

  function closeExportMenu() {
    const menu = $('export-options');
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    $('export-open')?.setAttribute('aria-expanded', 'false');
  }
  function toggleExportMenu() {
    const menu = $('export-options');
    const button = $('export-open');
    if (!menu || !button || button.disabled) return;
    menu.hidden = !menu.hidden;
    button.setAttribute('aria-expanded', menu.hidden ? 'false' : 'true');
  }
  async function exportBook(format) {
    const kind = format === 'txt' ? 'txt' : 'epub';
    const button = $('export-open');
    closeExportMenu();
    if (button) button.disabled = true;
    try {
      const response = await fetch('/api/v2/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: kind }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.msg || response.statusText || `HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const encodedName = response.headers.get('Content-Disposition')?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      link.download = encodedName
        ? decodeURIComponent(encodedName.replace(/\+/g, ' '))
        : (kind === 'txt' ? 'novel.txt' : 'novel.epub');
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      deps.notify(kind === 'txt' ? 'TXT 已导出。' : 'EPUB 已导出，可在手机阅读器中打开。', 'toast', 'success');
    } catch (error) {
      deps.notify(`导出失败：${error.message}`, 'toast', 'error');
    } finally {
      if (button) button.disabled = false;
    }
  }

  function isCompletedNovelImage(job = {}) {
    const scene = String(job.scene || '');
    const trigger = String(job.trigger || '');
    const status = String(job.status || '');
    return (scene === 'novel' || trigger === 'unit')
      && status === 'completed' && Number(job.chapter || 0) > 0 && Number(job.ordinal || 0) > 0;
  }
  function collectNovelImages(jobs = []) {
    const latest = new Map();
    for (const job of Array.isArray(jobs) ? jobs : []) {
      if (!isCompletedNovelImage(job)) continue;
      latest.set(`${job.chapter}:${job.ordinal}`, job);
    }
    return [...latest.values()].sort((a, b) => (a.chapter - b.chapter) || (a.ordinal - b.ordinal));
  }
  function imageKey(job) {
    return `${Number(job.chapter)}:${Number(job.ordinal)}`;
  }
  function unitImageSrc(job) {
    const src = `/api/v2/units/${encodeURIComponent(job.chapter)}/${encodeURIComponent(job.ordinal)}/image`;
    const version = String(job.job_id || '');
    return version ? `${src}?v=${encodeURIComponent(version)}` : src;
  }
  function renderImageBrowser(jobs) {
    const list = $('image-browser-list');
    if (!list) return;
    const images = collectNovelImages(jobs);
    const signature = images.map((job) => `${imageKey(job)}:${job.job_id || ''}`).join('|');
    if (list.dataset.signature === signature) return;
    const keepOffset = list.dataset.signature !== undefined;
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight <= 80;
    const scrollTop = list.scrollTop;
    list.dataset.signature = signature;
    if (!images.length) {
      list.replaceChildren();
      const empty = document.createElement('p');
      empty.className = 'image-browser-empty';
      empty.textContent = '暂无已生成图片';
      list.appendChild(empty);
      return;
    }
    const existing = new Map();
    list.querySelectorAll('.image-browser-item').forEach((item) => existing.set(item.dataset.key, item));
    const next = document.createDocumentFragment();
    images.forEach((job) => {
      const key = imageKey(job);
      const src = unitImageSrc(job);
      const label = `第 ${job.chapter} 章 · 第 ${job.ordinal} 节`;
      let item = existing.get(key);
      if (!item) {
        item = document.createElement('figure');
        item.className = 'image-browser-item';
        item.dataset.key = key;
        const image = document.createElement('img');
        image.alt = label;
        image.decoding = 'async';
        const caption = document.createElement('figcaption');
        item.append(image, caption);
      }
      item.dataset.src = src;
      const image = item.querySelector('img');
      if (image.getAttribute('src') !== src) image.src = src;
      image.alt = label;
      item.querySelector('figcaption').textContent = label;
      next.appendChild(item);
    });
    list.replaceChildren(next);
    const restoreScroll = () => {
      if (keepOffset && nearBottom) list.scrollTop = list.scrollHeight;
      else list.scrollTop = scrollTop;
    };
    restoreScroll();
    if (keepOffset && nearBottom) {
      list.querySelectorAll('img').forEach((image) => {
        if (!image.complete) image.addEventListener('load', restoreScroll, { once: true });
      });
    }
  }
  function closeImageLightbox() {
    const lightbox = $('image-lightbox');
    const image = $('image-lightbox-img');
    if (lightbox) lightbox.hidden = true;
    if (image) image.removeAttribute('src');
  }
  function openImageLightbox(src) {
    const lightbox = $('image-lightbox');
    const image = $('image-lightbox-img');
    if (!lightbox || !image || !src) return;
    image.src = src;
    lightbox.hidden = false;
  }
  function closeImageBrowser() {
    closeImageLightbox();
  }
  let novelImagesRequest = 0;
  async function openImageBrowser() {
    const list = $('image-browser-list');
    if (!list || document.body.dataset.imageNovelEnabled !== 'true') return;
    const request = ++novelImagesRequest;
    const hadImages = list.querySelector('.image-browser-item');
    if (!hadImages) {
      delete list.dataset.signature;
      list.replaceChildren();
      const loading = document.createElement('p');
      loading.className = 'image-browser-empty';
      loading.textContent = '正在加载图片...';
      list.appendChild(loading);
    }
    try {
      const jobs = await api('/api/v2/image-jobs');
      if (request !== novelImagesRequest) return;
      renderImageBrowser(jobs);
    } catch (error) {
      if (request !== novelImagesRequest) return;
      list.innerHTML = `<p class="image-browser-empty">${esc(error.message || '图片列表加载失败')}</p>`;
    }
  }

  document.querySelectorAll('.tab[data-view]').forEach((tab) => {
    tab.onclick = () => showView(tab.dataset.view);
  });
  $('export-open')?.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleExportMenu();
  });
  document.querySelectorAll('[data-export]').forEach((element) => {
    element.addEventListener('click', (event) => {
      event.stopPropagation();
      exportBook(element.getAttribute('data-export'));
    });
  });
  $('image-browser-list')?.addEventListener('click', (event) => {
    const item = event.target.closest('.image-browser-item');
    if (!item || !$('image-browser-list').contains(item)) return;
    event.stopPropagation();
    openImageLightbox(item.dataset.src);
  });
  $('image-lightbox')?.addEventListener('click', (event) => {
    if (event.target.id !== 'image-lightbox-img') closeImageLightbox();
  });
  document.addEventListener('click', (event) => {
    const exportMenu = $('export-menu');
    if (exportMenu && !exportMenu.contains(event.target)) closeExportMenu();
    const switcher = $('workspace-switcher');
    if (switcher && !switcher.contains(event.target)) global.WritingWorkspace?.closeMenu?.();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if ($('image-lightbox') && !$('image-lightbox').hidden) {
      closeImageLightbox();
      return;
    }
    global.WritingCommands?.closeReview?.();
    closeExportMenu();
    global.WritingWorkspace?.closeMenu?.();
  });

  new MutationObserver(openImageBrowser).observe(document.body, { attributes: true, attributeFilter: ['data-image-novel-enabled'] });
  openImageBrowser();

  global.WorkbenchShell = Object.freeze({
    closeExportMenu,
    closeImageBrowser,
    configure,
    exportBook,
    openImageBrowser,
    refreshNovelImages: openImageBrowser,
    showView,
    toggleExportMenu,
  });
}(window));
