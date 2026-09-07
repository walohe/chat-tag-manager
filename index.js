import {
    TAG_KINDS,
    addTags,
    deleteTagKind,
    ensureTagKind,
    getScopeKey,
    kindsEqual,
    normalizeFileName,
    normalizeSettings,
    normalizeTags,
    normalizeTagKinds,
    removeTags,
    renameTag,
    renameTagKind,
    recordMatchesTags,
    tagKindOf,
} from './core.js';
import { IndexedRecordStore } from './storage.js';

const MODULE_NAME = 'chatTagManager';
const AUTO_SCAN_CONCURRENCY = 3;

const strings = {
    zh: {
        title: '聊天标签管理',
        description: '在“管理聊天文件”中给聊天打标签、筛选和批量管理。数据保存在浏览器 IndexedDB，不会修改聊天文件。',
        showTags: '在聊天卡片上显示标签',
        autoTag: '生成回复后自动打模型/预设标签',
        autoTagHelp: '开启后，每次 AI 回复完成会把当次模型和当前预设记为标签；关闭则只保留手动标签和“按聊天元数据补模型标签”。',
        currentScopeTags: '当前角色卡/群聊的标签',
        refresh: '刷新',
        autoModel: '按聊天元数据补模型标签',
        autoModelConfirm: '扫描当前角色卡/群聊的全部聊天，把生成消息里记录的模型（如“claude-opus-4.8”）补成标签？只读取聊天文件，不会修改。',
        autoModelRunning: '正在扫描…',
        autoModelProgress: (total, done) => `正在扫描 ${done}/${total}…`,
        autoModelDone: (scanned, changed, skipped) => `扫描完成：共 ${scanned} 封聊天，${changed} 封已带模型标签，${skipped} 封没有模型记录。`,
        noTags: '（还没有标签。在聊天列表勾选聊天后添加标签，标签会自动出现在这里。）',
        rename: '重命名',
        remove: '删除',
        clearScope: '清空当前角色卡的标签',
        clearScopeConfirm: '清空当前角色卡/群聊的全部标签？聊天文件不会被修改。',
        clearAll: '清空全部数据',
        clearAllConfirm: '清空当前用户在本浏览器的全部标签数据？',
        cleared: '已清空。',
        select: '选择模式',
        cancelSelect: '退出选择',
        filterToggle: '筛选标签',
        hideFilter: '收起筛选',
        filterPanelTitle: '按标签筛选',
        tagPanelTitle: '标签管理',
        batchSection: '输入标签',
        inputTag: '输入标签',
        filterPlaceholder: '筛选标签…',
        clearFilter: '清除筛选',
        filterOptions: '已添加的标签',
        filterOptionsEmpty: '还没有已添加的标签',
        tagPicker: '选择已添加的标签',
        modelGroup: '模型',
        presetGroup: '预设',
        manualGroup: '手动标签',
        selected: n => `已选 ${n} 个聊天`,
        batchTagPlaceholder: '输入标签…',
        addTag: '添加标签',
        removeTag: '移除标签',
        clearSelection: '清空选择',
        noSelection: '请先勾选聊天。',
        emptyTag: '请输入标签名。',
        done: '完成。',
        tagRenamed: '标签已重命名。',
        tagRemoved: '标签已删除。',
        failed: '操作失败',
        storageError: '无法打开本地 IndexedDB。',
        renamePromptTitle: '重命名标签',
        renamePromptHelp: '输入新标签名：',
        deleteTagConfirm: '从当前角色卡/群聊的所有聊天中移除该标签？',
    },
    en: {
        title: 'Chat Tag Manager',
        description: 'Tag, filter and batch-manage chats in Manage Chat Files. Data is stored in browser IndexedDB and chat files are never modified.',
        showTags: 'Show tags on chat cards',
        autoTag: 'Auto-tag models and presets after each reply',
        autoTagHelp: 'When enabled, each AI reply records its model and the current preset as tags. When disabled, only manual tags and "Tag chats with models from metadata" are used.',
        currentScopeTags: 'Tags for the current character/group',
        refresh: 'Refresh',
        autoModel: 'Tag chats with models from metadata',
        autoModelConfirm: 'Scan all chats of the current character/group and add tags for the models recorded on generated messages (e.g. "claude-opus-4.8")? Chat files are only read, never modified.',
        autoModelRunning: 'Scanning…',
        autoModelProgress: (total, done) => `Scanning ${done}/${total}…`,
        autoModelDone: (scanned, changed, skipped) => `Done: ${scanned} chats scanned, ${changed} tagged, ${skipped} had no model metadata.`,
        noTags: '（No tags yet. Select chats and add a tag — tags will appear here.）',
        rename: 'Rename',
        remove: 'Remove',
        clearScope: 'Clear tags of the current character',
        clearScopeConfirm: 'Clear all tags for the current character/group? Chat files are not modified.',
        clearAll: 'Clear all data',
        clearAllConfirm: 'Clear all tag data for the current user in this browser?',
        cleared: 'Cleared.',
        select: 'Select mode',
        cancelSelect: 'Exit select',
        filterToggle: 'Filter chats',
        hideFilter: 'Hide filter',
        filterPanelTitle: 'Filter by tag',
        tagPanelTitle: 'Tag manager',
        batchSection: 'Type a tag',
        inputTag: 'Type a tag',
        filterPlaceholder: 'Filter by tag…',
        clearFilter: 'Clear filter',
        filterOptions: 'Added tags',
        filterOptionsEmpty: 'No added tags yet',
        tagPicker: 'Pick an added tag',
        modelGroup: 'Models',
        presetGroup: 'Presets',
        manualGroup: 'Manual tags',
        selected: n => `${n} chats selected`,
        batchTagPlaceholder: 'Type a tag…',
        addTag: 'Add tag',
        removeTag: 'Remove tag',
        clearSelection: 'Clear selection',
        noSelection: 'Select chats first.',
        emptyTag: 'Enter a tag name.',
        done: 'Done.',
        tagRenamed: 'Tag renamed.',
        tagRemoved: 'Tag removed.',
        failed: 'Operation failed',
        storageError: 'Could not open local IndexedDB.',
        renamePromptTitle: 'Rename tag',
        renamePromptHelp: 'Enter the new tag name:',
        deleteTagConfirm: 'Remove this tag from all chats of the current character/group?',
    },
};

let settings;
let context;
let recordStore;
let observer = null;
let observedContainer = null;
let fetchInstalled = false;
let previousFetch = null;
let installedFetch = null;
let installedFetchState = null;
let initialized = false;
let dataEpoch = 0;
let lifecycleEpoch = 0;
let dataResetting = false;
let selectMode = false;
let filterQuery = '';
let filterPanelOpen = false;
let activePanelSection = 'filter';
let filterOutsideBound = false;
let autoScanRunning = false;
let selectModeGuardInstalled = false;
const filterGroupCollapsed = { model: true, preset: true, manual: false };
const settingsGroupCollapsed = { model: true, preset: true, manual: false };

const selection = new Set();
const eventBindings = [];
const completedChatRenames = new Map();
const completedChatDeletes = new Map();

function s() {
    const locale = context?.getCurrentLocale?.() ?? document.documentElement.lang ?? 'en';
    return String(locale).toLowerCase().startsWith('zh') ? strings.zh : strings.en;
}

function currentScope() {
    const ctx = SillyTavern.getContext();
    const avatar = ctx.characterId !== undefined ? ctx.characters?.[ctx.characterId]?.avatar : null;
    return {
        key: getScopeKey({ groupId: ctx.groupId, avatar }),
        groupId: ctx.groupId,
        avatar,
    };
}

function recordFor(scopeKey, fileName, create = false) {
    return recordStore.record(scopeKey, fileName, create);
}

function save() {
    context.saveSettingsDebounced();
}

function log(...args) {
    console.log('[Chat Tag Manager]', ...args);
}

async function getUserHandle() {
    const headers = context?.getRequestHeaders?.();
    const response = await fetch('/api/users/me', { headers });
    if (!response.ok) throw new Error(`Unable to identify the current SillyTavern user (${response.status}).`);
    const handle = String((await response.json())?.handle ?? '').trim();
    if (!handle) throw new Error('SillyTavern did not return a current user handle.');
    return handle;
}

