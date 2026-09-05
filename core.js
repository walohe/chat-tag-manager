export const SCHEMA_VERSION = 1;

export const DEFAULT_SETTINGS = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    config: {
        showTags: true,
        autoTag: true,
    },
});

export function cloneDefaultSettings() {
    return structuredClone(DEFAULT_SETTINGS);
}

/**
 * 把用户存过的设置和默认值合并，并清洗非法值。
 * 结构参考参考项目 core.js 的做法：schemaVersion 对不上就直接回退默认。
 */
export function normalizeSettings(value) {
    const source = value && typeof value === 'object' ? value : {};
    const normalized = cloneDefaultSettings();
    if (Number(source.schemaVersion) !== SCHEMA_VERSION) return normalized;
    const config = source.config && typeof source.config === 'object' ? source.config : {};
    normalized.config.showTags = config.showTags !== false;
    normalized.config.autoTag = config.autoTag !== false;
    return normalized;
}

/**
 * 聊天文件名规范化。physical=true 时去掉 .jsonl 后缀，
 * 保证 IndexedDB 里的键始终是"不含扩展名"的形式。
 */
export function normalizeFileName(value, { physical = false } = {}) {
    const fileName = String(value ?? '');
    return physical ? fileName.replace(/\.jsonl$/i, '') : fileName;
}

/**
 * 作用域键：角色聊天用 character:<avatar>，群聊用 group:<id>。
 * 角色卡改名时 avatar 会变，用 scope 迁移解决（见 storage.moveScope）。
 */
export function getScopeKey({ groupId, avatar }) {
    return groupId ? `group:${groupId}` : `character:${avatar ?? ''}`;
}

export function parseScopeKey(scopeKey) {
    const text = String(scopeKey ?? '');
    if (text.startsWith('group:')) return { groupId: text.slice(6), avatar: null };
    if (text.startsWith('character:')) return { groupId: null, avatar: text.slice(10) };
    return { groupId: null, avatar: null };
}

/** 标签清洗：去空格、去重、限制长度（模型名可能很长，放宽到 100）。 */
export function normalizeTags(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    const tags = [];
    for (const item of value) {
        const tag = String(item ?? '').replace(/\s+/g, ' ').trim().slice(0, 100);
        if (!tag || seen.has(tag)) continue;
        seen.add(tag);
        tags.push(tag);
    }
    return tags;
}

/** 把"单个标签字符串"或"标签数组"统一成数组，避免调用方传错类型。 */
function toTagArray(value) {
    if (typeof value === 'string') return normalizeTags([value]);
    return normalizeTags(value);
}

export function addTags(tags, additions) {
    const set = new Set(normalizeTags(tags));
    for (const tag of toTagArray(additions)) set.add(tag);
    return [...set];
}

export function removeTags(tags, removals) {
    const set = new Set(normalizeTags(tags));
    for (const tag of toTagArray(removals)) set.delete(tag);
    return [...set];
}

export function renameTag(tags, oldTag, newTag) {
    const normalizedOld = normalizeTags([oldTag])[0];
    const normalizedNew = normalizeTags([newTag])[0];
    if (!normalizedOld || !normalizedNew) return normalizeTags(tags);
    const set = new Set(normalizeTags(tags));
    if (!set.has(normalizedOld)) return [...set];
    set.delete(normalizedOld);
    set.add(normalizedNew);
    return [...set];
}

/** 汇总一个 scope 内所有记录里出现过的标签（用于筛选下拉和设置页）。 */
export function collectTags(records) {
    const set = new Set();
    for (const record of Object.values(records)) {
        for (const tag of normalizeTags(record?.tags)) set.add(tag);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
}

/** 聊天记录是否命中筛选词（标签名子串匹配，忽略大小写）。 */
export function recordMatchesTags(record, query) {
    const text = String(query ?? '').trim().toLowerCase();
    if (!text) return true;
    return normalizeTags(record?.tags).some(tag => tag.toLowerCase().includes(text));
}

/** 标签来源类型。记录在 record.tagKinds 里，用于“模型/预设/手动”分组展示。 */
export const TAG_KINDS = Object.freeze({
    MODEL: 'model',
    PRESET: 'preset',
    MANUAL: 'manual',
});

/** 清洗 tagKinds：只保留合法的 model/preset 映射。 */
export function normalizeTagKinds(value) {
    const result = Object.create(null);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
    for (const [tag, kind] of Object.entries(value)) {
        const key = normalizeTags([tag])[0];
        if (!key || (kind !== TAG_KINDS.MODEL && kind !== TAG_KINDS.PRESET)) continue;
        result[key] = kind;
    }
    return result;
}

/** 给标签补一个来源类型；已有类型时保持不变。 */
export function ensureTagKind(kinds, tag, kind) {
    const normalized = normalizeTagKinds(kinds);
    const key = normalizeTags([tag])[0];
    if (!key || (kind !== TAG_KINDS.MODEL && kind !== TAG_KINDS.PRESET)) return normalized;
    if (!normalized[key]) normalized[key] = kind;
    return normalized;
}

/** 标签重命名时把来源类型一起迁移。 */
export function renameTagKind(kinds, oldTag, newTag) {
    const normalized = normalizeTagKinds(kinds);
    const oldKey = normalizeTags([oldTag])[0];
    const newKey = normalizeTags([newTag])[0];
    if (!oldKey || !newKey || oldKey === newKey || !normalized[oldKey]) return normalized;
    normalized[newKey] = normalized[oldKey];
    delete normalized[oldKey];
    return normalized;
}

/** 删除标签时同步清掉它的来源类型。 */
export function deleteTagKind(kinds, tag) {
    const normalized = normalizeTagKinds(kinds);
    const key = normalizeTags([tag])[0];
    if (key) delete normalized[key];
    return normalized;
}

/** 读取单个标签的来源类型，缺省视为手动。 */
export function tagKindOf(kinds, tag) {
    return normalizeTagKinds(kinds)[normalizeTags([tag])[0]] ?? TAG_KINDS.MANUAL;
}

/** 比较两份 tagKinds 内容是否一致（忽略键顺序）。 */
export function kindsEqual(a, b) {
    const na = normalizeTagKinds(a);
    const nb = normalizeTagKinds(b);
    const ka = Object.keys(na).sort();
    const kb = Object.keys(nb).sort();
    if (ka.length !== kb.length || ka.some((key, index) => key !== kb[index])) return false;
    return ka.every(key => na[key] === nb[key]);
}
