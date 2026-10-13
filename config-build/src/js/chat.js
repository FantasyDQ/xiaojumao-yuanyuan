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
    // 保存网页到桌面
    const saveBtns = container.querySelectorAll('.md-html-save');
    saveBtns.forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const raw = btn.getAttribute('data-raw') || '';
        const html = decodeHtmlEntities(raw);
        btn.textContent = '保存中…';
        try {
          const ts = new Date();
          const pad = (n) => String(n).padStart(2, '0');
          const fname = `小橘生成_${ts.getFullYear()}${pad(ts.getMonth()+1)}${pad(ts.getDate())}_${pad(ts.getHours())}${pad(ts.getMinutes())}.html`;
          const res = await window.pet.saveFile(html, fname);
          if (res && res.success) {
            btn.textContent = '✓ 已保存到桌面';
            setTimeout(() => { btn.textContent = '💾 保存网页'; }, 2500);
          } else {
            btn.textContent = '✗ 失败';
            setTimeout(() => { btn.textContent = '💾 保存网页'; }, 2000);
          }
        } catch (err) {
          btn.textContent = '✗ 失败';
          setTimeout(() => { btn.textContent = '💾 保存网页'; }, 2000);
        }
      });
    });
  }

  function decodeHtmlEntities(s) {
    const t = document.createElement('textarea');
    t.innerHTML = s;
    return t.value;
  }

  // 流式渲染 Markdown：未闭合的 HTML 代码块显示"正在生成"+ 可折叠代码
  function renderStreamMarkdown(text) {
    // 检测是否有未闭合的 ```html
    const htmlStart = text.indexOf('```html');
    if (htmlStart >= 0) {
      const afterStart = text.substring(htmlStart + 7);
      const endIdx = afterStart.indexOf('```');
      if (endIdx < 0) {
        // 还没闭合 → 显示前面的文字 + "正在生成HTML"折叠面板
        const before = text.substring(0, htmlStart);
        const beforeHtml = App.markdown.render(before);
        const rawCode = afterStart; // 实时生成的 HTML 代码
        const escapedCode = App.markdown.escapeHtml ? App.markdown.escapeHtml(rawCode) : rawCode.replace(/</g, '&lt;');
        return beforeHtml +
          '<details class="md-html-gen-collapse">' +
            '<summary class="md-html-gen-summary">🔨 正在生成 HTML 文档…</summary>' +
            '<pre class="md-html-gen-code"><code>' + escapedCode + '</code></pre>' +
          '</details>';
      }
    }
    return App.markdown.render(text);
  }

  function addCopyButton(div, rawText) {
    const bar = document.createElement('div');
    bar.className = 'chat-copy-bar';

    const mkBtn = (label, getText) => {
      const btn = document.createElement('button');
      btn.className = 'chat-copy-btn';
      btn.textContent = label;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const text = getText();
        navigator.clipboard.writeText(text).then(() => {
          btn.textContent = '✓';
          setTimeout(() => { btn.textContent = label; }, 1500);
        }).catch(() => {
          const ta = document.createElement('textarea');
          ta.value = text; document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); btn.textContent = '✓'; setTimeout(() => { btn.textContent = label; }, 1500); } catch (e2) {}
          document.body.removeChild(ta);
        });
      });
      return btn;
    };

    bar.appendChild(mkBtn('纯文本', () => mdToPlainText(rawText || div.textContent || '')));
    bar.appendChild(mkBtn('Markdown', () => rawText || ''));
    div.appendChild(bar);

    // 检测 HTML 代码块，加"保存为网页"按钮
    if (rawText && /```html/i.test(rawText)) {
      const htmlMatch = rawText.match(/```html?\s*\n([\s\S]*?)```/i);
      if (htmlMatch && htmlMatch[1] && htmlMatch[1].trim().length > 50) {
        const saveBtn = document.createElement('button');
        saveBtn.className = 'chat-copy-btn chat-save-btn';
        saveBtn.textContent = '💾 保存网页';
        saveBtn.title = '将 HTML 保存到桌面';
        saveBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          saveBtn.textContent = '保存中…';
          try {
            const html = htmlMatch[1].trim();
            const ts = new Date();
            const pad = (n) => String(n).padStart(2, '0');
            const fname = `小橘生成_${ts.getFullYear()}${pad(ts.getMonth()+1)}${pad(ts.getDate())}_${pad(ts.getHours())}${pad(ts.getMinutes())}.html`;
            const res = await window.pet.saveFile(html, fname);
            if (res && res.success) {
              saveBtn.textContent = '✓ 已保存到桌面';
              setTimeout(() => { saveBtn.textContent = '💾 保存网页'; }, 2500);
            } else {
              saveBtn.textContent = '✗ 失败';
              setTimeout(() => { saveBtn.textContent = '💾 保存网页'; }, 2000);
            }
          } catch (err) {
            saveBtn.textContent = '✗ 失败';
            setTimeout(() => { saveBtn.textContent = '💾 保存网页'; }, 2000);
          }
        });
        bar.appendChild(saveBtn);
      }
    }
  }

  function addMessage(text, role) {
    const div = document.createElement('div');
    div.className = 'chat-msg ' + role;
    if (role === 'pet' && App.markdown) {
      div.innerHTML = App.markdown.render(text);
      addCopyButton(div, text);
      // 绑定 HTML 折叠面板的保存/复制按钮
      bindHtmlButtons(div);
    } else {
      div.textContent = text;
      // 用户消息也加复制按钮（纯文本）
      addCopyButton(div, text);
    }
    messagesEl.appendChild(div);
    fitHeight();
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // 消息区高度自适应：内容少时收窄，内容多时撑高（有上限）
  function fitHeight() {
    if (!messagesEl) return;
    messagesEl.style.height = 'auto';
    const h = messagesEl.scrollHeight;
    const target = Math.min(Math.max(h + 4, 150), 380);
    messagesEl.style.height = target + 'px';
    // 高度变化后重新定位，防止超出屏幕
    if (isOpen) position();
  }

  let isWaiting = false; // 是否正在等待大模型回复

  async function send() {
    let text = inputEl.value.trim();
    // 支持注入拖拽文件内容（发送给 AI 但不在聊天框显示文件内容）
    let hiddenContext = '';
    if (window._pendingFileContent) {
      hiddenContext = window._pendingFileContent;
      window._pendingFileContent = null;
      inputEl.value = '';
      inputEl.placeholder = '输入消息…';
    }
    if (!text || isWaiting) return;
    inputEl.value = '';
    // 聊天框只显示用户的提问文字，不显示文件内容
    addMessage(text, 'user');
    // 实际发给 AI 的是提问 + 隐藏的文件内容
    const sendText = hiddenContext ? '__SKIP_INTENT__' + text + hiddenContext : text;
    isWaiting = true;
    sendBtn.disabled = true;
    inputEl.disabled = true;
    sendBtn.textContent = '思考中…';

    // 创建流式消息元素，先显示"思考中"
    const streamEl = document.createElement('div');
    streamEl.className = 'chat-msg pet thinking';
    streamEl.textContent = '';
    messagesEl.appendChild(streamEl);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    let firstChunk = true;
    let streamText = '';
    const onChunk = (delta) => {
      if (firstChunk) {
        streamEl.classList.remove('thinking');
        firstChunk = false;
      }
      streamText += delta;
      // 流式过程中渲染：HTML 代码块折叠显示，不铺满屏幕
      if (App.markdown) {
        streamEl.innerHTML = renderStreamMarkdown(streamText);
      } else {
        streamEl.textContent = streamText;
      }
      fitHeight();
      messagesEl.scrollTop = messagesEl.scrollHeight;
    };
    const removeChunkListener = window.pet.onChatChunk(onChunk);

    // 监听搜索状态（联网搜索时显示提示）
    const onStatus = (data) => {
      if (data.status === 'searching') {
        streamEl.textContent = '🔍 正在搜索网络…';
      } else if (data.status === 'searching_done') {
        streamEl.textContent = '🤔 整理答案中…';
      } else if (data.status === 'reading') {
        streamEl.textContent = '📖 正在读取文件…';
      } else if (data.status === 'reading_done') {
        streamEl.textContent = '🤔 分析文件内容中…';
      }
    };
    const removeStatusListener = window.pet.onChatStatus(onStatus);

    try {
      const res = await window.pet.chat(sendText);
      removeChunkListener();
      removeStatusListener();

      // 文件操作场景：匹配到多个文件，弹出选择框，不显示 AI 回复
      if (res.reply === '__FILE_CHOOSE__') {
        streamEl.remove();
        const actionText = { copy: '复制', move: '移动', delete: '删除' }[res.action] || '操作';
        pet.showBubble(`喵～找到多个文件，请选择要${actionText}的文件！`, 4000);
        return;
      }

      // 若全程未收到流式 chunk（兜底场景），用返回结果填充
      if (firstChunk) {
        streamEl.classList.remove('thinking');
        streamText = res.reply;
      }
      // 流式结束后最终渲染一次 Markdown（确保完整）
      if (App.markdown && streamText) {
        streamEl.innerHTML = App.markdown.render(streamText);
        addCopyButton(streamEl, streamText);
        bindHtmlButtons(streamEl);
      } else {
        streamEl.textContent = streamText;
      }
      streamEl.classList.remove('thinking');
      fitHeight();
      messagesEl.scrollTop = messagesEl.scrollHeight;
      pet.showBubble(streamText.slice(0, 60), 3000);
      pet.setMood('happy');
      state.adjust({ happiness: 1 });
      setTimeout(() => { if (!state.runtime.isDragging) pet.setMood(state.computeMood()); }, 1600);
    } catch (err) {
      removeChunkListener();
      removeStatusListener();
      streamEl.classList.remove('thinking');
      streamEl.textContent = '喵？信号不太好，等会儿再聊…';
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
      inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
      closeBtn.addEventListener('click', () => App.chat.close());

      // 拖拽文件到聊天框 → 读取内容并缓存，等用户提问后再一起发送
      boxEl.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
      boxEl.addEventListener('drop', async (e) => {
        e.preventDefault(); e.stopPropagation();
        const files = e.dataTransfer && e.dataTransfer.files;
        if (!files || !files.length) return;
        const file = files[0];
        let filePath = file.path || '';
        if (!filePath && window.pet.getPathForFile) {
          filePath = window.pet.getPathForFile(file);
        }
        if (!filePath) { addMessage('（无法获取文件路径喵，试试直接跟我说文件名）', 'pet'); return; }
        const fileName = file.name;
        if (!isOpen) App.chat.open();
        try {
          // 只显示"已拖入"提示，不自动分析
          const tip = document.createElement('div');
          tip.className = 'chat-msg user file-attached-tip';
          tip.innerHTML = `📎 已拖入文件：<b>${fileName}</b><br><span style="opacity:0.7;font-size:12px">正在读取内容…</span>`;
          messagesEl.appendChild(tip);
          messagesEl.scrollTop = messagesEl.scrollHeight;
          fitHeight();

          const result = await window.pet.readFileContent(filePath);
          if (result.ok) {
            const content = result.content.slice(0, 8000);
            window._pendingFileContent = `\n\n【拖拽文件内容：${fileName}】\n${content}`;
            tip.innerHTML = `📎 已拖入文件：<b>${fileName}</b>（${result.ext}，${content.length} 字）<br><span style="opacity:0.7;font-size:12px">已读取完毕，请输入你想问的问题～</span>`;
            inputEl.placeholder = `已加载文件「${fileName}」，输入你的问题…`;
            inputEl.focus();
          } else {
            tip.innerHTML = `📎 已拖入文件：<b>${fileName}</b><br><span style="color:#e84040;font-size:12px">读取失败：${result.error}</span>`;
          }
        } catch (err) {
          addMessage('读取文件出错了喵：' + err.message, 'pet');
        }
      });

      addMessage('喵~我是小橘！有什么想跟我说的吗？', 'pet');
    },

    open() {
      isOpen = true;
      boxEl.classList.remove('hidden');
      position();
      App.uiOpen = (App.uiOpen || 0) + 1;
      setTimeout(() => inputEl.focus(), 100);
    },

    close() {
      if (!isOpen) return;
      isOpen = false;
      boxEl.classList.add('hidden');
      if (App.uiOpen) App.uiOpen = Math.max(0, App.uiOpen - 1);
      if (!App.uiOpen) window.pet.setIgnoreMouse(true); // 恢复穿透
    },

    toggle() { isOpen ? App.chat.close() : App.chat.open(); },
    send,

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
      messagesEl.appendChild(div);
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
      text += '\n💡 跟我说"取消提醒"可停止全部循环提醒';
      const div = document.createElement('div');
      div.className = 'chat-msg pet';
      div.innerHTML = App.markdown ? App.markdown.render(text) : text;
      messagesEl.appendChild(div);
      fitHeight();
      messagesEl.scrollTop = messagesEl.scrollHeight;
    },
  };
})(window.PetApp);
