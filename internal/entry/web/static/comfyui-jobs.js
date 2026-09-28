/* ComfyUI job state and output presentation. */
(() => {
  'use strict';

  function create({ api, notify, esc, ui }) {
    const $ = (id) => document.getElementById(id);
    let currentJob = null;

    async function action(name) {
      if (!currentJob?.job_id && !currentJob?.id) return notify('No active job', 'comfy-msg', 'error');
      const id = currentJob.job_id || currentJob.id;
      try {
        render(await api(`/api/v2/image-jobs/${encodeURIComponent(id)}/${name}`, { method: 'POST', body: '{}' }));
      } catch (error) {
        notify(`${name} failed: ${error.message}`, 'comfy-msg', 'error');
      }
    }

    function outputList(job = {}) {
      return Array.isArray(job.outputs) && job.outputs.length
        ? job.outputs
        : Array.isArray(job.output) ? job.output : job.output ? [job.output] : [];
    }

    function renderOutputs(outputs, jobID = '') {
      const list = Array.isArray(outputs) ? outputs : outputs ? [outputs] : [];
      const host = $('job-outputs');
      if (!host) return;
      host.innerHTML = list.length ? list.map((output, index) => {
        const url = output.url || output.preview_url || output.image_url || (jobID ? `/api/v2/image-jobs/${encodeURIComponent(jobID)}/outputs/${index}` : '');
        const mime = output.mime || output.content_type || '';
        const isImage = output.kind === 'image' || output.previewable || mime.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(String(output.filename || ''));
        return isImage
          ? `<figure class="output-item"><img src="${esc(url)}" alt="${ui('latestOutput')} ${index + 1}" loading="lazy" data-lightbox-src="${esc(url)}"><figcaption>${ui('image')} · ${esc(mime)}</figcaption></figure>`
          : `<div class="output-item output-text"><strong>${esc(output.kind || ui('file'))} · #${index + 1}</strong><pre>${esc(output.preview || output.filename || JSON.stringify(output))}</pre></div>`;
      }).join('') : `<span class="muted">${ui('noOutputs')}</span>`;
    }

    async function refresh(id) {
      try { render(await api(`/api/v2/image-jobs/${encodeURIComponent(id)}`)); } catch (_) {}
    }

    function render(job = {}) {
      if (!job.job_id && !job.id) return;
      currentJob = { ...currentJob, ...job };
      const id = currentJob.job_id || currentJob.id;
      const status = currentJob.status || 'pending';
      const statusLabels = {
        pending: '等待中', submitting: '提交中', queued: '排队中', running: '运行中',
        succeeded: '已完成', completed: '已完成', failed: '失败', timeout: '超时', cancelled: '已取消',
      };
      if ($('job-status')) {
        $('job-status').textContent = statusLabels[status] || status;
        $('job-status').className = `job-status ${status}`;
      }
      if ($('job-phase')) {
        $('job-phase').textContent = [currentJob.phase || '', currentJob.progress != null ? `${Math.round(currentJob.progress * 100)}%` : ''].filter(Boolean).join(' · ');
      }
      renderOutputs(outputList(currentJob), id);
      if (!['succeeded', 'completed', 'failed', 'timeout', 'cancelled'].includes(status)) {
        clearTimeout(render.pollTimer);
        render.pollTimer = setTimeout(() => refresh(id), 1500);
      }
    }

    function bind() {
      document.querySelector('[data-action="cancel-job"]')?.addEventListener('click', () => action('cancel'));
      document.querySelector('[data-action="retry-job"]')?.addEventListener('click', () => action('retry'));
      $('job-outputs')?.addEventListener('click', (event) => {
        const src = event.target.dataset.lightboxSrc;
        if (src) window.open(src, '_blank', 'noopener');
      });
    }

    return Object.freeze({ bind, onJobEvent: render });
  }

  window.ComfyUIJobs = Object.freeze({ create });
})();