/* ---------------- fetch 拦截：改名 / 删除 / 列表对账 ---------------- */

function parseSearchRequest(input, init) {
    try {
        const url = typeof input === 'string' || input instanceof URL ? new URL(input, location.href) : new URL(input.url, location.href);
        if (url.origin !== location.origin || url.pathname !== '/api/chats/search') return null;
        const rawBody = init?.body;
        if (typeof rawBody !== 'string') return null;
        const body = JSON.parse(rawBody);
        return { body, scopeKey: getScopeKey({ groupId: body.group_id, avatar: body.avatar_url }) };
    } catch {
        return null;
    }
}

function parseDeletedGroupId(input, init, baseUrl = globalThis.location?.href ?? 'http://localhost/') {
    try {
        const url = typeof input === 'string' || input instanceof URL ? new URL(input, baseUrl) : new URL(input.url, baseUrl);
        if (url.origin !== new URL(baseUrl).origin || url.pathname !== '/api/groups/delete' || typeof init?.body !== 'string') return null;
        return String(JSON.parse(init.body)?.id ?? '').trim() || null;
    } catch {
        return null;
    }
}

function parseChatDeleteRequest(input, init, baseUrl = globalThis.location?.href ?? 'http://localhost/') {
    try {
        const url = typeof input === 'string' || input instanceof URL ? new URL(input, baseUrl) : new URL(input.url, baseUrl);
        if (url.origin !== new URL(baseUrl).origin || url.pathname !== '/api/chats/delete' || typeof init?.body !== 'string') return null;
        const body = JSON.parse(init.body);
        const avatar = String(body?.avatar_url ?? '').trim();
        const fileName = normalizeFileName(body?.chatfile, { physical: true });
        if (!avatar || !fileName) return null;
        return { scopeKey: getScopeKey({ avatar }), fileName };
    } catch {
        return null;
    }
}

function rememberChatDelete(request) {
    if (!request) return;
    const pending = completedChatDeletes.get(request.fileName) ?? [];
    pending.push(request);
    completedChatDeletes.set(request.fileName, pending);
    if (completedChatDeletes.size > 50) completedChatDeletes.delete(completedChatDeletes.keys().next().value);
}

export function resolveChatDeleteEvent(fileName) {
    const normalized = normalizeFileName(fileName, { physical: true });
    const pending = completedChatDeletes.get(normalized);
    if (!pending?.length) return null;
    const request = pending.shift();
    if (!pending.length) completedChatDeletes.delete(normalized);
    return request;
}

function chatRenameKey(scopeKey, oldFileName, requestedFileName) {
    return `${scopeKey ?? 'group:*'}\n${oldFileName}\n${requestedFileName}`;
}

function parseChatRenameRequest(input, init, baseUrl = globalThis.location?.href ?? 'http://localhost/') {
    try {
        const url = typeof input === 'string' || input instanceof URL ? new URL(input, baseUrl) : new URL(input.url, baseUrl);
        if (url.origin !== new URL(baseUrl).origin || url.pathname !== '/api/chats/rename' || typeof init?.body !== 'string') return null;
        const body = JSON.parse(init.body);
        const scopeKey = body.is_group ? null : getScopeKey({ avatar: body.avatar_url });
        const oldFileName = normalizeFileName(body.original_file, { physical: true });
        const requestedFileName = normalizeFileName(body.renamed_file, { physical: true });
        if (!oldFileName || !requestedFileName) return null;
        return { scopeKey, oldFileName, requestedFileName };
    } catch {
        return null;
    }
}

function rememberChatRename(request, responseBody) {
    const actualFileName = normalizeFileName(responseBody?.sanitizedFileName, { physical: true });
    if (!request || !actualFileName) return;
    const key = chatRenameKey(request.scopeKey, request.oldFileName, request.requestedFileName);
    completedChatRenames.set(key, actualFileName);
    if (completedChatRenames.size > 50) completedChatRenames.delete(completedChatRenames.keys().next().value);
}

function takeChatRename(scopeKey, oldFileName, requestedFileName) {
    const exactKey = chatRenameKey(scopeKey, oldFileName, requestedFileName);
    const groupKey = chatRenameKey(null, oldFileName, requestedFileName);
    const key = completedChatRenames.has(exactKey)
        ? exactKey
        : String(scopeKey).startsWith('group:') ? groupKey : exactKey;
    const actualFileName = completedChatRenames.get(key);
    completedChatRenames.delete(key);
    return actualFileName;
}

export function resolveChatRenameEvent(data) {
    const scopeKey = getScopeKey({ groupId: data?.groupId, avatar: data?.avatarId });
    const oldFileName = normalizeFileName(data?.oldFileName, { physical: true });
    const requestedFileName = normalizeFileName(data?.newFileName, { physical: true });
    const newFileName = takeChatRename(scopeKey, oldFileName, requestedFileName) ?? requestedFileName;
    return { scopeKey, oldFileName, newFileName };
}

/** 聊天列表加载后，把本地记录里已经不存在的文件清理掉。 */
async function reconcileScopeRecords(scopeKey, nativeResults, expectedEpoch = dataEpoch) {
    if (expectedEpoch !== dataEpoch) return;
    await recordStore.loadScope(scopeKey);
    if (expectedEpoch !== dataEpoch) return;
    const liveFiles = new Set(nativeResults.map(item => normalizeFileName(item.file_name ?? item.file_id)));
    const staleFiles = Object.keys(recordStore.scope(scopeKey) ?? {}).filter(fileName => !liveFiles.has(fileName));
    if (!staleFiles.length) return;
    await Promise.all(staleFiles.map(fileName => recordStore.delete(scopeKey, fileName)));
}

export function installFetchWrapper() {
    if (fetchInstalled) return;
    const delegate = globalThis.fetch;
    const state = { enabled: true };
    previousFetch = delegate;
    installedFetchState = state;
    installedFetch = async function ctmFetch(input, init) {
        if (!state.enabled) return Reflect.apply(delegate, globalThis, [input, init]);
        const parsed = parseSearchRequest(input, init);
        const deletedGroupId = parseDeletedGroupId(input, init);
        const chatDelete = parseChatDeleteRequest(input, init);
        const chatRename = parseChatRenameRequest(input, init);
        const response = await Reflect.apply(delegate, globalThis, [input, init]);
        if (chatRename && response.ok) {
            try { rememberChatRename(chatRename, await response.clone().json()); }
            catch (error) { console.warn('[Chat Tag Manager] Could not capture the sanitized chat name:', error); }
        }
        if (chatDelete && response.ok) rememberChatDelete(chatDelete);
        if (deletedGroupId && response.ok) {
            const scopeKey = getScopeKey({ groupId: deletedGroupId });
            void recordStore.deleteScope(scopeKey).catch(error =>
                console.warn('[Chat Tag Manager] Deleted group cache cleanup failed:', error));
        }
        if (parsed && !String(parsed.body.query ?? '').trim() && response.ok) {
            const expectedEpoch = dataEpoch;
            void response.clone().json().then(nativeResults => {
                if (!Array.isArray(nativeResults) || expectedEpoch !== dataEpoch) return;
                return reconcileScopeRecords(parsed.scopeKey, nativeResults, expectedEpoch)
                    .then(() => requestAnimationFrame(renderVisibleCards));
            }).catch(error => console.warn('[Chat Tag Manager] Chat list reconciliation failed:', error));
        }
        return response;
    };
    globalThis.fetch = installedFetch;
    fetchInstalled = true;
}

export function uninstallFetchWrapper() {
    if (!fetchInstalled) return;
    installedFetchState.enabled = false;
    if (globalThis.fetch === installedFetch) globalThis.fetch = previousFetch;
    else console.warn('[Chat Tag Manager] Another extension replaced fetch after this extension; the inactive wrapper will remain as a pass-through.');
    fetchInstalled = false;
    installedFetch = null;
    installedFetchState = null;
    previousFetch = null;
    completedChatRenames.clear();
    completedChatDeletes.clear();
}

/* ---------------- 管理聊天文件页的卡片增强 ---------------- */

