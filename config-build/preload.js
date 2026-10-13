const { contextBridge, ipcRenderer, webUtils } = require('electron');

// 通过 contextBridge 安全地向渲染进程暴露受控 API
contextBridge.exposeInMainWorld('pet', {
  // 从拖拽的 File 对象获取真实文件路径（Electron 33+ 需用 webUtils）
  getPathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch (e) { return null; } },
  setIgnoreMouse: (ignore) => ipcRenderer.send('set-ignore-mouse', ignore),

  // 配置管理（配置版专用）
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (cfg) => ipcRenderer.invoke('config:save', cfg),

  // 屏幕尺寸 / 窗口位置
  getScreenBounds: () => ipcRenderer.invoke('get-screen-bounds'),
  getWindowPosition: () => ipcRenderer.invoke('get-window-position'),
  moveWindow: (x, y) => ipcRenderer.invoke('move-window', x, y),

  // AI 对话（流式：发起请求 + 监听增量 chunk）
  chat: (message) => ipcRenderer.invoke('chat:request', message),

  // 监听流式输出增量，返回取消监听函数
  onChatChunk: (callback) => {
    const handler = (_event, delta) => callback(delta);
    ipcRenderer.on('chat:chunk', handler);
    return () => ipcRenderer.removeListener('chat:chunk', handler);
  },

  // 监听聊天状态变化（searching / searching_done），返回取消监听函数
  onChatStatus: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('chat:status', handler);
    return () => ipcRenderer.removeListener('chat:status', handler);
  },

  // 天气查询（forceRefresh=true 时跳过缓存）
  getWeather: (city, forceRefresh) => ipcRenderer.invoke('weather:get', city, forceRefresh),

  // 开机自启动
  getAutoLaunch: () => ipcRenderer.invoke('autolaunch:get'),
  setAutoLaunch: (on) => ipcRenderer.invoke('autolaunch:set', on),

  // 打开应用
  openApp: (name) => ipcRenderer.invoke('app:open', name),

  // 文件操作
  onFileChoose: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('file:choose', handler);
    return () => ipcRenderer.removeListener('file:choose', handler);
  },
  execFileOp: (action, srcPath, targetDir) => ipcRenderer.invoke('file:exec', action, srcPath, targetDir),

  // 读取文件内容（拖拽文件时用）
  readFileContent: (filePath) => ipcRenderer.invoke('file:read', filePath),
  // 保存内容到桌面文件（AI 输出 HTML 时用）
  saveFile: (content, suggestedName) => ipcRenderer.invoke('file:save', content, suggestedName),
  // 用默认程序打开文件（HTML 预览时用）
  openFile: (filePath) => ipcRenderer.invoke('file:open', filePath),

  // 循环提醒
  listReminders: () => ipcRenderer.invoke('reminder:list'),
  cancelReminders: () => ipcRenderer.invoke('reminder:cancel'),
  deleteReminder: (id) => ipcRenderer.invoke('reminder:delete', id),
  addReminderDirect: (text, intervalMs, intervalText) => ipcRenderer.invoke('reminder:add', text, intervalMs, intervalText),
  addWeeklyReminder: (text, weekdays, timeStr) => ipcRenderer.invoke('reminder:addWeekly', text, weekdays, timeStr),
  onRecurringRemind: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('recurring:remind', handler);
    return () => ipcRenderer.removeListener('recurring:remind', handler);
  },
  onReminderCreate: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('reminder:create', handler);
    return () => ipcRenderer.removeListener('reminder:create', handler);
  },

  // 记忆系统（用户画像）
  getMemory: () => ipcRenderer.invoke('memory:get'),
  clearMemory: () => ipcRenderer.invoke('memory:clear'),
  addMemory: (text) => ipcRenderer.invoke('memory:add', text),

  // 托盘菜单动作回调
  onTrayAction: (callback) => {
    ipcRenderer.on('tray:action', (_event, action) => callback(action));
  },
});
