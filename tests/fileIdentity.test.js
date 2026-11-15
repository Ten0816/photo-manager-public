'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const {
    captureFileIdentity,
    matchesFileIdentity
} = require('../utils/fileIdentity');

const {
    beginMediaRenameWithIdentity
} = require('../utils/mediaRenameJournal');

function createFixture() {
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), 'photo-identity-')
    );

    const source = path.join(root, 'original.jpg');
    const target = path.join(root, 'renamed.jpg');

    fs.writeFileSync(source, 'original-photo');

    return {
        root,
        source,
        target,
        cleanup() {
            fs.rmSync(root, {
                recursive: true,
                force: true
            });
        }
    };
}

test('ファイルの同一性情報を取得できる', async () => {
    const f = createFixture();

    try {
        const identity =
            await captureFileIdentity(f.source);

        assert.match(identity.dev, /^\d+$/);
        assert.match(identity.ino, /^\d+$/);
        assert.equal(identity.size, '14');
        assert.match(identity.mtimeNs, /^\d+$/);

        assert.equal(
            await matchesFileIdentity(f.source, identity),
            true
        );
    } finally {
        f.cleanup();
    }
});

test('名前変更後も同一ファイルと判定できる', async () => {
    const f = createFixture();

    try {
        const identity =
            await captureFileIdentity(f.source);

        fs.renameSync(f.source, f.target);

        assert.equal(
            await matchesFileIdentity(f.target, identity),
            true
        );
    } finally {
        f.cleanup();
    }
});

test('別ファイルへの置き換えを検出できる', async () => {
    const f = createFixture();

    try {
        const identity =
            await captureFileIdentity(f.source);

        fs.unlinkSync(f.source);
        fs.writeFileSync(f.source, 'different-photo-content');

        assert.equal(
            await matchesFileIdentity(f.source, identity),
            false
        );
    } finally {
        f.cleanup();
    }
});

test('名前変更ジャーナルに同一性情報を保存できる', async () => {
    const f = createFixture();

    const db = new Database(':memory:');

    try {
        db.exec(`
            CREATE TABLE media (
                id INTEGER PRIMARY KEY,
                path TEXT NOT NULL UNIQUE
            );

            INSERT INTO media (id, path)
            VALUES (1, 'original.jpg');
        `);

        const journalId =
            await beginMediaRenameWithIdentity(
                db,
                {
                    id: 1,
                    from: 'original.jpg',
                    to: 'renamed.jpg'
                },
                f.source
            );

        const row = db.prepare(`
            SELECT payload
            FROM file_operation_journal
            WHERE id = ?
        `).get(journalId);

        assert.ok(row);

        const payload = JSON.parse(row.payload);

        assert.equal(payload.id, 1);
        assert.ok(payload.identity);

        assert.equal(
            await matchesFileIdentity(
                f.source,
                payload.identity
            ),
            true
        );
    } finally {
        db.close();
        f.cleanup();
    }
});
