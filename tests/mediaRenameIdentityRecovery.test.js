'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');

const {
    beginMediaRename,
    beginMediaRenameWithIdentity
} = require('../utils/mediaRenameJournal');

const projectDir = path.resolve(__dirname, '..');

function createFixture() {
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), 'photo-identity-recovery-')
    );

    const mediaDir = path.join(root, 'Memory');
    const dbPath = path.join(root, 'test.db');

    fs.mkdirSync(
        path.join(mediaDir, 'before'),
        { recursive: true }
    );

    fs.writeFileSync(
        path.join(mediaDir, '.photo-manager-storage-id'),
        'photo-manager-storage-v1\n'
    );

    const from = 'before/photo.jpg';
    const to = 'before/renamed.jpg';

    const oldPath = path.join(mediaDir, from);
    const newPath = path.join(mediaDir, to);

    fs.writeFileSync(oldPath, 'original-photo');

    const db = new Database(dbPath);

    db.exec(`
        CREATE TABLE media (
            id INTEGER PRIMARY KEY,
            path TEXT NOT NULL UNIQUE
        );

        INSERT INTO media (id, path)
        VALUES (1, 'before/photo.jpg');
    `);

    const plan = {
        id: 1,
        from,
        to
    };

    function inspect() {
        return spawnSync(
            process.execPath,
            [path.join(projectDir, 'check-operations.js')],
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
        plan,
        oldPath,
        newPath,
        inspect,
        cleanup
    };
}

test('同じファイルなら同一性が一致する', async () => {
    const f = createFixture();

    try {
        await beginMediaRenameWithIdentity(
            f.db,
            f.plan,
            f.oldPath
        );

        fs.renameSync(f.oldPath, f.newPath);

        const result = f.inspect();

        assert.equal(result.status, 2, result.stderr);
        assert.match(
            result.stdout,
            /"identityStatus": "matched"/
        );
        assert.match(
            result.stdout,
            /"identityVerified": true/
        );
        assert.match(
            result.stdout,
            /"candidateAction": "commit"/
        );

    } finally {
        f.cleanup();
    }
});

test('別のファイルなら同一性不一致を検出する', async () => {
    const f = createFixture();

    try {
        await beginMediaRenameWithIdentity(
            f.db,
            f.plan,
            f.oldPath
        );

        fs.unlinkSync(f.oldPath);
        fs.writeFileSync(
            f.newPath,
            'completely-different-file'
        );

        const result = f.inspect();

        assert.equal(result.status, 2, result.stderr);
        assert.match(
            result.stdout,
            /"identityStatus": "mismatched"/
        );
        assert.match(
            result.stdout,
            /"identityVerified": false/
        );
        assert.match(
            result.stdout,
            /"candidateAction": "manual"/
        );

    } finally {
        f.cleanup();
    }
});

test('旧ジャーナルは同一性未確認として扱う', () => {
    const f = createFixture();

    try {
        beginMediaRename(f.db, f.plan);

        fs.renameSync(f.oldPath, f.newPath);

        const result = f.inspect();

        assert.equal(result.status, 2, result.stderr);
        assert.match(
            result.stdout,
            /"identityStatus": "missing"/
        );
        assert.match(
            result.stdout,
            /"identityVerified": false/
        );

    } finally {
        f.cleanup();
    }
});
