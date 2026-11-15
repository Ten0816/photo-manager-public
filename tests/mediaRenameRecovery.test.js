'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');

const {
    beginMediaRename
} = require('../utils/mediaRenameJournal');

const projectDir = path.resolve(__dirname, '..');

function createFixture() {
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), 'photo-rename-recovery-')
    );

    const mediaDir = path.join(root, 'Memory');
    const dbPath = path.join(root, 'test.db');

    fs.mkdirSync(path.join(mediaDir, 'before'), {
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
            path TEXT NOT NULL UNIQUE
        );

        INSERT INTO media (id, path)
        VALUES (1, 'before/photo.jpg');
    `);

    const from = 'before/photo.jpg';
    const to = 'before/renamed.jpg';

    fs.writeFileSync(
        path.join(mediaDir, from),
        'test-photo'
    );

    beginMediaRename(db, {
        id: 1,
        from,
        to
    });

    function inspect(apply = false) {
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

    return {
        db,
        mediaDir,
        from,
        to,
        inspect,
        cleanup
    };
}

test('名前変更前の状態を検出できる', () => {
    const f = createFixture();

    try {
        const result = f.inspect();

        assert.equal(result.status, 2, result.stderr);
        assert.match(result.stdout, /"candidateAction": "cancel"/);
    } finally {
        f.cleanup();
    }
});

test('ファイル移動後のDB未更新を検出できる', () => {
    const f = createFixture();

    try {
        fs.renameSync(
            path.join(f.mediaDir, f.from),
            path.join(f.mediaDir, f.to)
        );

        const result = f.inspect();

        assert.equal(result.status, 2, result.stderr);
        assert.match(result.stdout, /"candidateAction": "commit"/);

        // 検査だけではDBは変更されない
        const media = f.db.prepare(
            'SELECT path FROM media WHERE id = 1'
        ).get();

        assert.equal(media.path, f.from);
    } finally {
        f.cleanup();
    }
});

test('同一性未確認なら--applyでも自動更新しない', () => {
    const f = createFixture();

    try {
        fs.renameSync(
            path.join(f.mediaDir, f.from),
            path.join(f.mediaDir, f.to)
        );

        const result = f.inspect(true);

        assert.equal(result.status, 2, result.stderr);

        const media = f.db.prepare(
            'SELECT path FROM media WHERE id = 1'
        ).get();

        assert.equal(media.path, f.from);

        const journal = f.db.prepare(`
            SELECT state
            FROM file_operation_journal
            LIMIT 1
        `).get();

        assert.equal(journal.state, 'needs_attention');
    } finally {
        f.cleanup();
    }
});

test('移動前後に両方のファイルが存在すれば手動確認', () => {
    const f = createFixture();

    try {
        fs.writeFileSync(
            path.join(f.mediaDir, f.to),
            'another-photo'
        );

        const result = f.inspect();

        assert.equal(result.status, 2, result.stderr);
        assert.match(result.stdout, /"candidateAction": "manual"/);
    } finally {
        f.cleanup();
    }
});
