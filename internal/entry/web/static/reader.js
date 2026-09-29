/* Immersive reader. Kept independent from the workbench runtime client. */
(() => {
  const LAST_CHAPTER_KEY = 'ainovel.reader.chapter.v1';
  const SCROLL_KEY = 'ainovel.reader.scroll.v1';
  const APPEARANCE_KEY = 'ainovel.reader.appearance.v1';
  const REFRESH_INTERVAL_MS = 10000;
  const FONTS = [
    { id: 'song', label: '宋体', family: "'Songti SC', 'STSong', 'SimSun', 'Source Han Serif SC', Georgia, serif" },
    { id: 'hei', label: '黑体', family: "'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif" },
    { id: 'kai', label: '楷体', family: "'KaiTi', 'STKaiti', 'Kaiti SC', serif" },
    { id: 'fang', label: '仿宋', family: "'FangSong', 'STFangsong', serif" },
    { id: 'system', label: '默认', family: 'var(--ui-font, system-ui, sans-serif)' },
  ];
  const BACKGROUNDS = [
    { label: '纸色', background: '#f3f0e8', color: '#292a26' },
    { label: '白色', background: '#ffffff', color: '#222222' },
    { label: '护眼', background: '#e3f0e4', color: '#243028' },
    { label: '夜间', background: '#1e1e1c', color: '#e6e1d6' },
  ];
  const DEFAULT_APPEARANCE = { font: 'song', fontSize: 18, lineHeight: 2, background: '#f3f0e8', color: '#292a26' };
  let appearance = readAppearance();
  let chapters = [];
  let currentChapter = 0;
  let previousFocus = null;
  let refreshTimer = 0;
  let readerHistoryOwned = false;
  let scrollPositions = loadScrollPositions();

  function request(path) {
    return fetch(path, { headers: { Accept: 'application/json' } })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok || (body.code !== undefined && body.code !== 0)) {
          throw new Error(body.msg || body.error || response.statusText);
        }
        return body.data !== undefined ? body.data : body;
      });
  }

  function loadScrollPositions() {
    try { return JSON.parse(localStorage.getItem(SCROLL_KEY) || '{}'); } catch (_) { return {}; }
  }

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function sanitizeColor(value, fallback) {
    return /^#[0-9a-fA-F]{6}$/.test(String(value || '')) ? String(value).toLowerCase() : fallback;
  }

  function readAppearance() {
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem(APPEARANCE_KEY) || '{}'); } catch (_) { stored = {}; }
    const font = FONTS.some((item) => item.id === stored.font) ? stored.font : DEFAULT_APPEARANCE.font;
    const night = document.documentElement.dataset.theme === 'night';
    const nightPreset = BACKGROUNDS.find((item) => item.label === '夜间');
    const fallbackBackground = night && nightPreset ? nightPreset.background : DEFAULT_APPEARANCE.background;
    const fallbackColor = night && nightPreset ? nightPreset.color : DEFAULT_APPEARANCE.color;
    return {
      font,
      fontSize: clampNumber(stored.fontSize, 14, 32, DEFAULT_APPEARANCE.fontSize),
      lineHeight: Math.round(clampNumber(stored.lineHeight, 1.4, 2.8, DEFAULT_APPEARANCE.lineHeight) * 10) / 10,
      background: sanitizeColor(stored.background, fallbackBackground),
      color: sanitizeColor(stored.color, fallbackColor),
    };
  }

  function saveAppearance() {
    try { localStorage.setItem(APPEARANCE_KEY, JSON.stringify(appearance)); } catch (_) { /* Appearance is optional. */ }
  }

  function isDark(hex) {
    const value = hex.slice(1);
    const red = parseInt(value.slice(0, 2), 16);
    const green = parseInt(value.slice(2, 4), 16);
    const blue = parseInt(value.slice(4, 6), 16);
    return (red * 299 + green * 587 + blue * 114) / 1000 < 140;
  }

  function applyAppearance() {
    const reader = document.getElementById('reader-view');
    if (!reader) return;
    const font = FONTS.find((item) => item.id === appearance.font) || FONTS[0];
    reader.style.setProperty('--reader-font', font.family);
    reader.style.setProperty('--reader-font-size', `${appearance.fontSize}px`);
    reader.style.setProperty('--reader-line-height', String(appearance.lineHeight));
    reader.style.setProperty('--reader-canvas', appearance.background);
    reader.style.setProperty('--reader-ink', appearance.color);
    reader.style.colorScheme = isDark(appearance.background) ? 'dark' : 'light';
    reader.querySelectorAll('[data-reader-font]').forEach((button) => {
      button.classList.toggle('active', button.dataset.readerFont === appearance.font);
      button.setAttribute('aria-pressed', button.dataset.readerFont === appearance.font ? 'true' : 'false');
    });
    reader.querySelectorAll('[data-reader-background]').forEach((button) => {
      const selected = button.dataset.readerBackground === appearance.background && button.dataset.readerColor === appearance.color;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    const fontSize = document.getElementById('reader-font-size');
    const lineHeight = document.getElementById('reader-line-height');
    const background = document.getElementById('reader-background');
    const color = document.getElementById('reader-color');
    if (fontSize) fontSize.value = String(appearance.fontSize);
    if (lineHeight) lineHeight.value = String(appearance.lineHeight);
    if (background) background.value = appearance.background;
    if (color) color.value = appearance.color;
    const fontSizeValue = document.getElementById('reader-font-size-value');
    const lineHeightValue = document.getElementById('reader-line-height-value');
    if (fontSizeValue) fontSizeValue.textContent = String(appearance.fontSize);
    if (lineHeightValue) lineHeightValue.textContent = appearance.lineHeight.toFixed(1);
  }

  function setSettingsOpen(open) {
    const panel = document.getElementById('reader-settings');
    const toggle = document.getElementById('reader-settings-toggle');
    if (!panel || !toggle) return;
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) panel.querySelector('button, input')?.focus();
    else toggle.focus();
  }

  function saveReaderState() {
    if (!currentChapter) return;
    const articlePane = document.getElementById('reader-content-pane');
    scrollPositions[currentChapter] = articlePane?.scrollTop || 0;
    try {
      localStorage.setItem(LAST_CHAPTER_KEY, String(currentChapter));
      localStorage.setItem(SCROLL_KEY, JSON.stringify(scrollPositions));
    } catch (_) { /* Reader state is optional. */ }
  }

  function createReader() {
    const reader = document.createElement('section');
    reader.id = 'reader-view';
    reader.className = 'reader-view';
    reader.hidden = true;
    reader.setAttribute('aria-label', '沉浸式阅读');
    reader.innerHTML = `
      <header class="reader-header">
        <div class="reader-brand"><strong id="reader-novel-name">未命名作品</strong><span id="reader-count"></span></div>
        <div class="reader-tools">
          <button id="reader-settings-toggle" class="reader-tool" type="button" aria-expanded="false" aria-controls="reader-settings">版式</button>
          <button id="reader-close" class="reader-close" type="button" aria-label="关闭沉浸式阅读" title="关闭">×</button>
          <div id="reader-settings" class="reader-settings" hidden>
            <div class="reader-settings-title">阅读版式</div>
            <div class="reader-setting">
              <span>字体</span>
              <div class="reader-font-options" role="group" aria-label="字体">${FONTS.map((font) => `<button type="button" class="reader-font-option" data-reader-font="${font.id}" style="font-family: ${font.family}">${font.label}</button>`).join('')}</div>
            </div>
            <label class="reader-setting" for="reader-font-size">字号 <output id="reader-font-size-value">18</output><input id="reader-font-size" type="range" min="14" max="32" step="1" value="18"></label>
            <label class="reader-setting" for="reader-line-height">行距 <output id="reader-line-height-value">2.0</output><input id="reader-line-height" type="range" min="1.4" max="2.8" step="0.1" value="2"></label>
            <div class="reader-setting">
              <span>背景色</span>
              <div class="reader-swatches">${BACKGROUNDS.map((item) => `<button type="button" class="reader-swatch" data-reader-background="${item.background}" data-reader-color="${item.color}" style="background:${item.background}" title="${item.label}" aria-label="${item.label}"></button>`).join('')}<input id="reader-background" type="color" value="#f3f0e8" aria-label="自定义背景色"></div>
            </div>
            <label class="reader-setting" for="reader-color">字体颜色<input id="reader-color" type="color" value="#292a26"></label>
            <button id="reader-appearance-reset" class="reader-reset" type="button">恢复默认</button>
          </div>
        </div>
      </header>
      <div class="reader-layout">
        <aside class="reader-sidebar" aria-label="正式章节">
          <div class="reader-sidebar-title">章节</div>
          <nav id="reader-chapters" class="reader-chapters"></nav>
        </aside>
        <main id="reader-content-pane" class="reader-content-pane">
          <article class="reader-article">
            <h1 id="reader-title"></h1>
            <div id="reader-content" class="reader-content"><p class="reader-muted">选择章节开始阅读</p></div>
          </article>
        </main>
      </div>`;
    document.body.appendChild(reader);
    document.getElementById('reader-close').addEventListener('click', closeReader);
    document.getElementById('reader-settings-toggle').addEventListener('click', () => {
      setSettingsOpen(document.getElementById('reader-settings').hidden);
    });
    reader.querySelectorAll('[data-reader-font]').forEach((button) => {
      button.addEventListener('click', () => {
        appearance.font = button.dataset.readerFont;
        applyAppearance();
        saveAppearance();
      });
    });
    reader.querySelectorAll('[data-reader-background]').forEach((button) => {
      button.addEventListener('click', () => {
        appearance.background = button.dataset.readerBackground;
        appearance.color = button.dataset.readerColor;
        applyAppearance();
        saveAppearance();
      });
    });
    document.getElementById('reader-font-size').addEventListener('input', (event) => {
      appearance.fontSize = clampNumber(event.target.value, 14, 32, DEFAULT_APPEARANCE.fontSize);
      applyAppearance();
      saveAppearance();
    });
    document.getElementById('reader-line-height').addEventListener('input', (event) => {
      appearance.lineHeight = Math.round(clampNumber(event.target.value, 1.4, 2.8, DEFAULT_APPEARANCE.lineHeight) * 10) / 10;
      applyAppearance();
      saveAppearance();
    });
    document.getElementById('reader-background').addEventListener('input', (event) => {
      appearance.background = sanitizeColor(event.target.value, DEFAULT_APPEARANCE.background);
      applyAppearance();
      saveAppearance();
    });
    document.getElementById('reader-color').addEventListener('input', (event) => {
      appearance.color = sanitizeColor(event.target.value, DEFAULT_APPEARANCE.color);
      applyAppearance();
      saveAppearance();
    });
    document.getElementById('reader-appearance-reset').addEventListener('click', () => {
      appearance = { ...DEFAULT_APPEARANCE };
      applyAppearance();
      saveAppearance();
    });
    document.addEventListener('click', (event) => {
      const panel = document.getElementById('reader-settings');
      const toggle = document.getElementById('reader-settings-toggle');
      if (!panel || panel.hidden || panel.contains(event.target) || toggle.contains(event.target)) return;
      setSettingsOpen(false);
    });
    applyAppearance();
    document.getElementById('reader-content-pane').addEventListener('scroll', debounce(saveReaderState, 150));
  }

  function debounce(fn, delay) {
    let timer = 0;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  function renderChapterList() {
    const host = document.getElementById('reader-chapters');
    host.replaceChildren(...chapters.map((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `reader-chapter${item.chapter === currentChapter ? ' active' : ''}`;
      button.dataset.chapter = String(item.chapter);
      const number = document.createElement('span');
      number.textContent = `第 ${item.chapter} 章`;
      const title = document.createElement('strong');
      title.textContent = item.title || `第 ${item.chapter} 章`;
      button.append(number, title);
      button.addEventListener('click', () => selectChapter(item.chapter, true));
      return button;
    }));
  }

  async function loadChapterList(selectDefault) {
    const data = await request('/api/v2/chapters');
    chapters = Array.isArray(data.chapters) ? data.chapters : [];
    document.getElementById('reader-novel-name').textContent = data.novel_name || '未命名作品';
    document.getElementById('reader-count').textContent = chapters.length ? `${chapters.length} 章` : '';
    renderChapterList();
    if (!chapters.length) {
      currentChapter = 0;
      document.getElementById('reader-title').textContent = '';
      document.getElementById('reader-content').innerHTML = '<p class="reader-muted">暂无已提交的正式章节</p>';
      return;
    }
    if (!selectDefault) return;
    const hashChapter = chapterFromHash();
    let savedChapter = 0;
    try { savedChapter = Number(localStorage.getItem(LAST_CHAPTER_KEY)); } catch (_) { /* Ignore storage errors. */ }
    const preferred = [hashChapter, savedChapter, chapters[chapters.length - 1].chapter]
      .find((chapter) => chapters.some((item) => item.chapter === chapter));
    await selectChapter(preferred, false);
  }

  async function selectChapter(chapter, updateURL) {
    if (!chapters.some((item) => item.chapter === chapter)) return;
    saveReaderState();
    currentChapter = chapter;
    renderChapterList();
    const content = document.getElementById('reader-content');
    const title = document.getElementById('reader-title');
    title.textContent = '';
    content.className = 'reader-content';
    content.innerHTML = '<p class="reader-muted">正在加载章节…</p>';
    if (updateURL) history.replaceState({ reader: true }, '', `#reader/${chapter}`);
    try {
      const data = await request(`/api/v2/chapters/${encodeURIComponent(chapter)}`);
      if (chapter !== currentChapter) return;
      title.textContent = data.title || `第 ${chapter} 章`;
      content.innerHTML = data.html || '<p class="reader-muted">本章暂无内容</p>';
      content.querySelectorAll('img').forEach((image) => {
        image.loading = 'lazy';
        image.decoding = 'async';
      });
      const pane = document.getElementById('reader-content-pane');
      requestAnimationFrame(() => { pane.scrollTop = Number(scrollPositions[chapter]) || 0; });
    } catch (error) {
      if (chapter !== currentChapter) return;
      content.textContent = `章节读取失败：${error.message}`;
      content.className = 'reader-content reader-error';
    }
  }

  function chapterFromHash() {
    const match = location.hash.match(/^#reader\/(\d+)$/);
    return match ? Number(match[1]) : 0;
  }

  async function openReader(pushHistory = false) {
    previousFocus = document.activeElement;
    const reader = document.getElementById('reader-view');
    reader.hidden = false;
    document.body.classList.add('reader-active');
    if (pushHistory && !location.hash.startsWith('#reader')) {
      history.pushState({ reader: true }, '', '#reader');
      readerHistoryOwned = true;
    }
    try {
      await loadChapterList(true);
      if (currentChapter) history.replaceState({ reader: true }, '', `#reader/${currentChapter}`);
    } catch (error) {
      document.getElementById('reader-content').textContent = `章节列表读取失败：${error.message}`;
    }
    clearInterval(refreshTimer);
    refreshTimer = setInterval(() => loadChapterList(false).catch(() => {}), REFRESH_INTERVAL_MS);
    document.getElementById('reader-close').focus();
  }

  function hideReader() {
    saveReaderState();
    clearInterval(refreshTimer);
    refreshTimer = 0;
    document.getElementById('reader-view').hidden = true;
    document.body.classList.remove('reader-active');
    readerHistoryOwned = false;
    previousFocus?.focus?.();
  }

  function closeReader() {
    if (readerHistoryOwned) {
      history.back();
      return;
    }
    if (location.hash.startsWith('#reader')) {
      history.replaceState(null, '', `${location.pathname}${location.search}`);
    }
    hideReader();
  }

  createReader();
  document.getElementById('reader-open')?.addEventListener('click', () => openReader(true));
  window.addEventListener('hashchange', () => {
    if (location.hash.startsWith('#reader')) {
      if (document.getElementById('reader-view').hidden) openReader(false);
      else {
        const chapter = chapterFromHash();
        if (chapter && chapter !== currentChapter) selectChapter(chapter, false);
      }
    } else if (!document.getElementById('reader-view').hidden) {
      hideReader();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || document.getElementById('reader-view').hidden) return;
    const panel = document.getElementById('reader-settings');
    if (panel && !panel.hidden) {
      setSettingsOpen(false);
      return;
    }
    closeReader();
  });
  if (location.hash.startsWith('#reader')) openReader(false);
})();
