// meeting.js - 会议纪要：录音 → 自动转写 → 按钮生成纪要
// 支持长会议分段录制（每段≤55分钟），分段转写后合并
(function (App) {
  let panelEl, recordBtn, timerEl, statusEl, transcriptEl, summaryEl, summaryBtn, filesEl;
  let isOpen = false;

  // 录音状态
  let mediaRecorder = null;
  let audioStream = null;
  let recordTimer = null;
  let recordStart = 0;
  let isRecording = false;
  let currentMimeType = 'audio/webm;codecs=opus';

  // 分段录制
  const SEGMENT_MAX_MS = 55 * 60 * 1000; // 每段最长 55 分钟（ASR 限制 1 小时）
  let segmentIndex = 0;        // 当前段号
  let segmentChunks = [];      // 当前段的音频块
  let savedSegments = [];      // 已保存的段 { blob, filename, audioPath, transcript }
  let segmentRolling = false;  // 是否正在自动切换段

  // 最近一次的结果
  let lastAudioPaths = [];     // 所有音频文件路径
  let lastTranscript = '';

  function $(id) { return document.getElementById(id); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function formatTime(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s % 60)}`;
    return `${pad(m)}:${pad(s % 60)}`;
  }

  function showStatus(text, isError) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.style.color = isError ? '#ff4d4f' : '#e8590c';
  }

  function position() {
    if (!panelEl) return;
    panelEl.style.animation = 'none';
    // 动态限制面板 max-height，确保不超出窗口（底部留 80px 给宠物）
    const maxH = Math.min(600, window.innerHeight - 80);
    panelEl.style.maxHeight = maxH + 'px';
    const pw = panelEl.offsetWidth || 460;
    const ph = panelEl.offsetHeight || 400;
    let top = window.innerHeight - ph - 80;
    // 如果面板太高顶出屏幕顶部，从顶部 20px 开始
    if (top < 20) top = 20;
    panelEl.style.left = (window.innerWidth - pw - 20) + 'px';
    panelEl.style.top = top + 'px';
    panelEl.style.bottom = 'auto';
    panelEl.style.right = 'auto';
    panelEl.style.animation = '';
  }

  function pickMimeType() {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
    for (const m of candidates) {
      try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) {}
    }
    return '';
  }

  function startRecording() {
    if (isRecording) return;
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then((stream) => {
        audioStream = stream;
        segmentIndex = 0;
        segmentChunks = [];
        savedSegments = [];
        lastAudioPaths = [];
        lastTranscript = '';

        currentMimeType = pickMimeType();
        startSegment(stream);

        isRecording = true;
        recordStart = Date.now();
        recordBtn.textContent = '⏹ 停止录音';
        recordBtn.classList.add('recording');
        timerEl.classList.add('recording');
        showStatus('正在录音…（每55分钟自动分段）');

        recordTimer = setInterval(() => {
          const elapsed = Date.now() - recordStart;
          timerEl.textContent = formatTime(elapsed);
          // 接近分段上限时自动切换
          if (elapsed > (segmentIndex + 1) * SEGMENT_MAX_MS && !segmentRolling) {
            segmentRolling = true;
            rollSegment();
          }
        }, 1000);
      })
      .catch((err) => {
        console.warn('[meeting] 获取麦克风失败:', err.message);
        showStatus('无法访问麦克风：' + err.message, true);
      });
  }

  // 开始录制一个新段
  function startSegment(stream) {
    segmentChunks = [];
    try {
      mediaRecorder = currentMimeType
        ? new MediaRecorder(stream, { mimeType: currentMimeType })
        : new MediaRecorder(stream);
    } catch (e) {
      mediaRecorder = new MediaRecorder(stream);
    }

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) segmentChunks.push(e.data);
    };

    // onstop 在 stopRecording 和 rollSegment 中分别处理
    mediaRecorder.onstop = () => {
      const blob = new Blob(segmentChunks, { type: currentMimeType || 'audio/webm' });
      const ext = currentMimeType.includes('mp4') ? 'm4a' : 'webm';
      const ts = new Date();
      const fname = `meeting_${ts.getFullYear()}${pad(ts.getMonth()+1)}${pad(ts.getDate())}_${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}_part${segmentIndex + 1}.${ext}`;
      savedSegments.push({ blob, filename: fname, audioPath: null, transcript: '' });
    };

    mediaRecorder.start(1000); // 每1秒收集一次数据，stop 时更快吐出最后一块
  }

  // 自动切换段：停止当前段 → 保存 → 启动新段
  function rollSegment() {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      segmentRolling = false;
      return;
    }
    const oldRecorder = mediaRecorder;
    oldRecorder.onstop = () => {
      const blob = new Blob(segmentChunks, { type: currentMimeType || 'audio/webm' });
      const ext = currentMimeType.includes('mp4') ? 'm4a' : 'webm';
      const ts = new Date();
      const fname = `meeting_${ts.getFullYear()}${pad(ts.getMonth()+1)}${pad(ts.getDate())}_${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}_part${segmentIndex + 1}.${ext}`;
      savedSegments.push({ blob, filename: fname, audioPath: null, transcript: '' });
      segmentIndex++;
      // 开始新段
      if (audioStream && isRecording) {
        startSegment(audioStream);
        showStatus(`正在录音…（第 ${segmentIndex + 1} 段）`);
      }
      segmentRolling = false;
    };
    oldRecorder.stop();
  }

  function stopRecording() {
    if (!isRecording || !mediaRecorder) return;
    // 确保最后一段也保存
    mediaRecorder.onstop = () => {
      const blob = new Blob(segmentChunks, { type: currentMimeType || 'audio/webm' });
      const ext = currentMimeType.includes('mp4') ? 'm4a' : 'webm';
      const ts = new Date();
      const fname = `meeting_${ts.getFullYear()}${pad(ts.getMonth()+1)}${pad(ts.getDate())}_${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}_part${segmentIndex + 1}.${ext}`;
      savedSegments.push({ blob, filename: fname, audioPath: null, transcript: '' });
      stopRecordingUI();
      // 停止音频流
      if (audioStream) {
        audioStream.getTracks().forEach((t) => t.stop());
      }
      // 开始保存和转写所有段
      saveAndTranscribeAll();
    };
    mediaRecorder.stop();
    if (recordTimer) { clearInterval(recordTimer); recordTimer = null; }
    isRecording = false;
  }

  function stopRecordingUI() {
    recordBtn.textContent = '🔴 开始录音';
    recordBtn.classList.remove('recording');
    timerEl.classList.remove('recording');
  }

  // 上传本地音频文件 → 转写（支持 wav/mp3/webm/m4a 等格式）
  async function uploadAudioFile() {
    if (isRecording) { showStatus('请先停止录音', true); return; }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*,.wav,.mp3,.webm,.m4a,.ogg,.flac,.aac,.amr';
    input.onchange = async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      clearAll();
      const fileName = file.name || 'upload_' + Date.now() + '.webm';
      showStatus(`正在上传音频：${fileName}（${(file.size / 1024 / 1024).toFixed(1)} MB）…`);
      try {
        // 1. 保存音频文件到 meeting 目录
        const arrayBuffer = await file.arrayBuffer();
        const saveRes = await window.pet.meetingSaveAudio(arrayBuffer, fileName);
        if (!saveRes || !saveRes.success) {
          showStatus('保存音频失败：' + (saveRes?.error || '未知错误'), true);
          return;
        }
        lastAudioPaths.push(saveRes.path);
        showFile('🎵 音频', saveRes.path);

        // 2. 转写
        showStatus('语音识别中（首次启动可能需要约 30 秒）…');
        const placeholder = document.createElement('div');
        placeholder.className = 'meeting-transcript-loading';
        placeholder.textContent = '正在识别语音内容…';
        transcriptEl.appendChild(placeholder);
        transcriptEl.scrollTop = transcriptEl.scrollHeight;

        const transRes = await window.pet.meetingTranscribe(saveRes.path);
        placeholder.remove();
        if (!transRes || !transRes.success) {
          showStatus('识别失败：' + (transRes?.error || '未知错误'), true);
          return;
        }
        lastTranscript = transRes.text || '';
        const segText = document.createElement('div');
        segText.textContent = lastTranscript;
        transcriptEl.appendChild(segText);
        transcriptEl.scrollTop = transcriptEl.scrollHeight;
        if (transRes.txtPath) showFile('📝 转写', transRes.txtPath);
        showStatus(`转写完成！${lastTranscript.length} 字`);
        position(); // 转写完成后重新定位面板，防止底部按钮跑出屏幕
        summaryBtn.disabled = false;
      } catch (err) {
        showStatus('上传/识别出错：' + err.message, true);
      }
    };
    input.click();
  }

  // 保存并转写所有段
  async function saveAndTranscribeAll() {
    if (!savedSegments.length) {
      showStatus('没有录音内容', true);
      return;
    }

    showStatus('正在保存音频…');

    // 1. 保存所有音频文件
    for (let i = 0; i < savedSegments.length; i++) {
      const seg = savedSegments[i];
      try {
        const arrayBuffer = await seg.blob.arrayBuffer();
        const res = await window.pet.meetingSaveAudio(arrayBuffer, seg.filename);
        if (res && res.success) {
          seg.audioPath = res.path;
          lastAudioPaths.push(res.path);
          // 单段时显示音频文件，多段时等合并后只显示一次
          if (savedSegments.length === 1) showFile('🎵 音频', res.path);
        }
      } catch (err) {
        showStatus(`保存音频段 ${i + 1} 失败`, true);
        return;
      }
    }

    // 2. 逐段转写（每段转完立即显示到文本区）
    let allText = '';
    transcriptEl.textContent = '';
    for (let i = 0; i < savedSegments.length; i++) {
      const seg = savedSegments[i];
      if (!seg.audioPath) continue;
      const isMulti = savedSegments.length > 1;
      const phasePrefix = isMulti ? `[${i + 1}/${savedSegments.length}] ` : '';

      // 全程统一提示，不切换状态
      showStatus(`${phasePrefix}语音识别中（首次启动可能需要约 30 秒）…`);

      // 占位提示
      const placeholder = document.createElement('div');
      placeholder.className = 'meeting-transcript-loading';
      placeholder.textContent = '正在识别语音内容…';
      transcriptEl.appendChild(placeholder);
      transcriptEl.scrollTop = transcriptEl.scrollHeight;

      try {
        const transRes = await window.pet.meetingTranscribe(seg.audioPath);
        if (transRes && transRes.success) {
          seg.transcript = transRes.text;
          allText += transRes.text + '\n\n';
          placeholder.remove();
          if (isMulti) {
            const sep = document.createElement('div');
            sep.className = 'meeting-seg-sep';
            sep.textContent = `第 ${i + 1} 段`;
            transcriptEl.appendChild(sep);
          }
          const segText = document.createElement('div');
          segText.textContent = transRes.text;
          transcriptEl.appendChild(segText);
          transcriptEl.scrollTop = transcriptEl.scrollHeight;
          // 单段时直接显示转写文件，多段时等合并后显示
          if (!isMulti) showFile('📝 转写', transRes.txtPath);
        } else {
          placeholder.remove();
          showStatus(`第 ${i + 1} 段识别失败`, true);
          return;
        }
      } catch (err) {
        clearTimeout(phaseTimer);
        placeholder.remove();
        showStatus(`第 ${i + 1} 段识别出错`, true);
        return;
      }
    }

    // 3. 合并转写文本，保存合并版
    lastTranscript = allText.trim();

    // 保存合并的转写文本
    if (savedSegments.length > 1) {
      try {
        const mergedRes = await window.pet.meetingSaveAudio(
          new TextEncoder().encode(lastTranscript).buffer,
          savedSegments[0].filename.replace(/_part\d+\.[^.]+$/, '_合并.txt')
        );
        if (mergedRes && mergedRes.success) {
          showFile('🎵 音频 & 📝 转写', mergedRes.path);
        }
      } catch (e) {}
    }

    const wordCount = lastTranscript.length;
    showStatus(`转写完成！${wordCount} 字`);
    summaryBtn.disabled = false;
    position(); // 转写完成后重新定位面板，防止底部按钮跑出屏幕
  }

  async function generateSummary() {
    if (!lastTranscript) {
      showStatus('请先录音并转写', true);
      return;
    }
    summaryBtn.disabled = true;
    summaryBtn.textContent = '⏳ 生成中…';
    summaryEl.textContent = '';
    let fullText = '';
    let firstChunk = true;

    const removeChunk = window.pet.onMeetingChunk((delta) => {
      if (firstChunk) { summaryEl.textContent = ''; firstChunk = false; }
      fullText += delta;
      if (App.markdown) {
        summaryEl.innerHTML = App.markdown.render(fullText);
      } else {
        summaryEl.textContent = fullText;
      }
      summaryEl.scrollTop = summaryEl.scrollHeight;
    });

    try {
      const res = await window.pet.meetingSummary(lastTranscript);
      removeChunk();
      if (!res || !res.success) {
        showStatus('生成纪要失败：' + (res?.error || '未知错误'), true);
        summaryEl.textContent = fullText || '生成失败';
        summaryBtn.disabled = false;
        summaryBtn.textContent = '📝 生成纪要';
        return;
      }

      // 最终渲染一次完整 Markdown
      if (App.markdown && res.text) {
        summaryEl.innerHTML = App.markdown.render(res.text);
      }

      // 保存纪要到文件（跟第一段音频同目录同名）
      if (lastAudioPaths.length > 0) {
        const saveRes = await window.pet.meetingSaveSummary(res.text, lastAudioPaths[0]);
        if (saveRes && saveRes.success) {
          showFile('📋 纪要', saveRes.path);
          // 如果 IMA 知识库已配置，显示入库结果
          if (saveRes.ima) {
            if (saveRes.ima.success) {
              const location = saveRes.ima.folder ? '会议纪要文件夹' : '知识库根目录';
              let msg = `纪要生成完成！已自动存入 IMA 知识库（${location}）📚`;
              // 调试信息：没找到文件夹时显示 API 返回内容
              if (!saveRes.ima.folder && saveRes.ima.debug) {
                msg += '\n[调试] 文件夹查找返回：' + saveRes.ima.debug.slice(0, 300);
              }
              showStatus(msg);
            } else {
              showStatus('纪要生成完成！存入 IMA 知识库失败：' + saveRes.ima.error);
            }
          } else {
            showStatus('纪要生成完成！（未配置 IMA 知识库，仅保存到本地文件）');
          }
        }
      } else {
        showStatus('纪要生成完成！');
      }
    } catch (err) {
      removeChunk();
      showStatus('出错：' + err.message, true);
    }
    summaryBtn.disabled = false;
    summaryBtn.textContent = '📝 生成纪要';
  }

  function showFile(label, filePath) {
    if (!filesEl) return;
    const item = document.createElement('div');
    item.className = 'file-item';
    const fname = filePath.replace(/^.*[\\/]/, '');
    const link = document.createElement('a');
    link.title = '点击在文件夹中显示';
    link.textContent = fname;
    link.href = 'javascript:void(0)';
    link.addEventListener('click', (e) => {
      e.preventDefault();
      if (window.pet.showInFolder) window.pet.showInFolder(filePath);
    });
    item.textContent = label + '：';
    item.appendChild(link);
    filesEl.appendChild(item);
  }

  function clearAll() {
    transcriptEl.textContent = '';
    summaryEl.textContent = '';
    filesEl.innerHTML = '';
    lastTranscript = '';
    lastAudioPaths = [];
    savedSegments = [];
    segmentIndex = 0;
    summaryBtn.disabled = true;
    timerEl.textContent = '00:00';
    showStatus('');
  }

  function open() {
    isOpen = true;
    panelEl.classList.remove('hidden');
    position();
    App.uiOpen = (App.uiOpen || 0) + 1;
    window.pet.setIgnoreMouse(false);
  }

  function close() {
    if (!isOpen) return;
    if (isRecording) stopRecording();
    isOpen = false;
    panelEl.classList.add('hidden');
    if (App.uiOpen) App.uiOpen = Math.max(0, App.uiOpen - 1);
    if (!App.uiOpen) window.pet.setIgnoreMouse(true);
  }

  function toggle() {
    if (isOpen) close();
    else open();
  }

  // 拖拽移动面板
  function bindDrag() {
    const header = panelEl.querySelector('.meeting-panel-header');
    let dragStart = null;
    header.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('meeting-panel-close')) return;
      dragStart = { x: e.clientX, y: e.clientY, px: parseInt(panelEl.style.left || 0), py: parseInt(panelEl.style.top || 0) };
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragStart) return;
      panelEl.style.left = (dragStart.px + e.clientX - dragStart.x) + 'px';
      panelEl.style.top = (dragStart.py + e.clientY - dragStart.y) + 'px';
    });
    window.addEventListener('mouseup', () => { dragStart = null; });
  }

  App.meeting = {
    init() {
      panelEl = $('meetingPanel');
      recordBtn = $('meetingRecordBtn');
      timerEl = $('meetingTimer');
      statusEl = $('meetingStatus');
      transcriptEl = $('meetingTranscript');
      summaryEl = $('meetingSummary');
      summaryBtn = $('meetingSummaryBtn');
      filesEl = $('meetingFiles');

      if (!panelEl) return;

      recordBtn.addEventListener('click', () => {
        if (isRecording) stopRecording();
        else { clearAll(); startRecording(); }
      });

      summaryBtn.addEventListener('click', generateSummary);
      summaryBtn.disabled = true;

      // 上传音频文件 → 转写
      const uploadBtn = $('meetingUploadBtn');
      if (uploadBtn) {
        uploadBtn.addEventListener('click', uploadAudioFile);
      }

      panelEl.querySelector('.meeting-panel-close').addEventListener('click', close);

      bindDrag();
    },
    open,
    close,
    toggle,
  };
})(window.PetApp);
