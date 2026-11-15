'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const {
    pendingOperations,
    assertNoPendingOperations,
    beginBulkMove,
    completeBulkMove
} = require('../utils/operationJournal');

function createTestDatabase() {
    const db = new Database(':memory:');

    db.exec(`
        CREATE TABLE media (
            id INTEGER PRIMARY KEY,
            path TEXT NOT NULL UNIQUE
        );
    `);

    db.prepare(
        'INSERT INTO media (id, path) VALUES (?, ?)'
    ).run(1, 'before/photo.jpg');

    return db;
}

function createPlan() {
    return [{
        media: {
            id: 1,
            path: 'before/photo.jpg'
        },
        newRelativePath: 'after/photo.jpg'
    }];
}

test('操作開始時に履歴が保存される', () => {
    const db = createTestDatabase();

    try {
        const id = beginBulkMove(db, createPlan());
        const records = pendingOperations(db);

        assert.equal(records.length, 1);
        assert.equal(records[0].id, Number(id));
        assert.equal(records[0].operation, 'bulk_move');

        const payload = JSON.parse(records[0].payload);

        assert.equal(payload[0].from, 'before/photo.jpg');
        assert.equal(payload[0].to, 'after/photo.jpg');
    } finally {
        db.close();
    }
});

test('未完了操作がある場合は次の操作を拒否する', () => {
    const db = createTestDatabase();

    try {
        beginBulkMove(db, createPlan());

        assert.throws(
            () => assertNoPendingOperations(db),
            { code: 'PENDING_OPERATION' }
        );

        assert.throws(
            () => beginBulkMove(db, createPlan()),
            { code: 'PENDING_OPERATION' }
        );

        assert.equal(pendingOperations(db).length, 1);
    } finally {
        db.close();
    }
});

test('正常完了時にDB更新と履歴削除が行われる', () => {
    const db = createTestDatabase();

    try {
        const plans = createPlan();
        const id = beginBulkMove(db, plans);

        completeBulkMove(db, id, plans);

        const media = db.prepare(
            'SELECT path FROM media WHERE id = 1'
        ).get();

        assert.equal(media.path, 'after/photo.jpg');
        assert.equal(pendingOperations(db).length, 0);

        assert.doesNotThrow(
            () => assertNoPendingOperations(db)
        );
    } finally {
        db.close();
    }
});

test('DB更新失敗時は操作履歴が残る', () => {
    const db = createTestDatabase();

    try {
        const plans = createPlan();
        const id = beginBulkMove(db, plans);

        db.prepare(
            'UPDATE media SET path = ? WHERE id = 1'
        ).run('unexpected/photo.jpg');

        assert.throws(
            () => completeBulkMove(db, id, plans),
            /Media changed during bulk move/
        );

        assert.equal(pendingOperations(db).length, 1);

        const media = db.prepare(
            'SELECT path FROM media WHERE id = 1'
        ).get();

        assert.equal(media.path, 'unexpected/photo.jpg');
    } finally {
        db.close();
    }
});
