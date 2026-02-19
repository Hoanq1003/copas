const { app, BrowserWindow, clipboard, ipcMain, Tray, Menu, globalShortcut, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

let db, mainWindow, tray, isQuitting = false, lastClipboardText = '', pollInterval = null;
const DB_PATH = path.join(app.getPath('userData'), 'copas-data.json');

const DEFAULT_DATA = {
  tabs: [
    { id: 'all', name: 'Tất cả', icon: '📋', system: true },
    { id: 'links', name: 'Liên kết', icon: '🔗', system: true },
    { id: 'important', name: 'Quan trọng', icon: '⭐', system: false }
  ],
  items: [],
  settings: {
    theme: 'light',
    maxHistory: 1000,
    shortcutToggle: process.platform === 'darwin' ? 'Cmd+Shift+V' : 'Ctrl+Shift+V',
    shortcutPaste: process.platform === 'darwin' ? 'Cmd+Shift+B' : 'Ctrl+Shift+B',
    pollInterval: 500,
    showNotifications: true,
    autoStart: false,
    pasteDelimiter: '\\n'
  }
};

async function initDB() {
  const { Low } = await import('lowdb');
  const { JSONFile } = await import('lowdb/node');
  db = new Low(new JSONFile(DB_PATH), JSON.parse(JSON.stringify(DEFAULT_DATA)));
  await db.read();
  // Migration
  if (!db.data.tabs) db.data.tabs = DEFAULT_DATA.tabs;
  if (!db.data.settings) db.data.settings = {};
  db.data.settings = { ...DEFAULT_DATA.settings, ...db.data.settings };
  await db.write();
}

function detectCategory(text) {
  if (!text) return 'text';
  const t = text.trim();
  if (/^(https?:\/\/|www\.)\S+$/i.test(t)) return 'link';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return 'email';
  if (/^[\d\s\-+().]{7,15}$/.test(t)) return 'phone';
  if (/[{}\[\]();].*[{}\[\]();]/.test(text) || /^(const|let|var|function|class|import|def)\s/m.test(text)) return 'code';
  if (/(https?:\/\/\S+)/g.test(text)) return 'link';
  return 'text';
}

function startClipboardMonitoring() {
  lastClipboardText = clipboard.readText();
  const interval = db.data.settings.pollInterval || 500;
  pollInterval = setInterval(async () => {
    const txt = clipboard.readText();
    if (txt && txt !== lastClipboardText) {
      lastClipboardText = txt;
      const cat = detectCategory(txt);
      const item = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        content: txt, category: cat,
        tabId: cat === 'link' ? 'links' : null,
        timestamp: new Date().toISOString(),
        pinned: false, label: ''
      };
      db.data.items.unshift(item);
      const max = db.data.settings.maxHistory || 1000;
      if (db.data.items.length > max) {
        db.data.items = [...db.data.items.filter(i => i.pinned), ...db.data.items.filter(i => !i.pinned).slice(0, max)];
      }
      await db.write();
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('clipboard-updated', item);
    }
  }, interval);
}

function stopClipboardMonitoring() { if (pollInterval) { clearInterval(pollInterval); pollInterval = null; } }

function registerShortcuts() {
  globalShortcut.unregisterAll();
  try {
    globalShortcut.register(db.data.settings.shortcutToggle, () => {
      if (mainWindow) mainWindow.isVisible() ? mainWindow.hide() : (mainWindow.show(), mainWindow.focus());
    });
  } catch (e) { console.error('Failed to register toggle shortcut:', e); }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 520, height: 740, minWidth: 420, minHeight: 520,
    frame: false, backgroundColor: '#f8f9fc',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
    show: false, resizable: true, titleBarStyle: 'hidden',
    trafficLightPosition: { x: -20, y: -20 }
  });
  mainWindow.loadFile('index.html');
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', e => { if (!isQuitting) { e.preventDefault(); mainWindow.hide(); } });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function createTray() {
  let icon;
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  try { icon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath).resize({ width: 16 }) : nativeImage.createEmpty(); }
  catch { icon = nativeImage.createEmpty(); }
  tray = new Tray(icon);
  tray.setToolTip('CoPas');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '📋 Mở CoPas', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
    { type: 'separator' },
    { label: '❌ Thoát', click: () => { isQuitting = true; app.quit(); } }
  ]));
  tray.on('click', () => { if (mainWindow) mainWindow.isVisible() ? mainWindow.hide() : (mainWindow.show(), mainWindow.focus()); });
}

