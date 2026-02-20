// ============================================================
// CoPas v5 — Popup Overlay: Click-to-Paste
// ============================================================
// BEHAVIOR:
//   Single Click    → Paste item into active app + hide
//   Ctrl+Click      → Select multiple items
//   Enter           → Paste selected items + hide
//   Ctrl+Shift+C    → Copy to clipboard only (no paste)
//   Double Click    → Copy only, don't paste
//   Escape          → Hide popup
// ============================================================
(function () {
    'use strict';

    // ===== OS DETECTION =====
    const isMac = navigator.userAgent.includes('Mac');
    const isWin = navigator.userAgent.includes('Win');
    document.body.classList.add(isMac ? 'os-mac' : 'os-win');

    // ===== PREMIUM / DEV MODE =====
    // Set to false for production release to lock premium features
    const DEV_MODE = true;
    function isPremium() { return DEV_MODE; }
    function requirePremium(featureName) {
        if (isPremium()) return true;
        toast(`🔒 "${featureName}" là tính năng Premium. Nâng cấp để sử dụng!`, 'warning');
        return false;
    }

    // Tauri Backend Shim
    const { invoke } = window.__TAURI__.core;
    const { listen } = window.__TAURI__.event;

    window.copas = {
        getTabs: () => invoke('get_tabs'),
        createTab: (data) => invoke('create_tab', { tab: data }),
        renameTab: (data) => invoke('rename_tab', { tab: data }),
        deleteTab: (id) => invoke('delete_tab', { id }),
        getHistory: (opts) => invoke('get_history', { search: opts.search, tabId: opts.tabId, page: opts.page, pageSize: opts.pageSize }),
        deleteItem: (id) => invoke('delete_item', { id }),
        deleteMultiple: (ids) => invoke('delete_multiple', { ids }),
        pinItem: (id) => invoke('pin_item', { id }),
        moveToTab: (data) => invoke('move_to_tab', { data }),
        labelItem: (data) => invoke('label_item', { id: data.id, label: data.label }),
        copyToClipboard: (content) => invoke('copy_to_clipboard', { content }),
        bulkCopy: (contents) => invoke('bulk_copy', { contents }),
        clearHistory: (tabId) => invoke('clear_history', { tabId }),
        getStats: () => invoke('get_stats'),
        getSettings: () => invoke('get_settings'),
        setSettings: (s) => invoke('set_settings', { settings: s }),
        pasteAndHide: (content, imagePath) => invoke('paste_and_hide', { content, imagePath }),
        bulkPasteAndHide: (contents) => invoke('bulk_paste_and_hide', { contents }),
        hidePopup: () => invoke('hide_popup'),
        showPopup: () => invoke('window_show'),
        onClipboardUpdate: (cb) => listen('clipboard-updated', (e) => cb(e.payload)),
        onHistoryCleared: (cb) => listen('history-cleared', () => cb()),
        onPopupShown: (cb) => listen('popup-shown', () => cb()),
        onStartScreenshot: (cb) => listen('start-screenshot', () => cb()),
        checkForUpdate: () => invoke('check_for_update'),
        installUpdate: () => invoke('install_update'),
        getVersion: () => invoke('get_version'),
        getImageUrl: (filename) => invoke('get_image_url', { filename }),
        captureScreen: () => invoke('capture_screen'),
        setFullscreen: (f) => invoke('window_fullscreen', { fullscreen: f }),
        copyImageToClipboard: (b64) => invoke('copy_image_to_clipboard', { base64: b64 }),
        setVaultPin: (pin) => invoke('set_vault_pin', { pin }),
        verifyVaultPin: (pin) => invoke('verify_vault_pin', { pin }),
        hasVaultPin: () => invoke('has_vault_pin'),
        moveToVault: (id) => invoke('move_to_vault', { id }),
        removeFromVault: (id) => invoke('remove_from_vault', { id }),
        getVaultItems: () => invoke('get_vault_items'),
        onUpdateStatus: (cb) => listen('update-status', (e) => cb(e.payload)),
        minimize: () => invoke('window_minimize'),
        maximize: () => invoke('window_maximize'),
        close: () => invoke('window_close'),
        quit: () => invoke('window_quit')
    };

    let tabs = [], activeTabId = 'all', allItems = [], displayItems = [];
    let searchQuery = '', isSelectMode = false, selectedIds = new Set(), settings = {};
    let focusedIndex = -1;

    const $ = s => document.querySelector(s);
    const $$ = s => document.querySelectorAll(s);
    const tabListEl = $('#tab-list'), itemsEl = $('#items'), scrollEl = $('#scroll');
    const emptyEl = $('#empty'), searchInput = $('#search'), sClear = $('#s-clear');
    const toastWrap = $('#toast-wrap'), selBar = $('#sel-bar'), selCountEl = $('#sel-count');
    const dlgRoot = $('#dialog-root');
    const settingsPanel = $('#settings-panel'), guidePanel = $('#guide-panel');

    // ===== INIT =====
    async function init() {
        settings = await window.copas.getSettings();
        applyTheme(settings.theme);
        await loadAllItems();
        await loadTabs();
        await loadItems();
        updateStats();
        bindEvents();
        bindRealtime();
        bindScreenshot();
        bindVault();
        updateGuideShortcut();
        bindAutoUpdate();

        // Listen for global screenshot shortcut
        window.copas.onStartScreenshot(() => {
            if (isPremium()) startScreenshot();
        });
    }

    // ===== THEME =====
    function applyTheme(t) {
        const osClass = isMac ? 'os-mac' : 'os-win';
        document.body.className = (t === 'dark' ? 'theme-dark' : 'theme-light') + ' ' + osClass;
    }
    function toggleTheme() {
        const d = document.body.classList.contains('theme-dark');
        const t = d ? 'light' : 'dark'; applyTheme(t);
        settings.theme = t; window.copas.setSettings({ theme: t });
        $$('.th-opt').forEach(b => b.classList.toggle('active', b.dataset.theme === t));
    }

    // ===== TABS =====
    async function loadTabs() { tabs = await window.copas.getTabs(); renderTabs(); }
    function renderTabs() {
        tabListEl.innerHTML = tabs.map(t => `
      <div class="tab-item ${t.id === activeTabId ? 'active' : ''}" data-id="${t.id}">
        <span class="ti">${t.icon}</span><span class="tn">${esc(t.name)}</span>
        <span class="tc">${countTab(t.id)}</span>
        ${!t.system ? `<button class="tm" data-id="${t.id}">⋯</button>` : ''}
      </div>`).join('');
        tabListEl.querySelectorAll('.tab-item').forEach(el => {
            el.addEventListener('click', e => { if (e.target.classList.contains('tm')) return; activeTabId = el.dataset.id; renderTabs(); loadItems(); });
        });
        tabListEl.querySelectorAll('.tm').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); showTabMenu(b.dataset.id, e); }));
    }
    function countTab(id) {
        if (id === 'all') return allItems.length;
        if (id === 'links') return allItems.filter(i => i.category === 'link' || i.tabId === 'links').length;
        return allItems.filter(i => i.tabId === id).length;
    }

    // ===== ITEMS =====
    async function loadAllItems() {
        let items = (await window.copas.getHistory({ search: '', tabId: 'all', page: 0, pageSize: 9999 })).items;
        for (let i of items) {
            if (i.kind === 'image' || i.imagePath) {
                i.imageUrl = await window.copas.getImageUrl(i.imagePath);
            }
        }
        allItems = items;
    }

    async function loadItems() {
        const r = await window.copas.getHistory({ search: searchQuery, tabId: activeTabId, page: 0, pageSize: 500 });
        let items = r.items;
        for (let i of items) {
            if (i.kind === 'image' || i.imagePath) {
                i.imageUrl = await window.copas.getImageUrl(i.imagePath);
            }
        }

        if (!searchQuery && activeTabId === 'all') allItems = items;
        displayItems = items;
        renderItems(displayItems);
        // Auto-focus first item so Enter works immediately
        focusedIndex = displayItems.length > 0 ? 0 : -1;
        highlightFocused();
        scrollEl.scrollTop = 0;
    }

    const catNames = { text: 'Văn bản', link: 'Liên kết', email: 'Email', code: 'Code', phone: 'SĐT', number: 'Số' };
    const catIcons = {
        text: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>',
        link: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
        email: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><path d="m22 6-10 7L2 6"/></svg>',
        code: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/></svg>',
        phone: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
        number: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>',
        image: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>'
    };

    function renderItems(items) {
        if (!items.length) { itemsEl.innerHTML = ''; emptyEl.style.display = 'flex'; return; }
        emptyEl.style.display = 'none';
        itemsEl.innerHTML = items.map((i, idx) => cardHTML(i, idx)).join('');
        bindCards();
    }

    function cardHTML(i, idx) {
        let contentHtml = '';
        if (i.kind === 'image' && i.imageUrl) {
            contentHtml = `<img src="${i.imageUrl}" class="card-img" alt="Copied image">`;
        } else {
            const rawText = i.contentText || i.content || '';
            const c = searchQuery ? hi(esc(rawText), searchQuery) : esc(rawText);
            contentHtml = `<div class="card-txt ${i.category === 'code' ? 'code' : ''}">${c}</div>`;
        }

        const s = selectedIds.has(i.id);
        return `<div class="card ${i.pinned ? 'pinned' : ''} ${s ? 'sel' : ''}" data-id="${i.id}" data-idx="${idx}" data-cat="${i.category}">
      <div class="card-chk"><input type="checkbox" ${s ? 'checked' : ''}></div>
      <div class="card-body">
        <div class="card-top">
          ${i.label ? `<span class="card-label"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg> ${esc(i.label)}</span>` : ''}
          <span class="card-cat ${i.category}">${catIcons[i.category] || ''} ${catNames[i.category] || 'Hình ảnh'}</span>
          ${i.pinned ? '<span class="card-label">📌</span>' : ''}
          <span class="card-time">${timeAgo(i.timestamp)}</span>
        </div>
        ${contentHtml}
      </div>
      <div class="card-acts">
        <button class="ca paste" title="Dán"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="8" y="2" width="8" height="4" rx="1"/><rect x="4" y="4" width="16" height="18" rx="2"/><path d="m9 14 2 2 4-4"/></svg></button>
        <button class="ca pin ${i.pinned ? 'on' : ''}" title="Ghim"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C9.243 2 7 4.243 7 7c0 3.514 4.062 8.384 4.733 9.188a.347.347 0 0 0 .534 0C12.938 15.384 17 10.514 17 7c0-2.757-2.243-5-5-5z"/></svg></button>
        <button class="ca lbl" title="Đặt tên"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg></button>
        <button class="ca del" title="Xóa"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="m19 6-.7 11.2a2 2 0 0 1-2 1.8H7.7a2 2 0 0 1-2-1.8L5 6"/></svg></button>
      </div>
    </div>`;
    }

    function getTabName(id) { const t = tabs.find(x => x.id === id); return t ? t.name : ''; }

    // ===== CARD EVENTS — CLICK TO PASTE =====
    function bindCards() {
        itemsEl.querySelectorAll('.card').forEach(card => {
            const id = card.dataset.id;

            // SINGLE CLICK = Paste into active app!
            card.addEventListener('click', async (e) => {
                if (e.target.closest('.ca') || e.target.closest('.card-chk')) return;

                // Ctrl+Click = multi-select
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    if (!isSelectMode) toggleSel(true);
                    if (selectedIds.has(id)) selectedIds.delete(id);
                    else selectedIds.add(id);
                    reRenderSel();
                    updateSelUI();
                    if (selectedIds.size === 0 && isSelectMode) toggleSel(false);
                    return;
                }

                // Normal click = paste and hide!
                const item = displayItems.find(i => i.id === id);
                if (item) {
                    card.style.borderColor = 'var(--success)';
                    card.style.background = 'var(--acc-bg)';
                    if (item.kind === 'image') {
                        await window.copas.pasteAndHide('', item.imagePath);
                    } else {
                        let text = parseSnippets(item.contentText || item.content || '');
                        await window.copas.pasteAndHide(text);
                    }
                }
            });

            // Double click = copy only (don't paste, don't hide)
            card.addEventListener('dblclick', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const item = displayItems.find(i => i.id === id);
                if (item) {
                    // Note: bulkCopy currently only supports text in the backend
                    if (item.kind !== 'image') {
                        await window.copas.copyToClipboard(item.contentText || item.content || '');
                        toast('📋 Đã copy (không dán)', 'info');
                    } else {
                        toast('Cần dán trực tiếp đối với hình ảnh', 'warning');
                    }
                }
            });

            card.addEventListener('contextmenu', e => { e.preventDefault(); showItemMenu(id, e); });
            card.querySelector('.card-chk input')?.addEventListener('change', e => { e.stopPropagation(); e.target.checked ? selectedIds.add(id) : selectedIds.delete(id); updateSelUI(); });
            card.querySelector('.ca.paste')?.addEventListener('click', async e => {
                e.stopPropagation();
                const item = displayItems.find(i => i.id === id);
                if (item) {
                    if (item.kind === 'image') {
                        await window.copas.pasteAndHide('', item.imagePath);
                    } else {
                        let text = parseSnippets(item.contentText || item.content || '');
                        await window.copas.pasteAndHide(text);
                    }
                }
            });
            card.querySelector('.ca.pin')?.addEventListener('click', async e => { e.stopPropagation(); const r = await window.copas.pinItem(id); if (r.success) { toast(r.pinned ? '📌 Đã ghim!' : 'Đã bỏ ghim', 'info'); await refresh(); } });
            card.querySelector('.ca.lbl')?.addEventListener('click', e => { e.stopPropagation(); showLabelDlg(id); });
            card.querySelector('.ca.del')?.addEventListener('click', async e => { e.stopPropagation(); await window.copas.deleteItem(id); toast('🗑 Đã xóa!', 'info'); await refresh(); });
        });
    }

    // ===== KEYBOARD SHORTCUTS =====
    function bindEvents() {
        // Window
        $('#btn-close').addEventListener('click', () => window.copas.hidePopup());
        $('#btn-theme').addEventListener('click', toggleTheme);
        $('#btn-settings').addEventListener('click', toggleSettings);
        $('#close-settings').addEventListener('click', () => settingsPanel.style.display = 'none');
        $('#btn-guide').addEventListener('click', toggleGuide);
        $('#close-guide').addEventListener('click', () => guidePanel.style.display = 'none');

        // Search
        let sT;
        searchInput.addEventListener('input', () => {
            searchQuery = searchInput.value.trim();
            sClear.classList.toggle('vis', !!searchQuery);
            clearTimeout(sT); sT = setTimeout(loadItems, 200);
        });
        sClear.addEventListener('click', clearSearch);

        // Add tab
        $('#btn-add-tab').addEventListener('click', showNewTabDlg);

        // Select buttons
        $('#btn-sel').addEventListener('click', () => toggleSel(!isSelectMode));
        $('#btn-scr').addEventListener('click', () => {
            if (!requirePremium('Chụp màn hình')) return;
            startScreenshot();
        });
        $('#btn-bulk-paste').addEventListener('click', bulkPaste);
        $('#btn-del-sel').addEventListener('click', deleteSel);

        // Settings
        $('#save-settings').addEventListener('click', saveSettings);
        setupShortcutRecorder();
        $$('.th-opt').forEach(b => b.addEventListener('click', () => { $$('.th-opt').forEach(x => x.classList.remove('active')); b.classList.add('active'); }));

        document.addEventListener('click', closeMenus);
        document.addEventListener('keydown', handleKeyDown);
    }

    function handleKeyDown(e) {
        const ctrl = e.ctrlKey || e.metaKey;
        const shift = e.shiftKey;
        const key = e.key;
        const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
        const inDlg = dlgRoot.children.length > 0;

        if (key === 'F1') { e.preventDefault(); toggleGuide(); return; }
        if (ctrl && key === ',') { e.preventDefault(); toggleSettings(); return; }
        if (ctrl && key === 't' && !shift) { e.preventDefault(); showNewTabDlg(); return; }

        // Escape → hide popup
        if (key === 'Escape') {
            if (inDlg) return;
            if (settingsPanel.style.display !== 'none') { settingsPanel.style.display = 'none'; return; }
            if (guidePanel.style.display !== 'none') { guidePanel.style.display = 'none'; return; }
            if (searchQuery) { clearSearch(); return; }
            if (isSelectMode) { toggleSel(false); return; }
            // Hide popup!
            window.copas.hidePopup();
            return;
        }

        if (ctrl && key === 'f' && !shift) { e.preventDefault(); searchInput.focus(); return; }
        if (inInput || inDlg) return;

        // Ctrl+A → select mode / select all
        if (ctrl && key === 'a' && !shift) {
            e.preventDefault();
            if (!isSelectMode) {
                toggleSel(true);
            } else {
                const cards = itemsEl.querySelectorAll('.card');
                if (selectedIds.size === cards.length) selectedIds.clear();
                else cards.forEach(c => selectedIds.add(c.dataset.id));
                reRenderSel();
                updateSelUI();
            }
            return;
        }

        // Ctrl+Shift+C → copy only (no paste)
        if (ctrl && shift && (key === 'c' || key === 'C')) {
            e.preventDefault();
            if (selectedIds.size > 0) bulkCopyOnly();
            else toast('Chọn mục trước (Ctrl+A)', 'info');
            return;
        }

        // Enter → paste selected / paste focused
        if (key === 'Enter') {
            e.preventDefault();
            if (isSelectMode && selectedIds.size > 0) {
                bulkPaste();
            } else if (focusedIndex >= 0 && focusedIndex < displayItems.length) {
                const item = displayItems[focusedIndex];
                if (item.kind === 'image') {
                    window.copas.pasteAndHide('', item.imagePath);
                } else {
                    let text = parseSnippets(item.contentText || item.content || '');
                    window.copas.pasteAndHide(text);
                }
            }
            return;
        }

        // Delete → delete selected
        if ((key === 'Delete' || key === 'Backspace') && isSelectMode && selectedIds.size > 0) {
            e.preventDefault(); deleteSel(); return;
        }

        // Arrow ↑/↓
        if (key === 'ArrowDown') {
            e.preventDefault();
            if (focusedIndex < displayItems.length - 1) { focusedIndex++; highlightFocused(); scrollToFocused(); }
            return;
        }
        if (key === 'ArrowUp') {
            e.preventDefault();
            if (focusedIndex > 0) { focusedIndex--; highlightFocused(); scrollToFocused(); }
            return;
        }

        // Space → toggle select
        if (key === ' ' && isSelectMode && focusedIndex >= 0) {
            e.preventDefault();
            const item = displayItems[focusedIndex];
            if (selectedIds.has(item.id)) selectedIds.delete(item.id);
            else selectedIds.add(item.id);
            reRenderSel(); updateSelUI();
            return;
        }
    }

    function highlightFocused() {
        itemsEl.querySelectorAll('.card').forEach((c, i) => c.classList.toggle('focused', i === focusedIndex));
    }
    function scrollToFocused() {
        const card = itemsEl.querySelector(`[data-idx="${focusedIndex}"]`);
        if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    function clearSearch() { searchInput.value = ''; searchQuery = ''; sClear.classList.remove('vis'); loadItems(); }
    function toggleSettings() { guidePanel.style.display = 'none'; const s = settingsPanel.style.display === 'none'; settingsPanel.style.display = s ? 'flex' : 'none'; if (s) populateSettings(); }
    function toggleGuide() { settingsPanel.style.display = 'none'; guidePanel.style.display = guidePanel.style.display === 'none' ? 'flex' : 'none'; }

    // ===== SELECT MODE =====
    function toggleSel(on) {
        isSelectMode = on;
        document.body.classList.toggle('selecting', on);
        $('#btn-sel').classList.toggle('on', on);
        selBar.style.display = on ? 'flex' : 'none';
        if (!on) selectedIds.clear();
        reRenderSel(); updateSelUI();
    }
    function updateSelUI() {
        selCountEl.textContent = `${selectedIds.size} đã chọn`;
        $('#btn-bulk-paste').disabled = !selectedIds.size;
        $('#btn-del-sel').disabled = !selectedIds.size;
    }
    function reRenderSel() {
        itemsEl.querySelectorAll('.card').forEach(c => {
            c.classList.toggle('sel', selectedIds.has(c.dataset.id));
            const cb = c.querySelector('.card-chk input');
            if (cb) cb.checked = selectedIds.has(c.dataset.id);
        });
    }

    // Paste selected items AND hide
    async function bulkPaste() {
        if (!selectedIds.size) return;
        const contents = [];
        displayItems.forEach(i => {
            if (selectedIds.has(i.id) && i.kind !== 'image') contents.push(parseSnippets(i.contentText || i.content || ''));
        });
        toggleSel(false);
        if (contents.length > 0) {
            await window.copas.bulkPasteAndHide(contents);
        } else {
            toast('Bulk paste text only', 'info');
        }
    }

    // Copy only (don't paste, don't hide)
    async function bulkCopyOnly() {
        if (!selectedIds.size) return;
        const contents = [];
        displayItems.forEach(i => {
            if (selectedIds.has(i.id) && i.kind !== 'image') contents.push(i.contentText || i.content || '');
        });
        if (contents.length > 0) {
            await window.copas.bulkCopy(contents);
            toast(`📋 Đã copy ${contents.length} mục`, 'success');
        } else {
            toast('Dán ảnh trực tiếp', 'warning');
        }
        toggleSel(false);
    }

    async function deleteSel() {
        if (!selectedIds.size) return;
        showConfirm('Xóa đã chọn?', `Xóa ${selectedIds.size} mục?`, async () => {
            await window.copas.deleteMultiple([...selectedIds]);
            toast(`🗑 Đã xóa ${selectedIds.size} mục!`, 'info');
            toggleSel(false); await refresh();
        });
    }

    // ===== SETTINGS =====
    function populateSettings() {
        $('#set-toggle').value = settings.shortcutToggle || '';
        $('#set-max').value = settings.maxHistory || 1000;
        $('#set-delim').value = settings.pasteDelimiter || '\\n';
        $$('.th-opt').forEach(b => b.classList.toggle('active', b.dataset.theme === settings.theme));
    }
    async function saveSettings() {
        const ns = {
            shortcutToggle: $('#set-toggle').value || settings.shortcutToggle,
            maxHistory: parseInt($('#set-max').value) || 1000,
            pasteDelimiter: $('#set-delim').value,
            theme: document.querySelector('.th-opt.active')?.dataset.theme || settings.theme
        };
        applyTheme(ns.theme); settings = { ...settings, ...ns };
        await window.copas.setSettings(ns);
        toast('💾 Đã lưu!', 'success');
        settingsPanel.style.display = 'none';
        updateGuideShortcut();
    }
    function updateGuideShortcut() { const el = $('#guide-sc'); if (el) el.textContent = settings.shortcutToggle || 'Ctrl+Shift+V'; }
    function setupShortcutRecorder() {
        $$('.sc-rec').forEach(btn => {
            btn.addEventListener('click', () => {
                const input = $(`#${btn.dataset.target}`);
                if (btn.classList.contains('recording')) { btn.classList.remove('recording'); btn.textContent = 'Ghi'; document.removeEventListener('keydown', btn._h); return; }
                btn.classList.add('recording'); btn.textContent = '⏺ Ghi...'; input.value = 'Nhấn phím...';
                btn._h = e => {
                    e.preventDefault(); e.stopPropagation();
                    const p = [];
                    if (e.ctrlKey) p.push('Ctrl'); if (e.metaKey) p.push('Cmd'); if (e.altKey) p.push('Alt'); if (e.shiftKey) p.push('Shift');
                    if (!['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) {
                        p.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
                        input.value = p.join('+'); btn.classList.remove('recording'); btn.textContent = 'Ghi'; document.removeEventListener('keydown', btn._h);
                    }
                };
                document.addEventListener('keydown', btn._h);
            });
        });
    }

    // ===== REALTIME =====
    function bindRealtime() {
        window.copas.onClipboardUpdate(async item => {
            if (item.kind === 'image' || item.imagePath) {
                item.imageUrl = await window.copas.getImageUrl(item.imagePath);
            }
            allItems.unshift(item);
            await loadItems();
            renderTabs();
            updateStats();
            scrollEl.scrollTo({ top: 0, behavior: 'smooth' });
        });
        window.copas.onHistoryCleared(() => refresh());
        // When popup is shown, focus search
        window.copas.onPopupShown(() => {
            searchInput.focus();
            searchInput.select();
        });
    }
    async function refresh() { await loadAllItems(); await loadItems(); renderTabs(); updateStats(); }
    async function updateStats() {
        try { const s = await window.copas.getStats(); $('#stat-total').textContent = s.totalItems.toLocaleString(); $('#stat-size').textContent = fmtB(s.storageSize); } catch { }
    }

    // ===== DIALOGS =====
    function showNewTabDlg() {
        const icons = ['📁', '💼', '🏠', '🎯', '🔖', '💡', '🎨', '🛒', '📌', '🚀', '❤️', '📎', '🌐', '📸', '🎵', '🔥', '💎', '🎮'];
        let icon = '📁';
        const ov = mk('div', 'dlg-overlay');
        ov.innerHTML = `<div class="dlg-box"><div class="dlg-title">Tạo thẻ mới</div><input class="dlg-input" id="nt-name" placeholder="Tên thẻ..." autofocus><div class="dlg-body">Icon:</div><div class="dlg-row">${icons.map(ic => `<button class="dlg-emoji ${ic === icon ? 'on' : ''}" data-i="${ic}">${ic}</button>`).join('')}</div><div class="dlg-foot"><button class="dlg-btn cancel">Hủy</button><button class="dlg-btn primary" id="nt-ok">Tạo</button></div></div>`;
        dlgRoot.appendChild(ov);
        ov.querySelectorAll('.dlg-emoji').forEach(b => b.addEventListener('click', () => { ov.querySelectorAll('.dlg-emoji').forEach(x => x.classList.remove('on')); b.classList.add('on'); icon = b.dataset.i; }));
        ov.querySelector('.cancel').addEventListener('click', () => ov.remove());
        ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
        ov.querySelector('#nt-ok').addEventListener('click', async () => { const n = ov.querySelector('#nt-name').value.trim(); if (!n) { toast('⚠️ Nhập tên!', 'error'); return; } await window.copas.createTab({ name: n, icon }); toast(`✅ Tạo thẻ "${n}"!`, 'success'); ov.remove(); await loadTabs(); renderTabs(); });
        setTimeout(() => ov.querySelector('#nt-name')?.focus(), 100);
    }
    function showTabMenu(id, ev) {
        closeMenus(); const tab = tabs.find(t => t.id === id); if (!tab || tab.system) return;
        const m = mk('div', 'ctx-menu'); m.style.left = ev.clientX + 'px'; m.style.top = ev.clientY + 'px';
        m.innerHTML = `<button class="ctx-item" data-a="rename">✏️ Đổi tên</button><button class="ctx-item" data-a="clear">🧹 Xóa nội dung</button><div class="ctx-sep"></div><button class="ctx-item danger" data-a="del">🗑 Xóa thẻ</button>`;
        document.body.appendChild(m);
        const r = m.getBoundingClientRect(); if (r.right > innerWidth) m.style.left = (innerWidth - r.width - 8) + 'px'; if (r.bottom > innerHeight) m.style.top = (innerHeight - r.height - 8) + 'px';
        m.addEventListener('click', async e => {
            const a = e.target.closest('.ctx-item')?.dataset.a; m.remove();
            if (a === 'rename') showRenameDlg(id);
            if (a === 'clear') showConfirm('Xóa nội dung?', `Xóa nội dung chưa ghim?`, async () => { await window.copas.clearHistory(id); toast('🧹 Đã xóa!', 'info'); await refresh(); });
            if (a === 'del') showConfirm('Xóa thẻ?', `Xóa thẻ "${tab.name}"?`, async () => { await window.copas.deleteTab(id); if (activeTabId === id) activeTabId = 'all'; toast('🗑 Đã xóa!', 'info'); await loadTabs(); await refresh(); });
        }); ev.stopPropagation();
    }
    function showRenameDlg(id) {
        const tab = tabs.find(t => t.id === id); if (!tab) return;
        const icons = ['📁', '💼', '🏠', '🎯', '🔖', '💡', '🎨', '🛒', '📌', '🚀', '❤️', '📎', '🌐', '📸', '🎵', '🔥', '💎', '🎮']; let icon = tab.icon;
        const ov = mk('div', 'dlg-overlay');
        ov.innerHTML = `<div class="dlg-box"><div class="dlg-title">Đổi tên thẻ</div><input class="dlg-input" id="rn-in" value="${esc(tab.name)}"><div class="dlg-body">Icon:</div><div class="dlg-row">${icons.map(ic => `<button class="dlg-emoji ${ic === icon ? 'on' : ''}" data-i="${ic}">${ic}</button>`).join('')}</div><div class="dlg-foot"><button class="dlg-btn cancel">Hủy</button><button class="dlg-btn primary" id="rn-ok">Lưu</button></div></div>`;
        dlgRoot.appendChild(ov);
        ov.querySelectorAll('.dlg-emoji').forEach(b => b.addEventListener('click', () => { ov.querySelectorAll('.dlg-emoji').forEach(x => x.classList.remove('on')); b.classList.add('on'); icon = b.dataset.i; }));
        ov.querySelector('.cancel').addEventListener('click', () => ov.remove());
        ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
        ov.querySelector('#rn-ok').addEventListener('click', async () => { const n = ov.querySelector('#rn-in').value.trim(); if (!n) return; await window.copas.renameTab({ id, name: n, icon }); toast('✅ Đã lưu!', 'success'); ov.remove(); await loadTabs(); renderTabs(); });
    }
    function showLabelDlg(id) {
        const item = allItems.find(i => i.id === id); if (!item) return;
        const ov = mk('div', 'dlg-overlay');
        ov.innerHTML = `<div class="dlg-box"><div class="dlg-title">🏷 Đặt tên</div><div class="dlg-body">${esc(item.content).substring(0, 120)}${item.content.length > 120 ? '...' : ''}</div><input class="dlg-input" id="lb-in" placeholder="Tên..." value="${esc(item.label || '')}"><div class="dlg-foot"><button class="dlg-btn cancel">Hủy</button>${item.label ? '<button class="dlg-btn danger" id="lb-rm">Xóa</button>' : ''}<button class="dlg-btn primary" id="lb-ok">Lưu</button></div></div>`;
        dlgRoot.appendChild(ov);
        ov.querySelector('.cancel').addEventListener('click', () => ov.remove());
        ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
        ov.querySelector('#lb-ok').addEventListener('click', async () => { await window.copas.labelItem({ id, label: ov.querySelector('#lb-in').value.trim() }); toast('🏷 Đã lưu!', 'success'); ov.remove(); await refresh(); });
        ov.querySelector('#lb-rm')?.addEventListener('click', async () => { await window.copas.labelItem({ id, label: '' }); toast('Đã xóa tên', 'info'); ov.remove(); await refresh(); });
        setTimeout(() => ov.querySelector('#lb-in')?.focus(), 100);
    }
    function showConfirm(title, msg, onOk) {
        const ov = mk('div', 'dlg-overlay');
        ov.innerHTML = `<div class="dlg-box"><div class="dlg-title">${title}</div><div class="dlg-body">${msg}</div><div class="dlg-foot"><button class="dlg-btn cancel">Hủy</button><button class="dlg-btn danger">Xóa</button></div></div>`;
        dlgRoot.appendChild(ov);
        ov.querySelector('.cancel').addEventListener('click', () => ov.remove());
        ov.querySelector('.danger').addEventListener('click', () => { onOk(); ov.remove(); });
        ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
    }
    function showItemMenu(id, ev) {
        closeMenus(); const item = displayItems.find(i => i.id === id); if (!item) return;
        const m = mk('div', 'ctx-menu'); m.style.left = ev.clientX + 'px'; m.style.top = ev.clientY + 'px';
        const svgUp = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 17L12 7l10 10"/></svg>';
        const svgLow = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 7l10 10L22 7"/></svg>';
        const svgAcc = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>';
        const svgCopy = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
        const svgDel = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="m19 6-.7 11.2a2 2 0 0 1-2 1.8H7.7a2 2 0 0 1-2-1.8L5 6"/></svg>';
        let html = '';
        if (item.kind !== 'image') html += `<button class="ctx-item" data-a="fmt-up">${svgUp} IN HOA</button><button class="ctx-item" data-a="fmt-low">${svgLow} in thường</button><button class="ctx-item" data-a="fmt-noacc">${svgAcc} Bỏ dấu</button><div class="ctx-sep"></div>`;
        const svgVault = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
        html += `<button class="ctx-item" data-a="copy">${svgCopy} Copy</button>`;
        if (!item.in_vault) html += `<button class="ctx-item" data-a="vault">${svgVault} Chuyển vào Vault</button>`;
        else html += `<button class="ctx-item" data-a="unvault">${svgVault} Lấy khỏi Vault</button>`;
        html += `<button class="ctx-item danger" data-a="del">${svgDel} Xóa</button>`;
        m.innerHTML = html; document.body.appendChild(m);
        const r = m.getBoundingClientRect(); if (r.right > innerWidth) m.style.left = (innerWidth - r.width - 8) + 'px'; if (r.bottom > innerHeight) m.style.top = (innerHeight - r.height - 8) + 'px';
        m.addEventListener('click', async e => {
            const a = e.target.closest('.ctx-item')?.dataset.a; m.remove(); if (!a) return;
            if (a === 'copy') {
                if (item.kind !== 'image') { await window.copas.copyToClipboard(item.contentText || item.content || ''); toast('📋 Đã copy!', 'info'); } else toast('Dán ảnh trực tiếp', 'warning');
            } else if (a === 'del') { await window.copas.deleteItem(id); toast('🗑 Đã xóa!', 'info'); await refresh(); }
            else if (a.startsWith('fmt-')) {
                let txt = item.contentText || item.content || '';
                if (a === 'fmt-up') txt = txt.toUpperCase();
                if (a === 'fmt-low') txt = txt.toLowerCase();
                if (a === 'fmt-noacc') txt = txt.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
                await window.copas.copyToClipboard(txt); toast('✨ Đã format và copy!', 'success');
            } else if (a === 'vault') {
                await window.copas.moveToVault(id); toast('🔒 Đã chuyển vào Vault!', 'success'); await refresh();
            } else if (a === 'unvault') {
                await window.copas.removeFromVault(id); toast('🔓 Đã lấy khỏi Vault', 'info'); await refresh();
            }
        }); ev.stopPropagation();
    }
    function closeMenus() { document.querySelectorAll('.ctx-menu').forEach(m => m.remove()) }

    // ===== UTILS =====
    function parseSnippets(t) {
        if (!t || typeof t !== 'string' || !t.includes('{')) return t;
        const n = new Date();
        return t.replace(/{date}/gi, n.toLocaleDateString('vi-VN')).replace(/{time}/gi, n.toLocaleTimeString('vi-VN')).replace(/{datetime}/gi, n.toLocaleString('vi-VN'));
    }
    function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML }
    function hi(t, q) { if (!q) return t; return t.replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>') }
    function timeAgo(iso) { const d = (Date.now() - new Date(iso)) / 1e3; if (d < 5) return 'Vừa xong'; if (d < 60) return `${~~d}s`; if (d < 3600) return `${~~(d / 60)}m`; if (d < 86400) return `${~~(d / 3600)}h`; if (d < 604800) return `${~~(d / 86400)}d`; return new Date(iso).toLocaleDateString('vi-VN') }
    function fmtB(b) { if (!b) return '0 B'; const k = 1024, s = ['B', 'KB', 'MB', 'GB'], i = Math.floor(Math.log(b) / Math.log(k)); return (b / Math.pow(k, i)).toFixed(1) + ' ' + s[i] }
    function mk(t, c) { const e = document.createElement(t); if (c) e.className = c; return e }
    function toast(msg, type = 'info') { const t = mk('div', `toast ${type}`); t.textContent = msg; toastWrap.appendChild(t); setTimeout(() => t.remove(), 2300) }

    // ===== AUTO UPDATE =====
    async function bindAutoUpdate() {
        try { const ver = await window.copas.getVersion(); const el = $('.sb-stats'); if (el && ver) el.innerHTML += ` · v${ver}`; } catch { }
        window.copas.onUpdateStatus((data) => {
            document.querySelector('.update-banner')?.remove();
            if (data.status === 'available') showUpdateBanner(`⬇️ Đang tải v${data.version}...`, false);
            if (data.status === 'downloading') showUpdateBanner(`⬇️ ${data.percent}%`, false);
            if (data.status === 'ready') showUpdateBanner(`✅ v${data.version} sẵn sàng!`, true);
        });
    }
    function showUpdateBanner(msg, showInstall) {
        document.querySelector('.update-banner')?.remove();
        const banner = mk('div', 'update-banner');
        banner.innerHTML = `<span>${msg}</span>${showInstall ? '<button class="update-btn" id="install-update">🔄 Cập nhật</button>' : ''}`;
        const content = document.querySelector('.content');
        content.insertBefore(banner, content.firstChild);
        if (showInstall) document.querySelector('#install-update')?.addEventListener('click', () => window.copas.installUpdate());
    }

    // SCROPU / SCREENSHOT
    let cropImg = null;
    let isDragging = false;
    let isDrawing = false;
    let sx = 0, sy = 0, curX = 0, curY = 0;

    // Drawing sub-states
    let currentDrawTool = 'select'; // select, rect, arrow, pen, text, blur
    let drawColor = '#ef4444';
    let drawLineWidth = 3;
    let drawStrokes = [];

    async function startScreenshot() {
        closeMenus();
        await window.copas.hidePopup();
        await new Promise(r => setTimeout(r, 350)); // let os hide animations finish
        try {
            const b64 = await window.copas.captureScreen();

            // show fullscreen overlay
            await window.copas.showPopup();
            await window.copas.setFullscreen(true);
            await new Promise(r => setTimeout(r, 100)); // wait for resize

            $('.titlebar').style.display = 'none';
            $('.app-body').style.display = 'none';

            const ov = $('#img-crop-overlay');
            ov.style.display = 'block';

            // reset states
            isDragging = false;
            isDrawing = false;
            currentDrawTool = 'select';
            drawStrokes = [];
            sx = sy = curX = curY = 0;
            document.querySelectorAll('.dt-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.tool === 'select');
            });
            document.querySelectorAll('.dt-swatch').forEach(b => {
                b.classList.toggle('active', b.dataset.color === '#ef4444');
            });
            document.querySelectorAll('.dt-width').forEach(b => {
                b.classList.toggle('active', parseInt(b.dataset.width) === 3);
            });
            drawColor = '#ef4444';
            drawLineWidth = 3;
            const colorInput = $('#dt-color');
            if (colorInput) colorInput.value = '#ef4444';

            const img = new Image();
            img.onload = async () => {
                cropImg = img;
                const cvs = $('#crop-canvas');
                cvs.width = window.innerWidth;
                cvs.height = window.innerHeight;
                drawCrop();
            };
            img.src = b64;
        } catch (e) { toast('Lỗi chụp ảnh: ' + e, 'error'); }
    }

    function bindScreenshot() {
        // Drawing tools UI
        document.querySelectorAll('.dt-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.dt-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentDrawTool = btn.dataset.tool;
            });
        });
        // Color input
        const colorInput = $('#dt-color');
        if (colorInput) {
            colorInput.addEventListener('input', (e) => {
                drawColor = e.target.value;
                document.querySelectorAll('.dt-swatch').forEach(b => b.classList.remove('active'));
            });
        }
        // Preset color swatches
        document.querySelectorAll('.dt-swatch').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.dt-swatch').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                drawColor = btn.dataset.color;
                if (colorInput) colorInput.value = drawColor;
            });
        });
        // Stroke width buttons
        document.querySelectorAll('.dt-width').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.dt-width').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                drawLineWidth = parseInt(btn.dataset.width) || 3;
            });
        });

        const tools = $('#img-crop-tools');
        const cvs = $('#crop-canvas');
        cvs.addEventListener('mousedown', (e) => {
            if (currentDrawTool === 'select') {
                isDragging = true;
                sx = e.clientX; sy = e.clientY;
                curX = sx; curY = sy;
                drawStrokes = [];
                tools.style.display = 'none';
                drawCrop();
            } else {
                const selX = Math.min(sx, curX), selY = Math.min(sy, curY);
                const selW = Math.abs(curX - sx), selH = Math.abs(curY - sy);
                if (e.clientX >= selX && e.clientX <= selX + selW && e.clientY >= selY && e.clientY <= selY + selH) {
                    isDrawing = true;
                    if (currentDrawTool === 'text') {
                        isDrawing = false; // text requires prompt, no drag needed
                        const txt = prompt('Nhập chữ (sẽ chèn tại con trỏ):');
                        if (txt) {
                            drawStrokes.push({ tool: 'text', color: drawColor, x: e.clientX, y: e.clientY, text: txt, lineWidth: drawLineWidth });
                            drawCrop();
                        }
                    } else {
                        drawStrokes.push({
                            tool: currentDrawTool,
                            color: drawColor,
                            lineWidth: drawLineWidth,
                            x: e.clientX, y: e.clientY,
                            w: 0, h: 0,
                            path: [{ x: e.clientX, y: e.clientY }]
                        });
                    }
                }
            }
        });
        window.addEventListener('mousemove', (e) => {
            if (isDragging) {
                curX = e.clientX; curY = e.clientY;
                drawCrop();
            } else if (isDrawing && drawStrokes.length > 0) {
                const stroke = drawStrokes[drawStrokes.length - 1];
                if (stroke.tool === 'pen') {
                    stroke.path.push({ x: e.clientX, y: e.clientY });
                } else if (stroke.tool === 'rect' || stroke.tool === 'arrow' || stroke.tool === 'blur') {
                    stroke.w = e.clientX - stroke.x;
                    stroke.h = e.clientY - stroke.y;
                }
                drawCrop();
            }
        });
        window.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                if (Math.abs(curX - sx) > 10 && Math.abs(curY - sy) > 10) {
                    tools.style.display = 'flex';
                    tools.style.left = Math.min(curX, sx) + 'px';
                    tools.style.top = Math.max(curY, sy) + 8 + 'px';
                } else { drawCrop(); }
            } else if (isDrawing) {
                isDrawing = false;
            }
        });

        $('#ic-cancel').addEventListener('click', closeScreenshot);
        $('#ic-save').addEventListener('click', async () => {
            const x = Math.min(sx, curX), y = Math.min(sy, curY);
            const w = Math.abs(curX - sx), h = Math.abs(curY - sy);
            if (w < 10 || h < 10) return;
            const temp = document.createElement('canvas');
            temp.width = w; temp.height = h;
            const tCtx = temp.getContext('2d');
            tCtx.drawImage(cropImg, x, y, w, h, 0, 0, w, h);
            tCtx.save(); tCtx.translate(-x, -y); renderStrokes(tCtx, cropImg); tCtx.restore();

            const b64 = temp.toDataURL('image/png');
            await window.copas.copyImageToClipboard(b64);
            toast('Đã copy ảnh!', 'success');
            closeScreenshot();
            setTimeout(() => window.copas.hidePopup(), 500);
        });
        $('#ic-copy').addEventListener('click', async () => {
            if (!requirePremium('Trích xuất OCR')) return;
            // OCR: Extract text from cropped area
            const x = Math.min(sx, curX), y = Math.min(sy, curY);
            const w = Math.abs(curX - sx), h = Math.abs(curY - sy);
            if (w < 10 || h < 10) { toast('Vui lòng chọn vùng cần quét', 'warning'); return; }

            const temp = document.createElement('canvas');
            temp.width = w; temp.height = h;
            const tCtx = temp.getContext('2d');
            tCtx.drawImage(cropImg, x, y, w, h, 0, 0, w, h);
            tCtx.save(); tCtx.translate(-x, -y); renderStrokes(tCtx, cropImg); tCtx.restore();

            const b64 = temp.toDataURL('image/png');

            closeScreenshot();

            // Show loading
            const loading = mk('div', 'ocr-loading');
            loading.innerHTML = '<div class="ocr-spinner"></div><p>🔍 Đang quét chữ (OCR)...</p>';
            document.body.appendChild(loading);

            try {
                if (typeof Tesseract !== 'undefined') {
                    const result = await Tesseract.recognize(b64, 'vie+eng', {
                        logger: m => {
                            if (m.status === 'recognizing text') {
                                loading.querySelector('p').textContent = `🔍 Đang quét... ${Math.round((m.progress || 0) * 100)}%`;
                            }
                        }
                    });
                    const text = result.data.text.trim();
                    loading.remove();
                    if (text) {
                        await window.copas.copyToClipboard(text);
                        toast(`✅ Đã quét ${text.length} ký tự và copy!`, 'success');
                    } else {
                        toast('Không tìm thấy chữ trong ảnh', 'warning');
                    }
                } else {
                    loading.remove();
                    toast('Tesseract.js chưa tải xong, vui lòng thử lại', 'warning');
                }
            } catch (e) {
                loading.remove();
                console.error("OCR Exception:", e);
                const msg = e?.message || (typeof e === 'string' ? e : JSON.stringify(e));
                toast('Lỗi OCR: ' + msg, 'error');
            }
        });
    }

    function renderStrokes(ctx, srcImg) {
        drawStrokes.forEach(s => {
            ctx.strokeStyle = s.color;
            ctx.fillStyle = s.color;
            ctx.lineWidth = s.lineWidth || 3;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            if (s.tool === 'blur' && srcImg) {
                // Pixelation blur effect
                const bx = s.w < 0 ? s.x + s.w : s.x;
                const by = s.h < 0 ? s.y + s.h : s.y;
                const bw = Math.abs(s.w), bh = Math.abs(s.h);
                if (bw > 2 && bh > 2) {
                    const pixelSize = 8;
                    const tw = Math.max(1, Math.ceil(bw / pixelSize));
                    const th = Math.max(1, Math.ceil(bh / pixelSize));
                    const tmpCvs = document.createElement('canvas');
                    tmpCvs.width = tw; tmpCvs.height = th;
                    const tmpCtx = tmpCvs.getContext('2d');
                    tmpCtx.drawImage(srcImg, bx, by, bw, bh, 0, 0, tw, th);
                    ctx.save();
                    ctx.imageSmoothingEnabled = false;
                    ctx.drawImage(tmpCvs, 0, 0, tw, th, bx, by, bw, bh);
                    ctx.restore();
                }
            } else if (s.tool === 'pen') {
                ctx.beginPath();
                if (s.path.length > 0) {
                    ctx.moveTo(s.path[0].x, s.path[0].y);
                    for (let i = 1; i < s.path.length; i++) ctx.lineTo(s.path[i].x, s.path[i].y);
                }
                ctx.stroke();
            } else if (s.tool === 'rect') {
                ctx.strokeRect(s.x, s.y, s.w, s.h);
            } else if (s.tool === 'arrow') {
                const headlen = 15;
                const angle = Math.atan2(s.h, s.w);
                ctx.beginPath();
                ctx.moveTo(s.x, s.y);
                const endX = s.x + s.w, endY = s.y + s.h;
                ctx.lineTo(endX, endY);
                ctx.lineTo(endX - headlen * Math.cos(angle - Math.PI / 6), endY - headlen * Math.sin(angle - Math.PI / 6));
                ctx.moveTo(endX, endY);
                ctx.lineTo(endX - headlen * Math.cos(angle + Math.PI / 6), endY - headlen * Math.sin(angle + Math.PI / 6));
                ctx.stroke();
            } else if (s.tool === 'text') {
                ctx.font = 'bold 24px Inter, sans-serif';
                ctx.fillText(s.text, s.x, s.y + 20); // offset y so text isn't above cursor
            }
        });
    }

    function drawCrop() {
        if (!cropImg) return;
        const cvs = $('#crop-canvas');
        const ctx = cvs.getContext('2d');
        ctx.clearRect(0, 0, cvs.width, cvs.height);
        // Draw full screenshot dimmed
        ctx.drawImage(cropImg, 0, 0, cvs.width, cvs.height);
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, 0, cvs.width, cvs.height);

        // Draw crosshair guides
        if (isDragging) {
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = 'rgba(255,255,255,0.3)';
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(curX, 0); ctx.lineTo(curX, cvs.height); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, curY); ctx.lineTo(cvs.width, curY); ctx.stroke();
            ctx.setLineDash([]);
        }

        if (sx !== curX && sy !== curY) {
            const x = Math.min(sx, curX), y = Math.min(sy, curY);
            const w = Math.abs(curX - sx), h = Math.abs(curY - sy);
            // Draw selected area bright
            ctx.clearRect(x, y, w, h);
            ctx.drawImage(cropImg, x, y, w, h, x, y, w, h);

            // Draw any annotation strokes clipped to the selected region
            ctx.save();
            ctx.beginPath();
            ctx.rect(x, y, w, h);
            ctx.clip();
            renderStrokes(ctx, cropImg);
            ctx.restore();

            const accColor = getComputedStyle(document.body).getPropertyValue('--acc').trim() || '#16a34a';
            // Selection border with glow
            ctx.strokeStyle = accColor;
            ctx.lineWidth = 2;
            ctx.shadowColor = accColor;
            ctx.shadowBlur = 8;
            ctx.strokeRect(x, y, w, h);
            ctx.shadowBlur = 0;

            // Corner handles
            const hs = 5;
            ctx.fillStyle = accColor;
            [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].forEach(([cx, cy]) => {
                ctx.fillRect(cx - hs, cy - hs, hs * 2, hs * 2);
            });

            // Size label
            const label = `${w} × ${h} px`;
            ctx.font = '600 12px Inter, sans-serif';
            ctx.fillStyle = 'rgba(14, 165, 233, 0.9)';
            const tw = ctx.measureText(label).width;
            const lx = x + (w - tw - 16) / 2, ly = y - 8;
            ctx.beginPath();
            ctx.roundRect(lx, ly - 16, tw + 16, 22, 6);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.fillText(label, lx + 8, ly - 1);
        }
    }

    async function closeScreenshot() {
        $('#img-crop-overlay').style.display = 'none';
        $('#img-crop-tools').style.display = 'none';
        $('.titlebar').style.display = 'flex';
        $('.app-body').style.display = 'flex';
        cropImg = null; sx = 0; sy = 0; curX = 0; curY = 0;
        await window.copas.setFullscreen(false);
    }

    // ===== VAULT =====
    let vaultUnlocked = false;
    function bindVault() {
        $('#btn-vault').addEventListener('click', async () => {
            if (!requirePremium('Vault bảo mật')) return;
            const res = await window.copas.hasVaultPin();
            if (!res.hasPin) {
                // Setup new PIN
                $('#vault-title').textContent = 'Tạo mã PIN Vault';
                $('#vault-desc').textContent = 'Nhập mã PIN mới (4-8 số) để bảo vệ dữ liệu của bạn';
                $('#vault-ok').textContent = 'Tạo PIN';
                showVaultOverlay(async (pin) => {
                    if (pin.length < 4) { toast('PIN cần ít nhất 4 ký tự', 'warning'); return false; }
                    await window.copas.setVaultPin(pin);
                    toast('🔐 Đã tạo PIN Vault!', 'success');
                    vaultUnlocked = true;
                    showVaultItems();
                    return true;
                });
            } else if (!vaultUnlocked) {
                // Unlock vault
                $('#vault-title').textContent = 'Mở khóa Vault';
                $('#vault-desc').textContent = 'Nhập mã PIN để truy cập dữ liệu bảo mật';
                $('#vault-ok').textContent = 'Mở khóa';
                showVaultOverlay(async (pin) => {
                    const r = await window.copas.verifyVaultPin(pin);
                    if (r.valid) {
                        vaultUnlocked = true;
                        toast('🔓 Vault đã mở!', 'success');
                        showVaultItems();
                        return true;
                    } else {
                        toast('Sai mã PIN!', 'error');
                        return false;
                    }
                });
            } else {
                // Already unlocked, show vault
                showVaultItems();
            }
        });
    }

    function showVaultOverlay(onSubmit) {
        const ov = $('#vault-overlay');
        const pinInput = $('#vault-pin');
        ov.style.display = 'flex';
        pinInput.value = '';
        setTimeout(() => pinInput.focus(), 100);

        const cleanup = () => { ov.style.display = 'none'; };
        $('#vault-cancel').onclick = cleanup;
        pinInput.onkeydown = async (e) => {
            if (e.key === 'Enter') { const ok = await onSubmit(pinInput.value); if (ok) cleanup(); }
            if (e.key === 'Escape') cleanup();
        };
        $('#vault-ok').onclick = async () => { const ok = await onSubmit(pinInput.value); if (ok) cleanup(); };
    }

    async function showVaultItems() {
        const res = await window.copas.getVaultItems();
        const items = res.items || [];
        if (items.length === 0) {
            toast('🔒 Vault trống. Click chuột phải → "Chuyển vào Vault" để thêm mục.', 'info');
            return;
        }
        // Show vault items in a dialog
        const ov = mk('div', 'dlg-overlay');
        let html = '<div class="dlg-box" style="max-width:420px"><div class="dlg-title">🔒 Vault (' + items.length + ' mục)</div><div class="dlg-body" style="max-height:300px;overflow-y:auto">';
        items.forEach(item => {
            const txt = (item.contentText || item.content || 'Hình ảnh').substring(0, 80);
            html += `<div style="padding:8px 0;border-bottom:1px solid var(--bdr);display:flex;justify-content:space-between;align-items:center"><span style="font-size:12px;word-break:break-all">${esc(txt)}</span><button class="dlg-btn" data-vid="${item.id}" style="font-size:11px;padding:4px 10px">🔓 Lấy ra</button></div>`;
        });
        html += '</div><div class="dlg-foot"><button class="dlg-btn cancel">Đóng</button></div></div>';
        ov.innerHTML = html;
        dlgRoot.appendChild(ov);
        ov.querySelector('.cancel').addEventListener('click', () => ov.remove());
        ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
        ov.querySelectorAll('[data-vid]').forEach(btn => {
            btn.addEventListener('click', async () => {
                await window.copas.removeFromVault(btn.dataset.vid);
                toast('🔓 Đã lấy khỏi Vault', 'info');
                ov.remove();
                await refresh();
            });
        });
    }

    init();
})();
