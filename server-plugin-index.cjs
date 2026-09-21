const fs = require('node:fs');
const path = require('node:path');
const atomic = require('write-file-atomic').sync;
exports.info = { id: 'chat-tag-manager', name: 'Chat Tag Manager Storage', description: 'Per-user persistent chat tags with revision checks' };
function read(root) {
    const file = path.join(root, 'chat-tag-manager.json');
    if (!fs.existsSync(file)) return { revision: 0, records: {} };
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Number.isSafeInteger(data.revision) || !data.records || typeof data.records !== 'object' || Array.isArray(data.records)) throw Error('Invalid tag database; restore backup manually');
    return data;
}
exports.init = async router => {
    router.post('/read', (req, res) => {
        try {
            if (!req.user?.directories?.root) return res.sendStatus(401);
            res.json(read(req.user.directories.root));
        } catch (e) { res.status(500).json({ error: e.message }); }
    });
    router.post('/write', (req, res) => {
        try {
            const root = req.user?.directories?.root;
            if (!root) return res.sendStatus(401);
            const current = read(root);
            if (req.body.revision !== current.revision) return res.status(409).json({ error: 'Tags changed in another browser. Refresh and repeat this edit.' });
            const records = req.body.records;
            if (!records || typeof records !== 'object' || Array.isArray(records)) return res.sendStatus(400);
            const file = path.join(root, 'chat-tag-manager.json');
            const next = { revision: current.revision + 1, records };
            if (fs.existsSync(file)) atomic(file + '.bak', fs.readFileSync(file), { fsync: true });
            atomic(file, JSON.stringify(next), { encoding: 'utf8', fsync: true });
            res.json(next);
        } catch (e) { res.status(500).json({ error: e.message }); }
    });
};