function setupIPC() {
  // Tabs
  ipcMain.handle('get-tabs', () => db.data.tabs);
  ipcMain.handle('create-tab', async (e, { name, icon }) => {
    const t = { id: 'tab_' + Date.now().toString(36), name, icon: icon || '📁', system: false };
    db.data.tabs.push(t); await db.write(); return t;
  });
  ipcMain.handle('rename-tab', async (e, { id, name, icon }) => {
    const t = db.data.tabs.find(x => x.id === id);
    if (t && !t.system) { if (name) t.name = name; if (icon) t.icon = icon; await db.write(); return { success: true }; }
    return { success: false };
  });
  ipcMain.handle('delete-tab', async (e, id) => {
    const t = db.data.tabs.find(x => x.id === id);
    if (t && !t.system) {
      db.data.tabs = db.data.tabs.filter(x => x.id !== id);
      db.data.items.forEach(i => { if (i.tabId === id) i.tabId = null; });
      await db.write(); return { success: true };
    }
    return { success: false };
  });

  // Items
  ipcMain.handle('get-history', async (e, { search, tabId, page, pageSize }) => {
    let items = [...db.data.items];
    if (tabId && tabId !== 'all') {
      items = tabId === 'links' ? items.filter(i => i.category === 'link' || i.tabId === 'links') : items.filter(i => i.tabId === tabId);
    }
    if (search) { const q = search.toLowerCase(); items = items.filter(i => i.content.toLowerCase().includes(q) || (i.label || '').toLowerCase().includes(q)); }
    items.sort((a, b) => (a.pinned && !b.pinned ? -1 : !a.pinned && b.pinned ? 1 : new Date(b.timestamp) - new Date(a.timestamp)));
    return { items: items.slice(0, pageSize || 500), total: items.length };
  });
  ipcMain.handle('delete-item', async (e, id) => { db.data.items = db.data.items.filter(i => i.id !== id); await db.write(); return { success: true }; });
  ipcMain.handle('delete-multiple', async (e, ids) => { db.data.items = db.data.items.filter(i => !ids.includes(i.id)); await db.write(); return { success: true }; });
  ipcMain.handle('pin-item', async (e, id) => { const i = db.data.items.find(x => x.id === id); if (i) { i.pinned = !i.pinned; await db.write(); return { success: true, pinned: i.pinned }; } return { success: false }; });
  ipcMain.handle('move-to-tab', async (e, { itemId, tabId }) => { const i = db.data.items.find(x => x.id === itemId); if (i) { i.tabId = tabId; await db.write(); return { success: true }; } return { success: false }; });
  ipcMain.handle('label-item', async (e, { id, label }) => { const i = db.data.items.find(x => x.id === id); if (i) { i.label = label; await db.write(); return { success: true }; } return { success: false }; });
  ipcMain.handle('copy-to-clipboard', async (e, content) => { clipboard.writeText(content); lastClipboardText = content; return { success: true }; });
  ipcMain.handle('bulk-copy', async (e, contents) => {
    const delim = (db.data.settings.pasteDelimiter || '\\n').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    const combined = contents.join(delim);
    clipboard.writeText(combined); lastClipboardText = combined; return { success: true };
  });
  ipcMain.handle('clear-history', async (e, tabId) => {
    if (tabId && tabId !== 'all') db.data.items = db.data.items.filter(i => i.tabId !== tabId || i.pinned);
    else db.data.items = db.data.items.filter(i => i.pinned);
    await db.write(); return { success: true };
  });
  ipcMain.handle('get-stats', async () => {
    let sz = 0; try { sz = fs.statSync(DB_PATH).size; } catch { }
    return { totalItems: db.data.items.length, pinnedItems: db.data.items.filter(i => i.pinned).length, storageSize: sz };
  });

  // Settings
  ipcMain.handle('get-settings', () => db.data.settings);
  ipcMain.handle('set-settings', async (e, s) => {
    const oldShortcut = db.data.settings.shortcutToggle;
    Object.assign(db.data.settings, s);
    await db.write();
    if (s.shortcutToggle && s.shortcutToggle !== oldShortcut) registerShortcuts();
    return { success: true };
  });

  // Window controls
  ipcMain.on('window-minimize', () => { if (mainWindow) mainWindow.minimize(); });
  ipcMain.on('window-maximize', () => { if (mainWindow) mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize(); });
  ipcMain.on('window-close', () => { if (mainWindow) mainWindow.hide(); });
  ipcMain.on('window-quit', () => { isQuitting = true; app.quit(); });
}

// Single instance
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } });

app.whenReady().then(async () => {
  await initDB();
  createWindow(); createTray(); setupIPC();
  startClipboardMonitoring(); registerShortcuts();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && isQuitting) app.quit(); });
app.on('activate', () => { if (!mainWindow) createWindow(); else mainWindow.show(); });
app.on('before-quit', () => { isQuitting = true; stopClipboardMonitoring(); globalShortcut.unregisterAll(); });
