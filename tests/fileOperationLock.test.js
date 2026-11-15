'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const {
    acquireLock,
    releaseLock,
    getCurrentLock,
    withFileOperationLock
} = require('../utils/fileOperationLock');

function createFixture() {
    const dir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'photo-lock-')
    );

    const file = path.join(dir, 'test.db');

    const db1 = new Database(file);
    const db2 = new Database(file);

    return {
        db1,
        db2,
        cleanup() {
            db1.close();
            db2.close();
            fs.rmSync(dir, {
                recursive: true,
                force: true
            });
        }
    };
}

test('ロックを取得・解除できる', () => {
    const f = createFixture();

    try {
        const owner = acquireLock(f.db1, 'test');

        assert.equal(
            getCurrentLock(f.db1).owner,
            owner
        );

        assert.equal(releaseLock(f.db1, owner), true);
        assert.equal(getCurrentLock(f.db1), null);
    } finally {
        f.cleanup();
    }
});

test('別のDB接続からの同時操作を拒否する', () => {
    const f = createFixture();

    try {
        const owner = acquireLock(f.db1, 'first');

        assert.throws(
            () => acquireLock(f.db2, 'second'),
            { code: 'FILE_OPERATION_LOCKED' }
        );

        releaseLock(f.db1, owner);

        const second = acquireLock(f.db2, 'second');

        assert.ok(second);
        releaseLock(f.db2, second);
    } finally {
        f.cleanup();
    }
});

test('所有者以外はロックを解除できない', () => {
    const f = createFixture();

    try {
        const owner = acquireLock(f.db1, 'test');

        assert.equal(
            releaseLock(f.db2, 'wrong-owner'),
            false
        );

        assert.ok(getCurrentLock(f.db1));

        releaseLock(f.db1, owner);
    } finally {
        f.cleanup();
    }
});

test('処理失敗時もロックを解除する', async () => {
    const f = createFixture();

    try {
        await assert.rejects(
            withFileOperationLock(
                f.db1,
                'test',
                async () => {
                    throw new Error('Test failure');
                }
            ),
            /Test failure/
        );

        assert.equal(getCurrentLock(f.db1), null);
    } finally {
        f.cleanup();
    }
});

test('未完了ジャーナルがある場合は取得を拒否する', () => {
    const f = createFixture();

    try {
        f.db1.exec(`
            CREATE TABLE file_operation_journal (
                id INTEGER PRIMARY KEY
            );
            INSERT INTO file_operation_journal (id)
            VALUES (1);
        `);

        assert.throws(
            () => acquireLock(f.db1, 'test'),
            { code: 'PENDING_OPERATION' }
        );
    } finally {
        f.cleanup();
    }
});
