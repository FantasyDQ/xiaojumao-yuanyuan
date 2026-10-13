/* ============================================================
   fileops.js - 文件操作选择面板
   当文件操作匹配到多个文件时，弹出选择框让用户确认
   挂载到 window.PetApp.fileops
   ============================================================ */
window.PetApp = window.PetApp || {};

(function (App) {
  'use strict';

  const state = App.state;
  let pet;
  let panelEl, descEl, listEl, confirmBtn, cancelBtn, closeBtn;
  let isOpen = false;
  let selectedFile = null;
  let currentAction = null;
  let currentTargetDir = null;
  let currentTargetName = null;

  function position() {
    const r = state.runtime;
    let x = r.x - 380;
    let y = r.y - 20;
    panelEl.style.left = x + 'px';
    panelEl.style.top = y + 'px';
    const bw = panelEl.offsetWidth || 360;
    const bh = panelEl.offsetHeight || 400;
    if (x + bw > window.innerWidth - 8) x = r.x + 180;
    if (x < 8) x = 8;
    if (y < 8) y = r.y + 176 + 8;
    if (y + bh > window.innerHeight - 8) y = window.innerHeight - bh - 8;
    if (y < 8) y = 8;
    panelEl.style.left = x + 'px';
    panelEl.style.top = y + 'px';
  }

  // 文件图标根据扩展名
  function fileIcon(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    const map = {
      txt: '📄', md: '📝', doc: '📘', docx: '📘',
      xls: '📗', xlsx: '📗', ppt: '📙', pptx: '📙',
      pdf: '📕', jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️',
      mp3: '🎵', wav: '🎵', flac: '🎵',
      mp4: '🎬', avi: '🎬', mkv: '🎬',
      zip: '📦', rar: '📦', '7z': '📦',
      js: '📜', json: '📜', html: '🌐', css: '🎨',
      exe: '⚙️', msi: '⚙️',
    };
    return map[ext] || '📄';
  }

  function show(data) {
    currentAction = data.action;
    currentTargetDir = data.targetDir;
    currentTargetName = data.targetName;
    selectedFile = null;
    confirmBtn.disabled = true;

    const actionText = { copy: '复制', move: '移动', delete: '删除' }[data.action] || '操作';
    const targetPart = data.action === 'delete' ? '' : ` → 目标：${data.targetName}`;
    descEl.textContent = `找到 ${data.files.length} 个匹配文件，请选择要${actionText}的文件${targetPart}`;

    listEl.innerHTML = '';
    data.files.forEach((f) => {
      const div = document.createElement('div');
      div.className = 'file-item';
      div.innerHTML = `<span class="file-item-icon">${fileIcon(f.name)}</span>` +
        `<div class="file-item-info"><div class="file-item-name">${f.name}</div>` +
        `<div class="file-item-path">${f.dir}</div></div>`;
      div.addEventListener('click', () => {
        document.querySelectorAll('.file-item').forEach((el) => el.classList.remove('selected'));
        div.classList.add('selected');
        selectedFile = f;
        confirmBtn.disabled = false;
      });
      listEl.appendChild(div);
    });

    panelEl.classList.remove('hidden');
    isOpen = true;
    App.uiOpen = (App.uiOpen || 0) + 1;
    position();
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    panelEl.classList.add('hidden');
    if (App.uiOpen) App.uiOpen = Math.max(0, App.uiOpen - 1);
    if (!App.uiOpen) window.pet.setIgnoreMouse(true);
  }

  async function confirm() {
    if (!selectedFile) return;
    const actionText = { copy: '复制', move: '移动', delete: '删除' }[currentAction] || '操作';
    confirmBtn.textContent = '执行中…';
    confirmBtn.disabled = true;
    const res = await window.pet.execFileOp(currentAction, selectedFile.path, currentTargetDir);
    confirmBtn.textContent = '确认';
    if (res.success) {
      if (currentAction === 'delete') {
        pet.showBubble(`喵～已删除「${selectedFile.name}」！`, 4000);
      } else {
        pet.showBubble(`喵～已${actionText}「${selectedFile.name}」到${currentTargetName}！`, 4000);
      }
      close();
    } else {
      pet.showBubble(`喵…${actionText}失败了：${res.error}`, 4000);
      confirmBtn.disabled = false;
    }
  }

  App.fileops = {
    init() {
      pet = App.pet;
      panelEl = document.getElementById('filepanel');
      descEl = document.getElementById('filepanelDesc');
      listEl = document.getElementById('filepanelList');
      confirmBtn = document.getElementById('filepanelConfirm');
      cancelBtn = document.getElementById('filepanelCancel');
      closeBtn = document.querySelector('.filepanel-close');

      confirmBtn.addEventListener('click', confirm);
      cancelBtn.addEventListener('click', close);
      closeBtn.addEventListener('click', close);

      // 监听主进程的文件选择请求
      window.pet.onFileChoose((data) => {
        show(data);
      });
    },
    show, close,
  };
})(window.PetApp);