function renderVisibleCards() {
    if (!initialized) return;
    const scope = currentScope();
    const cardCount = document.querySelectorAll('#select_chat_div .select_chat_block_wrapper').length;
    log('renderVisibleCards scope=', scope.key, 'loaded=', recordStore.loadedScopes.has(scope.key), 'cards=', cardCount);
    if (!recordStore.loadedScopes.has(scope.key)) {
        void recordStore.loadScope(scope.key).then(() => {
            if (initialized) renderVisibleCards();
        }).catch(error => console.warn('[Chat Tag Manager] IndexedDB scope load failed:', error));
        return;
    }
    document.querySelectorAll('#select_chat_div .select_chat_block_wrapper').forEach(enhanceCard);
    ensureToolbar();
    applyFilter();
    updateTagDatalist();
}

function enhanceCard(wrapper) {
    const block = wrapper.querySelector('.select_chat_block');
    const originalNameElement = wrapper.querySelector('.select_chat_block_filename');
    const titleLeft = originalNameElement?.parentElement;
    if (!block || !originalNameElement || !titleLeft) return;

    const fileName = normalizeFileName(
        block.getAttribute('file_name') || wrapper.dataset.ctmFile || originalNameElement.textContent,
        { physical: true },
    );
    wrapper.dataset.ctmFile = fileName;
    wrapper.querySelectorAll('.ctm-injected').forEach(element => element.remove());

    const scope = currentScope();
    const record = recordFor(scope.key, fileName);
    log('enhanceCard file=', fileName, 'scope=', scope.key, 'tags=', record?.tags);

    // 标签胶囊：点击某个标签 = 按它筛选
    if (settings.config.showTags) {
        const tags = document.createElement('span');
        tags.className = 'ctm-tags ctm-injected';
        for (const tag of normalizeTags(record?.tags)) {
            const pill = document.createElement('span');
            pill.className = 'ctm-tag';
            pill.textContent = tag;
            pill.title = tag;
            pill.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                setFilter(tag);
            });
            tags.append(pill);
        }
        if (tags.childNodes.length) titleLeft.append(tags);
    }

    // 选择模式勾选框（绝对定位，不干扰原生点击打开聊天）
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'ctm-select ctm-injected';
    checkbox.hidden = !selectMode;
    checkbox.checked = selection.has(fileName);
    checkbox.title = s().select;
    checkbox.addEventListener('click', event => event.stopPropagation());
    checkbox.addEventListener('change', () => toggleSelect(fileName, checkbox.checked));
    wrapper.append(checkbox);
}

function setFilter(query) {
    filterQuery = String(query ?? '').trim();
    const filterInput = document.querySelector('#ctm_filter');
    if (filterInput) filterInput.value = filterQuery;
    if (filterQuery) {
        // 从标签胶囊或下拉选项发起筛选时，自动展开筛选栏，让用户能看到当前筛选条件并能快速清除。
        if (!filterPanelOpen) {
            toggleFilterPanel(true, 'filter');
        } else {
            setPanelSection('filter');
        }
    }
    applyFilter();
    updateTagDatalist();
}

function applyFilter() {
    if (!initialized) return;
    const scope = currentScope();
    document.querySelectorAll('#select_chat_div .select_chat_block_wrapper').forEach(card => {
        const fileName = card.dataset.ctmFile;
        const record = fileName ? recordFor(scope.key, fileName) : null;
        card.style.display = recordMatchesTags(record, filterQuery) ? '' : 'none';
    });
}

function updateSelectModeUI() {
    const selectToggle = document.querySelector('#ctm_select_toggle');
    if (selectToggle) {
        selectToggle.classList.toggle('ctm-active', selectMode);
        selectToggle.title = selectMode ? s().cancelSelect : s().select;
        const icon = selectToggle.querySelector('i');
        if (icon) icon.className = selectMode ? 'fa-solid fa-check' : 'fa-solid fa-check-double';
    }
    document.querySelector('#select_chat_div')?.classList.toggle('ctm-select-mode', selectMode);
}

function handleSelectModeCardClick(event) {
    if (!selectMode) return;
    const container = document.querySelector('#select_chat_div');
    if (!container) {
        // 管理聊天文件弹窗已经关闭，但选择模式还开着：自动退出，避免全局监听残留。
        selectMode = false;
        selection.clear();
        uninstallSelectModeGuard();
        updateBatchBar();
        return;
    }
    const target = event.target;
    if (!(target instanceof Element)) return;
    const wrapper = target.closest('.select_chat_block_wrapper');
    if (!wrapper || !container.contains(wrapper)) return;

    // 勾选框交给原生 change 事件处理；标签胶囊仍用于按标签筛选，不拦截。
    if (target.closest('.ctm-select') || target.closest('.ctm-tag')) return;
    // 保留卡片上原生按钮/链接/输入框的交互，例如单聊删除、重命名等。
    if (target.closest('button, a, input, select, textarea')) return;

    // 在捕获阶段拦住原生“打开聊天”的点击，改为勾选/取消勾选。
    event.preventDefault();
    event.stopPropagation();
    const block = wrapper.querySelector('.select_chat_block');
    const fileName = normalizeFileName(
        wrapper.dataset.ctmFile || block?.getAttribute('file_name'),
        { physical: true },
    );
    if (fileName) {
        const checked = !selection.has(fileName);
        toggleSelect(fileName, checked);
        const checkbox = wrapper.querySelector('.ctm-select');
        if (checkbox) checkbox.checked = checked;
    }
}

function installSelectModeGuard() {
    if (selectModeGuardInstalled) return;
    selectModeGuardInstalled = true;
    document.addEventListener('click', handleSelectModeCardClick, true);
}

function uninstallSelectModeGuard() {
    if (!selectModeGuardInstalled) return;
    selectModeGuardInstalled = false;
    document.removeEventListener('click', handleSelectModeCardClick, true);
}

function toggleSelectMode() {
    selectMode = !selectMode;
    if (!selectMode) {
        selection.clear();
        uninstallSelectModeGuard();
    } else {
        installSelectModeGuard();
    }
    renderVisibleCards();
    updateBatchBar();
    updateSelectModeUI();
}

function toggleSelect(fileName, checked) {
    const key = normalizeFileName(fileName);
    if (checked) selection.add(key);
    else selection.delete(key);
    updateBatchBar();
}

function clearSelection() {
    selection.clear();
    updateBatchBar();
    renderVisibleCards();
}

async function applyBatch(action) {
    const input = document.querySelector('#ctm_batch_tag');
    const tag = String(input?.value ?? '').trim();
    if (!tag) {
        globalThis.toastr?.warning(s().emptyTag);
        return;
    }
    if (!selection.size) {
        globalThis.toastr?.warning(s().noSelection);
        return;
    }
    const scope = currentScope();
    log('applyBatch action=', action, 'scope=', scope.key, 'files=', [...selection], 'tag=', tag);
    const entries = [];
    for (const fileName of selection) {
        const record = recordFor(scope.key, fileName, true);
        record.tags = action === 'add' ? addTags(record.tags, tag) : removeTags(record.tags, tag);
        if (action === 'remove') record.tagKinds = deleteTagKind(record.tagKinds, tag);
        record.updatedAt = new Date().toISOString();
        entries.push([fileName, record]);
    }
    try {
        await recordStore.putMany(scope.key, entries);
        log('applyBatch saved entries=', entries.length, 'scopeKeys=', Object.keys(recordStore.scope(scope.key)).length);
        if (input) input.value = '';
        renderVisibleCards();
        updateBatchBar();
        refreshTagList();
        globalThis.toastr?.success(s().done);
    } catch (error) {
        console.error('[Chat Tag Manager] Batch tag update failed:', error);
        globalThis.toastr?.error(error.message || s().failed);
    }
}

let tagHostObserver = null;

