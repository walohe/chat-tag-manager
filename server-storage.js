import { IndexedRecordStore } from './storage.js';
export class ServerRecordStore extends IndexedRecordStore {
    constructor(handle, headers) { super(handle); this.headers = headers; this.revision = 0; }
    async request(route, body = {}) {
        const response = await fetch('/api/plugins/chat-tag-manager/' + route, {
            method: 'POST', headers: this.headers(), body: JSON.stringify(body), cache: 'no-store',
        });
        if (!response.ok) throw new Error(response.status === 409
            ? '其他窗口已修改标签，请刷新页面后重新操作。此次修改未保存。'
            : `标签服务器不可用 (${response.status})，请安装服务端插件并重启酒馆。`);
        return response.json();
    }
    accept(data) { this.revision = data.revision; this.records = Object.assign(Object.create(null), data.records); }
    async open() {
        this.accept(await this.request('read'));
        // Only the first initialization imports this browser's complete old database.
        if (this.revision === 0) {
            const legacy = new IndexedRecordStore(this.userHandle);
            const records = Object.create(null);
            try {
                await legacy.transaction('readonly', store => {
                    const cursor = store.openCursor();
                    cursor.onsuccess = () => {
                        const item = cursor.result;
                        if (!item) return;
                        const value = item.value;
                        if (value.userHandle === this.userHandle) {
                            records[value.scopeKey] ??= Object.create(null);
                            records[value.scopeKey][value.fileName] = value.record;
                        }
                        item.continue();
                    };
                });
            } finally { legacy.close(); }
            // An empty browser must not prevent later migration from the original browser.
            if (Object.keys(records).length) this.accept(await this.request('write', { revision: 0, records }));
        }
        return this;
    }
    async loadScope(key) { this.loadedScopes.add(key); return this.scope(key) ?? {}; }
    async mutate(edit) {
        return this.enqueueMutation(async () => {
            const next = structuredClone(this.records);
            const result = edit(next);
            try { this.accept(await this.request('write', { revision: this.revision, records: next })); }
            catch (error) {
                // Caller code mutates record objects before saving. Restore server state on failure.
                try { this.accept(await this.request('read')); } catch { /* keep error visible */ }
                throw error;
            }
            return result;
        });
    }
    async put(scope, file, record) { return this.putMany(scope, [[file, record]]); }
    async putMany(scope, entries) {
        const snapshot = structuredClone(entries);
        return this.mutate(data => {
            data[scope] ??= Object.create(null);
            for (const [file, record] of snapshot) data[scope][file] = record;
            return snapshot.length;
        });
    }
    async rename(scope, oldName, newName) {
        return this.mutate(data => {
            if (oldName === newName || !data[scope]?.[oldName]) return;
            if (data[scope][newName]) throw Error('目标聊天已有标签，请先确认后再重命名。');
            data[scope][newName] = data[scope][oldName]; delete data[scope][oldName];
        });
    }
    async moveScope(oldKey, newKey) {
        return this.mutate(data => {
            if (oldKey === newKey || !data[oldKey]) return 0;
            data[newKey] ??= Object.create(null);
            for (const [file, record] of Object.entries(data[oldKey])) {
                if (data[newKey][file]) throw Error('目标角色已有同名聊天标签，停止迁移以保护数据。');
                data[newKey][file] = record;
            }
            const count = Object.keys(data[oldKey]).length; delete data[oldKey]; return count;
        });
    }
    async delete(scope, file) { return this.mutate(data => { if (data[scope]) delete data[scope][file]; }); }
    async deleteScope(scope) { return this.mutate(data => { delete data[scope]; }); }
    async clearUser() { return this.mutate(data => { for (const key of Object.keys(data)) delete data[key]; }); }
    close() {}
}
