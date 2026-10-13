/* ============================================================
   markdown.js - 轻量 Markdown 渲染器（安全：先转义再解析）
   挂载到 window.PetApp.markdown
   支持：标题/粗体/斜体/行内代码/代码块/列表/链接/引用/分割线
   ============================================================ */
window.PetApp = window.PetApp || {};

(function (App) {
  'use strict';

  function escapeHtml(s) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // 写剪贴板。navigator.clipboard 要求安全上下文，而页面是 file:// 加载的，
  // 不一定算 —— 所以必须留 execCommand 这条老路兜底。
  // 原来 chat.js 里写了一份几乎一样的，抽出来共用，免得两处漂移。
  function copyText(text) {
    const t = String(text == null ? '' : text);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(t).then(() => true).catch(() => legacyCopy(t));
    }
    return Promise.resolve(legacyCopy(t));
  }

  function legacyCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  // 文档类代码块语言标签。只有 html 需要浏览器预览，其余保存后用默认程序打开。
  const DOC_TYPES = ['html', 'word', 'excel', 'ppt', 'pdf'];
  const PREVIEW_TYPES = ['html'];

  function render(text) {
    if (!text) return '';
    let src = text;

    // 1. 先提取代码块（占位，最后还原），防止内部内容被 markdown 解析
    const codeBlocks = [];
    src = src.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, lang, code) => {
      const idx = codeBlocks.length;
      codeBlocks.push({ lang: lang || '', code: code.trim() });
      return `\x00CB${idx}\x00`;
    });

    // 2. 转义 HTML（防 XSS）
    src = escapeHtml(src);

    // 3. 标题
    src = src.replace(/^### (.+)$/gm, '<h5 class="md-h">$1</h5>');
    src = src.replace(/^## (.+)$/gm, '<h4 class="md-h">$1</h4>');
    src = src.replace(/^# (.+)$/gm, '<h3 class="md-h">$1</h3>');

    // 4. 分割线
    src = src.replace(/^(---|\*\*\*|___)$/gm, '<hr class="md-hr">');

    // 5. 引用块
    src = src.replace(/^(?:&gt; )(.+)$/gm, '<blockquote class="md-quote">$1</blockquote>');
    // 合并连续 blockquote
    src = src.replace(/(<\/blockquote>)\n(<blockquote)/g, '$1$2');

    // 6. 列表
    // 无序列表
    src = src.replace(/(^|\n)((?:[-*] .+\n?)+)/g, (_m, pre, block) => {
      const items = block.trim().split('\n').map((l) => l.replace(/^[-*] /, '').trim());
      return `${pre}<ul class="md-list">${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
    });
    // 有序列表
    src = src.replace(/(^|\n)((?:\d+\. .+\n?)+)/g, (_m, pre, block) => {
      const items = block.trim().split('\n').map((l) => l.replace(/^\d+\. /, '').trim());
      return `${pre}<ol class="md-list">${items.map((i) => `<li>${i}</li>`).join('')}</ol>`;
    });

    // 6.5 表格（Markdown pipe table 语法）
    src = src.replace(/(^|\n)(\|.+\|\n\|[-: |]+\|.+\n(?:\|.+\|\n?)+)/g, (_m, pre, block) => {
      const lines = block.trim().split('\n');
      // 第二行是分隔行
      const separators = lines[1].split('|').map(s => s.trim()).filter(s => s);
      const aligns = separators.map(s => {
        if (s.startsWith(':') && s.endsWith(':')) return 'center';
        if (s.endsWith(':')) return 'right';
        return 'left';
      });
      // 表头
      const headers = lines[0].split('|').map(s => s.trim()).filter(s => s);
      // 表体
      const bodyLines = lines.slice(2);
      const rows = bodyLines.map(l => l.split('|').map(s => s.trim()).filter(s => s || true).slice(0, headers.length));
      // 去掉每行首尾空管道符产生的空元素
      const cleanRows = bodyLines.map(l => {
        const cells = l.split('|');
        // 去掉首尾空元素（管道符在行首尾时）
        if (cells[0].trim() === '') cells.shift();
        if (cells[cells.length - 1].trim() === '') cells.pop();
        return cells.map(c => c.trim());
      });

      let html = '<table class="md-table"><thead><tr>';
      headers.forEach((h, i) => {
        html += `<th style="text-align:${aligns[i] || 'left'}">${h}</th>`;
      });
      html += '</tr></thead><tbody>';
      cleanRows.forEach(row => {
        html += '<tr>';
        headers.forEach((_, i) => {
          html += `<td style="text-align:${aligns[i] || 'left'}">${row[i] || ''}</td>`;
        });
        html += '</tr>';
      });
      html += '</tbody></table>';
      return `${pre}${html}`;
    });

    // 7. 行内格式
    // 行内代码
    src = src.replace(/`([^`]+)`/g, '<code class="md-code-inline">$1</code>');
    // 粗体
    src = src.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    src = src.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    // 斜体（避免误匹配粗体的星号）
    src = src.replace(/(?<!\*)\*(?!\*)[^*]+\*(?!\*)/g, (m) => `<em>${m.slice(1, -1)}</em>`);
    // 链接
    src = src.replace(/\[([^\]]+)\]\(([^)]+)\)/g,
      '<a class="md-link" href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

    // 8. 段落处理：连续两个换行分段，单个换行转 <br>
    const paragraphs = src.split(/\n{2,}/);
    src = paragraphs.map((p) => {
      const t = p.trim();
      if (!t) return '';
      // 块级元素不包 <p>
      if (/^<(h[3-5]|ul|ol|hr|blockquote|pre|table)/.test(t)) return t;
      return '<p class="md-p">' + p.replace(/\n/g, '<br>') + '</p>';
    }).join('\n');

    // 9. 还原代码块（HTML/Word/Excel/PPT/PDF 代码块折叠+动作按钮，其他正常显示）
    src = src.replace(/\x00CB(\d+)\x00/g, (_m, idx) => {
      const b = codeBlocks[parseInt(idx, 10)];
      const lang = (b.lang || '').toLowerCase();
      // 文档块：折叠面板 + 动作按钮
      // 只有 HTML 需要浏览器预览；Word/Excel/PPT/PDF 一律"保存后用默认程序打开"——
      // 它们的原生格式浏览器渲染不了，走预览只会得到一张假的 HTML 页，看着像排版坏了。
      if (DOC_TYPES.includes(lang)) {
        const labels = { html: '📄 HTML 网页', word: '📄 Word 文档', excel: '📊 Excel 表格', ppt: '📽️ PPT 演示', pdf: '📕 PDF 文档' };
        const saveLabels = { html: '💾 保存网页', word: '💾 保存Word', excel: '💾 保存Excel', ppt: '💾 保存PPT', pdf: '💾 保存PDF' };
        const label = labels[lang] || '📄 文档';
        const saveLabel = saveLabels[lang] || '💾 保存';
        // 原文只存一处 data-html（encodeURIComponent），预览/保存/打开/复制都从它取。
        // 别再用 escapeHtml 存 data-raw：getAttribute 会先解一次实体，手工再解就是双重解码，
        // 文档里的 &nbsp;/&amp;/&lt; 全被毁掉——预览正常、保存出来乱，就是这么来的。
        const src64 = encodeURIComponent(b.code);
        // HTML 走浏览器预览；Word/Excel/PPT/PDF 是「保存」「打开」两个独立按钮，
        // 不合并成"保存并打开"——保存是保存，主人自己决定什么时候开。
        const sideBtn = PREVIEW_TYPES.includes(lang)
          ? '<button class="md-html-btn md-html-preview">👁️ 预览</button>'
          : '<button class="md-html-btn md-html-open" title="用默认程序打开（未保存会先保存）">📂 打开</button>';
        return `<div class="md-html-collapse" data-html="${src64}" data-doctype="${lang}">
          <div class="md-html-summary">${label}已生成</div>
          <div class="md-html-actions">
            ${sideBtn}
            <button class="md-html-btn md-html-save" data-doctype="${lang}">${saveLabel}</button>
            <button type="button" class="md-html-btn md-copy-btn">📋 复制</button>
          </div>
        </div>`;
      }
      // 普通代码块：头部条（语言标签 + 复制）。
      // 复制内容点的时候从 <code> 的 textContent 取，不另存 data-* ——
      // 那是 md-html-collapse 的做法（要拿原文做预览/下载），复制用不上，存了反而多一处编码问题。
      return `<div class="md-code-wrap">
        <div class="md-code-head">
          <span class="md-code-lang">${escapeHtml(lang || 'text')}</span>
          <button type="button" class="md-copy-btn">📋 复制</button>
        </div>
        <pre class="md-code-block"><code>${escapeHtml(b.code)}</code></pre>
      </div>`;
    });

    return src;
  }

  App.markdown = { render, escapeHtml, copyText };

  // ============ 复制按钮：事件委托 ============
  // 为什么是委托而不是给每个按钮绑监听：markdown 在 3 个文件、8+ 个渲染点被 innerHTML
  // 整树重建（流式期间每个 chunk 一次），逐绑会不停创建/销毁监听，"已复制"状态也被打断；
  // 更要命的是任何新增渲染点忘了调绑定就得到一个死按钮 —— 跟 config-build 漂移是同类问题。
  // 挂在 document 上一次性生效，所有渲染点自动覆盖（含 meeting.js / scheduled.js）。
  document.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('.md-copy-btn') : null;
    if (!btn) return;
    e.stopPropagation();

    let text = '';
    const doc = btn.closest('.md-html-collapse');
    if (doc) {
      // 文档块：原文在 data-html（预览/下载也用它，是现成的唯一来源）
      try { text = decodeURIComponent(doc.getAttribute('data-html') || ''); } catch (e2) { text = ''; }
    } else {
      // 代码块：从 <code> 的 textContent 取，天然正确、不受转义影响
      const wrap = btn.closest('.md-code-wrap');
      const code = wrap && wrap.querySelector('pre code');
      if (code) text = code.textContent || '';
    }
    if (!text) return;

    const orig = btn.textContent;
    copyText(text).then((ok) => {
      btn.textContent = ok ? '✓ 已复制' : '✗ 失败';
      setTimeout(() => { btn.textContent = orig; }, 1200);
    });
  });
})(window.PetApp);
