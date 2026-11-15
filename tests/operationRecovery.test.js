'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');

const {
    beginBulkMove,
    pendingOperations
} = require('../utils/operationJournal');

const projectDir = path.resolve(__dirname, '..');

function createFixture(count = 1) {
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), 'photo-recovery-')
    );

    const mediaDir = path.join(root, 'Memory');
    const dbPath = path.join(root, 'test.db');

    fs.mkdirSync(path.join(mediaDir, 'before'), {
        recursive: true
    });

    fs.mkdirSync(path.join(mediaDir, 'after'), {
        recursive: true
    });

    fs.writeFileSync(
        path.join(mediaDir, '.photo-manager-storage-id'),
        'photo-manager-storage-v1\n'
    );

    const db = new Database(dbPath);

    db.exec(`
        CREATE TABLE media (
            id INTEGER PRIMARY KEY,
            path TEXT NOT NULL UNIQUE,
            type TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            modified_at INTEGER NOT NULL,
            taken_at TEXT
        );
    `);

    const plans = [];

    for (let i = 1; i <= count; i++) {
        const from = `before/photo${i}.jpg`;
        const to = `after/photo${i}.jpg`;

        fs.writeFileSync(
            path.join(mediaDir, from),
            `test-photo-${i}`
        );

        db.prepare(`
            INSERT INTO media
            (id, path, type, file_size, modified_at)
            VALUES (?, ?, 'image', 12, 0)
        `).run(i, from);

        plans.push({
            media: { id: i, path: from },
            newRelativePath: to
        });
    }

    beginBulkMove(db, plans);

    function runRecovery(apply = false) {
        return spawnSync(
            process.execPath,
            [
                path.join(projectDir, 'check-operations.js'),
                ...(apply ? ['--apply'] : [])
            ],
            {
                cwd: projectDir,
                env: {
                    ...process.env,
                    MEDIA_DIR: mediaDir,
                    DATABASE_PATH: dbPath
                },
                encoding: 'utf8'
            }
        );
    }

    function move(index) {
        const plan = plans[index];

        fs.renameSync(
            path.join(mediaDir, plan.media.path),
            path.join(mediaDir, plan.newRelativePath)
        );
    }

    function cleanup() {
        db.close();
        fs.rmSync(root, {
            recursive: true,
            force: true
        });
    }

    return {
        db,
        plans,
        mediaDir,
        runRecovery,
        move,
        cleanup
    };
}

test('移動前の異常終了は取り消せる', () => {
    const f = createFixture();

    try {
        const result = f.runRecovery(true);

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /cancel/);
        assert.equal(pendingOperations(f.db).length, 0);

        const row = f.db.prepare(
            'SELECT path FROM media WHERE id = 1'
        ).get();

        assert.equal(row.path, 'before/photo1.jpg');
    } finally {
        f.cleanup();
    }
});

test('ファイル移動後の異常終了はDBを修復できる', () => {
    const f = createFixture();

    try {
        f.move(0);

        const inspect = f.runRecovery(false);

        assert.equal(inspect.status, 0, inspect.stderr);
        assert.match(inspect.stdout, /commit/);

        // 読み取り専用では履歴が残る
        assert.equal(pendingOperations(f.db).length, 1);

        const result = f.runRecovery(true);

        assert.equal(result.status, 0, result.stderr);
        assert.equal(pendingOperations(f.db).length, 0);

        const row = f.db.prepare(
            'SELECT path FROM media WHERE id = 1'
        ).get();

        assert.equal(row.path, 'after/photo1.jpg');
    } finally {
        f.cleanup();
    }
});

test('一部だけ移動した場合は自動復旧しない', () => {
    const f = createFixture(2);

    try {
        f.move(0);

        const result = f.runRecovery(true);

        assert.equal(result.status, 2, result.stderr);
        assert.match(result.stdout, /manual/);
        assert.equal(pendingOperations(f.db).length, 1);

        const record = pendingOperations(f.db)[0];

        assert.equal(record.state, 'needs_attention');

        const rows = f.db.prepare(
            'SELECT path FROM media ORDER BY id'
        ).all();

        assert.deepEqual(
            rows.map(row => row.path),
            ['before/photo1.jpg', 'before/photo2.jpg']
        );
    } finally {
        f.cleanup();
    }
});
