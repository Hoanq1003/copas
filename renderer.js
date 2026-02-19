// ============================================================
// CoPas v4 — Renderer: Rich Shortcuts + Modern SVG Icons
// ============================================================
// KEYBOARD SHORTCUTS:
//   Ctrl+Click     → Chọn từng mục (giống Windows Explorer)
//   Ctrl+F         → Focus search
//   Ctrl+A         → Toggle select mode / Select all
//   Ctrl+Shift+C   → Bulk copy selected
//   Delete/Backspace→ Delete selected
//   Escape         → Clear search / Exit select / Close panels
//   Ctrl+T         → New tab
//   Ctrl+,         → Settings
//   F1             → Guide
//   Enter          → Copy first/selected item
//   ↑/↓            → Navigate items
// ============================================================
(function () {
    'use strict';

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
        updateGuideShortcut();
    }

    // ===== THEME =====
    function applyTheme(t) { document.body.className = t === 'dark' ? 'theme-dark' : 'theme-light'; }
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
    async function loadAllItems() { allItems = (await window.copas.getHistory({ search: '', tabId: 'all', page: 0, pageSize: 9999 })).items; }
    async function loadItems() {
        const r = await window.copas.getHistory({ search: searchQuery, tabId: activeTabId, page: 0, pageSize: 500 });
        if (!searchQuery && activeTabId === 'all') allItems = r.items;
        displayItems = r.items;
        renderItems(displayItems);
        focusedIndex = -1;
    }

    const catNames = { text: 'Văn bản', link: 'Liên kết', email: 'Email', code: 'Code', phone: 'SĐT', number: 'Số' };
    const catIcons = {
        text: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>',
        link: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
        email: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><path d="m22 6-10 7L2 6"/></svg>',
        code: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/></svg>',
        phone: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
        number: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>'
    };

    function renderItems(items) {
        if (!items.length) { itemsEl.innerHTML = ''; emptyEl.style.display = 'flex'; return; }
        emptyEl.style.display = 'none';
        itemsEl.innerHTML = items.map((i, idx) => cardHTML(i, idx)).join('');
        bindCards();
    }

    function cardHTML(i, idx) {
        const c = searchQuery ? hi(esc(i.content), searchQuery) : esc(i.content);
        const s = selectedIds.has(i.id);
        const focused = idx === focusedIndex;
        return `<div class="card ${i.pinned ? 'pinned' : ''} ${s ? 'sel' : ''} ${focused ? 'focused' : ''}" data-id="${i.id}" data-idx="${idx}" data-cat="${i.category}">
      <div class="card-chk"><input type="checkbox" ${s ? 'checked' : ''}></div>
      <div class="card-body">
        <div class="card-top">
          ${i.label ? `<span class="card-label"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg> ${esc(i.label)}</span>` : ''}
          <span class="card-cat ${i.category}">${catIcons[i.category] || ''} ${catNames[i.category] || 'Văn bản'}</span>
          ${i.pinned ? '<span class="card-label"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C9.243 2 7 4.243 7 7c0 3.514 4.062 8.384 4.733 9.188a.347.347 0 0 0 .534 0C12.938 15.384 17 10.514 17 7c0-2.757-2.243-5-5-5z"/></svg> Ghim</span>' : ''}
          <span class="card-time">${timeAgo(i.timestamp)}</span>
        </div>
        <div class="card-txt ${i.category === 'code' ? 'code' : ''}">${c}</div>
        <div class="card-info"><span>${i.content.length.toLocaleString()} ký tự</span>${i.tabId && i.tabId !== 'all' ? `<span>📁 ${getTabName(i.tabId)}</span>` : ''}</div>
      </div>
      <div class="card-acts">
        <button class="ca copy" title="Copy"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
        <button class="ca pin ${i.pinned ? 'on' : ''}" title="Ghim"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C9.243 2 7 4.243 7 7c0 3.514 4.062 8.384 4.733 9.188a.347.347 0 0 0 .534 0C12.938 15.384 17 10.514 17 7c0-2.757-2.243-5-5-5z"/></svg></button>
        <button class="ca lbl" title="Đặt tên"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg></button>
        <button class="ca mv" title="Chuyển thẻ"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></button>
        <button class="ca del" title="Xóa"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="m19 6-.7 11.2a2 2 0 0 1-2 1.8H7.7a2 2 0 0 1-2-1.8L5 6"/></svg></button>
      </div>
    </div>`;
    }

    function getTabName(id) { const t = tabs.find(x => x.id === id); return t ? t.name : ''; }

    function bindCards() {
        itemsEl.querySelectorAll('.card').forEach(card => {
            const id = card.dataset.id;

            // Ctrl+Click = toggle select this item (like Windows Explorer)
            card.addEventListener('click', (e) => {
                if (e.target.closest('.ca') || e.target.closest('.card-chk')) return; // ignore action buttons/checkbox
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    e.stopPropagation();
                    // Auto-enter select mode if not already
                    if (!isSelectMode) toggleSel(true);
                    // Toggle this item's selection
                    if (selectedIds.has(id)) selectedIds.delete(id);
                    else selectedIds.add(id);
                    reRenderSel();
                    updateSelUI();
                    // Exit select mode if nothing selected
                    if (selectedIds.size === 0 && isSelectMode) toggleSel(false);
                    return;
                }
            });

            card.addEventListener('dblclick', () => copyItem(id, card));
            card.querySelector('.card-chk input')?.addEventListener('change', e => { e.stopPropagation(); e.target.checked ? selectedIds.add(id) : selectedIds.delete(id); updateSelUI(); });
            card.querySelector('.ca.copy')?.addEventListener('click', e => { e.stopPropagation(); copyItem(id, card); });
            card.querySelector('.ca.pin')?.addEventListener('click', async e => { e.stopPropagation(); const r = await window.copas.pinItem(id); if (r.success) { toast(r.pinned ? '📌 Đã ghim!' : 'Đã bỏ ghim', 'info'); await refresh(); } });
            card.querySelector('.ca.lbl')?.addEventListener('click', e => { e.stopPropagation(); showLabelDlg(id); });
            card.querySelector('.ca.mv')?.addEventListener('click', e => { e.stopPropagation(); showMoveDlg(id, e); });
            card.querySelector('.ca.del')?.addEventListener('click', async e => { e.stopPropagation(); await window.copas.deleteItem(id); toast('🗑 Đã xóa!', 'info'); await refresh(); });
        });
    }

    async function copyItem(id, card) {
        const item = allItems.find(i => i.id === id);
        if (!item) return;
        await window.copas.copyToClipboard(item.content);
        toast('✅ Đã copy!', 'success');
        if (card) { card.style.borderColor = 'var(--success)'; setTimeout(() => card.style.borderColor = '', 400); }
    }

    // ===== KEYBOARD SHORTCUTS =====
    function bindEvents() {
        // Window
        $('#btn-min').addEventListener('click', () => window.copas.minimize());
        $('#btn-max').addEventListener('click', () => window.copas.maximize());
        $('#btn-close').addEventListener('click', () => window.copas.close());
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
        $('#btn-bulk').addEventListener('click', bulkCopy);
        $('#btn-del-sel').addEventListener('click', deleteSel);

        // Settings
        $('#save-settings').addEventListener('click', saveSettings);
        setupShortcutRecorder();
        $$('.th-opt').forEach(b => b.addEventListener('click', () => { $$('.th-opt').forEach(x => x.classList.remove('active')); b.classList.add('active'); }));

        document.addEventListener('click', closeMenus);

        // ===== GLOBAL KEYBOARD HANDLER =====
        document.addEventListener('keydown', handleKeyDown);
    }

    function handleKeyDown(e) {
        const ctrl = e.ctrlKey || e.metaKey;
        const shift = e.shiftKey;
        const key = e.key;

        // Don't capture when typing in inputs
        const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
        const inDlg = dlgRoot.children.length > 0;

        // F1 → Guide
        if (key === 'F1') { e.preventDefault(); toggleGuide(); return; }

        // Ctrl+, → Settings
        if (ctrl && key === ',') { e.preventDefault(); toggleSettings(); return; }

        // Ctrl+T → New tab
        if (ctrl && key === 't' && !shift) { e.preventDefault(); showNewTabDlg(); return; }

        // Escape → Close panels / clear search / exit select
        if (key === 'Escape') {
            if (inDlg) return; // dialog handles its own escape
            if (settingsPanel.style.display !== 'none') { settingsPanel.style.display = 'none'; return; }
            if (guidePanel.style.display !== 'none') { guidePanel.style.display = 'none'; return; }
            if (searchQuery) { clearSearch(); return; }
            if (isSelectMode) { toggleSel(false); return; }
            closeMenus();
            return;
        }

        // Ctrl+F → Focus search
        if (ctrl && key === 'f' && !shift) { e.preventDefault(); searchInput.focus(); return; }

        // Don't capture below shortcuts when in input fields
        if (inInput || inDlg) return;

        // Ctrl+A → Toggle select / select all
        if (ctrl && key === 'a' && !shift) {
            e.preventDefault();
            if (!isSelectMode) {
                toggleSel(true);
            } else {
                // Select all visible items
                const cards = itemsEl.querySelectorAll('.card');
                if (selectedIds.size === cards.length) {
                    selectedIds.clear();
                } else {
                    cards.forEach(c => selectedIds.add(c.dataset.id));
                }
                reRenderSel();
                updateSelUI();
            }
            return;
        }

        // Ctrl+Shift+C → Bulk copy
        if (ctrl && shift && (key === 'c' || key === 'C')) {
            e.preventDefault();
            if (selectedIds.size > 0) bulkCopy();
            else toast('Chọn mục trước (Ctrl+A)', 'info');
            return;
        }

        // Delete / Backspace → Delete selected
        if ((key === 'Delete' || key === 'Backspace') && isSelectMode && selectedIds.size > 0) {
            e.preventDefault();
            deleteSel();
            return;
        }

        // Arrow ↑/↓ → Navigate items
        if (key === 'ArrowDown') {
            e.preventDefault();
            if (focusedIndex < displayItems.length - 1) {
                focusedIndex++;
                highlightFocused();
                scrollToFocused();
            }
            return;
        }
        if (key === 'ArrowUp') {
            e.preventDefault();
            if (focusedIndex > 0) {
                focusedIndex--;
                highlightFocused();
                scrollToFocused();
            }
            return;
        }

        // Enter → Copy focused item
        if (key === 'Enter' && focusedIndex >= 0 && focusedIndex < displayItems.length) {
            e.preventDefault();
            const item = displayItems[focusedIndex];
            const card = itemsEl.querySelector(`[data-idx="${focusedIndex}"]`);
            copyItem(item.id, card);
            return;
        }

        // Space → Toggle select focused item
        if (key === ' ' && isSelectMode && focusedIndex >= 0) {
            e.preventDefault();
            const item = displayItems[focusedIndex];
            if (selectedIds.has(item.id)) selectedIds.delete(item.id);
            else selectedIds.add(item.id);
            reRenderSel();
            updateSelUI();
            return;
        }
    }

    function highlightFocused() {
        itemsEl.querySelectorAll('.card').forEach((c, i) => {
            c.classList.toggle('focused', i === focusedIndex);
        });
    }

    function scrollToFocused() {
        const card = itemsEl.querySelector(`[data-idx="${focusedIndex}"]`);
        if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    function clearSearch() { searchInput.value = ''; searchQuery = ''; sClear.classList.remove('vis'); loadItems(); }

    function toggleSettings() {
        guidePanel.style.display = 'none';
        const show = settingsPanel.style.display === 'none';
        settingsPanel.style.display = show ? 'flex' : 'none';
        if (show) populateSettings();
    }

    function toggleGuide() {
        settingsPanel.style.display = 'none';
        guidePanel.style.display = guidePanel.style.display === 'none' ? 'flex' : 'none';
    }

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
        $('#btn-bulk').disabled = !selectedIds.size;
        $('#btn-del-sel').disabled = !selectedIds.size;
    }
    function reRenderSel() {
        itemsEl.querySelectorAll('.card').forEach(c => {
            c.classList.toggle('sel', selectedIds.has(c.dataset.id));
            const cb = c.querySelector('.card-chk input');
            if (cb) cb.checked = selectedIds.has(c.dataset.id);
        });
    }
    async function bulkCopy() {
        if (!selectedIds.size) return;
        const contents = [];
        // Maintain order from displayItems
        displayItems.forEach(i => { if (selectedIds.has(i.id)) contents.push(i.content); });
        await window.copas.bulkCopy(contents);
        toast(`✅ Đã copy ${contents.length} mục!`, 'success');
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
    function updateGuideShortcut() {
        const el = $('#guide-sc'); if (el) el.textContent = settings.shortcutToggle || 'Ctrl+Shift+V';
    }
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
        window.copas.onClipboardUpdate(async item => { allItems.unshift(item); await loadItems(); renderTabs(); updateStats(); scrollEl.scrollTo({ top: 0, behavior: 'smooth' }); });
        window.copas.onHistoryCleared(() => refresh());
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
    function showMoveDlg(id, ev) {
        closeMenus(); const m = mk('div', 'ctx-menu'); m.style.left = Math.min(ev.clientX, innerWidth - 180) + 'px'; m.style.top = Math.min(ev.clientY, innerHeight - 200) + 'px';
        const ut = tabs.filter(t => t.id !== 'all');
        m.innerHTML = `<div style="padding:6px 12px;font-size:10px;font-weight:800;color:var(--c4);letter-spacing:.5px">CHUYỂN THẺ</div>${ut.map(t => `<button class="ctx-item" data-t="${t.id}">${t.icon} ${esc(t.name)}</button>`).join('')}<div class="ctx-sep"></div><button class="ctx-item" data-t="">📋 Bỏ khỏi thẻ</button>`;
        document.body.appendChild(m);
        m.addEventListener('click', async e => { const tid = e.target.closest('.ctx-item')?.dataset.t; m.remove(); if (tid !== undefined) { await window.copas.moveToTab({ itemId: id, tabId: tid || null }); toast('📁 Đã chuyển!', 'success'); await refresh(); } });
        ev.stopPropagation();
    }
    function showConfirm(title, msg, onOk) {
        const ov = mk('div', 'dlg-overlay');
        ov.innerHTML = `<div class="dlg-box"><div class="dlg-title">${title}</div><div class="dlg-body">${msg}</div><div class="dlg-foot"><button class="dlg-btn cancel">Hủy</button><button class="dlg-btn danger">Xóa</button></div></div>`;
        dlgRoot.appendChild(ov);
        ov.querySelector('.cancel').addEventListener('click', () => ov.remove());
        ov.querySelector('.danger').addEventListener('click', () => { onOk(); ov.remove(); });
        ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
    }
    function closeMenus() { document.querySelectorAll('.ctx-menu').forEach(m => m.remove()) }

    // ===== UTILS =====
    function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML }
    function hi(t, q) { if (!q) return t; return t.replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>') }
    function timeAgo(iso) { const d = (Date.now() - new Date(iso)) / 1e3; if (d < 5) return 'Vừa xong'; if (d < 60) return `${~~d}s`; if (d < 3600) return `${~~(d / 60)}m`; if (d < 86400) return `${~~(d / 3600)}h`; if (d < 604800) return `${~~(d / 86400)}d`; return new Date(iso).toLocaleDateString('vi-VN') }
    function fmtB(b) { if (!b) return '0 B'; const k = 1024, s = ['B', 'KB', 'MB', 'GB'], i = Math.floor(Math.log(b) / Math.log(k)); return (b / Math.pow(k, i)).toFixed(1) + ' ' + s[i] }
    function mk(t, c) { const e = document.createElement(t); if (c) e.className = c; return e }
    function toast(msg, type = 'info') { const t = mk('div', `toast ${type}`); t.textContent = msg; toastWrap.appendChild(t); setTimeout(() => t.remove(), 2300) }

    init();
})();
