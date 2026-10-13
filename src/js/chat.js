/* ============================================================
   chat.js - AI 对话功能（对话气泡窗 + 接入主进程 chat 接口）
   挂载到 window.PetApp.chat
   ============================================================ */
window.PetApp = window.PetApp || {};

(function (App) {
  'use strict';

  const state = App.state;
  let pet;
  let boxEl, messagesEl, inputEl, sendBtn;
  let isOpen = false;
  // 文件选择器打开时临时禁用 blurHide（点上传按钮会触发窗口失焦，不应关闭聊天框）
  let suppressBlurHide = false;
  // 记住用户调整的窗口大小和位置（内存级，重启重置）
  let savedWidth = null, savedHeight = null, savedLeft = null, savedTop = null, savedExpanded = null;
  let chatHistoryPanel = null;

  // 聊天记录持久化存储（保存到本地文件，通过 IPC 读写）
  async function loadChatHistory() {
    try { return await window.pet.loadChatHistory(); }
    catch (e) { return []; }
  }
  async function saveChatHistory(history) {
    try { await window.pet.saveChatHistory(history); } catch (e) {}
  }
  async function addChatRecord(role, text, attachments) {
    const history = await loadChatHistory();
    const time = Date.now();
    const rec = { role, text, time };
    // 附件（图片/文件）一并存进记录，重启后还能显示和双击打开
    if (attachments && ((attachments.images && attachments.images.length) || (attachments.files && attachments.files.length))) {
      // dataUrl 只用于当次显示，不能落进历史，否则 chat-history.json 会被图片撑爆
      rec.attachments = {
        images: (attachments.images || []).map((im) => ({
          name: im.name || '图片',
          asset: im.asset || '',
          open: im.open || '',
        })),
        files: (attachments.files || []).map((f) => ({
          name: f.name || '文件',
          path: f.path || '',
          size: f.size || 0,
        })),
      };
    }
    history.push(rec);
    await saveChatHistory(history.slice(-200));
    return time;
  }

  // 把待发送图片落盘到 chat_assets，返回历史记录用的附件结构
  async function persistImageAttachments(items) {
    const images = [];
    for (const it of (items || [])) {
      let asset = '';
      if (window.pet.saveChatAsset) {
        try {
          const r = await window.pet.saveChatAsset(imgSrcOf(it.src));
          if (r && r.success) asset = r.asset;
        } catch (e) { /* 落盘失败不影响对话，只是重启后看不到图 */ }
      }
      images.push({
        name: it.name || '图片',
        asset,
        // 双击打开：优先原文件路径，没有就打开落盘副本
        open: it.path || asset,
      });
    }
    return { images, files: [] };
  }

  // ============ 附件渲染（图片缩略图 / 文件卡片）============
  // attachments: { images: [{name, asset, open, dataUrl}], files: [{name, path, size}] }
  // dataUrl 仅本次会话有（即时显示不用等 IPC）；历史记录里没有，靠 asset/path 走 IPC 取图。
  const ATTACH_IMG_MAX = 220; // 缩略图长边上限

  // 图片项统一成完整 data URL（兼容旧的裸 base64）
  function imgSrcOf(img) {
    if (!img) return '';
    const s = String(img);
    return s.startsWith('data:') ? s : 'data:image/png;base64,' + s;
  }

  function fmtFileSize(n) {
    if (!n && n !== 0) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  // 记一条待发送的文件附件（发消息时显示文件卡片，双击可打开）
  function pushPendingFile(name, path, size) {
    window._pendingFiles = window._pendingFiles || [];
    window._pendingFiles.push({ name: name || '文件', path: path || '', size: size || 0 });
  }
  function takePendingFiles() {
    const out = window._pendingFiles || [];
    window._pendingFiles = [];
    return out;
  }

  // 从 File/Blob 取附件元信息：能拿到真实路径就记下来（双击时打开原文件），拿不到就只能打开副本
  function fileMetaOf(file) {
    if (!file) return { name: '', path: '' };
    let p = '';
    try { p = (window.pet.getPathForFile ? window.pet.getPathForFile(file) : '') || ''; } catch (e) {}
    if (!p && file.path) p = file.path;
    const name = file.name || (p ? String(p).split(/[\\/]/).pop() : '');
    return { name, path: p };
  }

  // 读取用户选中的文件内容。路径只是附带信息（双击打开原文件用），
  // 内容一律以字节为准 —— 路径取不到或已失效，照样能把内容读出来。
  async function readLocalFile(file, filePath) {
    if (filePath) {
      try {
        const r = await window.pet.readFileContent(filePath);
        if (r && r.ok) return { result: r, path: filePath };
        // 格式本身不支持就别再拿字节试一遍了，错误原样带出去
        if (r && r.error && /不支持读取/.test(r.error)) return { result: r, path: filePath };
      } catch (e) { /* 路径读不动 → 退回字节 */ }
    }
    try {
      const arrayBuffer = await file.arrayBuffer();
      const r = await window.pet.readFileBuffer(new Uint8Array(arrayBuffer), file.name);
      return { result: r, path: filePath || '' };
    } catch (e) {
      return { result: { ok: false, error: e.message }, path: filePath || '' };
    }
  }

  // 登记会话附件（主进程 sessionFiles）：内容/路径跨轮保留。
  // 不登记的话，追问时模型手里只有 cleanUserMsg 剥剩下的提问，会以为文件丢了。
  function registerAttachedFile(name, filePath, size, content) {
    try {
      if (window.pet.attachFile) {
        window.pet.attachFile({ name: name || '文件', path: filePath || '', size: size || 0, content: content || '' });
      }
    } catch (e) { /* 登记失败不影响主流程 */ }
  }

  // 用系统默认程序打开附件（图片有原文件路径就打开原文件，否则打开 chat_assets 里的副本）
  async function openAttachment(openPath) {
    if (!openPath) { pet.showBubble('喵～这个附件找不到原文件了', 2500); return; }
    try {
      const res = await window.pet.openFile(openPath);
      if (!res || !res.success) pet.showBubble('喵～打开失败了', 2500);
    } catch (e) {
      pet.showBubble('喵～打开失败了：' + e.message, 2500);
    }
  }

  // 应用内放大预览（lightbox）
  function openLightbox(src, name, openPath) {
    const modal = document.getElementById('imgLightbox');
    const img = document.getElementById('lightboxImg');
    const title = document.getElementById('lightboxTitle');
    const openBtn = document.getElementById('lightboxOpen');
    const closeBtn = document.getElementById('lightboxClose');
    if (!modal || !img) return;
    img.src = src;
    if (title) title.textContent = name || '图片预览';
    if (openBtn) {
      openBtn.onclick = () => { if (openPath) openAttachment(openPath); };
      openBtn.style.display = openPath ? '' : 'none';
    }
    // 每次打开都重新绑定（onclick 赋值是覆盖式的，重复绑定无副作用）
    if (closeBtn) closeBtn.onclick = () => modal.classList.add('hidden');
    modal.onclick = (e) => { if (e.target === modal) modal.classList.add('hidden'); };
    modal.classList.remove('hidden');
  }

  // 渲染附件到气泡里：图片缩略图（单击放大 / 双击系统打开）+ 文件卡片（双击打开）
  function renderAttachments(container, attachments) {
    if (!attachments) return;
    const imgs = attachments.images || [];
    const files = attachments.files || [];
    if (!imgs.length && !files.length) return;

    const wrap = document.createElement('div');
    wrap.className = 'chat-attach';

    imgs.forEach((im) => {
      const cell = document.createElement('div');
      cell.className = 'chat-attach-img';
      cell.title = '单击放大 · 双击用系统默认程序打开';
      const el = document.createElement('img');
      el.alt = im.name || '图片';
      el.style.maxWidth = ATTACH_IMG_MAX + 'px';
      el.style.maxHeight = ATTACH_IMG_MAX + 'px';
      // 单击和双击要区分开：click 在双击时会连发两次，必须延迟单击动作好让 dblclick 取消它
      let clickTimer = null;
      el.addEventListener('click', () => {
        if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; return; }
        clickTimer = setTimeout(() => {
          clickTimer = null;
          openLightbox(el.src, im.name, im.open);
        }, 220);
      });
      el.addEventListener('dblclick', (e) => {
        e.preventDefault();
        if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
        openAttachment(im.open);
      });
      if (im.dataUrl) {
        el.src = imgSrcOf(im.dataUrl);
      } else if (im.asset && window.pet.readImage) {
        el.classList.add('loading');
        window.pet.readImage(im.asset).then((r) => {
          el.classList.remove('loading');
          if (r && r.ok) el.src = r.dataUrl;
        }).catch(() => el.classList.remove('loading'));
      }
      cell.appendChild(el);
      const label = document.createElement('div');
      label.className = 'chat-attach-name';
      label.textContent = im.name || '图片';
      cell.appendChild(label);
      wrap.appendChild(cell);
    });

    files.forEach((f) => {
      const card = document.createElement('div');
      card.className = 'chat-attach-file';
      card.title = '双击用系统默认程序打开';
      card.innerHTML = `<span class="chat-attach-file-ic">📄</span>` +
        `<span class="chat-attach-file-meta"><span class="chat-attach-file-name"></span>` +
        `<span class="chat-attach-file-size"></span></span>`;
      card.querySelector('.chat-attach-file-name').textContent = f.name || '文件';
      card.querySelector('.chat-attach-file-size').textContent = fmtFileSize(f.size) || '双击打开';
      card.addEventListener('dblclick', (e) => { e.preventDefault(); openAttachment(f.path); });
      wrap.appendChild(card);
    });

    const hint = document.createElement('div');
    hint.className = 'chat-attach-hint';
    hint.textContent = '双击可用系统默认程序打开';
    wrap.appendChild(hint);

    container.appendChild(wrap);
  }

  // markdown 转纯文本（去掉标记符号，保留换行和内容）
  function mdToPlainText(md) {
    if (!md) return '';
    let t = md;
    t = t.replace(/```[\w]*\n?([\s\S]*?)```/g, '$1'); // 代码块去围栏
    t = t.replace(/`([^`]+)`/g, '$1');                 // 行内代码
    t = t.replace(/\*\*([^*]+)\*\*/g, '$1');          // 粗体
    t = t.replace(/__([^_]+)__/g, '$1');              // 粗体_
    t = t.replace(/(?<!\*)\*(?!\*)[^*]+\*(?!\*)/g, (m) => m.slice(1, -1)); // 斜体
    t = t.replace(/^###\s+/gm, '');                    // 标题
    t = t.replace(/^##\s+/gm, '');
    t = t.replace(/^#\s+/gm, '');
    t = t.replace(/^[-*]\s+/gm, '• ');                 // 无序列表 → 圆点
    t = t.replace(/^\d+\.\s+/gm, '');                   // 有序列表
    t = t.replace(/^>\s+/gm, '');                      // 引用
    t = t.replace(/^---+$/gm, '────────');             // 分割线
    t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1（$2）'); // 链接
    return t.trim();
  }

  // 给 pet 消息加复制按钮（纯文本 + Markdown 两个选项）
  // 绑定 HTML 折叠面板的预览/保存按钮
  function bindHtmlButtons(container) {
    // 预览：保存到临时文件后用默认浏览器打开
    const previewBtns = container.querySelectorAll('.md-html-preview');
    previewBtns.forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const wrap = btn.closest('.md-html-collapse');
        const rawHtml = wrap ? wrap.getAttribute('data-html') : '';
        if (!rawHtml) return;
        const html = decodeURIComponent(rawHtml);
        btn.textContent = '打开中…';
        try {
          // 保存到临时文件，用默认浏览器打开
          const ts = Date.now();
          const fname = `小橘预览_${ts}.html`;
          const res = await window.pet.saveFile(html, fname);
          if (res && res.success) {
            await window.pet.openFile(res.path);
            btn.textContent = '✓ 已打开';
            setTimeout(() => { btn.textContent = '👁️ 预览'; }, 2000);
          } else {
            btn.textContent = '✗ 失败';
            setTimeout(() => { btn.textContent = '👁️ 预览'; }, 2000);
          }
        } catch (err) {
          btn.textContent = '✗ 失败';
          setTimeout(() => { btn.textContent = '👁️ 预览'; }, 2000);
        }
      });
    });
    // 保存文档到配置文件夹（html/word/excel/ppt/pdf）
    // 保存后用默认程序打开 —— 省得再去文件夹里翻。HTML 例外，它走「预览」。
    const saveBtns = container.querySelectorAll('.md-html-save');
    saveBtns.forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const docType = btn.getAttribute('data-doctype') || 'html';
        const collapse = btn.closest('.md-html-collapse');
        // 原文统一从 data-html 取。别再用 data-raw + decodeHtmlEntities ——
        // getAttribute 已经解过一次实体，手工再解就是双重解码，文档里的 &nbsp;/&amp; 全被毁掉。
        let content = '';
        try { content = decodeURIComponent(collapse ? (collapse.getAttribute('data-html') || '') : ''); }
        catch (err) { content = ''; }
        if (!content) {
          btn.textContent = '✗ 无内容';
          setTimeout(() => { btn.textContent = SAVE_LABEL[docType] || '💾 保存'; }, 2000);
          return;
        }
        btn.textContent = '保存中…';
        try {
          const ts = new Date();
          const pad = (n) => String(n).padStart(2, '0');
          const dateStr = `${ts.getFullYear()}${pad(ts.getMonth()+1)}${pad(ts.getDate())}_${pad(ts.getHours())}${pad(ts.getMinutes())}`;
          // 根据文档类型确定扩展名和包装
          let wrapped = content, fname = '';
          if (docType === 'word') {
            wrapped = wrapAsWord(content);
            fname = `小橘文档_${dateStr}.doc`;
          } else if (docType === 'excel') {
            wrapped = wrapAsExcel(content);
            fname = `小橘表格_${dateStr}.xls`;
          } else if (docType === 'ppt') {
            wrapped = wrapAsPPT(content);
            fname = `小橘演示_${dateStr}.ppt`;
          } else if (docType === 'pdf') {
            wrapped = content;
            fname = `小橘文档_${dateStr}.pdf`;
          } else {
            fname = `小橘生成_${dateStr}.html`;
          }
          const res = await window.pet.saveFile(wrapped, fname);
          if (res && res.success) {
            const shortPath = res.path ? res.path.replace(/^.*[\\/]/, '') : fname;
            btn.textContent = '✓ ' + shortPath;
            btn.title = '已保存到：' + (res.path || '');
            // 记下来，给「📂 打开」按钮用
            if (collapse && res.path) collapse.setAttribute('data-saved-path', res.path);
            setTimeout(() => { btn.textContent = SAVE_LABEL[docType] || '💾 保存'; }, 3000);
          } else {
            btn.textContent = '✗ 失败';
            setTimeout(() => { btn.textContent = SAVE_LABEL[docType] || '💾 保存'; }, 2000);
          }
        } catch (err) {
          btn.textContent = '✗ 失败';
          setTimeout(() => { btn.textContent = SAVE_LABEL[docType] || '💾 保存'; }, 2000);
        }
      });
    });

    // 打开按钮：用默认程序打开。保存和打开是两个独立动作，不合并。
    // 还没存过就先存一份再开，省得按钮点了没反应。
    const openBtns = container.querySelectorAll('.md-html-open');
    openBtns.forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const collapse = btn.closest('.md-html-collapse');
        if (!collapse) return;
        let savedPath = collapse.getAttribute('data-saved-path') || '';
        if (!savedPath) {
          const saveBtn = collapse.querySelector('.md-html-save');
          if (!saveBtn) return;
          btn.textContent = '先保存…';
          saveBtn.click();
          // saveBtn 是异步的，轮询等它把 data-saved-path 写上
          for (let i = 0; i < 40 && !savedPath; i++) {
            await new Promise(r => setTimeout(r, 100));
            savedPath = collapse.getAttribute('data-saved-path') || '';
          }
        }
        if (!savedPath) {
          btn.textContent = '✗ 打开失败';
          setTimeout(() => { btn.textContent = '📂 打开'; }, 2000);
          return;
        }
        btn.textContent = '打开中…';
        try {
          const opened = await window.pet.openFile(savedPath);
          btn.textContent = (opened && opened.success) ? '✓ 已打开' : '✗ 打开失败';
          if (!(opened && opened.success)) btn.title = ((opened && opened.error) || '未知错误') + '（文件在：' + savedPath + '）';
          setTimeout(() => { btn.textContent = '📂 打开'; }, 2000);
        } catch (err) {
          btn.textContent = '✗ 打开失败';
          setTimeout(() => { btn.textContent = '📂 打开'; }, 2000);
        }
      });
    });
  }

  // 保存按钮文案（只保存，不自动打开）
  const SAVE_LABEL = {
    html: '💾 保存网页', word: '💾 保存Word', excel: '💾 保存Excel',
    ppt: '💾 保存PPT', pdf: '💾 保存PDF',
  };

  // Word 文档 HTML 包装（Word 可直接打开 .doc 格式的 HTML）
  function wrapAsWord(content) {
    return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>文档</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>
@page WordSection1 { size: A4; margin: 2.54cm 3.18cm 2.54cm 3.18cm; }
div.WordSection1 { page: WordSection1; }
body { font-family: '宋体', SimSun, serif; font-size: 12pt; line-height: 1.5; }
h1 { font-size: 18pt; text-align: center; font-weight: bold; margin: 12pt 0; }
h2 { font-size: 15pt; font-weight: bold; margin: 10pt 0; }
h3 { font-size: 13pt; font-weight: bold; margin: 8pt 0; }
p { text-indent: 2em; margin: 4pt 0; }
table { border-collapse: collapse; width: 100%; margin: 8pt 0; }
td, th { border: 1pt solid #000; padding: 5pt 8pt; font-size: 11pt; }
th { background: #f0f0f0; font-weight: bold; text-align: center; }
ul, ol { margin: 4pt 0; padding-left: 2em; }
</style>
</head>
<body><div class="WordSection1">
${content}
</div></body>
</html>`;
  }

  // Excel 表格 HTML 包装（Excel 可直接打开 .xls 格式的 HTML）
  function wrapAsExcel(content) {
    return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8">
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Sheet1</x:Name></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
<style>
table { border-collapse: collapse; }
td, th { border: 1px solid #000; padding: 4px 8px; font-family: '宋体', SimSun; font-size: 11pt; white-space: nowrap; }
th { background: #d9e1f2; font-weight: bold; }
</style>
</head>
<body>
${content}
</body>
</html>`;
  }

  // PPT 演示 HTML 包装（PowerPoint 可导入 .ppt 格式的 HTML）
  function wrapAsPPT(content) {
    return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:p="urn:schemas-microsoft-com:office:powerpoint" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8">
<style>
body { margin: 0; }
.slide { width: 960px; height: 540px; margin: 0 auto 20px; padding: 40px; box-sizing: border-box; page-break-after: always; font-family: '微软雅黑', sans-serif; }
.slide h1 { font-size: 32pt; margin-bottom: 20pt; }
.slide h2 { font-size: 24pt; margin-bottom: 16pt; }
.slide p { font-size: 18pt; line-height: 1.6; }
.slide ul { font-size: 18pt; line-height: 1.8; }
</style>
</head>
<body>
${content}
</body>
</html>`;
  }

  // 流式渲染 Markdown：未闭合的 HTML/Word/Excel/PPT 代码块显示"正在生成"+ 可折叠代码
  function renderStreamMarkdown(text) {
    // 检测是否有未闭合的代码块（html/word/excel/ppt）
    const docTypes = ['```html', '```word', '```excel', '```ppt'];
    for (const startTag of docTypes) {
      const startIdx = text.indexOf(startTag);
      if (startIdx >= 0) {
        const afterStart = text.substring(startIdx + startTag.length);
        const endIdx = afterStart.indexOf('```');
        if (endIdx < 0) {
          // 还没闭合 → 显示前面的文字 + "正在生成"折叠面板
          const before = text.substring(0, startIdx);
          const beforeHtml = App.markdown.render(before);
          const rawCode = afterStart;
          const escapedCode = App.markdown.escapeHtml ? App.markdown.escapeHtml(rawCode) : rawCode.replace(/</g, '&lt;');
          const typeLabel = startTag.replace('```', '').toUpperCase();
          return beforeHtml +
            '<details class="md-html-gen-collapse">' +
              '<summary class="md-html-gen-summary">🔨 正在生成 ' + typeLabel + '…</summary>' +
              '<pre class="md-html-gen-code"><code>' + escapedCode + '</code></pre>' +
            '</details>';
        }
      }
    }
    return App.markdown.render(text);
  }

  // 补全未闭合的代码块（agent loop 多轮场景：LLM 输出 ```html 后切去调工具，没输出闭合 ```）
  // 检查 allStreamText 中是否有未闭合的 ```html/word/excel/ppt，有则补上 ```
  function closeUnclosedFences(text) {
    const docTypes = ['```html', '```word', '```excel', '```ppt', '```'];
    for (const startTag of docTypes) {
      const startIdx = text.lastIndexOf(startTag);
      if (startIdx >= 0) {
        const afterStart = text.substring(startIdx + startTag.length);
        const endIdx = afterStart.indexOf('```');
        if (endIdx < 0) {
          // 未闭合 → 补上闭合标记
          return text + '\n```';
        }
      }
    }
    return text;
  }

  // ============ 图片压缩（发给 vision 前缩到长边 2048，转 JPEG）============
  // 原图直接 base64 直传太慢：4K 截图 PNG 有好几 MB，IPC 传输 + 上传 + 服务端解码都要时间。
  // 多数 vision 模型内部本来就会下采样，前端先缩一档几乎不损失识别精度，速度提升明显。
  const IMG_MAX_EDGE = 2048;
  const IMG_JPEG_QUALITY = 0.88;
  const IMG_KEEP_ORIGINAL_LIMIT = 400 * 1024; // 小于 400KB 且不超长边就不再转码

  function loadImageEl(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('图片解码失败'));
      img.src = src;
    });
  }

  // 入参：data URL 或裸 base64（裸的按 png 处理，兼容旧调用）
  // 返回：完整的 data URL（压缩后为 image/jpeg）
  async function compressImage(src) {
    const dataUrl = src.startsWith('data:') ? src : 'data:image/png;base64,' + src;
    try {
      const img = await loadImageEl(dataUrl);
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (!w || !h) return dataUrl;
      const scale = Math.min(1, IMG_MAX_EDGE / Math.max(w, h));
      // 够小、又不用缩放 → 原样发，省一次重编码（也保住 PNG 透明通道）
      if (scale >= 1 && dataUrl.length <= IMG_KEEP_ORIGINAL_LIMIT) return dataUrl;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      const ctx = canvas.getContext('2d');
      // JPEG 不支持透明，先铺白底，避免透明区域变黑
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', IMG_JPEG_QUALITY);
    } catch (e) {
      console.warn('[chat] 图片压缩失败，改用原图:', e && e.message);
      return dataUrl;
    }
  }

  // ============ TTS 流式播放器（Web Audio 无缝调度，首块 ~800ms 即播）============
  // mimo TTS 分段返回独立 mini-WAV 块，每块 decodeAudioData 解码后按时间轴无缝衔接
  const ttsPlayer = {
    ctx: null,
    session: 0,            // 会话 ID，过滤旧会话残留块
    _seq: 0,               // 会话序号（保证 ID 唯一）
    active: false,
    nextTime: 0,           // 下一段音频起播时间点（无缝衔接的关键）
    sources: [],           // 已调度的 BufferSource（停止时全部 stop）
    queue: Promise.resolve(), // 解码串行队列（保证块顺序不乱）
    listener: null,
    btn: null,
    onFirst: null,
    sentences: [],         // 待合成句子队列（自动播报连播用）
    workerRunning: false,
    nextSession() { return Date.now() + '-' + (++this._seq); },
    ensureListener() {
      if (this.listener || !window.pet || !window.pet.onTtsChunk) return;
      this.listener = window.pet.onTtsChunk((payload) => {
        if (!ttsPlayer.active || !payload || payload.session !== ttsPlayer.session) return;
        ttsPlayer.queue = ttsPlayer.queue.then(async () => {
          if (!ttsPlayer.active || payload.session !== ttsPlayer.session) return;
          try {
            const bin = atob(payload.data);
            const arr = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            const audioBuf = await ttsPlayer.ctx.decodeAudioData(arr.buffer);
            const src = ttsPlayer.ctx.createBufferSource();
            src.buffer = audioBuf;
            src.connect(ttsPlayer.ctx.destination);
            const startAt = Math.max(ttsPlayer.ctx.currentTime + 0.03, ttsPlayer.nextTime);
            src.start(startAt);
            ttsPlayer.nextTime = startAt + audioBuf.duration;
            ttsPlayer.sources.push(src);
            if (ttsPlayer.onFirst) { const f = ttsPlayer.onFirst; ttsPlayer.onFirst = null; f(); }
          } catch (e) { /* 单块解码失败跳过 */ }
        });
      });
    },
    async start(btn, onFirst) {
      this.ensureListener();
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      this.session = this.nextSession();
      this.active = true;
      this.nextTime = this.ctx.currentTime + 0.05;
      this.sources = [];
      this.sentences = [];
      this.btn = btn;
      this.onFirst = onFirst;
    },
    // 多句连播（自动播报）：句子排队顺序合成，时间轴连续无缝衔接
    queueSentences(list, btn, onFirst) {
      if (!list || !list.length) return;
      this.ensureListener();
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      if (!this.active) {
        // 新一轮播放：起时间轴
        this.active = true;
        this.nextTime = this.ctx.currentTime + 0.05;
        this.sources = [];
        this.btn = btn || null;
        this.onFirst = onFirst || null;
      }
      this.sentences.push(...list);
      this._drain();
    },
    async _drain() {
      if (this.workerRunning) return;
      this.workerRunning = true;
      try {
        while (this.sentences.length && this.active) {
          const text = this.sentences.shift();
          this.session = this.nextSession();
          try {
            await window.pet.ttsSpeakStream(text, undefined, this.session);
            await this.queue.catch(() => {});
            await new Promise((r) => setTimeout(r, 80)); // 等 IPC 尾块到达的余量
          } catch (e) { /* 单句合成失败跳过，不打断后续 */ }
        }
      } finally {
        this.workerRunning = false;
      }
    },
    stop() {
      this.active = false;
      this.onFirst = null;
      this.sentences = [];
      this.sources.forEach((s) => { try { s.stop(); } catch (e) {} });
      this.sources = [];
      this.resetBtn();
    },
    resetBtn() {
      if (this.btn) {
        try { clearInterval(this.btn._endPoll); } catch (e) {}
        this.btn.innerHTML = '<span class="ic">🔊</span>朗读';
        this.btn = null;
      }
    },
    // 所有已调度段都放完、句子队列清空（且至少播过一段）
    ended() {
      return this.sources.length > 0 && !this.workerRunning && this.sentences.length === 0
        && this.ctx && this.ctx.currentTime > this.nextTime + 0.15;
    },
  };

  // 对外暴露的语音播放接口（设置面板试听等外部模块用，复用流式播放器）
  App.tts = {
    async play(text, voice) {
      disableAutoReadThisReply(); // 手动播放接管，本次回复不再自动播报
      if (ttsPlayer.active) ttsPlayer.stop();
      await ttsPlayer.start(null, null);
      const sess = ttsPlayer.session;
      const result = await window.pet.ttsSpeakStream(String(text || '').slice(0, 500), voice, sess);
      await ttsPlayer.queue.catch(() => {});
      if (ttsPlayer.session !== sess) return { success: false, error: '已切换播放' };
      if (!result || !result.success || !result.chunks) {
        ttsPlayer.stop();
        return { success: false, error: (result && result.error) || '语音合成失败' };
      }
      // 等播放自然结束（或被 stop/新播放打断）
      await new Promise((resolve) => {
        const poll = setInterval(() => {
          if (ttsPlayer.session !== sess || !ttsPlayer.active || ttsPlayer.ended()) { clearInterval(poll); resolve(); }
        }, 250);
      });
      if (ttsPlayer.active && ttsPlayer.session === sess) ttsPlayer.stop();
      return { success: true };
    },
    stop() { ttsPlayer.stop(); },
    isActive() { return ttsPlayer.active; },
  };

  // 提取适合朗读的纯文本（去掉代码块/Markdown 标记，限制长度）
  function toSpeakText(rawText, maxLen) {
    return (rawText || '')
      .replace(/```[\s\S]*?```/g, '')   // 完整代码块
      .replace(/```[\s\S]*$/g, '')      // 未闭合代码块（流式尾巴）
      .replace(/[#*_>`~\[\]()]/g, '')
      .slice(0, maxLen || 1500);
  }

  // ============ 自动播报：边流式输出边朗读（按完整句子切分，跳过代码块）============
  const AUTO_READ_LIMIT = 800;
  let autoReadCache = null;   // null=未知 / true=开 / false=关（send 开始时预取）
  let autoReadCursor = 0;     // 已处理到 allStreamText 的位置
  let autoReadChars = 0;      // 已排队朗读的字符数（限长）

  // 从流式文本中提取已完成的句子（以。！？!?\n 结尾），跳过代码块内容
  function extractDoneSentences(text, cursor) {
    const sentences = [];
    let segStart = cursor;
    let i = cursor;
    let inFence = false;
    let fenceStart = -1;
    while (i < text.length) {
      if (text[i] === '`' && text.startsWith('```', i)) {
        if (!inFence) {
          inFence = true;
          fenceStart = segStart; // 代码块未闭合时回退到这里
          i += 3;
          continue;
        }
        inFence = false;
        i += 3;
        segStart = i; // 跳过代码块内容，不朗读
        continue;
      }
      if (!inFence && '。！？!?\n'.includes(text[i])) {
        const s = text.slice(segStart, i + 1).trim();
        if (s.length >= 2) sentences.push(s);
        segStart = i + 1;
      }
      i++;
    }
    return { sentences, cursor: inFence ? fenceStart : segStart };
  }

  function autoReadTick(text) {
    if (autoReadCache !== true) return;
    const r = extractDoneSentences(text, autoReadCursor);
    autoReadCursor = r.cursor;
    const toSpeak = [];
    for (const s of r.sentences) {
      const t = toSpeakText(s, 200).trim();
      if (t.length < 2) continue;
      if (autoReadChars + t.length > AUTO_READ_LIMIT) break;
      autoReadChars += t.length;
      toSpeak.push(t);
    }
    if (toSpeak.length) ttsPlayer.queueSentences(toSpeak, null, null);
  }

  function autoReadFinish(text) {
    const doTail = () => {
      const tail = toSpeakText(text.slice(autoReadCursor), Math.max(0, AUTO_READ_LIMIT - autoReadChars)).trim();
      if (tail.length >= 2) ttsPlayer.queueSentences([tail], null, null);
    };
    if (autoReadCache === true) { doTail(); return; }
    if (autoReadCache === false) return;
    // 配置还没取到 → 现查一次兜底（整段朗读）
    window.pet.ttsGetConfig().then((cfg) => {
      autoReadCache = !!(cfg && cfg.autoRead && cfg.configured);
      if (autoReadCache) doTail();
    }).catch(() => {});
  }

  // 手动朗读接管时，本次回复不再自动播报（避免和手动播放混音）
  function disableAutoReadThisReply() {
    autoReadCache = false;
    autoReadCursor = 1e9;
  }

  // 自动播报回复（旧版整段播报，供图片/知识库回复路径用）
  async function maybeAutoSpeak(text) {
    try {
      if (!window.pet || !window.pet.ttsGetConfig || !App.tts) return;
      const cfg = await window.pet.ttsGetConfig();
      if (!cfg || !cfg.autoRead || !cfg.configured) return;
      const speakText = toSpeakText(text, 800);
      if (speakText.trim().length < 2) return;
      disableAutoReadThisReply();
      App.tts.play(speakText).catch(() => {});
    } catch (e) { /* 自动播报失败不影响聊天 */ }
  }

  function addCopyButton(div, rawText, showPrecipitate, showSpeak) {
    const bar = document.createElement('div');
    bar.className = 'chat-copy-bar';

    // 复制按钮（图标 + 文字胶囊）
    const copyBtn = document.createElement('button');
    copyBtn.className = 'chat-copy-btn';
    copyBtn.innerHTML = '<span class="ic">📋</span>复制';
    copyBtn.title = '复制 Markdown 原文';
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const text = rawText || div.textContent || '';
      // 共用 markdown.js 的 copyText（自带 execCommand 兜底），不再各写一份
      App.markdown.copyText(text).then((ok) => {
        copyBtn.innerHTML = ok ? '<span class="ic">✓</span>已复制' : '<span class="ic">✗</span>失败';
        setTimeout(() => { copyBtn.innerHTML = '<span class="ic">📋</span>复制'; }, 1200);
      });
    });
    bar.appendChild(copyBtn);

    // 保存 Markdown 按钮（只保存，不自动打开 —— 打开是另一个按钮）
    let lastSavedPath = '';
    const dlBtn = document.createElement('button');
    dlBtn.className = 'chat-copy-btn';
    dlBtn.innerHTML = '<span class="ic">📥</span>保存';
    dlBtn.title = '保存为 Markdown 文件';
    dlBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const text = rawText || div.textContent || '';
      dlBtn.innerHTML = '<span class="ic">⋯</span>保存中';
      try {
        const ts = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const fname = `小橘回复_${ts.getFullYear()}${pad(ts.getMonth()+1)}${pad(ts.getDate())}_${pad(ts.getHours())}${pad(ts.getMinutes())}.md`;
        const res = await window.pet.saveFile(text, fname);
        if (res && res.success) {
          lastSavedPath = res.path || '';
          dlBtn.innerHTML = '<span class="ic">✓</span>已保存';
          dlBtn.title = '已保存到：' + lastSavedPath;
          setTimeout(() => { dlBtn.innerHTML = '<span class="ic">📥</span>保存'; }, 1500);
        } else {
          dlBtn.innerHTML = '<span class="ic">✗</span>失败';
          setTimeout(() => { dlBtn.innerHTML = '<span class="ic">📥</span>保存'; }, 1500);
        }
      } catch (err) {
        dlBtn.innerHTML = '<span class="ic">✗</span>失败';
        setTimeout(() => { dlBtn.innerHTML = '<span class="ic">📥</span>保存'; }, 1500);
      }
    });
    bar.appendChild(dlBtn);
    div.appendChild(bar);

    // 检测 HTML 代码块，加"保存网页"按钮
    if (rawText && /```html/i.test(rawText)) {
      const htmlMatch = rawText.match(/```html?\s*\n([\s\S]*?)```/i);
      if (htmlMatch && htmlMatch[1] && htmlMatch[1].trim().length > 50) {
        const saveBtn = document.createElement('button');
        saveBtn.className = 'chat-copy-btn chat-save-btn';
        saveBtn.innerHTML = '<span class="ic">💾</span>保存网页';
        saveBtn.title = '保存网页到配置文件夹';
        saveBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          saveBtn.innerHTML = '<span class="ic">⋯</span>保存中';
          try {
            const html = htmlMatch[1].trim();
            const ts = new Date();
            const pad = (n) => String(n).padStart(2, '0');
            const fname = `小橘生成_${ts.getFullYear()}${pad(ts.getMonth()+1)}${pad(ts.getDate())}_${pad(ts.getHours())}${pad(ts.getMinutes())}.html`;
            const res = await window.pet.saveFile(html, fname);
            if (res && res.success) {
              saveBtn.innerHTML = '<span class="ic">✓</span>已保存';
              setTimeout(() => { saveBtn.innerHTML = '<span class="ic">💾</span>保存网页'; }, 2000);
            } else {
              saveBtn.innerHTML = '<span class="ic">✗</span>失败';
              setTimeout(() => { saveBtn.innerHTML = '<span class="ic">💾</span>保存网页'; }, 1500);
            }
          } catch (err) {
            saveBtn.innerHTML = '<span class="ic">✗</span>失败';
            setTimeout(() => { saveBtn.innerHTML = '<span class="ic">💾</span>保存网页'; }, 1500);
          }
        });
        bar.appendChild(saveBtn);
      }
    }

    // 沉淀技能按钮（仅在 agent loop 完成的回复上显示）
    if (showPrecipitate && window.pet && window.pet.precipitateSkill) {
      const skillBtn = document.createElement('button');
      skillBtn.className = 'chat-copy-btn chat-precipitate-btn';
      skillBtn.innerHTML = '<span class="ic">💡</span>沉淀技能';
      skillBtn.title = '把这次成功的流程沉淀为可复用的技能';
      skillBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        skillBtn.innerHTML = '<span class="ic">⋯</span>沉淀中';
        skillBtn.disabled = true;
        try {
          const result = await window.pet.precipitateSkill();
          if (result.success) {
            skillBtn.innerHTML = '<span class="ic">✓</span>已沉淀';
            skillBtn.title = `技能"${result.name}"已沉淀成功`;
            setTimeout(() => { skillBtn.innerHTML = '<span class="ic">💡</span>沉淀技能'; skillBtn.disabled = false; }, 3000);
            // 弹气泡提示
            if (pet && pet.showBubble) {
              pet.showBubble(`✅ 技能"${result.name}"已沉淀！下次类似任务小橘会自动激活它喵～`, 4000);
            }
          } else if (result.skipped) {
            skillBtn.innerHTML = '<span class="ic">✗</span>不适合沉淀';
            skillBtn.title = result.reason || '这次任务不适合沉淀为技能';
            setTimeout(() => { skillBtn.innerHTML = '<span class="ic">💡</span>沉淀技能'; skillBtn.disabled = false; }, 3000);
          } else {
            skillBtn.innerHTML = '<span class="ic">✗</span>失败';
            skillBtn.title = result.error || '沉淀失败';
            setTimeout(() => { skillBtn.innerHTML = '<span class="ic">💡</span>沉淀技能'; skillBtn.disabled = false; }, 2000);
          }
        } catch (err) {
          skillBtn.innerHTML = '<span class="ic">✗</span>失败';
          setTimeout(() => { skillBtn.innerHTML = '<span class="ic">💡</span>沉淀技能'; skillBtn.disabled = false; }, 2000);
        }
      });
      bar.appendChild(skillBtn);
    }

    // 朗读按钮（TTS 流式合成，只在 pet 回复上显示）
    if (showSpeak && window.pet && window.pet.ttsSpeakStream) {
      const speakBtn = document.createElement('button');
      speakBtn.className = 'chat-copy-btn chat-speak-btn';
      speakBtn.innerHTML = '<span class="ic">🔊</span>朗读';
      speakBtn.title = '朗读这段内容';
      speakBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        // 正在朗读 → 点击停止；别的按钮在播 → 停掉旧的接着播这段
        if (ttsPlayer.active) {
          const sameBtn = ttsPlayer.btn === speakBtn;
          ttsPlayer.stop(); // 会重置旧按钮显示
          if (sameBtn) return;
        }
        speakBtn.innerHTML = '<span class="ic">🎙</span>合成中';
        try {
          disableAutoReadThisReply(); // 手动朗读接管，本次回复不再自动播报
          // 朗读纯文本（去掉 Markdown 标记和 HTML）
          const plainText = toSpeakText(rawText || div.textContent || '', 1500);
          if (!plainText) {
            speakBtn.innerHTML = '<span class="ic">✗</span>无内容';
            setTimeout(() => { speakBtn.innerHTML = '<span class="ic">🔊</span>朗读'; }, 1500);
            return;
          }
          let gotFirst = false;
          await ttsPlayer.start(speakBtn, () => {
            if (gotFirst) return;
            gotFirst = true;
            speakBtn.innerHTML = '<span class="ic">⏹</span>停止'; // 首块 ~800ms 到达即开始播
          });
          const result = await window.pet.ttsSpeakStream(plainText, undefined, ttsPlayer.session);
          // 等解码队列排空，确认真有音频块被调度（否则不能一直卡在"合成中"）
          await ttsPlayer.queue.catch(() => {});
          if (ttsPlayer.btn !== speakBtn) return; // 已被停止或切换到别的朗读
          if (!result || !result.success || result.chunks === 0 || !gotFirst) {
            ttsPlayer.stop();
            speakBtn.innerHTML = '<span class="ic">✗</span>失败';
            speakBtn.title = (result && result.error) || '语音合成失败';
            setTimeout(() => { speakBtn.innerHTML = '<span class="ic">🔊</span>朗读'; }, 2000);
            return;
          }
          // 流式合成完成，轮询到播放自然结束后复位按钮
          clearInterval(speakBtn._endPoll);
          speakBtn._endPoll = setInterval(() => {
            if (!ttsPlayer.active || ttsPlayer.btn !== speakBtn) { clearInterval(speakBtn._endPoll); return; }
            if (ttsPlayer.ended()) {
              clearInterval(speakBtn._endPoll);
              ttsPlayer.stop();
            }
          }, 300);
        } catch (err) {
          ttsPlayer.stop();
          speakBtn.innerHTML = '<span class="ic">✗</span>失败';
          setTimeout(() => { speakBtn.innerHTML = '<span class="ic">🔊</span>朗读'; }, 2000);
        }
      });
      bar.appendChild(speakBtn);
    }
  }

  // 给消息气泡附加删除按钮（实时聊天消息也支持）
  function attachDelBtn(div, role, text) {
    const delBtn = document.createElement('button');
    delBtn.className = 'chat-msg-del';
    delBtn.textContent = '🗑';
    delBtn.title = '删除这条消息';
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      // 先按精确匹配删，失败再按前缀匹配（兼容图片/文件场景存储文本带后缀）
      let res = await window.pet.chatDeleteByContent(role, text);
      if (!res || !res.success) {
        res = await window.pet.chatDeleteByContent(role, text + ' [图片]');
      }
      if (res && res.success) {
        // 找到所属行并淡出移除
        const row = div.closest('.chat-msg-row');
        if (row) {
          row.style.transition = 'opacity 0.2s';
          row.style.opacity = '0';
          setTimeout(() => row.remove(), 200);
        }
      }
    });
    div.appendChild(delBtn);
  }

  // 创建头像元素（支持自定义图片）
  function createAvatarEl(role) {
    const avatar = document.createElement('div');
    avatar.className = 'chat-avatar ' + role;
    const custom = role === 'pet' ? (App.avatar && App.avatar.getPetAvatar()) : (App.avatar && App.avatar.getUserAvatar());
    if (custom && custom.src) {
      avatar.innerHTML = `<img src="${custom.src}" alt="${role}" />`;
    } else {
      avatar.textContent = role === 'pet' ? '🐱' : '我';
    }
    return avatar;
  }

  function addMessage(text, role, attachments) {
    // 隐藏空状态引导
    const emptyState = document.getElementById('chatEmptyState');
    if (emptyState) emptyState.style.display = 'none';
    // 消息行：头像 + 气泡
    const row = document.createElement('div');
    row.className = 'chat-msg-row ' + role;
    const avatar = createAvatarEl(role);
    // 气泡容器
    const wrap = document.createElement('div');
    wrap.className = 'chat-bubble-wrap';
    // 气泡
    const div = document.createElement('div');
    div.className = 'chat-msg ' + role;
    // 附件（图片缩略图 / 文件卡片）放正文上方
    renderAttachments(div, attachments);
    // 正文单独一层：不能用 div.textContent，会把上面的附件节点一起抹掉
    const content = document.createElement('div');
    content.className = 'chat-msg-text';
    if (role === 'pet' && App.markdown) {
      content.innerHTML = App.markdown.render(text);
    } else {
      content.textContent = text;
    }
    div.appendChild(content);
    if (role === 'pet' && App.markdown) {
      addCopyButton(div, text, false, true);
      // 绑定 HTML 折叠面板的保存/复制按钮
      bindHtmlButtons(div);
    } else {
      // 用户消息也加复制按钮（纯文本）
      addCopyButton(div, text);
    }
    attachDelBtn(div, role, text);
    wrap.appendChild(div);
    row.appendChild(avatar);
    row.appendChild(wrap);
    messagesEl.appendChild(row);
    fitHeight();
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // 显示空状态引导界面（清屏/清除历史时回到初始化界面）
  function showEmptyState() {
    messagesEl.innerHTML = '';
    // 重建空状态引导
    const empty = document.createElement('div');
    empty.className = 'chat-empty-state';
    empty.id = 'chatEmptyState';
    empty.innerHTML = `
      <div class="empty-icon">🐱</div>
      <div class="empty-title">和小橘聊点什么吧～</div>
      <div class="empty-hint">我会写代码、操作电脑、生成文档、接入外部工具…远不止聊天</div>
      <div class="empty-tags">
        <span class="empty-tag"><span class="tag-emoji">🐍</span>写代码</span>
        <span class="empty-tag"><span class="tag-emoji">📄</span>生成文档</span>
        <span class="empty-tag"><span class="tag-emoji">🔌</span>MCP工具</span>
        <span class="empty-tag"><span class="tag-emoji">💻</span>操作电脑</span>
        <span class="empty-tag"><span class="tag-emoji">🔄</span>定时任务</span>
        <span class="empty-tag"><span class="tag-emoji">🔍</span>联网搜索</span>
      </div>`;
    messagesEl.appendChild(empty);
    fitHeight();
  }

  // 创建流式消息行（头像 + 气泡），返回 { row, bubble } 供流式更新
  function createStreamRow() {
    const row = document.createElement('div');
    row.className = 'chat-msg-row pet';
    const avatar = createAvatarEl('pet');
    const wrap = document.createElement('div');
    wrap.className = 'chat-bubble-wrap';
    const bubble = document.createElement('div');
    bubble.className = 'chat-msg pet thinking';
    wrap.appendChild(bubble);
    row.appendChild(avatar);
    row.appendChild(wrap);
    messagesEl.appendChild(row);
    fitHeight();
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return { row, bubble };
  }

  // 添加提示气泡（如"已拖入文件"等），带头像行结构，返回 bubble 元素
  function addTipBubble(role, html, extraClass) {
    const row = document.createElement('div');
    row.className = 'chat-msg-row ' + role;
    const avatar = createAvatarEl(role);
    const wrap = document.createElement('div');
    wrap.className = 'chat-bubble-wrap';
    const bubble = document.createElement('div');
    bubble.className = 'chat-msg ' + role + (extraClass ? ' ' + extraClass : '');
    bubble.innerHTML = html;
    wrap.appendChild(bubble);
    row.appendChild(avatar);
    row.appendChild(wrap);
    messagesEl.appendChild(row);
    fitHeight();
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return bubble;
  }

  // 消息区高度自适应：内容少时收窄，内容多时撑高（跟随窗口大小）
  function fitHeight() {
    if (!messagesEl) return;
    messagesEl.style.height = 'auto';
    const h = messagesEl.scrollHeight;
    // 根据聊天框实际高度动态计算上限（窗口放大时消息区也放大）
    const boxH = boxEl ? boxEl.offsetHeight : 400;
    const maxH = Math.max(380, boxH - 160); // 减去标题栏+工具栏+输入栏的高度
    const target = Math.min(Math.max(h + 4, 150), maxH);
    messagesEl.style.height = target + 'px';
    // 高度变化后重新定位，防止超出屏幕
    if (isOpen) position();
  }

  let isWaiting = false; // 是否正在等待 AI 回复
  // 默认收窄：常规认知是「先小，点了才变大」。原来默认就是大窗，导致按钮第一下
  // 点下去必然是缩小——看起来就像"这个按钮是缩小"。
  let isExpanded = false;

  // 尺寸两档，形状是刻意不同的：
  //   · 普通档 8:9 竖构图 —— 读消息/读文档，视线纵向走
  //   · 最大化 4:3 横构图 —— 看表格、附件卡片、HTML 输出，要横向空间
  // 关键：比例是第一性的，尺寸跟着屏幕走。做法是在视口里「放一个定比例的框」，
  // 取宽/高约束里更紧的一边 —— 这样任何屏幕上比例都精确成立，不会变形。
  // （不要写成 宽=px、高=vh：那样屏高一变比例就飘，1080 是 0.89:1、1440 就成 0.67:1 了。）
  const SIZE_PRESETS = {
    normal: { ratio: 8 / 9, vw: 0.62, vh: 0.80 },
    large:  { ratio: 4 / 3, vw: 0.88, vh: 0.88 },
  };
  function applySizePreset() {
    const p = SIZE_PRESETS[isExpanded ? 'large' : 'normal'];
    const maxW = Math.round(window.innerWidth * p.vw);
    const maxH = Math.round(window.innerHeight * p.vh);
    let w = Math.round(maxH * p.ratio);
    let h = maxH;
    if (w > maxW) { w = maxW; h = Math.round(w / p.ratio); }
    boxEl.style.width = w + 'px';
    boxEl.style.height = h + 'px';
  }

  // 尺寸按钮的图标/tooltip 必须表达「点下去会发生什么」，跟 Windows 最大化/还原一致。
  // 原来 title 写死"放大窗口"，而默认就是大窗 —— 第一下点下去反而是缩小，完全误导。
  // 图标用 Windows 标准的最大化/还原字形（🗖 / 🗗），不用文字按钮，也不用 ⤡⤢
  // （那两个都是对角双箭头，小尺寸下分不出来）。
  // 所有改尺寸的地方（点击、拖拽、开关聊天框）都要过 syncExpandBtn，否则状态会失同步。
  function syncExpandBtn() {
    const btn = document.getElementById('chatExpandBtn');
    if (!btn) return;
    btn.textContent = isExpanded ? '🗗' : '🗖';   // 🗗=还原  🗖=最大化
    btn.title = isExpanded ? '还原窗口（8:9 竖构图，读消息）' : '最大化窗口（4:3 横构图，看表格/附件）';
    btn.classList.toggle('is-expanded', isExpanded);
  }

  async function send() {
    // 等待中点击发送按钮 → 停止生成（文本/图片都适用）
    if (isWaiting) {
      if (window.pet.chatStop) {
        try { await window.pet.chatStop(); } catch (e) { console.warn('[chat] 停止请求异常:', e); }
      }
      return;
    }
    let text = inputEl.value.trim();
    // 什么都没有就不发：必须在取走待发内容之前判断，否则 return 会把它们弄丢
    const hasPendingImage = !!(App.chat._peekPendingImageCount && App.chat._peekPendingImageCount() > 0);
    const hasPendingFile = !!window._pendingFileContent;
    if (!text && !hasPendingImage && !hasPendingFile) return;

    // 支持注入拖拽文件内容（发送给 AI 但不在聊天框显示文件内容）
    let hiddenContext = '';
    if (window._pendingFileContent) {
      hiddenContext = window._pendingFileContent;
      window._pendingFileContent = null;
      inputEl.value = '';
      inputEl.placeholder = '对小橘说点什么…';
    }
    // 待发送的文件附件（聊天框里显示文件卡片，双击可打开）
    const pendingFiles = takePendingFiles();
    // 文件完整路径清单：一并发给模型。否则它手上只有文件名，要用文件时只能自己
    // search_file 去搜，而搜索范围覆盖不全 → 会一直"再找找看～"
    const filePathsNote = pendingFiles.filter(f => f.path)
      .map(f => `- ${f.name} → ${f.path}`).join('\n');
    // 只带文件没打字 → 给个默认提问，和"只发图片"的行为保持一致
    if (!text && pendingFiles.length) text = '请看看这个文件的内容。';

    // 检查是否有待发送的图片（截屏/上传/粘贴，支持多张）
    const pendingImages = App.chat._getPendingImages ? App.chat._getPendingImages() : [];

    // ===== 流式渲染共享状态 =====
    // 注意：图片分支和文本分支共用，必须在两条路径之前初始化。
    // 这些 let 放到 send() 后面才声明的话，图片分支先 return，访问时会触发 TDZ
    // （Cannot access 'agentContentEl' before initialization）。
    let agentContentEl = null;   // 正文容器（步骤/思考块插在它前面，实现交错排列）
    let thinkingAdded = false;   // 防止重复追加"思考中"步骤
    let progressBar = null;      // 链路进度条
    let stepCount = 0;
    let renderTimer = null;      // 流式渲染节流定时器
    let firstChunk = true;       // 是否还没收到第一个正文 chunk
    let streamText = '';         // 本轮正文（多轮 agent loop 中会被重置）
    // 当前回复的行/气泡。必须和上面一起提前声明：
    // ensureAgentContentEl 等共享函数会往 streamEl 里插正文，
    // 而图片分支在自己的块里还声明过同名 const 会遮蔽它 → TDZ。
    let streamRow = null;
    let streamEl = null;
    // 思考过程折叠块的状态：被 ensureReasoningEl / onReasoningDelta 等函数引用，
    // 同样必须在任何分支之前初始化。
    let reasoningEl = null, reasoningBodyEl = null, reasoningTimeEl = null;
    let reasoningText = '', reasoningStart = 0, reasoningTruncated = false, reasoningCollapsed = false;
    let reasoningTimer = null;
    let reasoningRenderTimer = null;
    const REASONING_MAX = 4000; // 思考展示上限，超长省略（避免刷屏）
    let allStreamText = ''; // 跨轮次累积所有正文（用于聊天记录/删除按钮）
    let wasStopped = false;

    // 有图片 → 走 vision 模型（不要求文字，空文字也行）
    if (pendingImages && pendingImages.length > 0) {
      // 图片+文件同时存在时，把文件内容附加到问题中一起发给 vision 模型
      const displayText = text || '请描述这些图片的内容。'; // 聊天框只显示提问，不显示文件内容
      let q = displayText;
      if (hiddenContext) {
        q = q + '\n\n【以下是用户提供的文件内容（当前任务的核心材料，请实质地分析它；不要整段照抄，但也不要只当背景一笔带过）】' + hiddenContext;
        hiddenContext = ''; // 已附加到问题中，不再走文本路径
      }
      // 附上完整路径，模型要再读/打开这些文件时直接用，不必自己去搜
      if (filePathsNote) {
        q += '\n\n【这些文件在主人电脑上的完整路径】需要读取或打开这些文件时，直接用下面的路径调用工具，不要再调用 search_file 去找：\n' + filePathsNote;
      }
      if (!isWaiting) {
        isWaiting = true; // 必须在 await 之前置位，否则落盘期间可重复点击发送
        inputEl.value = '';
        inputEl.style.height = 'auto';
        inputEl.placeholder = '输入消息…';
        // 图片落盘到 chat_assets（历史记录存路径，重启后还能看/打开），文件直接引用原路径
        const userAttach = await persistImageAttachments(pendingImages);
        userAttach.files = pendingFiles;
        // 本次会话直接用内存里的图显示，不用再走 IPC 读回
        userAttach.images.forEach((im, i) => {
          if (pendingImages[i]) im.dataUrl = imgSrcOf(pendingImages[i].src);
        });
        addMessage(displayText, 'user', userAttach);
        const imgLabel = pendingImages.length > 1 ? ` [${pendingImages.length}张图片]` : ' [图片]';
        const fileLabel = pendingFiles.length ? ` [${pendingFiles.length}个文件]` : '';
        addChatRecord('user', displayText + imgLabel + fileLabel, userAttach);
        sendBtn.disabled = false;
        inputEl.disabled = true;
        sendBtn.textContent = '⏹ 停止';
        // 赋值给 send() 顶层的 streamRow/streamEl（不能 const 重新声明，会遮蔽外层变量）
        ({ row: streamRow, bubble: streamEl } = createStreamRow());
        streamEl.textContent = pendingImages.length > 1 ? `👁️ 正在看图（${pendingImages.length}张）…` : '👁️ 正在看图…';
        messagesEl.scrollTop = messagesEl.scrollHeight;
        fitHeight();

        // 监听 skill 激活标记（作为一条步骤插入，不要覆盖已流式出来的正文）
        const onSkill = (data) => {
          if (data && data.name) {
            appendAgentStep(`🧩 正在执行技能：${data.name}…`);
            streamEl.classList.remove('thinking');
          }
        };
        const removeSkillListener = window.pet.onChatSkill ? window.pet.onChatSkill(onSkill) : null;

        // 流式输出（复用节流渲染 scheduleStreamRender，避免逐 token 全量重排卡顿）
        const onChunk = (delta) => {
          if (firstChunk) {
            streamEl.classList.remove('thinking');
            firstChunk = false;
            streamEl.textContent = ''; // 清掉"正在看图…"占位，正文交给正文容器渲染
          }
          streamText += delta;
          scheduleStreamRender();
        };
        const removeChunkListener = window.pet.onChatChunk(onChunk);

        try {
          const res = await window.pet.chatVision(pendingImages.map((p) => p.src), q);
          removeChunkListener();
          if (removeSkillListener) removeSkillListener();
          // 收尾：把最后一批还没渲染的 chunk 冲刷出来（只 clearTimeout 会丢内容 → 空气泡）
          finishStreamRender();
          streamEl.classList.remove('thinking');
          // 用户停止生成
          if (res && res.stopped) {
            if (streamText) {
              if (App.markdown) {
                const contentEl = ensureAgentContentEl();
                contentEl.innerHTML = App.markdown.render(streamText) + '<span class="chat-stopped-tag">⏹ 已停止</span>';
                addCopyButton(contentEl, streamText, false, true);
                bindHtmlButtons(contentEl);
              } else {
                const contentEl = ensureAgentContentEl();
                contentEl.textContent = streamText + ' ⏹ 已停止';
              }
              addChatRecord('pet', streamText);
              attachDelBtn(streamEl, 'pet', streamText);
            } else {
              streamEl.textContent = '⏹ 已停止';
            }
          } else if (res && res.reply) {
            // 流式已推送的不再重复渲染；非流式（或流式但一个 chunk 都没收到）则整体渲染
            if (!res.streamed || firstChunk) {
              firstChunk = false;
              streamEl.textContent = ''; // 清掉"正在看图…"占位
              if (App.markdown) {
                const contentEl = ensureAgentContentEl();
                contentEl.innerHTML = App.markdown.render(res.reply);
              } else {
                const contentEl = ensureAgentContentEl();
                contentEl.textContent = res.reply;
              }
            }
            if (App.markdown) {
              const contentEl = ensureAgentContentEl();
              addCopyButton(contentEl, res.reply, false, true);
              bindHtmlButtons(contentEl);
            }
            addChatRecord('pet', res.reply);
            attachDelBtn(streamEl, 'pet', res.reply);
            maybeAutoSpeak(res.reply); // 自动播报（设置开启时）
          } else {
            streamEl.textContent = '喵…图片理解失败了';
          }
        } catch (e) {
          removeChunkListener();
          if (removeSkillListener) removeSkillListener();
          if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
          streamEl.classList.remove('thinking');
          streamEl.textContent = '喵…出错了：' + e.message;
        }
        isWaiting = false;
        sendBtn.disabled = false;
        inputEl.disabled = false;
        sendBtn.textContent = '发送';
        fitHeight();
        messagesEl.scrollTop = messagesEl.scrollHeight;
        inputEl.focus();
      }
      return;
    }

    inputEl.value = '';
    inputEl.style.height = 'auto';
    // 聊天框只显示用户的提问文字，不显示文件内容（文件内容进 hiddenContext）
    const userAttach = { images: [], files: pendingFiles };
    addMessage(text, 'user', userAttach);
    addChatRecord('user', text, userAttach);
    // 实际发给 AI 的是提问 + 隐藏的文件内容。
    // 注意：这个前缀【以下是用户提供的文件内容】是 main.js 里 cleanUserMsg 剥离历史用的锚点，不能改。
    let sendText = hiddenContext ? '__SKIP_INTENT__' + text + '\n\n【以下是用户提供的文件内容（当前任务的核心材料，请实质地分析它；不要整段照抄，但也不要只当背景一笔带过）】' + hiddenContext : text;
    // 附上完整路径，模型要再读/打开这些文件时直接用，不必自己去搜
    if (filePathsNote) {
      sendText += '\n\n【这些文件在主人电脑上的完整路径】需要读取或打开这些文件时，直接用下面的路径调用工具，不要再调用 search_file 去找：\n' + filePathsNote;
    }
    isWaiting = true;
    sendBtn.disabled = false;
    inputEl.disabled = true;
    sendBtn.textContent = '⏹ 停止';

    // 创建流式消息元素，先显示"思考中"（赋值给顶层变量，见上面的说明）
    ({ row: streamRow, bubble: streamEl } = createStreamRow());
    streamEl.textContent = '';

    // 链路步骤和正文交错排列：步骤直接 append 到 streamEl，流式正文在独立容器内更新
    // （agentContentEl / thinkingAdded 等状态已提前到 send() 顶部声明）
    // 追加一条步骤（创建独立 div，不被后续覆盖）
    function appendAgentStep(text) {
      // 第一次追加步骤时移除 thinking 动画
      streamEl.classList.remove('thinking');
      // 如果已有正文容器，步骤插到正文前面（交错效果）
      const step = document.createElement('div');
      step.className = 'agent-step-line';
      step.innerHTML = `<span class="step-spinner"></span><span class="step-text">${(data => { const d = document.createElement('div'); d.textContent = data; return d.innerHTML; })(text)}</span>`;
      if (agentContentEl) {
        streamEl.insertBefore(step, agentContentEl);
      } else {
        streamEl.appendChild(step);
      }
      // 更新进度条
      updateProgress();
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return step;
    }
    // 标记步骤完成（移除 spinner）
    function completeAgentStep(stepEl) {
      if (stepEl) stepEl.classList.add('done');
    }
    // 进度条（progressBar / stepCount 已在 send() 顶部声明）
    function updateProgress() {
      stepCount++;
      if (!progressBar) {
        progressBar = document.createElement('div');
        progressBar.className = 'agent-progress-bar';
        progressBar.innerHTML = '<div class="agent-progress-fill"></div>';
        streamEl.insertBefore(progressBar, agentContentEl || null);
      }
      const fill = progressBar.querySelector('.agent-progress-fill');
      if (fill) {
        // 进度估算：每步增长，上限 90%（完成时填满）
        const pct = Math.min(90, stepCount * 12);
        fill.style.width = pct + '%';
      }
    }
    // 获取/创建正文容器
    function ensureAgentContentEl() {
      if (agentContentEl) return agentContentEl;
      agentContentEl = document.createElement('div');
      agentContentEl.className = 'agent-content';
      streamEl.appendChild(agentContentEl);
      return agentContentEl;
    }
    // 开始新一轮正文：重置正文容器，让下一轮正文在新容器显示
    function startNewRoundContent() {
      agentContentEl = null;
      streamText = '';
      // 不重置 firstChunk，避免 onStatus 重复追加步骤
    }

    // ===== 思考过程折叠块（DeepSeek 风格：流式时展开，正文开始后折叠成"已思考 X 秒"一行）=====
    // （reasoning* 状态已提前到 send() 顶部声明，避免函数被提前调用时 TDZ）
    function ensureReasoningEl() {
      if (reasoningEl) return reasoningEl;
      reasoningStart = Date.now();
      const div = document.createElement('div');
      div.className = 'reasoning-block';
      div.innerHTML =
        '<div class="reasoning-header">' +
          '<span class="reasoning-icon">🧠</span>' +
          '<span class="reasoning-title">思考过程</span>' +
          '<span class="reasoning-time"></span>' +
          '<span class="reasoning-arrow">▾</span>' +
        '</div>' +
        '<div class="reasoning-body"><pre class="reasoning-text"></pre></div>';
      reasoningBodyEl = div.querySelector('.reasoning-text');
      reasoningTimeEl = div.querySelector('.reasoning-time');
      div.querySelector('.reasoning-header').addEventListener('click', () => {
        reasoningCollapsed = !reasoningCollapsed;
        div.classList.toggle('collapsed', reasoningCollapsed);
      });
      // 思考在上、答案在下（插到正文容器前面）
      if (agentContentEl) streamEl.insertBefore(div, agentContentEl);
      else streamEl.appendChild(div);
      reasoningEl = div;
      updateReasoningTime();
      streamEl.classList.remove('thinking');
      return div;
    }
    function updateReasoningTime() {
      if (!reasoningTimeEl) return;
      const sec = Math.max(1, Math.round((Date.now() - (reasoningStart || Date.now())) / 1000));
      reasoningTimeEl.textContent = `已思考 ${sec} 秒`;
    }
    // 思考文本的 DOM 刷新也节流：逐 token 重设整个 <pre> 的 textContent 是 O(n²)，思考越长越卡
    function flushReasoningRender() {
      if (!reasoningBodyEl) return;
      reasoningBodyEl.textContent = reasoningText + (reasoningTruncated ? '\n…（思考过程过长，已省略）' : '');
      updateReasoningTime();
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
    function scheduleReasoningRender() {
      if (reasoningRenderTimer) return;
      reasoningRenderTimer = setTimeout(() => {
        reasoningRenderTimer = null;
        flushReasoningRender();
      }, 100);
    }
    function onReasoningDelta(delta) {
      if (!delta) return;
      ensureReasoningEl();
      if (reasoningText.length < REASONING_MAX) reasoningText += delta;
      else reasoningTruncated = true;
      scheduleReasoningRender();
      if (!reasoningTimer) reasoningTimer = setInterval(updateReasoningTime, 1000);
    }
    function collapseReasoning() {
      if (reasoningTimer) { clearInterval(reasoningTimer); reasoningTimer = null; }
      // 收尾时把还没刷进 DOM 的思考文本补上
      if (reasoningRenderTimer) { clearTimeout(reasoningRenderTimer); reasoningRenderTimer = null; }
      flushReasoningRender();
      updateReasoningTime();
      if (reasoningEl && !reasoningCollapsed) {
        reasoningCollapsed = true;
        reasoningEl.classList.add('collapsed');
      }
    }

    // ===== 流式渲染节流：逐 token 全量重渲染 Markdown 会卡顿，攒 80ms 渲染一次 =====
    // 把累计的 streamText 立刻刷进 DOM。
    // 收尾时必须调这个，不能只 clearTimeout —— 只取消不冲刷会把最后一批 chunk 弄丢。
    function flushStreamRender() {
      const contentEl = ensureAgentContentEl();
      if (App.markdown) {
        contentEl.innerHTML = renderStreamMarkdown(streamText);
      } else {
        contentEl.textContent = streamText;
      }
      fitHeight();
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
    function scheduleStreamRender() {
      if (renderTimer) return;
      renderTimer = setTimeout(() => {
        renderTimer = null;
        flushStreamRender();
      }, 80);
    }
    // 收尾：取消未触发的定时器，并把内容补刷出来
    function finishStreamRender() {
      if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
      if (streamText) flushStreamRender();
    }

    messagesEl.scrollTop = messagesEl.scrollHeight;

    // 自动播报状态初始化（预取配置，流式句子提取从头开始）
    autoReadCursor = 0; autoReadChars = 0; autoReadCache = null;
    window.pet.ttsGetConfig().then((cfg) => {
      autoReadCache = !!(cfg && cfg.autoRead && cfg.configured);
    }).catch(() => { autoReadCache = false; });
    const onChunk = (delta) => {
      if (firstChunk) {
        streamEl.classList.remove('thinking');
        firstChunk = false;
        // 正文开始输出 → 思考块自动折叠（只留"已思考 X 秒"一行）
        collapseReasoning();
      }
      streamText += delta;
      allStreamText += delta;
      autoReadTick(allStreamText); // 自动播报：完整句子一到就排队朗读（边流式边播）
      scheduleStreamRender(); // 节流渲染，避免逐 token 全量重排卡顿
    };
    const removeChunkListener = window.pet.onChatChunk(onChunk);
    // 监听思考内容增量（reasoning_content），流式展示在可折叠块里
    const removeReasoningListener = window.pet.onChatReasoning ? window.pet.onChatReasoning(onReasoningDelta) : null;

    // 监听 skill 激活标记
    const onSkill = (data) => {
      if (data && data.name) {
        // 技能激活也作为一条步骤插入
        appendAgentStep(`🧩 正在执行技能：${data.name}…`);
        streamEl.classList.remove('thinking');
      }
    };
    const removeSkillListener = window.pet.onChatSkill ? window.pet.onChatSkill(onSkill) : null;

    // 监听搜索状态（联网搜索时显示提示）— 非工具步骤也沉淀到链路区
    const onStatus = (data) => {
      if (data.status === 'searching') {
        if (firstChunk) appendAgentStep('🔍 正在搜索网络…');
      } else if (data.status === 'searching_done') {
        if (firstChunk) appendAgentStep('✅ 搜索完成，整理答案中…');
      } else if (data.status === 'file_searching') {
        if (firstChunk) appendAgentStep('📁 正在搜索文件…');
      } else if (data.status === 'file_searching_done') {
        if (firstChunk) appendAgentStep('📋 整理结果中…');
      } else if (data.status === 'reading') {
        if (firstChunk) appendAgentStep('📖 正在读取文件…');
      } else if (data.status === 'reading_done') {
        if (firstChunk) appendAgentStep('📝 分析文件内容中…');
      } else if (data.status === 'thinking') {
        // 首次思考提示（不重复）
        if (firstChunk && !thinkingAdded) { appendAgentStep('🐾 正在理解主人的话…'); thinkingAdded = true; }
      } else if (data.status === 'agent_step') {
        // Agent Loop 每一步沉淀到链路区（不覆盖）
        if (data.done) {
          // 工具执行完成，标记最后一步为 done
          const steps = streamEl.querySelectorAll('.agent-step-line:not(.done)');
          if (steps.length) completeAgentStep(steps[steps.length - 1]);
          startNewRoundContent();
        } else {
          appendAgentStep(data.text || '🐾 正在处理…');
        }
      } else if (data.status === 'plan_show') {
        // Claude 风格内联计划卡片（带确认/取消按钮）
        const choiceId = data.choiceId;
        const esc = (s) => { const d = document.createElement('div'); d.textContent = (s == null ? '' : String(s)); return d.innerHTML; };
        // 过滤掉 null/undefined/空字符串的步骤，避免显示 "undefined"
        const steps = (data.steps || []).map(s => (s == null ? '' : String(s)).trim()).filter(s => s.length > 0);
        const planHtml = `<div class="plan-card">` +
          `<div class="plan-card-header"><span class="plan-card-icon">📋</span><span class="plan-card-title">${esc(data.title || '执行计划')}</span></div>` +
          `<div class="plan-card-steps">${steps.map((s, i) => `<div class="plan-card-step"><span class="plan-step-num">${i + 1}</span><span class="plan-step-text">${esc(s)}</span></div>`).join('')}</div>` +
          `<div class="plan-card-actions">` +
            `<button class="plan-card-btn plan-card-confirm" data-choice-id="${choiceId}" data-choice-index="0">✓ 确认执行</button>` +
            `<button class="plan-card-btn plan-card-cancel" data-choice-id="${choiceId}" data-choice-index="1">取消</button>` +
          `</div>` +
          `</div>`;
        const planDiv = document.createElement('div');
        planDiv.innerHTML = planHtml;
        const planEl = planDiv.firstChild;
        if (agentContentEl) {
          streamEl.insertBefore(planEl, agentContentEl);
        } else {
          streamEl.appendChild(planEl);
        }
        // 绑定确认/取消按钮
        planEl.querySelectorAll('.plan-card-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const cid = parseInt(btn.dataset.choiceId);
            const cidx = parseInt(btn.dataset.choiceIndex);
            // 移除按钮区
            const actions = planEl.querySelector('.plan-card-actions');
            if (actions) actions.remove();
            // 发送选择结果到主进程
            if (window.pet && window.pet.choiceResult) {
              window.pet.choiceResult({ id: cid, index: cidx });
            }
          });
        });
        messagesEl.scrollTop = messagesEl.scrollHeight;
      } else if (data.status && data.status.startsWith('tool:')) {
        // 兼容旧状态（不应到达，agent_step 已替代）
        const toolNames = {
          open_app: '打开应用', search_file: '搜索文件', read_file: '读取文件',
          open_file: '打开文件', copy_file: '复制文件', move_file: '移动文件',
          delete_file: '删除文件', system_op: '系统操作', search_web: '搜索网络',
          fetch_webpage: '读取网页', get_weather: '查询天气', set_reminder: '设置提醒',
          set_recurring_reminder: '设置循环提醒', query_knowledge_base: '查询知识库',
          list_directory: '浏览文件夹',
        };
        const label = toolNames[data.tool] || data.tool || '工具';
        streamEl.textContent = `🔧 正在调用工具：${label}…`;
      } else if (data.status === 'tool_done') {
        streamEl.textContent = '📝 整理结果中…';
      }
    };
    const removeStatusListener = window.pet.onChatStatus(onStatus);

    try {
      const res = (await window.pet.chat(sendText)) || {};
      if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
      removeChunkListener();
      removeStatusListener();
      if (removeSkillListener) removeSkillListener();
      if (removeReasoningListener) removeReasoningListener();
      collapseReasoning();

      // 完成进度条，标记所有步骤为 done
      if (progressBar) { const f = progressBar.querySelector('.agent-progress-fill'); if (f) f.style.width = '100%'; }
      streamEl.querySelectorAll('.agent-step-line:not(.done)').forEach(s => s.classList.add('done'));

      // 文件操作场景：匹配到多个文件，弹出选择框，不显示 AI 回复
      if (res.reply === '__FILE_CHOOSE__') {
        streamRow.remove();
        const actionText = { copy: '复制', move: '移动', delete: '删除' }[res.action] || '操作';
        pet.showBubble(`喵～找到多个文件，请选择要${actionText}的文件！`, 4000);
        return;
      }

      // 用户手动停止时，保留已生成的部分文本
      if (res.stopped) {
        wasStopped = true;
        if (!streamText && res.reply) { streamText = res.reply; allStreamText = res.reply; }
      }
      // 结束标记：超时/中断/手动停止（内容保留，仅加小提示）
      const endTag = res.timedOut ? '<span class="chat-stopped-tag">⚠️ 响应超时</span>'
        : res.interrupted ? '<span class="chat-stopped-tag">⚠️ 回复中断</span>'
        : wasStopped ? '<span class="chat-stopped-tag">⏹ 已停止</span>' : '';
      const endTagText = res.timedOut ? ' ⚠️（响应超时）' : res.interrupted ? ' ⚠️（回复中断）' : wasStopped ? ' ⏹ 已停止' : '';

      // 若全程未收到流式 chunk（兜底场景），用返回结果填充
      if (firstChunk && res.reply && res.reply !== '__FILE_CHOOSE__') {
        streamEl.classList.remove('thinking');
        streamText = res.reply;
        allStreamText = res.reply;
      }
      // 后端自检修复成功（res.corrected）→ 用修正版整体替换。
      // 否则 allStreamText 里坏版本和修复版并存，最终渲染出来就是两份大表格。
      if (res.corrected && res.reply) {
        streamText = res.reply;
        allStreamText = res.reply;
      }
      // 流式结束后最终渲染一次 Markdown（确保完整）—— 用 allStreamText 渲染全部内容（跨轮次累积）
      // 多轮 agent loop 中 streamText 每轮被 startNewRoundContent() 重置，但 HTML 可能在中间轮生成
      // 所以最终渲染必须用 allStreamText，否则跨轮生成的 HTML 会丢失
      // 另外，LLM 可能输出 ```html 后切去调工具，没输出闭合 ```，需要补全闭合标记
      if (App.markdown && allStreamText) {
        // 移除所有之前的正文容器（内容已累积到 allStreamText，统一渲染到一个容器）
        streamEl.querySelectorAll('.agent-content').forEach(el => el.remove());
        agentContentEl = null;
        const contentEl = ensureAgentContentEl();
        const renderText = closeUnclosedFences(allStreamText);
        contentEl.innerHTML = App.markdown.render(renderText) + endTag;
        // 没被手动停止且有工具调用步骤时，显示沉淀技能按钮
        const hasToolSteps = streamEl.querySelectorAll('.agent-step-line').length > 0;
        addCopyButton(contentEl, renderText, !wasStopped && hasToolSteps, true);
        bindHtmlButtons(contentEl);
      } else if (allStreamText) {
        streamEl.querySelectorAll('.agent-content').forEach(el => el.remove());
        agentContentEl = null;
        const contentEl = ensureAgentContentEl();
        contentEl.textContent = allStreamText + endTagText;
      }
      streamEl.classList.remove('thinking');
      // 全程没收到任何内容：给明确提示，不留空白气泡
      if (!allStreamText) {
        streamEl.textContent = res.timedOut ? '喵…AI 大脑思考太久没响应，等会儿再试试吧～' : '喵…这次没收到回复内容，稍后再试试吧～';
      }
      fitHeight();
      messagesEl.scrollTop = messagesEl.scrollHeight;
      // 聊天记录/删除按钮用累积的全部正文（跨轮次）
      if (allStreamText) addChatRecord('pet', allStreamText);
      if (allStreamText) attachDelBtn(streamEl, 'pet', allStreamText);
      if (!wasStopped && allStreamText) {
        autoReadFinish(allStreamText); // 自动播报：补播未以标点结尾的尾巴（正文已边流式边播）
        pet.showBubble(allStreamText.slice(0, 60), 3000);
        pet.setMood('happy');
        state.adjust({ happiness: 1 });
        setTimeout(() => { if (!state.runtime.isDragging) pet.setMood(state.computeMood()); }, 1600);
      }
    } catch (err) {
      removeChunkListener();
      removeStatusListener();
      if (removeReasoningListener) removeReasoningListener();
      if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
      collapseReasoning();
      streamEl.classList.remove('thinking');
      // 出错时保留已生成的内容，只追加提示（整段抹掉会让用户觉得"断掉了"）
      if (allStreamText) {
        streamEl.querySelectorAll('.agent-content').forEach(el => el.remove());
        agentContentEl = null;
        const contentEl = ensureAgentContentEl();
        if (App.markdown) {
          contentEl.innerHTML = App.markdown.render(closeUnclosedFences(allStreamText)) + '<span class="chat-stopped-tag">⚠️ 连接异常</span>';
        } else {
          contentEl.textContent = allStreamText + ' ⚠️连接异常';
        }
        addChatRecord('pet', allStreamText);
        attachDelBtn(streamEl, 'pet', allStreamText);
      } else {
        streamEl.textContent = '喵？信号不太好，等会儿再聊…';
      }
    } finally {
      isWaiting = false;
      sendBtn.disabled = false;
      inputEl.disabled = false;
      sendBtn.textContent = '发送';
      inputEl.focus();
    }
  }

  function position() {
    const r = state.runtime;
    let x = r.x + 180;
    let y = r.y - 20;
    // 先显示才能测量
    boxEl.style.left = x + 'px';
    boxEl.style.top = y + 'px';
    // 测量实际高度后修正，确保不超出屏幕
    const bw = boxEl.offsetWidth || 300;
    const bh = boxEl.offsetHeight || 400;
    if (x + bw > window.innerWidth - 8) x = r.x - bw - 20;
    if (x < 8) x = 8;
    if (y < 8) y = r.y + 176 + 8;
    if (y + bh > window.innerHeight - 8) y = window.innerHeight - bh - 8;
    if (y < 8) y = 8;
    boxEl.style.left = x + 'px';
    boxEl.style.top = y + 'px';
  }

  App.chat = {
    init() {
      pet = App.pet;
      boxEl = document.getElementById('chatbox');
      messagesEl = document.getElementById('chatMessages');
      inputEl = document.getElementById('chatInput');
      sendBtn = document.getElementById('chatSend');
      const closeBtn = document.querySelector('.chatbox-close');

      sendBtn.addEventListener('click', send);
      // Enter 发送，Shift+Enter 换行（参考微信）
      inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          send();
        }
      });
      // 输入时自动撑高（微信式自适应高度）
      inputEl.addEventListener('input', () => {
        inputEl.style.height = 'auto';
        inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
      });
      // ✕ 收起聊天框，宠物留在桌面
      closeBtn.addEventListener('click', () => App.chat.close());

      // 溢出菜单：低频/危险操作收进来，头部只留 ⤢ ··· — ✕
      const moreBtn = document.getElementById('chatMoreBtn');
      const moreMenu = document.getElementById('chatMoreMenu');
      if (moreBtn && moreMenu) {
        const closeMore = () => {
          moreMenu.classList.add('hidden');
          moreBtn.classList.remove('active');
        };
        moreBtn.addEventListener('click', (e) => {
          e.stopPropagation();   // 否则 document 的点击监听会立刻把它关掉
          const opening = moreMenu.classList.toggle('hidden');
          moreBtn.classList.toggle('active', !opening);
        });
        // 点菜单外或按 Esc 关闭
        document.addEventListener('click', (e) => {
          if (!moreMenu.classList.contains('hidden') && !moreMenu.contains(e.target)) closeMore();
        });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMore(); });
        // 点了菜单项就收起（各按钮自己的 handler 照常跑）
        moreMenu.addEventListener('click', closeMore);
      }

      // 监听注入消息（定时面板等外部调用发消息）
      if (window.pet.onInjectMessage) {
        window.pet.onInjectMessage((msg) => {
          if (!App.chat.isOpen()) App.chat.open();
          inputEl.value = msg;
          send();
        });
      }

      // 清屏按钮
      const clearBtn = document.getElementById('chatClearBtn');
      clearBtn.addEventListener('click', () => {
        showEmptyState();
        clearBtn.textContent = '✓';
        setTimeout(() => { clearBtn.textContent = '🧹'; }, 1000);
      });

      // 导出对话按钮
      const exportBtn = document.getElementById('chatExportBtn');
      if (exportBtn) {
        exportBtn.addEventListener('click', () => {
          const msgs = messagesEl.querySelectorAll('.chat-msg');
          if (msgs.length === 0) return;
          let md = `# 🐱 小橘猫缘缘 · 对话记录\n\n导出时间：${new Date().toLocaleString('zh-CN')}\n\n---\n\n`;
          msgs.forEach((m) => {
            const isUser = m.classList.contains('user');
            const role = isUser ? '🙋 主人' : '🐱 小橘';
            md += `### ${role}\n\n${m.textContent.trim()}\n\n`;
          });
          const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `小橘对话_${new Date().toISOString().slice(0, 10)}.md`;
          a.click();
          URL.revokeObjectURL(url);
          exportBtn.textContent = '✓';
          setTimeout(() => { exportBtn.textContent = '📤'; }, 1000);
        });
      }

      // 清除聊天历史按钮（删除存储的聊天记录 + 对话记忆，保留用户画像）
      const clearHistoryBtn = document.getElementById('chatClearHistoryBtn');
      clearHistoryBtn.addEventListener('click', async () => {
        // 用自定义确认弹窗（避免原生 confirm 在透明窗口中的焦点/穿透问题）
        const ok = await App.chat.confirm('确定要清除全部聊天历史吗？', '这会删除所有保存的聊天记录，但会保留小橘对你的记忆（用户画像）和对话摘要。\n\n此操作不可撤销！');
        if (!ok) return;
        const res = await window.pet.chatClearHistory();
        if (res && res.success) {
          showEmptyState();
          clearHistoryBtn.textContent = '✓';
          setTimeout(() => { clearHistoryBtn.textContent = '🗑'; }, 1500);
        } else {
          addMessage('喵…清除历史时出了点问题，等会儿再试试？', 'pet');
        }
      });

      // 聊天记录按钮 → 直接在当前聊天框载入历史记录
      const historyBtn = document.getElementById('chatHistoryBtn');
      historyBtn.addEventListener('click', () => App.chat.loadHistory());

      // 尺寸切换：默认档 ↔ 最大化档（见 SIZE_PRESETS）
      const expandBtn = document.getElementById('chatExpandBtn');
      syncExpandBtn();
      expandBtn.addEventListener('click', () => {
        isExpanded = !isExpanded;
        applySizePreset();
        syncExpandBtn();
        position();
        // 延迟一帧等 CSS 应用后再调整高度
        requestAnimationFrame(() => { fitHeight(); messagesEl.scrollTop = messagesEl.scrollHeight; });
      });


      // 左上角拖拽缩放（保持右下角不动）
      const MIN_W = 340, MIN_H = 360;
      boxEl.addEventListener('mousedown', (e) => {
        // 用相对聊天框的坐标判断是否在左上角 18×18 区域
        // 不能用 e.offsetX/Y，因为那是相对于被点击的子元素，会误触发
        const rect = boxEl.getBoundingClientRect();
        const relX = e.clientX - rect.left;
        const relY = e.clientY - rect.top;
        if (relX > 18 || relY > 18) return;
        e.preventDefault();
        e.stopPropagation();
        const startRect = boxEl.getBoundingClientRect();
        const startX = e.clientX, startY = e.clientY;
        const fixedRight = startRect.right;
        const fixedBottom = startRect.bottom;
        let isResizing = true;
        const onMove = (ev) => {
          if (!isResizing) return;
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          let newL = startRect.left + dx;
          let newT = startRect.top + dy;
          let newW = fixedRight - newL;
          let newH = fixedBottom - newT;
          // 最小尺寸约束：保持右下角不动，只限制左/上
          if (newW < MIN_W) { newL = fixedRight - MIN_W; newW = MIN_W; }
          if (newH < MIN_H) { newT = fixedBottom - MIN_H; newH = MIN_H; }
          // 屏幕边界
          if (newL < 8) { newL = 8; newW = fixedRight - newL; }
          if (newT < 8) { newT = 8; newH = fixedBottom - newT; }
          boxEl.style.left = newL + 'px';
          boxEl.style.top = newT + 'px';
          boxEl.style.width = newW + 'px';
          boxEl.style.height = newH + 'px';
          fitHeight();
          // 记住用户调整的大小和位置
          savedWidth = newW;
          savedHeight = newH;
          savedLeft = newL;
          savedTop = newT;
          isExpanded = true; // 手动调整后标记为已展开
          syncExpandBtn();   // 图标/tooltip 跟着更新，否则显示的还是旧状态
        };
        const onUp = () => {
          isResizing = false;
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });

      // 拖拽标题栏移动聊天框
      const header = boxEl.querySelector('.chatbox-header');
      let isDragging = false, dragOffsetX = 0, dragOffsetY = 0;
      header.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) return; // 点按钮不拖拽
        isDragging = true;
        dragOffsetX = e.clientX - boxEl.offsetLeft;
        dragOffsetY = e.clientY - boxEl.offsetTop;
        header.style.cursor = 'grabbing';
        e.preventDefault();
      });
      document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        let x = e.clientX - dragOffsetX;
        let y = e.clientY - dragOffsetY;
        x = Math.max(0, Math.min(window.innerWidth - boxEl.offsetWidth, x));
        y = Math.max(0, Math.min(window.innerHeight - 40, y));
        boxEl.style.left = x + 'px';
        boxEl.style.top = y + 'px';
        // 记住拖动位置
        savedLeft = x;
        savedTop = y;
      });
      document.addEventListener('mouseup', () => {
        if (isDragging) { isDragging = false; header.style.cursor = ''; }
      });

      // 拖拽文件到聊天框 → 读取内容并缓存，等用户提问后再一起发送
      boxEl.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
      boxEl.addEventListener('drop', async (e) => {
        e.preventDefault(); e.stopPropagation();
        const files = e.dataTransfer && e.dataTransfer.files;
        if (!files || !files.length) return;
        const file = files[0];
        let filePath = '';
        try { filePath = (file.path || (window.pet.getPathForFile ? window.pet.getPathForFile(file) : '')) || ''; } catch (err) {}
        const fileName = file.name;
        if (!isOpen) App.chat.open();
        try {
          // 只显示"已拖入"提示，不自动分析
          const tip = addTipBubble('user', `📎 已拖入文件：<b>${fileName}</b><br><span style="opacity:0.7;font-size:12px">正在读取内容…</span>`, 'file-attached-tip');

          const { result, path: realPath } = await readLocalFile(file, filePath);
          filePath = realPath;
          if (result.ok) {
            const content = result.content.slice(0, 8000);
            const existing = window._pendingFileContent || '';
            window._pendingFileContent = existing + `\n\n【拖拽文件内容：${fileName}】\n${content}`;
            // 记下路径，随消息发给模型（拖入的文件以前从不记路径 → 模型只能自己去搜）
            pushPendingFile(fileName, filePath, file.size);
            registerAttachedFile(fileName, filePath, file.size, content);
            // docx 含图片 → 自动加入待发送图片列表
            if (result.images && result.images.length > 0) {
              result.images.forEach(img => addImage(img.base64));
              tip.innerHTML = `📎 已拖入文件：<b>${fileName}</b>${result.images && result.images.length ? `（${result.images.length} 张图片）` : ''}`;
            } else {
              tip.innerHTML = `📎 已拖入文件：<b>${fileName}</b>`;
            }
            inputEl.placeholder = `已加载文件，输入你的问题…`;
            inputEl.focus();
          } else {
            tip.innerHTML = `📎 已拖入文件：<b>${fileName}</b><br><span style="color:#e84040;font-size:12px">读取失败：${result.error}</span>`;
          }
        } catch (err) {
          addMessage('读取文件出错了喵：' + err.message, 'pet');
        }
      });

      // 待发送的图片 base64 缓存（支持多张）
      let pendingImages = [];
      const previewStrip = document.getElementById('chatPreviewStrip');
      const uploadImageBtn = document.getElementById('chatUploadImageBtn');
      const uploadFileBtn = document.getElementById('chatUploadFileBtn');
      const imageInput = document.getElementById('chatImageInput');
      const docInput = document.getElementById('chatDocInput');

      // 📚 知识库按钮 → 直接查询 IMA 知识库
      const kbBtn = document.getElementById('chatKbBtn');
      if (kbBtn) {
        kbBtn.addEventListener('click', async () => {
          // 先检查是否已配置知识库
          const cfg = await window.pet.imaLoadConfig();
          if (!cfg.clientId || !cfg.hasApiKey || !cfg.kbId) {
            // 未配置 → 打开知识库配置面板
            addMessage('喵～知识库还没配置好呢！先帮我配置一下嘛～', 'pet');
            if (App.ima) App.ima.open();
            return;
          }
          const text = inputEl.value.trim();
          if (!text) {
            // 没有输入文字 → 打开知识库面板
            if (App.ima) App.ima.open();
            return;
          }
          // 有输入文字 → 直接查询知识库
          await App.chat.askKnowledgeBase(text);
        });
      }

      const DEFAULT_PLACEHOLDER = '对小橘说点什么…';

      // 更新图片预览条（支持多张）
      function updatePreview() {
        previewStrip.innerHTML = '';
        pendingImages.forEach((img, idx) => {
          const thumb = document.createElement('div');
          thumb.className = 'chat-preview-thumb';
          thumb.innerHTML = `<img src="${imgSrcOf(img.src)}"><div class="remove-btn">✕</div>`;
          thumb.querySelector('.remove-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            pendingImages.splice(idx, 1);
            updatePreview();
            // 恢复 placeholder（只有文件也没加载时才恢复）
            if (!pendingImages.length && !window._pendingFileContent) {
              inputEl.placeholder = DEFAULT_PLACEHOLDER;
            }
          });
          previewStrip.appendChild(thumb);
        });
        if (pendingImages.length > 1) {
          const cnt = document.createElement('span');
          cnt.style.cssText = 'font-size:11px;color:#999;align-self:center;padding:0 4px;';
          cnt.textContent = `${pendingImages.length} 张图片`;
          previewStrip.appendChild(cnt);
        }
      }

      // 添加一张图片到待发送列表
      // src：data URL 或裸 base64；meta：{ path, name } —— 上传/拖拽能拿到真实路径（双击可打开原文件），粘贴的图片没有
      // 先入列占位再异步压缩替换：不阻塞选择/粘贴，也避免"压完才入列"导致用户抢在前面点发送丢图
      function addImage(src, meta) {
        const item = {
          src,
          path: (meta && meta.path) || '',
          name: (meta && meta.name) || '',
        };
        pendingImages.push(item);
        const idx = pendingImages.length - 1;
        updatePreview();
        inputEl.placeholder = `🖼️ ${pendingImages.length} 张图片已就绪，输入你想问的，或直接发送…`;
        inputEl.focus();
        compressImage(src).then((dataUrl) => {
          // 位置上还是同一张才替换（用户中途删掉就跳过，用原图不影响正确性）
          if (pendingImages[idx] === item) {
            item.src = dataUrl;
            updatePreview();
          }
        });
      }

      // 上传图片按钮
      uploadImageBtn.addEventListener('click', () => {
        suppressBlurHide = true;
        imageInput.click();
        // 文件选择器关闭后恢复（无论选中还是取消）
        setTimeout(() => { suppressBlurHide = false; }, 1000);
      });
      imageInput.addEventListener('change', (e) => {
        suppressBlurHide = false;
        const files = Array.from(e.target.files || []);
        files.forEach(file => {
          const reader = new FileReader();
          // 传完整 data URL，保留真实 mime（后面压缩后统一为 jpeg）
          const meta = fileMetaOf(file);
          reader.onload = (ev) => { addImage(ev.target.result, meta); };
          reader.readAsDataURL(file);
        });
        imageInput.value = '';
      });

      // 上传文件按钮（读取文件内容，走文本分析）
      uploadFileBtn.addEventListener('click', () => {
        suppressBlurHide = true;
        docInput.click();
        setTimeout(() => { suppressBlurHide = false; }, 1000);
      });
      docInput.addEventListener('change', async (e) => {
        suppressBlurHide = false;
        const files = Array.from(e.target.files || []);
        for (const file of files) {
          const fileName = file.name;
          // 路径只用于双击打开原文件，取不到也不影响读内容（readLocalFile 走字节兜底）
          let filePath = '';
          try { filePath = (window.pet.getPathForFile ? window.pet.getPathForFile(file) : '') || ''; } catch (err) {}
          try {
            const tip = addTipBubble('user', `📄 已上传文件：<b>${fileName}</b><br><span style="opacity:0.7;font-size:12px">正在读取内容…</span>`, 'file-attached-tip');
            const { result, path: realPath } = await readLocalFile(file, filePath);
            filePath = realPath;
            if (result.ok) {
              const content = result.content.slice(0, 8000);
              const existing = window._pendingFileContent || '';
              window._pendingFileContent = existing + `\n\n【上传文件内容：${fileName}】\n${content}`;
              pushPendingFile(fileName, filePath, file.size);
              registerAttachedFile(fileName, filePath, file.size, content);
              // docx 含图片 → 自动加入待发送图片列表
              if (result.images && result.images.length > 0) {
                result.images.forEach(img => addImage('data:image/' + (img.ext || 'png') + ';base64,' + img.base64));
                tip.innerHTML = `📄 已上传文件：<b>${fileName}</b>${result.images && result.images.length ? `（${result.images.length} 张图片）` : ''}`;
              } else {
                tip.innerHTML = `📄 已上传文件：<b>${fileName}</b>`;
              }
              inputEl.placeholder = `已加载文件，输入你的问题…`;
              inputEl.focus();
            } else {
              tip.innerHTML = `📄 已上传文件：<b>${fileName}</b><br><span style="color:#e84040;font-size:12px">读取失败：${result.error}</span>`;
            }
          } catch (err) {
            addMessage('读取文件出错了喵：' + err.message, 'pet');
          }
        }
        docInput.value = '';
      });

      // Ctrl+V 粘贴图片/文件（支持多个，累积）
      boxEl.addEventListener('paste', async (e) => {
        const items = e.clipboardData && e.clipboardData.items;
        if (!items) return;
        const itemArr = Array.from(items);
        if (!itemArr.some(i => i.kind === 'file' || i.type.startsWith('image/'))) return;
        e.preventDefault();

        for (const item of itemArr) {
          // 粘贴的图片
          if (item.type && item.type.startsWith('image/')) {
            const blob = item.getAsFile();
            if (!blob) continue;
            const reader = new FileReader();
            const meta = fileMetaOf(blob);
            reader.onload = (ev) => { addImage(ev.target.result, meta); };
            reader.readAsDataURL(blob);
            continue;
          }
          if (item.kind !== 'file') continue;
          const file = item.getAsFile();
          if (!file) continue;
          // 文件管理器复制的图片
          if (file.type && file.type.startsWith('image/')) {
            const reader = new FileReader();
            const meta = fileMetaOf(file);
            reader.onload = (ev) => { addImage(ev.target.result, meta); };
            reader.readAsDataURL(file);
            continue;
          }
          // 非图片文件 → 走文件读取流程
          const fileName = file.name;
          let filePath = file.path || '';
          if (!filePath && window.pet.getPathForFile) {
            try { filePath = window.pet.getPathForFile(file); } catch (err) {}
          }
          const tip = addTipBubble('user', `📎 已粘贴文件：<b>${fileName}</b><br><span style="opacity:0.7;font-size:12px">正在读取内容…</span>`, 'file-attached-tip');
          try {
            let result;
            if (filePath) {
              result = await window.pet.readFileContent(filePath);
            } else {
              // 没有 path → 先保存到临时文件，再用 IPC 读取
              const arrayBuffer = await file.arrayBuffer();
              const tmpRes = await window.pet.saveFile(new Uint8Array(arrayBuffer), `_tmp_paste_${Date.now()}_${fileName}`);
              if (tmpRes && tmpRes.success) {
                filePath = tmpRes.path; // 记下路径，双击可打开
                result = await window.pet.readFileContent(tmpRes.path);
              }
            }
            if (result && result.ok) {
              const content = result.content.slice(0, 8000);
              const existing = window._pendingFileContent || '';
              window._pendingFileContent = existing + `\n\n【粘贴文件内容：${fileName}】\n${content}`;
              pushPendingFile(fileName, filePath, file.size);
              registerAttachedFile(fileName, filePath, file.size, content);
              // docx 含图片 → 自动加入待发送图片列表
              if (result.images && result.images.length > 0) {
                result.images.forEach(img => addImage('data:image/' + (img.ext || 'png') + ';base64,' + img.base64));
                tip.innerHTML = `📎 已粘贴文件：<b>${fileName}</b>${result.images && result.images.length ? `（${result.images.length} 张图片）` : ''}`;
              } else {
                tip.innerHTML = `📎 已粘贴文件：<b>${fileName}</b>`;
              }
              inputEl.placeholder = `已加载文件，输入你的问题…`;
              inputEl.focus();
            } else {
              tip.innerHTML = `📎 已粘贴文件：<b>${fileName}</b><br><span style="color:#e84040;font-size:12px">读取失败：${result?.error || '未知错误'}</span>`;
            }
          } catch (err2) {
            tip.innerHTML = `📎 已粘贴文件：<b>${fileName}</b><br><span style="color:#e84040;font-size:12px">读取失败：${err2.message}</span>`;
          }
        }
      });

      // 只看数量不取走（send 先判断"有没有东西可发"，避免空发送把待发内容弄丢）
      App.chat._peekPendingImageCount = () => pendingImages.length;
      // 暴露 pendingImages 给 send 函数（返回数组）
      App.chat._getPendingImages = () => {
        const imgs = pendingImages.slice();
        pendingImages = [];
        updatePreview();
        if (!window._pendingFileContent) inputEl.placeholder = DEFAULT_PLACEHOLDER;
        return imgs;
      };
      // 兼容旧接口
      App.chat._getPendingImage = () => {
        const imgs = App.chat._getPendingImages();
        return imgs.length ? imgs : null;
      };

      // 不再加欢迎语，用空状态引导代替（HTML 中已有 #chatEmptyState）

      // ESC 键关闭弹窗（confirmModal + choiceModal + avatarCropModal + 图片放大）
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const modals = ['#confirmModal', '#choiceModal', '#avatarCropModal', '#imgLightbox'];
        for (const sel of modals) {
          const m = document.querySelector(sel);
          if (m && !m.classList.contains('hidden')) {
            // 模拟点击取消按钮
            const cancelBtn = m.querySelector('.confirm-cancel, .avatar-crop-cancel');
            if (cancelBtn) cancelBtn.click();
            else m.classList.add('hidden');
            e.preventDefault();
            break;
          }
        }
      });

      // 初始化通用选择弹窗监听
      App.chat.initChoiceModal();

      // 窗口失焦时收起聊天框（避免挡住其他应用）
      // 文件选择器打开时跳过（点上传按钮会触发窗口失焦，不应关闭聊天框）
      if (window.pet && window.pet.onChatBlurHide) {
        window.pet.onChatBlurHide(() => {
          if (suppressBlurHide) return;
          if (isOpen && !isWaiting) App.chat.close();
        });
      }
    },

    open() {
      const wasOpen = isOpen;   // 幂等：已经是打开状态就别再套用尺寸/位置
      isOpen = true;
      boxEl.classList.remove('hidden');
      // 只在"从关到开"时恢复大小位置。否则窗口重新聚焦也会调 open(),
      // savedWidth 还是 null（用户没关过）就会被打回默认尺寸。
      if (!wasOpen) {
        // 先定档位再套尺寸：默认走普通档（常规认知是先小、点了才变大）
        isExpanded = savedExpanded !== null ? savedExpanded : false;
        // 恢复用户上次调整的大小；没调过就套尺寸预设
        if (savedWidth && savedHeight) {
          boxEl.style.width = savedWidth + 'px';
          boxEl.style.height = savedHeight + 'px';
        } else {
          applySizePreset();
        }
        syncExpandBtn();
        // 恢复用户上次拖动的位置，没有则用默认 position()
        if (savedLeft !== null && savedTop !== null) {
          boxEl.style.left = savedLeft + 'px';
          boxEl.style.top = savedTop + 'px';
        } else {
          position();
        }
        App.uiOpen = (App.uiOpen || 0) + 1;
      }
      setTimeout(() => { fitHeight(); messagesEl.scrollTop = messagesEl.scrollHeight; inputEl.focus(); }, 100);
    },

    close() {
      if (!isOpen) return;
      // 保存用户调整的大小和位置
      const rect = boxEl.getBoundingClientRect();
      savedWidth = rect.width;
      savedHeight = rect.height;
      savedLeft = rect.left;
      savedTop = rect.top;
      savedExpanded = isExpanded;
      isOpen = false;
      boxEl.classList.add('hidden');
      if (App.uiOpen) App.uiOpen = Math.max(0, App.uiOpen - 1);
      if (!App.uiOpen) window.pet.setIgnoreMouse(true); // 恢复穿透
    },

    isOpen() { return isOpen; },
    toggle() { isOpen ? App.chat.close() : App.chat.open(); },
    addPetMessage(text) { addMessage(text, 'pet'); },
    addUserMessage(text) { addMessage(text, 'user'); },
    _addChatRecord: addChatRecord,
    send,

    // 通用选择弹窗初始化（监听主进程 choice:show 事件）
    initChoiceModal() {
      if (window.pet && window.pet.onChoiceShow) {
        window.pet.onChoiceShow((data) => {
          const modal = document.getElementById('choiceModal');
          const titleEl = document.getElementById('choiceTitle');
          const msgEl = document.getElementById('choiceMsg');
          const listEl = document.getElementById('choiceList');
          const customWrap = document.getElementById('choiceCustomWrap');
          const customInput = document.getElementById('choiceCustomInput');
          const customBtn = document.getElementById('choiceCustomBtn');
          if (!modal) return;
          const choiceId = data.id; // 跟踪本次选择的 ID
          titleEl.textContent = data.title || '请选择';
          msgEl.textContent = data.msg || '';
          listEl.innerHTML = '';
          (data.options || []).forEach((opt, i) => {
            // 兼容字符串选项（LLM 可能传纯字符串数组）和对象选项 {icon, name, sub}
            // 注意：字符串的 opt.name 为 undefined，而 opt.sub 是 String.prototype.sub 原生函数（truthy），
            // 必须用 typeof 守卫，否则会渲染成 "function sub() { [native code] }"
            const o = (typeof opt === 'string') ? { name: opt } : (opt || {});
            const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const icon = (typeof o.icon === 'string' && o.icon) ? esc(o.icon) : '📄';
            const name = (typeof o.name === 'string' || typeof o.name === 'number') ? esc(o.name) : '';
            const sub = (typeof o.sub === 'string' && o.sub) ? esc(o.sub) : '';
            const item = document.createElement('div');
            item.className = 'choice-item';
            item.innerHTML = `<span class="choice-item-icon">${icon}</span>` +
              `<div class="choice-item-info"><div class="choice-item-name">${name}</div>` +
              `${sub ? `<div class="choice-item-sub">${sub}</div>` : ''}</div>`;
            item.addEventListener('click', () => {
              modal.classList.add('hidden');
              if (customWrap) customWrap.style.display = 'none';
              if (App.uiOpen) App.uiOpen = Math.max(0, App.uiOpen - 1);
              if (!App.uiOpen && window.pet) window.pet.setIgnoreMouse(true);
              if (window.pet && window.pet.choiceResult) window.pet.choiceResult({ id: choiceId, index: i });
            });
            listEl.appendChild(item);
          });
          // 显示/隐藏自定义输入区
          if (customWrap) {
            customWrap.style.display = data.allowCustom ? 'flex' : 'none';
            if (customInput) customInput.value = '';
          }
          // 自定义输入确认
          const submitCustom = () => {
            const text = (customInput && customInput.value || '').trim();
            if (!text) return;
            modal.classList.add('hidden');
            customWrap.style.display = 'none';
            if (App.uiOpen) App.uiOpen = Math.max(0, App.uiOpen - 1);
            if (!App.uiOpen && window.pet) window.pet.setIgnoreMouse(true);
            if (window.pet && window.pet.choiceResult) window.pet.choiceResult({ id: choiceId, index: -2, customText: text });
          };
          if (customBtn) customBtn.onclick = submitCustom;
          if (customInput) {
            customInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); submitCustom(); } };
          }
          modal.classList.remove('hidden');
          App.uiOpen = (App.uiOpen || 0) + 1;
          if (window.pet) window.pet.setIgnoreMouse(false);
          if (data.allowCustom && customInput) setTimeout(() => customInput.focus(), 100);
          // 取消按钮
          const cancelBtn = document.getElementById('choiceCancel');
          if (cancelBtn) {
            cancelBtn.onclick = () => {
              modal.classList.add('hidden');
              if (customWrap) customWrap.style.display = 'none';
              if (App.uiOpen) App.uiOpen = Math.max(0, App.uiOpen - 1);
              if (!App.uiOpen && window.pet) window.pet.setIgnoreMouse(true);
              if (window.pet && window.pet.choiceResult) window.pet.choiceResult({ id: choiceId, index: -1 });
            };
          }
        });
      }
    },

    // 自定义确认弹窗（返回 Promise<boolean>）
    confirm(title, msg) {
      return new Promise((resolve) => {
        const modal = document.getElementById('confirmModal');
        const titleEl = document.getElementById('confirmTitle');
        const msgEl = document.getElementById('confirmMsg');
        const okBtn = document.getElementById('confirmOk');
        const cancelBtn = document.getElementById('confirmCancel');
        if (!modal) { resolve(false); return; }
        titleEl.textContent = title || '';
        msgEl.textContent = msg || '';
        modal.classList.remove('hidden');
        if (window.pet && window.pet.setIgnoreMouse) window.pet.setIgnoreMouse(false);
        const cleanup = (val) => {
          modal.classList.add('hidden');
          okBtn.onclick = null;
          cancelBtn.onclick = null;
          if (App.uiOpen) App.uiOpen = Math.max(0, App.uiOpen - 1);
          if (!App.uiOpen && window.pet) window.pet.setIgnoreMouse(true);
          resolve(val);
        };
        App.uiOpen = (App.uiOpen || 0) + 1;
        okBtn.onclick = () => cleanup(true);
        cancelBtn.onclick = () => cleanup(false);
      });
    },

    // 查询 IMA 知识库（流式输出）
    async askKnowledgeBase(query) {
      if (!isOpen) App.chat.open();
      inputEl.value = '';
      addMessage(query, 'user');
      addChatRecord('user', query);
      isWaiting = true;
      sendBtn.disabled = true;
      inputEl.disabled = true;
      sendBtn.textContent = '查库中…';

      const { row: _krow, bubble: streamEl } = createStreamRow();
      streamEl.textContent = '📚 正在查询知识库…';
      messagesEl.scrollTop = messagesEl.scrollHeight;
      fitHeight();

      // 监听 skill 标记
      const onSkill = (data) => {
        if (data && data.name) {
          streamEl.textContent = `🧩 ${data.name}…`;
        }
      };
      const removeSkillListener = window.pet.onChatSkill ? window.pet.onChatSkill(onSkill) : null;

      // 流式输出（节流渲染：逐 token 全量重排 Markdown 会卡顿，攒 80ms 渲染一次）
      let firstChunk = true;
      let streamText = '';
      let kRenderTimer = null;
      const renderStreamNow = () => {
        if (App.markdown) {
          streamEl.innerHTML = renderStreamMarkdown(streamText);
        } else {
          streamEl.textContent = streamText;
        }
        fitHeight();
        messagesEl.scrollTop = messagesEl.scrollHeight;
      };
      const onChunk = (delta) => {
        if (firstChunk) { streamEl.classList.remove('thinking'); firstChunk = false; }
        streamText += delta;
        if (kRenderTimer) return;
        kRenderTimer = setTimeout(() => { kRenderTimer = null; renderStreamNow(); }, 80);
      };
      const removeChunkListener = window.pet.onChatChunk(onChunk);

      try {
        const res = await window.pet.imaAsk(query);
        removeChunkListener();
        if (removeSkillListener) removeSkillListener();
        if (kRenderTimer) { clearTimeout(kRenderTimer); kRenderTimer = null; }
        if (res.success && res.streamed) {
          if (App.markdown) {
            streamEl.innerHTML = renderStreamMarkdown(streamText);
            addCopyButton(streamEl, streamText, false, true);
            bindHtmlButtons(streamEl);
          } else {
            streamEl.textContent = streamText;
          }
          streamEl.classList.remove('thinking');
          addChatRecord('pet', streamText);
          maybeAutoSpeak(streamText); // 自动播报（设置开启时）
        } else {
          streamEl.classList.remove('thinking');
          streamEl.textContent = '喵…知识库查询失败了：' + (res.error || '未知错误');
          streamEl.style.color = '#999';
        }
      } catch (err) {
        removeChunkListener();
        if (removeSkillListener) removeSkillListener();
        if (kRenderTimer) { clearTimeout(kRenderTimer); kRenderTimer = null; }
        streamEl.classList.remove('thinking');
        streamEl.textContent = '喵…查询出错了：' + err.message;
        streamEl.style.color = '#999';
      } finally {
        isWaiting = false;
        sendBtn.disabled = false;
        inputEl.disabled = false;
        sendBtn.textContent = '发送';
        inputEl.focus();
      }
    },

    // 载入聊天记录到当前聊天框
    async loadHistory() {
      await this.renderHistory();
    },

    // 渲染聊天记录（可被删除操作复用）
    async renderHistory() {
      const history = await loadChatHistory();
      if (!history.length) {
        messagesEl.innerHTML = '';
        addMessage('还没有聊天记录喵～', 'pet');
        return;
      }
      messagesEl.innerHTML = '';
      // 分隔标题（独立样式，不用 chat-msg）
      const sep = document.createElement('div');
      sep.className = 'chat-history-sep';
      sep.textContent = `📜 聊天记录（共 ${history.length} 条）`;
      messagesEl.appendChild(sep);
      // 逐条渲染（用行结构：头像+气泡，加时间前缀 + 删除按钮）
      history.forEach((r, idx) => {
        const t = new Date(r.time);
        const pad = (n) => String(n).padStart(2, '0');
        const timeStr = `${pad(t.getMonth()+1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}`;
        const text = r.text;
        // 行结构
        const row = document.createElement('div');
        row.className = 'chat-msg-row ' + r.role;
        const avatar = createAvatarEl(r.role);
        const wrap = document.createElement('div');
        wrap.className = 'chat-bubble-wrap';
        const div = document.createElement('div');
        div.className = 'chat-msg ' + r.role;
        const timeSpan = document.createElement('span');
        timeSpan.className = 'chat-msg-time';
        timeSpan.textContent = timeStr;
        div.appendChild(timeSpan);
        // 历史记录里的附件（图片缩略图 / 文件卡片）
        renderAttachments(div, r.attachments);
        if (r.role === 'pet' && App.markdown) {
          const contentDiv = document.createElement('div');
          contentDiv.innerHTML = App.markdown.render(text);
          div.appendChild(contentDiv);
          addCopyButton(div, text, false, true);
          bindHtmlButtons(div);
        } else {
          const contentDiv = document.createElement('div');
          contentDiv.textContent = text;
          div.appendChild(contentDiv);
          addCopyButton(div, text);
        }
        // 删除按钮
        const delBtn = document.createElement('button');
        delBtn.className = 'chat-msg-del';
        delBtn.textContent = '🗑';
        delBtn.title = '删除这条记录';
        delBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const res = await window.pet.chatDeleteRecord(idx);
          if (res && res.success) {
            row.style.transition = 'opacity 0.2s';
            row.style.opacity = '0';
            setTimeout(() => App.chat.renderHistory(), 200);
          }
        });
        div.appendChild(delBtn);
        wrap.appendChild(div);
        row.appendChild(avatar);
        row.appendChild(wrap);
        messagesEl.appendChild(row);
      });
      fitHeight();
      messagesEl.scrollTop = messagesEl.scrollHeight;
    },

    // 展示小橘记住的关于主人的信息
    async showMemory() {
      if (!isOpen) App.chat.open();
      const mem = await window.pet.getMemory();
      if (!mem || !mem.facts || !mem.facts.length) {
        addMessage('（小橘还没记住关于你的信息呢～跟我聊聊你自己吧，比如"我叫小王""我是程序员"）', 'pet');
        return;
      }
      let text = '🧠 小橘记得关于你的信息：\n\n';
      mem.facts.forEach((f, i) => {
        text += `${i + 1}. ${f.text}\n`;
      });
      const div = document.createElement('div');
      div.className = 'chat-msg pet';
      div.innerHTML = App.markdown ? App.markdown.render(text) : text;
      // 包装到行结构
      const row = document.createElement('div');
      row.className = 'chat-msg-row pet';
      const avatar = createAvatarEl('pet');
      const wrap = document.createElement('div');
      wrap.className = 'chat-bubble-wrap';
      wrap.appendChild(div);
      row.appendChild(avatar);
      row.appendChild(wrap);
      messagesEl.appendChild(row);
      fitHeight();
      messagesEl.scrollTop = messagesEl.scrollHeight;
    },

    // 展示当前所有循环提醒，并支持一键取消
    async showReminders() {
      if (!isOpen) App.chat.open();
      const list = await window.pet.listReminders();
      if (!list || !list.length) {
        addMessage('（目前没有循环提醒～可以跟我说"每隔30分钟提醒我喝水"来设置，或者说"开启久坐提醒"）', 'pet');
        return;
      }
      let text = '⏰ 当前的循环提醒：\n\n';
      list.forEach((r, i) => {
        text += `${i + 1}. ${r.intervalText} → ${r.text}\n`;
      });
      text += `\n💡 跟我说"取消提醒"可停止全部循环提醒`;
      const div = document.createElement('div');
      div.className = 'chat-msg pet';
      div.innerHTML = App.markdown ? App.markdown.render(text) : text;
      // 包装到行结构
      const row = document.createElement('div');
      row.className = 'chat-msg-row pet';
      const avatar = createAvatarEl('pet');
      const wrap = document.createElement('div');
      wrap.className = 'chat-bubble-wrap';
      wrap.appendChild(div);
      row.appendChild(avatar);
      row.appendChild(wrap);
      messagesEl.appendChild(row);
      fitHeight();
      messagesEl.scrollTop = messagesEl.scrollHeight;
    },
  };
})(window.PetApp);