function ensureToolbar() {
    const header = document.querySelector('#select_chat_popup [name="selectChatPopupHeader"]');
    if (!header || document.querySelector('#ctm_toolbar')) return;
    // 内嵌栏挂在聊天列表上方，重建工具条前先清掉可能残留的旧面板。
    document.querySelector('#ctm_panel')?.remove();
    filterPanelOpen = false;
    filterQuery = '';
    const toolbar = document.createElement('div');
    toolbar.id = 'ctm_toolbar';
    toolbar.className = 'ctm-toolbar ctm-injected';

    const selectToggle = document.createElement('button');
    selectToggle.id = 'ctm_select_toggle';
    selectToggle.type = 'button';
    selectToggle.className = 'menu_button menu_button_icon';
    selectToggle.innerHTML = '<i class="fa-solid fa-check-double"></i>';
    selectToggle.title = s().select;
    selectToggle.addEventListener('click', event => {
        event.stopPropagation();
        toggleSelectMode();
    });

    const panelToggle = document.createElement('button');
    panelToggle.id = 'ctm_panel_toggle';
    panelToggle.type = 'button';
    panelToggle.className = 'menu_button menu_button_icon ctm-panel-toggle';
    panelToggle.innerHTML = '<i class="fa-solid fa-filter"></i>';
    panelToggle.title = s().filterToggle;
    panelToggle.append(document.createTextNode(s().filterToggle));
    panelToggle.setAttribute('aria-expanded', 'false');
    panelToggle.addEventListener('click', event => {
        event.stopPropagation();
        toggleFilterPanel();
    });

    const main = document.createElement('div');
    main.className = 'ctm-toolbar-main';
    main.append(selectToggle, panelToggle);

    const panel = document.createElement('div');
    panel.id = 'ctm_panel';
    panel.className = 'ctm-panel ctm-viewport-panel ctm-injected';
    panel.hidden = true;

    const floatHead = document.createElement('div');
    floatHead.className = 'ctm-float-head';
    const floatTitle = document.createElement('span');
    floatTitle.className = 'ctm-float-title';
    floatTitle.textContent = s().tagPanelTitle;
    const closePanelBtn = document.createElement('button');
    closePanelBtn.id = 'ctm_filter_panel_close';
    closePanelBtn.type = 'button';
    closePanelBtn.className = 'menu_button menu_button_icon';
    closePanelBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    closePanelBtn.title = s().hideFilter;
    closePanelBtn.addEventListener('click', event => {
        event.stopPropagation();
        toggleFilterPanel(false);
    });
    floatHead.append(closePanelBtn, floatTitle);
    panel.append(floatHead);

    const modeBar = document.createElement('div');
    modeBar.className = 'ctm-panel-mode';

    const filterModeBtn = document.createElement('button');
    filterModeBtn.id = 'ctm_mode_filter';
    filterModeBtn.type = 'button';
    filterModeBtn.className = 'ctm-panel-mode-btn';
    filterModeBtn.innerHTML = '<i class="fa-solid fa-filter"></i>';
    filterModeBtn.append(document.createTextNode(s().filterToggle));
    filterModeBtn.append(document.createElement('i'));
    filterModeBtn.lastChild.className = 'fa-solid fa-chevron-down ctm-mode-chevron';
    filterModeBtn.addEventListener('click', event => {
        event.stopPropagation();
        setPanelSection('filter');
    });

    const batchModeBtn = document.createElement('button');
    batchModeBtn.id = 'ctm_mode_batch';
    batchModeBtn.type = 'button';
    batchModeBtn.className = 'ctm-panel-mode-btn';
    batchModeBtn.innerHTML = '<i class="fa-solid fa-pen"></i>';
    batchModeBtn.append(document.createTextNode(s().batchSection));
    batchModeBtn.append(document.createElement('i'));
    batchModeBtn.lastChild.className = 'fa-solid fa-chevron-down ctm-mode-chevron';
    batchModeBtn.addEventListener('click', event => {
        event.stopPropagation();
        setPanelSection('batch');
    });

    modeBar.append(filterModeBtn, batchModeBtn);

    const filterView = document.createElement('div');
    filterView.id = 'ctm_filter_view';
    filterView.className = 'ctm-panel-view';

    const batchView = document.createElement('div');
    batchView.id = 'ctm_batch_view';
    batchView.className = 'ctm-panel-view';
    batchView.hidden = true;

    const panelBatchCount = document.createElement('span');
    panelBatchCount.id = 'ctm_panel_batch_count';
    panelBatchCount.className = 'ctm-batch-count';

    const panelBatchTag = document.createElement('input');
    panelBatchTag.id = 'ctm_batch_tag';
    panelBatchTag.type = 'text';
    panelBatchTag.className = 'text_pole';
    panelBatchTag.placeholder = s().batchTagPlaceholder;
    panelBatchTag.setAttribute('autocomplete', 'off');
    panelBatchTag.addEventListener('input', () => {
        updateTagDatalist();
    });
    panelBatchTag.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.isComposing) {
            event.preventDefault();
            applyBatch('add');
        }
    });

    const panelAddBtn = document.createElement('button');
    panelAddBtn.id = 'ctm_batch_panel_add';
    panelAddBtn.type = 'button';
    panelAddBtn.className = 'menu_button';
    panelAddBtn.textContent = s().addTag;
    panelAddBtn.addEventListener('click', event => {
        event.stopPropagation();
        applyBatch('add');
    });

    const panelRemoveBtn = document.createElement('button');
    panelRemoveBtn.id = 'ctm_batch_panel_remove';
    panelRemoveBtn.type = 'button';
    panelRemoveBtn.className = 'menu_button';
    panelRemoveBtn.textContent = s().removeTag;
    panelRemoveBtn.addEventListener('click', event => {
        event.stopPropagation();
        applyBatch('remove');
    });

    const panelBatchActions = document.createElement('div');
    panelBatchActions.className = 'ctm-batch-panel-actions';
    panelBatchActions.append(panelAddBtn, panelRemoveBtn);

    const panelBatchListTitle = document.createElement('div');
    panelBatchListTitle.className = 'ctm-panel-list-title';
    panelBatchListTitle.textContent = s().filterOptions;

    const panelBatchOptions = document.createElement('div');
    panelBatchOptions.id = 'ctm_batch_tag_options';
    panelBatchOptions.className = 'ctm-filter-options ctm-inline-options';

    const panelBatchOptionsList = document.createElement('div');
    panelBatchOptionsList.id = 'ctm_batch_tag_options_list';
    panelBatchOptionsList.className = 'ctm-filter-options-list';
    panelBatchOptions.append(panelBatchOptionsList);

    batchView.append(panelBatchCount, panelBatchTag, panelBatchActions, panelBatchListTitle, panelBatchOptions);

    const filter = document.createElement('input');
    filter.id = 'ctm_filter';
    filter.type = 'text';
    filter.className = 'text_pole';
    filter.placeholder = s().filterPlaceholder;
    filter.addEventListener('input', () => {
        filterQuery = filter.value.trim();
        applyFilter();
        updateTagDatalist();
    });

    const filterControls = document.createElement('div');
    filterControls.id = 'ctm_filter_controls';
    filterControls.className = 'ctm-filter-controls';

    const filterOptionsBtn = document.createElement('button');
    filterOptionsBtn.id = 'ctm_filter_options_btn';
    filterOptionsBtn.type = 'button';
    filterOptionsBtn.className = 'menu_button menu_button_icon ctm-filter-options-btn';
    filterOptionsBtn.innerHTML = '<i class="fa-solid fa-chevron-down"></i>';
    filterOptionsBtn.title = s().filterOptions;
    filterOptionsBtn.setAttribute('aria-expanded', 'false');
    filterOptionsBtn.addEventListener('click', event => {
        event.stopPropagation();
        toggleFilterOptions();
    });

    const filterOptions = document.createElement('div');
    filterOptions.id = 'ctm_filter_options';
    filterOptions.className = 'ctm-filter-options';
    filterOptions.hidden = true;

    const filterOptionsList = document.createElement('div');
    filterOptionsList.id = 'ctm_filter_options_list';
    filterOptionsList.className = 'ctm-filter-options-list';
    filterOptions.append(filterOptionsList);

    filterControls.append(filter, filterOptionsBtn, filterOptions);

    const clearFilter = document.createElement('button');
    clearFilter.type = 'button';
    clearFilter.className = 'menu_button ctm-clear-filter';
    clearFilter.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    clearFilter.title = s().clearFilter;
    clearFilter.addEventListener('click', event => {
        event.stopPropagation();
        filter.value = '';
        filterQuery = '';
        applyFilter();
        updateTagDatalist();
    });

    filterView.append(filterControls, clearFilter);
    panel.append(modeBar, filterView, batchView);
    toolbar.append(main);
    document.body.append(panel);
    tagHostObserver?.disconnect();
    tagHostObserver = new MutationObserver(() => {
        const host = document.querySelector('#select_chat_popup');
        if (!host?.getClientRects().length) toggleFilterPanel(false);
    });
    for (const host of [header.closest('#select_chat_popup'), header.closest('#shadow_select_chat_popup')]) {
        if (host) tagHostObserver.observe(host, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    }
    window.addEventListener('resize', positionTagPanel);
    window.visualViewport?.addEventListener('resize', positionTagPanel);
    window.visualViewport?.addEventListener('scroll', positionTagPanel);

    const batch = document.createElement('div');
    batch.id = 'ctm_batch';
    batch.className = 'ctm-batch';
    batch.hidden = true;

    const count = document.createElement('span');
    count.id = 'ctm_batch_count';
    count.className = 'ctm-batch-count';

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'menu_button';
    clearBtn.textContent = s().clearSelection;
    clearBtn.addEventListener('click', event => {
        event.stopPropagation();
        clearSelection();
    });

    const openTagInputBtn = document.createElement('button');
    openTagInputBtn.id = 'ctm_open_tag_input';
    openTagInputBtn.type = 'button';
    openTagInputBtn.className = 'menu_button';
    openTagInputBtn.innerHTML = '<i class="fa-solid fa-pen"></i>';
    openTagInputBtn.append(document.createTextNode(s().inputTag));
    openTagInputBtn.addEventListener('click', event => {
        event.stopPropagation();
        toggleFilterPanel(true, 'batch');
    });

    batch.append(count, openTagInputBtn, clearBtn);
    toolbar.append(batch);

    header.after(toolbar);
    updateFilterPanel();
    updateSelectModeUI();
    if (!filterOutsideBound) {
        filterOutsideBound = true;
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                toggleBatchTagOptions(false);
                toggleFilterPanel(false);
            }
        });
    }
    updateBatchBar();
    updateTagDatalist();
}

