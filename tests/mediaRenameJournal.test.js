'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const {
    beginMediaRename,
    completeMediaRename
} = require('../utils/mediaRenameJournal');

const {
    pendingOperations
} = require('../utils/operationJournal');

function createFixture() {
    const db = new Database(':memory:');

    db.exec(`
        CREATE TABLE media (
            id INTEGER PRIMARY KEY,
            path TEXT NOT NULL UNIQUE
        );

        INSERT INTO media (id, path)
        VALUES (1, 'before/photo.jpg');
    `);

    const media = {
        id: 1,
        from: 'before/photo.jpg',
        to: 'before/renamed.jpg'
    };

    return { db, media };
}

test('名前変更の操作履歴を登録できる', () => {
    const { db, media } = createFixture();

    try {
        const id = beginMediaRename(db, media);

        const records = pendingOperations(db);

        assert.equal(records.length, 1);
        assert.equal(records[0].id, id);
        assert.equal(
            records[0].operation,
            'media_rename'
        );

        assert.deepEqual(
            JSON.parse(records[0].payload),
            media
        );
    } finally {
        db.close();
    }
});

test('名前変更完了時にDB更新と履歴削除が行われる', () => {
    const { db, media } = createFixture();

    try {
        const id = beginMediaRename(db, media);

        completeMediaRename(db, id, media);

        const row = db.prepare(`
            SELECT path FROM media WHERE id = 1
        `).get();

        assert.equal(
            row.path,
            'before/renamed.jpg'
        );

        assert.equal(
            pendingOperations(db).length,
            0
        );
    } finally {
        db.close();
    }
});

test('ジャーナル不一致ならDBを変更しない', () => {
    const { db, media } = createFixture();

    try {
        const id = beginMediaRename(db, media);

        assert.throws(() => {
            completeMediaRename(db, id, {
                ...media,
                to: 'before/wrong.jpg'
            });
        }, /Rename journal mismatch/);

        const row = db.prepare(`
            SELECT path FROM media WHERE id = 1
        `).get();

        assert.equal(
            row.path,
            'before/photo.jpg'
        );

        assert.equal(
            pendingOperations(db).length,
            1
        );
    } finally {
        db.close();
    }
});
