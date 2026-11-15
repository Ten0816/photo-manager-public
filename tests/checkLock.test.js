'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');

const {
    acquireLock,
    getCurrentLock
} = require('../utils/fileOperationLock');

const {
    beginBulkMove,
    pendingOperations
} = require('../utils/operationJournal');

const projectDir = path.resolve(__dirname, '..');

function createFixture() {
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), 'photo-lock-recovery-')
    );

    const mediaDir = path.join(root, 'Memory');
    const dbPath = path.join(root, 'test.db');

    fs.mkdirSync(mediaDir);

    fs.writeFileSync(
        path.join(mediaDir, '.photo-manager-storage-id'),
        'photo-manager-storage-v1\n'
    );

    const db = new Database(dbPath);

    db.exec(`
        CREATE TABLE media (
            id INTEGER PRIMARY KEY,
            path TEXT NOT NULL UNIQUE
        );

        INSERT INTO media (id, path)
        VALUES (1, 'before/photo.jpg');
    `);

    function run(args = []) {
        return spawnSync(
            process.execPath,
            [path.join(projectDir, 'check-lock.js'), ...args],
            {
                cwd: projectDir,
                env: {
                    ...process.env,
                    DATABASE_PATH: dbPath,
                    MEDIA_DIR: mediaDir
                },
                encoding: 'utf8',
                timeout: 10000
            }
        );
    }

    function cleanup() {
        db.close();
        fs.rmSync(root, {
            recursive: true,
            force: true
        });
    }

    return { db, run, cleanup };
}

test('ロックがない場合は正常終了する', () => {
    const f = createFixture();

    try {
        const result = f.run();

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /"lock": null/);
        assert.equal(getCurrentLock(f.db), null);
    } finally {
        f.cleanup();
    }
});

test('確認モードでは既存ロックを解除しない', () => {
    const f = createFixture();

    try {
        const owner = acquireLock(f.db, 'bulk_move');
        const result = f.run();

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /bulk_move/);
        assert.equal(getCurrentLock(f.db).owner, owner);
    } finally {
        f.cleanup();
    }
});

test('停止確認なしの解除要求は拒否する', () => {
    const f = createFixture();

    try {
        acquireLock(f.db, 'bulk_move');

        const result = f.run(['--release']);

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /confirm-stopped/);
        assert.ok(getCurrentLock(f.db));
    } finally {
        f.cleanup();
    }
});

test('未完了ジャーナルがある場合は解除を拒否する', () => {
    const f = createFixture();

    try {
        acquireLock(f.db, 'bulk_move');

        beginBulkMove(f.db, [{
            media: {
                id: 1,
                path: 'before/photo.jpg'
            },
            newRelativePath: 'after/photo.jpg'
        }]);

        const result = f.run([
            '--release',
            '--confirm-stopped'
        ]);

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /未完了ジャーナル/);
        assert.ok(getCurrentLock(f.db));
        assert.equal(pendingOperations(f.db).length, 1);
    } finally {
        f.cleanup();
    }
});

test('安全条件を満たす残存ロックは解除できる', () => {
    const f = createFixture();

    try {
        acquireLock(f.db, 'bulk_move');

        const result = f.run([
            '--release',
            '--confirm-stopped'
        ]);

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /残存ロックを解除/);
        assert.equal(getCurrentLock(f.db), null);
    } finally {
        f.cleanup();
    }
});