function updateFilterPanel() {
    const panel = document.querySelector('#ctm_panel');
    const button = document.querySelector('#ctm_panel_toggle');
    if (!panel || !button) return;
    panel.hidden = !filterPanelOpen;
    const options = document.querySelector('#ctm_filter_options');
    if (options) options.hidden = !filterPanelOpen || activePanelSection !== 'filter';
    button.classList.toggle('ctm-active', filterPanelOpen || Boolean(filterQuery));
    button.title = filterPanelOpen ? s().hideFilter : s().filterToggle;
    button.setAttribute('aria-expanded', String(filterPanelOpen));
    if (filterPanelOpen) {
        updatePanelSectionUI();
        positionTagPanel();
    }
}

function updatePanelSectionUI() {
    const filterModeBtn = document.querySelector('#ctm_mode_filter');
    const batchModeBtn = document.querySelector('#ctm_mode_batch');
    const filterView = document.querySelector('#ctm_filter_view');
    const batchView = document.querySelector('#ctm_batch_view');
    if (!filterModeBtn || !batchModeBtn || !filterView || !batchView) return;
    const isFilter = activePanelSection !== 'batch';
    filterModeBtn.classList.toggle('ctm-active', isFilter);
    filterModeBtn.setAttribute('aria-expanded', String(isFilter));
    batchModeBtn.classList.toggle('ctm-active', !isFilter);
    batchModeBtn.setAttribute('aria-expanded', String(!isFilter));
    filterView.hidden = !isFilter;
    batchView.hidden = isFilter;
    const filterOptions = document.querySelector('#ctm_filter_options');
    if (filterOptions) filterOptions.hidden = !isFilter;
}

function setPanelSection(section) {
    activePanelSection = section === 'batch' ? 'batch' : 'filter';
    updateTagDatalist();
    updateFilterPanel();
}

function positionTagPanel() {
    const panel = document.querySelector('#ctm_panel');
    if (!panel || panel.hidden) return;
    const viewport = window.visualViewport;
    // Use the visible screen directly, never the changing chat-dialog bounds.
    const availableWidth = viewport?.width ?? document.documentElement.clientWidth;
    const availableHeight = viewport?.height ?? window.innerHeight;
    const width = Math.max(0, Math.min(560, availableWidth - 16));
    const height = Math.max(0, Math.min(720, availableHeight - 16));
    panel.style.width = width + 'px';
    panel.style.height = height + 'px';
    panel.style.left = ((viewport?.offsetLeft ?? 0) + (availableWidth - width) / 2) + 'px';
    panel.style.top = ((viewport?.offsetTop ?? 0) + Math.max(8, (availableHeight - height) / 2)) + 'px';
}

function toggleFilterPanel(force, section) {
    if (typeof section === 'string') {
        activePanelSection = section === 'batch' ? 'batch' : 'filter';
    }
    const shouldOpen = typeof force === 'boolean' ? force : !filterPanelOpen;
    filterPanelOpen = shouldOpen;
    if (filterPanelOpen) updateTagDatalist();
    updateFilterPanel();
}

function updateBatchBar() {
    const batch = document.querySelector('#ctm_batch');
    if (!batch) return;
    batch.hidden = !selection.size;
    const count = document.querySelector('#ctm_batch_count');
    if (count) count.textContent = s().selected(selection.size);
    const panelCount = document.querySelector('#ctm_panel_batch_count');
    if (panelCount) panelCount.textContent = selection.size ? s().selected(selection.size) : s().noSelection;
}

function updateTagDatalist() {
    const scope = currentScope();
    const records = recordStore.loadedScopes.has(scope.key)
        ? recordStore.scope(scope.key)
        : {};
    const groups = collectGroupedTags(records);
    renderFilterOptions(groups);
    renderBatchTagOptions(groups);
}

function toggleFilterOptions() {
    // 内嵌栏里筛选分组列表始终可见，不需要额外的折叠按钮。
}

function toggleBatchTagOptions() {
    // 悬浮面板里输入标签的已添加标签列表始终可见，点击具体标签只会填入输入框。
}

function updateOptionsDirection(panel) {
    if (!panel) return;
    let openUp = false;
    try {
        const coarsePointer = window.matchMedia?.('(hover: none)').matches;
        const touchDevice = navigator.maxTouchPoints > 0;
        const parent = panel.parentElement;
        const rect = parent?.getBoundingClientRect();
        const belowSpace = rect ? window.innerHeight - rect.bottom : Number.POSITIVE_INFINITY;
        openUp = coarsePointer || touchDevice || belowSpace < 240;
    } catch {
        openUp = true;
    }
    panel.classList.toggle('ctm-open-up', openUp);
}

function collectGroupedTags(records) {
    const kindsByTag = new Map();
    for (const record of Object.values(records ?? {})) {
        for (const tag of normalizeTags(record?.tags)) {
            const kind = tagKindOf(record?.tagKinds, tag);
            const current = kindsByTag.get(tag);
            if (current === TAG_KINDS.PRESET) continue;
            if (kind === TAG_KINDS.PRESET || kind === TAG_KINDS.MODEL || !current) {
                kindsByTag.set(tag, kind);
            }
        }
    }
    const groups = { model: [], preset: [], manual: [] };
    for (const [tag, kind] of kindsByTag) {
        const key = kind === TAG_KINDS.PRESET ? 'preset' : kind === TAG_KINDS.MODEL ? 'model' : 'manual';
        groups[key].push(tag);
    }
    for (const key of Object.keys(groups)) groups[key].sort((a, b) => a.localeCompare(b));
    return groups;
}

function createGroupSection(key, label, count, collapsedState) {
    const group = document.createElement('div');
    group.className = 'ctm-tag-group';
    group.classList.toggle('collapsed', collapsedState[key] !== false);

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'ctm-tag-group-header';
    header.setAttribute('aria-expanded', String(collapsedState[key] === false));
    header.innerHTML = '<i class="fa-solid fa-chevron-right ctm-tag-group-chevron"></i>';
    header.append(document.createTextNode(`${label}（${count}）`));
    header.addEventListener('click', () => {
        collapsedState[key] = collapsedState[key] === false ? true : false;
        group.classList.toggle('collapsed', collapsedState[key]);
        header.setAttribute('aria-expanded', String(!collapsedState[key]));
    });

    const items = document.createElement('div');
    items.className = 'ctm-tag-group-items';
    group.append(header, items);
    return { group, items };
}

