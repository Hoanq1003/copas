const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('copas', {
    // Tabs
    getTabs: () => ipcRenderer.invoke('get-tabs'),
    createTab: (data) => ipcRenderer.invoke('create-tab', data),
    renameTab: (data) => ipcRenderer.invoke('rename-tab', data),
    deleteTab: (id) => ipcRenderer.invoke('delete-tab', id),

    // Items
    getHistory: (opts) => ipcRenderer.invoke('get-history', opts || {}),
    deleteItem: (id) => ipcRenderer.invoke('delete-item', id),
    deleteMultiple: (ids) => ipcRenderer.invoke('delete-multiple', ids),
    pinItem: (id) => ipcRenderer.invoke('pin-item', id),
    moveToTab: (data) => ipcRenderer.invoke('move-to-tab', data),
    labelItem: (data) => ipcRenderer.invoke('label-item', data),
    copyToClipboard: (content) => ipcRenderer.invoke('copy-to-clipboard', content),
    bulkCopy: (contents) => ipcRenderer.invoke('bulk-copy', contents),
    clearHistory: (tabId) => ipcRenderer.invoke('clear-history', tabId),
    getStats: () => ipcRenderer.invoke('get-stats'),

    // Settings
    getSettings: () => ipcRenderer.invoke('get-settings'),
    setSettings: (s) => ipcRenderer.invoke('set-settings', s),

    // Paste-and-hide (NEW: popup overlay UX)
    pasteAndHide: (content) => ipcRenderer.invoke('paste-and-hide', content),
    bulkPasteAndHide: (contents) => ipcRenderer.invoke('bulk-paste-and-hide', contents),
    hidePopup: () => ipcRenderer.invoke('hide-popup'),

    // Events
    onClipboardUpdate: (cb) => ipcRenderer.on('clipboard-updated', (_, item) => cb(item)),
    onHistoryCleared: (cb) => ipcRenderer.on('history-cleared', () => cb()),
    onPopupShown: (cb) => ipcRenderer.on('popup-shown', () => cb()),

    // Updates
    checkForUpdate: () => ipcRenderer.invoke('check-for-update'),
    installUpdate: () => ipcRenderer.invoke('install-update'),
    getVersion: () => ipcRenderer.invoke('get-version'),
    onUpdateStatus: (cb) => ipcRenderer.on('update-status', (_, data) => cb(data)),

    // Window
    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close: () => ipcRenderer.send('window-close'),
    quit: () => ipcRenderer.send('window-quit')
});

