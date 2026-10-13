// 头像模块 — 自定义聊天头像（小橘 + 用户）
(function () {
  const App = window.PetApp || (window.PetApp = {});
  let panelEl = null;

  // 缓存的头像数据（base64 或 null）
  let petAvatar = null;   // { src, ext }
  let userAvatar = null;  // { src, ext }

  // 裁剪状态
  let pendingCrop = null; // { type, base64, ext }
  let cropState = { panX: 0, panY: 0, zoom: 1, baseZoom: 1, imgW: 0, imgH: 0 };
  let cropDragging = false, cropLastX = 0, cropLastY = 0;
  let cropPreviewRAF = 0; // 预览渲染节流

  // 默认头像
  const DEFAULT_PET = '🐱';
  const DEFAULT_USER = '我';

  App.avatar = {
    init() {
      panelEl = document.getElementById('avatarPanel') || document.getElementById('settingsPanel');
      if (!panelEl) return;

      // 小橘头像上传
      const petInput = document.getElementById('petAvatarInput');
      const petBtn = document.getElementById('petAvatarUploadBtn');
      const petReset = document.getElementById('petAvatarResetBtn');
      if (petBtn) petBtn.addEventListener('click', () => petInput.click());
      if (petInput) petInput.addEventListener('change', (e) => App.avatar.handleUpload(e, 'pet'));
      if (petReset) petReset.addEventListener('click', () => App.avatar.reset('pet'));

      // 用户头像上传
      const userInput = document.getElementById('userAvatarInput');
      const userBtn = document.getElementById('userAvatarUploadBtn');
      const userReset = document.getElementById('userAvatarResetBtn');
      if (userBtn) userBtn.addEventListener('click', () => userInput.click());
      if (userInput) userInput.addEventListener('change', (e) => App.avatar.handleUpload(e, 'user'));
      if (userReset) userReset.addEventListener('click', () => App.avatar.reset('user'));

      // 启动时从存储加载头像，刷新聊天框
      App.avatar.load().then(() => {
        if (App.chat) App.avatar.refreshChatAvatars();
      }).catch(() => {});

      // 裁剪弹窗事件
      const cropModal = document.getElementById('avatarCropModal');
      const cropStage = document.getElementById('avatarCropStage');
      const cropZoom = document.getElementById('avatarCropZoom');
      const cropCancel = document.getElementById('avatarCropCancel');
      const cropConfirm = document.getElementById('avatarCropConfirm');
      if (cropCancel) cropCancel.addEventListener('click', () => App.avatar.closeCropper());
      if (cropConfirm) cropConfirm.addEventListener('click', () => App.avatar.confirmCrop());
      // 缩放滑块
      if (cropZoom) {
        cropZoom.addEventListener('input', () => {
          cropState.zoom = parseInt(cropZoom.value) / 100;
          App.avatar.updateCropper();
        });
      }
      // 拖拽平移
      if (cropStage) {
        cropStage.addEventListener('mousedown', (e) => {
          cropDragging = true;
          cropLastX = e.clientX;
          cropLastY = e.clientY;
          e.preventDefault();
        });
        const onMove = (e) => {
          if (!cropDragging) return;
          cropState.panX += e.clientX - cropLastX;
          cropState.panY += e.clientY - cropLastY;
          cropLastX = e.clientX;
          cropLastY = e.clientY;
          App.avatar.updateCropper();
        };
        const onUp = () => { cropDragging = false; };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        // 滚轮缩放（范围与滑块一致 50%-300%）
        cropStage.addEventListener('wheel', (e) => {
          e.preventDefault();
          const delta = e.deltaY > 0 ? -0.05 : 0.05;
          cropState.zoom = Math.max(0.5, Math.min(3.0, cropState.zoom + delta));
          if (cropZoom) cropZoom.value = Math.round(cropState.zoom * 100);
          App.avatar.updateCropper();
        }, { passive: false });
      }
      // ESC 关闭
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && cropModal && !cropModal.classList.contains('hidden')) {
          App.avatar.closeCropper();
        }
      });
    },

    // 获取头像用于渲染（返回 { src } 或 null）
    getPetAvatar() { return petAvatar; },
    getUserAvatar() { return userAvatar; },

    // 默认值
    defaultPetText() { return DEFAULT_PET; },
    defaultUserText() { return DEFAULT_USER; },

    async open() {
      // 头像设置已并入设置面板，打开设置面板并展开头像折叠区
      if (App.settings) await App.settings.open();
      const avatarHeader = document.getElementById('avatarCollapseHeader');
      if (avatarHeader && avatarHeader.parentElement && !avatarHeader.parentElement.classList.contains('expanded')) {
        avatarHeader.click();
      }
    },

    close() {
      if (App.settings) App.settings.close();
    },

    // 从主进程加载头像
    async load() {
      try {
        const data = await window.pet.loadAvatar();
        if (data) {
          if (data.pet) { petAvatar = data.pet; App.avatar.updatePreview('pet'); }
          if (data.user) { userAvatar = data.user; App.avatar.updatePreview('user'); }
        }
      } catch (e) { console.warn('[avatar] load failed:', e.message); }
    },

    // 处理上传 — 选图后打开裁剪弹窗
    async handleUpload(e, type) {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      e.target.value = ''; // 清空，允许重复选同一文件
      // 检查大小（10MB）
      if (file.size > 10 * 1024 * 1024) {
        App.avatar.showStatus('❌ 图片不能超过 10MB', 'error');
        setTimeout(() => App.avatar.showStatus('', ''), 3000);
        return;
      }
      // 读取为 base64，然后打开裁剪弹窗
      const reader = new FileReader();
      reader.onload = () => {
        pendingCrop = { type, base64: reader.result, ext: file.type.split('/')[1] || 'png' };
        App.avatar.openCropper();
      };
      reader.readAsDataURL(file);
    },

    // 打开裁剪弹窗
    openCropper() {
      if (!pendingCrop) return;
      const modal = document.getElementById('avatarCropModal');
      const img = document.getElementById('avatarCropImg');
      const slider = document.getElementById('avatarCropZoom');
      const preview = document.getElementById('avatarCropPreview');
      if (!modal || !img) return;
      img.src = pendingCrop.base64;
      preview.innerHTML = '';
      slider.value = 100;
      cropState = { panX: 0, panY: 0, zoom: 1, baseZoom: 1, imgW: 0, imgH: 0 };
      modal.classList.remove('hidden');
      // 等图片加载后初始化尺寸
      img.onload = () => {
        cropState.imgW = img.naturalWidth;
        cropState.imgH = img.naturalHeight;
        // baseZoom：让图片短边填满裁剪圈（240px），作为基准缩放
        const minDim = Math.min(cropState.imgW, cropState.imgH);
        cropState.baseZoom = minDim > 0 ? 240 / minDim : 1;
        // zoom 是相对倍率，1.0 = 刚好填满
        cropState.zoom = 1;
        slider.value = 100;
        App.avatar.updateCropper();
      };
    },

    // 更新裁剪区图片位置（拖拽 + 缩放）
    updateCropper() {
      const img = document.getElementById('avatarCropImg');
      if (!img) return;
      const totalZoom = cropState.baseZoom * cropState.zoom;
      img.style.transform = `translate(calc(-50% + ${cropState.panX}px), calc(-50% + ${cropState.panY}px)) scale(${totalZoom})`;
      // 预览用 RAF 节流，避免拖拽时频繁重绘 Canvas 卡顿
      if (cropPreviewRAF) cancelAnimationFrame(cropPreviewRAF);
      cropPreviewRAF = requestAnimationFrame(() => { cropPreviewRAF = 0; App.avatar.updateCropPreview(); });
    },

    // 更新圆形预览 — 用 Canvas 渲染，和最终裁剪完全一致
    updateCropPreview() {
      const img = document.getElementById('avatarCropImg');
      const preview = document.getElementById('avatarCropPreview');
      if (!img || !preview || !cropState.imgW) return;
      const outSize = 256;
      const canvas = document.createElement('canvas');
      canvas.width = outSize;
      canvas.height = outSize;
      const ctx = canvas.getContext('2d');
      ctx.beginPath();
      ctx.arc(outSize / 2, outSize / 2, outSize / 2, 0, Math.PI * 2);
      ctx.clip();
      const totalZoom = cropState.baseZoom * cropState.zoom;
      const cropRadiusDisp = 120;
      const srcCropW = (cropRadiusDisp * 2) / totalZoom;
      const srcCx = cropState.imgW / 2 - cropState.panX / totalZoom;
      const srcCy = cropState.imgH / 2 - cropState.panY / totalZoom;
      const srcX = srcCx - srcCropW / 2;
      const srcY = srcCy - srcCropW / 2;
      try { ctx.drawImage(img, srcX, srcY, srcCropW, srcCropW, 0, 0, outSize, outSize); } catch (e) {}
      preview.innerHTML = `<img src="${canvas.toDataURL('image/png')}" style="width:100%;height:100%;object-fit:cover;" />`;
    },

    // 关闭裁剪弹窗
    closeCropper() {
      const modal = document.getElementById('avatarCropModal');
      if (modal) modal.classList.add('hidden');
      pendingCrop = null;
    },

    // 确认裁剪 — 用 canvas 裁剪成正方形 base64
    async confirmCrop() {
      if (!pendingCrop) { App.avatar.closeCropper(); return; }
      const img = document.getElementById('avatarCropImg');
      if (!img || !cropState.imgW) { App.avatar.closeCropper(); return; }
      try {
        // 裁剪圈大小 240px，输出 256x256
        const outSize = 256;
        const canvas = document.createElement('canvas');
        canvas.width = outSize;
        canvas.height = outSize;
        const ctx = canvas.getContext('2d');
        // 圆形裁剪
        ctx.beginPath();
        ctx.arc(outSize / 2, outSize / 2, outSize / 2, 0, Math.PI * 2);
        ctx.clip();
        // 总缩放 = 基准缩放 × 相对倍率
        const totalZoom = cropState.baseZoom * cropState.zoom;
        const cropRadiusDisp = 120;
        const srcCropW = (cropRadiusDisp * 2) / totalZoom;
        const srcCx = cropState.imgW / 2 - cropState.panX / totalZoom;
        const srcCy = cropState.imgH / 2 - cropState.panY / totalZoom;
        const srcX = srcCx - srcCropW / 2;
        const srcY = srcCy - srcCropW / 2;
        ctx.drawImage(img, srcX, srcY, srcCropW, srcCropW, 0, 0, outSize, outSize);
        const croppedBase64 = canvas.toDataURL('image/png');
        // 保存
        const type = pendingCrop.type;
        const res = await window.pet.saveAvatar(type, croppedBase64);
        if (res && res.success) {
          const avatarData = { src: croppedBase64, ext: 'png' };
          if (type === 'pet') petAvatar = avatarData;
          else userAvatar = avatarData;
          App.avatar.updatePreview(type);
          App.avatar.refreshChatAvatars();
          App.avatar.showStatus(type === 'pet' ? '✅ 小橘头像已更新' : '✅ 我的头像已更新', 'success');
          setTimeout(() => App.avatar.showStatus('', ''), 2500);
        } else {
          App.avatar.showStatus('❌ 保存失败，请重试', 'error');
          setTimeout(() => App.avatar.showStatus('', ''), 3000);
        }
      } catch (err) {
        App.avatar.showStatus('❌ 裁剪失败：' + err.message, 'error');
        setTimeout(() => App.avatar.showStatus('', ''), 3000);
      }
      App.avatar.closeCropper();
    },

    // 恢复默认
    async reset(type) {
      try {
        const res = await window.pet.deleteAvatar(type);
        if (res && res.success) {
          if (type === 'pet') petAvatar = null;
          else userAvatar = null;
          App.avatar.updatePreview(type);
          App.avatar.refreshChatAvatars();
          App.avatar.showStatus(type === 'pet' ? '✅ 小橘头像已恢复默认' : '✅ 我的头像已恢复默认', 'success');
          setTimeout(() => App.avatar.showStatus('', ''), 2500);
        }
      } catch (e) {}
    },

    // 更新预览
    updatePreview(type) {
      const preview = document.getElementById(type === 'pet' ? 'petAvatarPreview' : 'userAvatarPreview');
      if (!preview) return;
      const data = type === 'pet' ? petAvatar : userAvatar;
      if (data && data.src) {
        preview.innerHTML = `<img src="${data.src}" alt="头像" />`;
      } else {
        preview.innerHTML = type === 'pet' ? DEFAULT_PET : DEFAULT_USER;
      }
    },

    // 刷新聊天框里所有头像（上传/重置后立即生效）
    refreshChatAvatars() {
      if (!App.chat) return;
      const messagesEl = document.getElementById('chatMessages');
      if (!messagesEl) return;
      // 只刷新指定类型的头像，避免全量重渲染
      const refreshType = (role) => {
        const data = role === 'pet' ? petAvatar : userAvatar;
        const defaultText = role === 'pet' ? DEFAULT_PET : DEFAULT_USER;
        const els = messagesEl.querySelectorAll(`.chat-avatar.${role}`);
        els.forEach((el) => {
          if (data && data.src) {
            el.innerHTML = `<img src="${data.src}" alt="${role}" />`;
          } else {
            el.textContent = defaultText;
          }
        });
      };
      refreshType('pet');
      refreshType('user');
    },

    showStatus(msg, stype) {
      const el = document.getElementById('avatarStatus');
      if (el) { el.textContent = msg; el.className = 'avatar-status ' + (stype || ''); }
    }
  };
})();