function renderFilterOptions(groups) {
    const list = document.querySelector('#ctm_filter_options_list');
    if (!list) return;
    renderGroupedOptions(list, groups, {
        active: filterQuery,
        collapsedState: filterGroupCollapsed,
        emptyText: s().filterOptionsEmpty,
        onPick: tag => {
            setFilter(tag);
        },
    });
}

function renderBatchTagOptions(groups) {
    const list = document.querySelector('#ctm_batch_tag_options_list');
    if (!list) return;
    const input = document.querySelector('#ctm_batch_tag');
    const active = String(input?.value ?? '').trim();
    renderGroupedOptions(list, groups, {
        active,
        collapsedState: filterGroupCollapsed,
        emptyText: s().filterOptionsEmpty,
        onPick: tag => {
            const input = document.querySelector('#ctm_batch_tag');
            if (input) input.value = tag;
            updateTagDatalist();
        },
    });
}

function renderGroupedOptions(list, groups, { active = '', collapsedState, emptyText, onPick = null } = {}) {
    if (!list) return;
    list.replaceChildren();
    const grouped = groups ?? { model: [], preset: [], manual: [] };
    const total = (grouped.model?.length ?? 0) + (grouped.preset?.length ?? 0) + (grouped.manual?.length ?? 0);
    if (!total) {
        const empty = document.createElement('span');
        empty.className = 'ctm-filter-options-empty';
        empty.textContent = emptyText ?? s().filterOptionsEmpty;
        list.append(empty);
        return;
    }
    const activeNorm = String(active ?? '').trim().toLowerCase();

    const makeOption = (tag, groupName) => {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'ctm-filter-option';
        option.textContent = tag;
        option.title = `${groupName}：${tag}`;
        const isActive = tag.toLowerCase() === activeNorm;
        option.classList.toggle('ctm-filter-option-active', isActive);
        option.setAttribute('aria-pressed', String(isActive));
        option.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            onPick?.(isActive && activeNorm ? '' : tag);
        });
        return option;
    };

    const sections = [
        { key: 'model', label: s().modelGroup, tags: grouped.model ?? [] },
        { key: 'preset', label: s().presetGroup, tags: grouped.preset ?? [] },
        { key: 'manual', label: s().manualGroup, tags: grouped.manual ?? [] },
    ];
    for (const section of sections) {
        if (!section.tags.length) continue;
        const { group, items } = createGroupSection(section.key, section.label, section.tags.length, collapsedState ?? filterGroupCollapsed);
        for (const tag of section.tags) items.append(makeOption(tag, section.label));
        list.append(group);
    }
}

function handleCardMutations(mutations) {
    for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
            if (!(node instanceof Element)) continue;
            if (node.matches('.select_chat_block_wrapper')) enhanceCard(node);
            else node.querySelectorAll?.('.select_chat_block_wrapper').forEach(enhanceCard);
        }
    }
    applyFilter();
}

function startObserver() {
    observer?.disconnect();
    observedContainer = document.querySelector('#select_chat_div');
    observer = new MutationObserver(mutations => {
        if (!observedContainer) {
            observedContainer = document.querySelector('#select_chat_div');
            if (observedContainer) {
                observer.disconnect();
                observer.observe(observedContainer, { childList: true });
                renderVisibleCards();
            }
            return;
        }
        handleCardMutations(mutations);
    });
    if (observedContainer) observer.observe(observedContainer, { childList: true });
    else if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    renderVisibleCards();
}

function stopObserver() {
    tagHostObserver?.disconnect();
    tagHostObserver = null;
    observer?.disconnect();
    observer = null;
    observedContainer = null;
    document.querySelector('#select_chat_div')?.classList.remove('ctm-select-mode');
    document.querySelectorAll('#select_chat_div .select_chat_block_wrapper').forEach(wrapper => {
        wrapper.style.display = '';
        delete wrapper.dataset.ctmFile;
    });
    document.querySelectorAll('.ctm-injected').forEach(element => element.remove());
    selection.clear();
    selectMode = false;
    filterQuery = '';
}

/* ---------------- 设置面板 ---------------- */

function settingsHtml() {
    return `
<div id="ctm_settings" class="ctm-settings">
  <div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>${s().title}</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">
      <p class="ctm-help">${s().description}</p>
      <label class="checkbox_label" for="ctm_show_tags">
        <input id="ctm_show_tags" type="checkbox">
        <span>${s().showTags}</span>
      </label>
      <label class="checkbox_label" for="ctm_auto_tag">
        <input id="ctm_auto_tag" type="checkbox">
        <span>${s().autoTag}</span>
      </label>
      <p class="ctm-help">${s().autoTagHelp}</p>
      <fieldset class="ctm-box">
        <legend>${s().currentScopeTags}</legend>
        <div id="ctm_tag_list" class="ctm-tag-list"></div>
        <button id="ctm_tags_refresh" type="button" class="menu_button">${s().refresh}</button>
        <button id="ctm_tags_auto_model" type="button" class="menu_button">${s().autoModel}</button>
        <span id="ctm_auto_status" class="ctm-help"></span>
      </fieldset>
      <div class="flex-container gap10px">
        <button id="ctm_clear_scope" type="button" class="menu_button danger_button">${s().clearScope}</button>
        <button id="ctm_clear_all" type="button" class="menu_button danger_button">${s().clearAll}</button>
      </div>
    </div>
  </div>
</div>`;
}

async function renderSettings(expectedEpoch = lifecycleEpoch) {
    if (document.querySelector('#ctm_settings')) return;
    const html = settingsHtml();
    if (!initialized || expectedEpoch !== lifecycleEpoch) return;
    document.querySelector('#extensions_settings2')?.insertAdjacentHTML('beforeend', html);

    const showTags = document.querySelector('#ctm_show_tags');
    showTags.checked = settings.config.showTags;
    showTags.addEventListener('change', () => {
        settings.config.showTags = showTags.checked;
        save();
        renderVisibleCards();
    });
    const autoTag = document.querySelector('#ctm_auto_tag');
    autoTag.checked = settings.config.autoTag !== false;
    autoTag.addEventListener('change', () => {
        settings.config.autoTag = autoTag.checked;
        save();
    });
    document.querySelector('#ctm_tags_refresh').addEventListener('click', refreshTagList);
    document.querySelector('#ctm_tags_auto_model').addEventListener('click', () => {
        runAutoModelScan().catch(error => globalThis.toastr?.error(error.message || s().failed));
    });
    document.querySelector('#ctm_clear_scope').addEventListener('click', async () => {
        if (await context.Popup.show.confirm(s().title, s().clearScopeConfirm)) {
            await clearScopeTags();
        }
    });
    document.querySelector('#ctm_clear_all').addEventListener('click', async () => {
        if (await context.Popup.show.confirm(s().title, s().clearAllConfirm)) {
            await clearAllData();
        }
    });
    await refreshTagList();
}

/** 设置页里显示"当前角色卡/群聊"的标签列表，可重命名/删除。 */
async function refreshTagList() {
    const container = document.querySelector('#ctm_tag_list');
    if (!container || !recordStore) return;
    const scope = currentScope();
    try {
        await recordStore.loadScope(scope.key);
    } catch (error) {
        console.warn('[Chat Tag Manager] Could not load scope for tag list:', error);
        return;
    }
    const records = recordStore.scope(scope.key) ?? {};
    const counts = new Map();
    for (const record of Object.values(records)) {
        for (const tag of normalizeTags(record?.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    const groups = collectGroupedTags(records);
    const tags = [...groups.model, ...groups.preset, ...groups.manual];
    container.replaceChildren();
    if (!tags.length) {
        const empty = document.createElement('p');
        empty.className = 'ctm-help';
        empty.textContent = s().noTags;
        container.append(empty);
        return;
    }
    const makeRow = tag => {
        const row = document.createElement('div');
        row.className = 'ctm-tag-row';
        const name = document.createElement('span');
        name.className = 'ctm-tag-name';
        name.textContent = `${tag}（${counts.get(tag)}）`;
        const renameBtn = document.createElement('button');
        renameBtn.type = 'button';
        renameBtn.className = 'menu_button';
        renameBtn.textContent = s().rename;
        renameBtn.addEventListener('click', () => renameTagInSettings(tag).catch(error => globalThis.toastr?.error(error.message || s().failed)));
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'menu_button danger_button';
        deleteBtn.textContent = s().remove;
        deleteBtn.addEventListener('click', () => deleteTagInSettings(tag).catch(error => globalThis.toastr?.error(error.message || s().failed)));
        row.append(name, renameBtn, deleteBtn);
        return row;
    };

    const sections = [
        { key: 'model', label: s().modelGroup, tags: groups.model },
        { key: 'preset', label: s().presetGroup, tags: groups.preset },
        { key: 'manual', label: s().manualGroup, tags: groups.manual },
    ];
    const hasAutoGroups = groups.model.length > 0 || groups.preset.length > 0;
    for (const section of sections) {
        if (!section.tags.length) continue;
        const isManualOnly = section.key === 'manual' && !hasAutoGroups;
        if (isManualOnly) {
            for (const tag of section.tags) container.append(makeRow(tag));
            continue;
        }
        const { group, items } = createGroupSection(section.key, section.label, section.tags.length, settingsGroupCollapsed);
        for (const tag of section.tags) items.append(makeRow(tag));
        container.append(group);
    }
    updateTagDatalist();
}

/* ---------------- 按聊天元数据自动打标签 ---------------- */

/** 列出当前角色/群聊作用域里的全部聊天文件名（不带扩展名）。 */
async function fetchScopeChatFiles(scope) {
    const headers = context.getRequestHeaders();
    const body = scope.groupId
        ? { group_id: scope.groupId }
        : { avatar_url: scope.avatar };
    const response = await fetch('/api/chats/search', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Unable to list chats (${response.status}).`);
    const results = await response.json();
    if (!Array.isArray(results)) return [];
    return results
        .map(item => normalizeFileName(item?.file_name, { physical: true }))
        .filter(Boolean);
}

/** 读取一封聊天的全部内容（首行聊天元数据 + 各条消息）。 */
async function readScopeChatData(scope, fileName) {
    const headers = context.getRequestHeaders();
    const endpoint = scope.groupId ? '/api/chats/group/get' : '/api/chats/get';
    const body = scope.groupId
        ? { id: fileName }
        : { file_name: fileName, avatar_url: scope.avatar };
    const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Unable to read chat (${response.status}).`);
    const data = await response.json();
    return Array.isArray(data) ? data : [];
}

/** 从聊天内容里收集所有生成消息记录到的模型名（原样，不做前缀处理）。 */
function extractModelTags(items) {
    const set = new Set();
    for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        if (item.is_user === true || item.is_system === true) continue;
        const model = String(item.extra?.model ?? '').trim();
        if (model && model !== '...') set.add(model);
    }
    return [...set];
}

async function runAutoModelScan() {
    if (!initialized || !recordStore || !context || autoScanRunning) return;
    if (!await context.Popup.show.confirm(s().title, s().autoModelConfirm)) return;

    const scope = currentScope();
    const button = document.querySelector('#ctm_tags_auto_model');
    const status = document.querySelector('#ctm_auto_status');
    const setStatus = text => { if (status) status.textContent = text; };

    autoScanRunning = true;
    if (button) button.disabled = true;
    setStatus(s().autoModelRunning);

    let scanned = 0;
    let changed = 0;
    let skipped = 0;
    try {
        await recordStore.loadScope(scope.key);
        const fileNames = await fetchScopeChatFiles(scope);
        const entries = [];

        for (let offset = 0; offset < fileNames.length; offset += AUTO_SCAN_CONCURRENCY) {
            const batch = fileNames.slice(offset, offset + AUTO_SCAN_CONCURRENCY);
            const results = await Promise.all(batch.map(async fileName => {
                try {
                    const items = await readScopeChatData(scope, fileName);
                    return { fileName, models: extractModelTags(items) };
                } catch (error) {
                    console.warn('[Chat Tag Manager] Auto model scan failed for', fileName, error);
                    return { fileName, models: [], error };
                }
            }));

            for (const result of results) {
                scanned++;
                if (result.error || !result.models.length) {
                    skipped++;
                    continue;
                }
                const record = recordFor(scope.key, result.fileName, true);
                const merged = addTags(record.tags, result.models);
                const kindsBefore = normalizeTagKinds(record?.tagKinds);
                let kinds = kindsBefore;
                for (const model of result.models) kinds = ensureTagKind(kinds, model, TAG_KINDS.MODEL);
                const tagsChanged = merged.length !== normalizeTags(record?.tags).length;
                const kindsChanged = !kindsEqual(kinds, kindsBefore);
                if (tagsChanged || kindsChanged) {
                    record.tags = merged;
                    record.tagKinds = kinds;
                    record.updatedAt = new Date().toISOString();
                    entries.push([result.fileName, record]);
                }
                changed++;
            }

            const done = Math.min(offset + batch.length, fileNames.length);
            if (done < fileNames.length) setStatus(s().autoModelProgress(fileNames.length, done));
        }

        if (entries.length) await recordStore.putMany(scope.key, entries);
        globalThis.toastr?.success(s().autoModelDone(scanned, changed, skipped));
        await refreshTagList();
        renderVisibleCards();
    } catch (error) {
        console.error('[Chat Tag Manager] Auto model scan failed:', error);
        globalThis.toastr?.error(error.message || s().failed);
    } finally {
        autoScanRunning = false;
        if (button) button.disabled = false;
        setStatus('');
    }
}

/** 读当前正在使用的“对话补全预设/API 预设”名称。 */
function readCurrentPresetName(ctx) {
    try {
        const preset = String(ctx?.getPresetManager?.()?.getSelectedPresetName?.() ?? '').trim();
        if (preset && preset !== 'gui') return preset;
    } catch (error) {
        console.warn('[Chat Tag Manager] Could not read preset from manager:', error);
    }
    try {
        const preset = String(ctx?.chatCompletionSettings?.preset_settings_openai ?? '').trim();
        if (preset && preset !== 'gui') return preset;
    } catch {
        // 忽略：拿不到就跳过本次记录
    }
    return '';
}

/** 消息生成完成后，把“模型 + 当前预设”记到当前聊天上（从今天起生效）。 */
async function recordSourceTagsForCurrentChat() {
    if (!initialized || !recordStore) return;
    if (settings.config.autoTag === false) return;
    const ctx = SillyTavern.getContext();
    const fileName = normalizeFileName(ctx.chatId, { physical: true });
    if (!fileName) return;

    const additions = [];
    const last = Array.isArray(ctx.chat) && ctx.chat.length ? ctx.chat[ctx.chat.length - 1] : null;
    const model = String(last?.extra?.model ?? '').trim();
    if (model && model !== '...') additions.push(model);
    const preset = readCurrentPresetName(ctx);
    if (preset) additions.push(preset);
    if (!additions.length) return;

    const scope = currentScope();
    try {
        await recordStore.loadScope(scope.key);
        const record = recordFor(scope.key, fileName, true);
        const merged = addTags(record.tags, additions);
        const kindsBefore = normalizeTagKinds(record?.tagKinds);
        let kinds = kindsBefore;
        if (model) kinds = ensureTagKind(kinds, model, TAG_KINDS.MODEL);
        if (preset) kinds = ensureTagKind(kinds, preset, TAG_KINDS.PRESET);
        const tagsChanged = merged.length !== normalizeTags(record?.tags).length;
        const kindsChanged = !kindsEqual(kinds, kindsBefore);
        if (!tagsChanged && !kindsChanged) return;
        record.tags = merged;
        record.tagKinds = kinds;
        record.updatedAt = new Date().toISOString();
        await recordStore.put(scope.key, fileName, record);
        refreshTagList();
        updateTagDatalist();
    } catch (error) {
        console.warn('[Chat Tag Manager] Could not record source tags:', error);
    }
}

async function renameTagInSettings(oldTag) {
    const newTag = await context.Popup.show.input(s().renamePromptTitle, s().renamePromptHelp, oldTag);
    if (typeof newTag !== 'string' || !newTag.trim() || newTag.trim() === oldTag) return;
    const scope = currentScope();
    await recordStore.loadScope(scope.key);
    const records = recordStore.scope(scope.key) ?? {};
    const entries = [];
    for (const [fileName, record] of Object.entries(records)) {
        const tags = renameTag(record?.tags, oldTag, newTag.trim());
        if (tags.join('\n') !== normalizeTags(record?.tags).join('\n')) {
            record.tags = tags;
            record.tagKinds = renameTagKind(record.tagKinds, oldTag, newTag.trim());
            record.updatedAt = new Date().toISOString();
            entries.push([fileName, record]);
        }
    }
    if (entries.length) await recordStore.putMany(scope.key, entries);
    globalThis.toastr?.success(s().tagRenamed);
    await refreshTagList();
    renderVisibleCards();
}

async function deleteTagInSettings(tag) {
    if (!await context.Popup.show.confirm(s().title, s().deleteTagConfirm)) return;
    const scope = currentScope();
    await recordStore.loadScope(scope.key);
    const records = recordStore.scope(scope.key) ?? {};
    const entries = [];
    for (const [fileName, record] of Object.entries(records)) {
        const tags = removeTags(record?.tags, tag);
        if (tags.length !== normalizeTags(record?.tags).length) {
            record.tags = tags;
            record.tagKinds = deleteTagKind(record.tagKinds, tag);
            record.updatedAt = new Date().toISOString();
            entries.push([fileName, record]);
        }
    }
    if (entries.length) await recordStore.putMany(scope.key, entries);
    globalThis.toastr?.success(s().tagRemoved);
    await refreshTagList();
    renderVisibleCards();
}

async function clearScopeTags() {
    const scope = currentScope();
    await recordStore.deleteScope(scope.key);
    globalThis.toastr?.success(s().cleared);
    await refreshTagList();
    renderVisibleCards();
}

async function clearAllData() {
    dataResetting = true;
    dataEpoch += 1;
    try {
        await recordStore.clearUser();
        globalThis.toastr?.success(s().cleared);
    } finally {
        dataResetting = false;
    }
    selection.clear();
    await refreshTagList();
    renderVisibleCards();
}

/* ---------------- 事件绑定 ---------------- */

function bindEvents() {
    const events = context.eventTypes;
    const bind = (event, handler) => {
        if (!event) return;
        context.eventSource.on(event, handler);
        eventBindings.push([event, handler]);
    };

    bind(events.CHAT_RENAMED, data => {
        if (dataResetting) return;
        const { scopeKey, oldFileName, newFileName } = resolveChatRenameEvent(data);
        void recordStore.rename(scopeKey, oldFileName, newFileName)
            .then(renderVisibleCards)
            .catch(error => console.warn('[Chat Tag Manager] Chat rename migration failed:', error));
        if (selection.delete(oldFileName)) selection.add(newFileName);
        updateBatchBar();
    });

    bind(events.CHAT_DELETED, fileName => {
        if (dataResetting) return;
        const target = resolveChatDeleteEvent(fileName);
        if (!target) return;
        selection.delete(target.fileName);
        void recordStore.delete(target.scopeKey, target.fileName)
            .then(renderVisibleCards)
            .catch(error => console.warn('[Chat Tag Manager] Chat delete cleanup failed:', error));
    });

    bind(events.GROUP_CHAT_DELETED, fileName => {
        if (dataResetting) return;
        const scope = currentScope();
        if (!scope.groupId) return;
        selection.delete(normalizeFileName(fileName, { physical: true }));
        void recordStore.delete(scope.key, normalizeFileName(fileName, { physical: true }))
            .then(renderVisibleCards)
            .catch(error => console.warn('[Chat Tag Manager] Group chat delete cleanup failed:', error));
    });

    bind(events.CHARACTER_RENAMED, (...args) => {
        if (dataResetting) return;
        const data = args[0] && typeof args[0] === 'object' ? args[0] : null;
        const oldAvatar = String(data?.oldAvatar ?? data?.old_avatar ?? '').trim();
        const newAvatar = String(data?.newAvatar ?? data?.new_avatar ?? '').trim();
        if (!oldAvatar || !newAvatar || oldAvatar === '[object Object]' || newAvatar === '[object Object]') return;
        void recordStore.moveScope(getScopeKey({ avatar: oldAvatar }), getScopeKey({ avatar: newAvatar }))
            .then(renderVisibleCards)
            .catch(error => console.warn('[Chat Tag Manager] Character scope migration failed:', error));
    });

    bind(events.CHARACTER_DELETED, (...args) => {
        if (dataResetting) return;
        const data = args[0] && typeof args[0] === 'object' ? args[0] : null;
        const avatar = String(data?.character?.avatar ?? data?.avatar ?? data?.avatar_url ?? data?.oldAvatar ?? '').trim();
        if (!avatar) return;
        void recordStore.deleteScope(getScopeKey({ avatar }))
            .catch(error => console.warn('[Chat Tag Manager] Character cache cleanup failed:', error));
    });

    bind(events.CHARACTER_LOADED, () => {
        if (dataResetting) return;
        refreshTagList();
        renderVisibleCards();
    });

    bind(events.MESSAGE_RECEIVED, () => {
        if (dataResetting) return;
        void recordSourceTagsForCurrentChat();
    });

    bind(events.GROUP_UPDATED, () => {
        if (dataResetting) return;
        refreshTagList();
        renderVisibleCards();
    });
}

function unbindEvents() {
    for (const [event, handler] of eventBindings.splice(0)) context.eventSource.removeListener(event, handler);
}

/* ---------------- 生命周期 ---------------- */

export async function onActivate() {
    if (initialized) return;
    const activationEpoch = ++lifecycleEpoch;
    initialized = true;
    const activationContext = SillyTavern.getContext();
    const activationSettings = normalizeSettings(activationContext.extensionSettings[MODULE_NAME]);
    let activationStore;
    try {
        const handle = await getUserHandle({ headers: activationContext.getRequestHeaders() });
        if (!initialized || activationEpoch !== lifecycleEpoch) return;
        activationStore = new IndexedRecordStore(handle);
        await activationStore.open();
    } catch (error) {
        if (activationEpoch !== lifecycleEpoch) {
            activationStore?.close();
            return;
        }
        initialized = false;
        console.error('[Chat Tag Manager] IndexedDB initialization failed:', error);
        globalThis.toastr?.error(s().storageError);
        return;
    }
    if (!initialized || activationEpoch !== lifecycleEpoch) {
        activationStore?.close();
        return;
    }
    context = activationContext;
    settings = activationSettings;
    recordStore = activationStore;
    log('activated scopeUser=', recordStore.userHandle);
    context.extensionSettings[MODULE_NAME] = settings;
    save();
    await renderSettings(activationEpoch);
    if (!initialized || activationEpoch !== lifecycleEpoch) return;
    installFetchWrapper();
    bindEvents();
    startObserver();
}

export async function onDisable() {
    window.removeEventListener('resize', positionTagPanel);
    window.visualViewport?.removeEventListener('resize', positionTagPanel);
    window.visualViewport?.removeEventListener('scroll', positionTagPanel);
    ++lifecycleEpoch;
    dataEpoch += 1;
    initialized = false;
    const storeToClose = recordStore;
    stopObserver();
    uninstallFetchWrapper();
    unbindEvents();
    uninstallSelectModeGuard();
    filterPanelOpen = false;
    document.querySelector('#ctm_settings')?.remove();
    await storeToClose?.drain();
    storeToClose?.close();
    if (recordStore === storeToClose) recordStore = null;
}

export async function onClean() {
    context ??= SillyTavern.getContext();
    if (initialized) await onDisable();
    let store = recordStore;
    if (!store) {
        try {
            store = new IndexedRecordStore(await getUserHandle());
        } catch (error) {
            console.warn('[Chat Tag Manager] Could not identify the current user during cleanup:', error);
        }
    }
    if (store) {
        try {
            await store.clearUser();
        } catch (error) {
            console.warn('[Chat Tag Manager] Could not clear records during cleanup:', error);
        }
        store.close();
    }
    delete context.extensionSettings[MODULE_NAME];
    recordStore = null;
    document.querySelector('#ctm_settings')?.remove();
}
