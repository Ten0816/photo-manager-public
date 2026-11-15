'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

// テスト用のメディア保存先を先に設定する
const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'photo-rename-cancel-')
);

const mediaDir = path.join(root, 'Memory');

fs.mkdirSync(mediaDir, { recursive: true });

process.env.MEDIA_DIR = mediaDir;

// MEDIA_DIR設定後にモジュールを読み込む
const {
    beginMediaRenameWithIdentity
} = require('../utils/mediaRenameJournal');

const {
    cancelUnchangedMediaRename
} = require('../utils/mediaRenameCancellation');

function createFixture() {
    const fixtureDir = fs.mkdtempSync(
        path.join(mediaDir, 'fixture-')
    );

    const relativeDir = path.relative(
        mediaDir,
        fixtureDir
    );

    const from = path.join(relativeDir, 'original.jpg');
    const to = path.join(relativeDir, 'renamed.jpg');

    const oldPath = path.join(mediaDir, from);
    const newPath = path.join(mediaDir, to);

    fs.writeFileSync(oldPath, 'original-photo');

    const db = new Database(':memory:');

    db.exec(`
        CREATE TABLE media (
            id INTEGER PRIMARY KEY,
            path TEXT NOT NULL UNIQUE
        );
    `);

    db.prepare(`
        INSERT INTO media (id, path)
        VALUES (?, ?)
    `).run(1, from);

    const plan = {
        id: 1,
        from,
        to
    };

    return {
        db,
        plan,
        oldPath,
        newPath,
        cleanup() {
            db.close();

            fs.rmSync(fixtureDir, {
                recursive: true,
                force: true
            });
        }
    };
}

test('元の状態ならジャーナルを取り消せる', async () => {
    const f = createFixture();

    try {
        const journalId =
            await beginMediaRenameWithIdentity(
                f.db,
                f.plan,
                f.oldPath
            );

        const cancelled =
            await cancelUnchangedMediaRename(
                f.db,
                journalId,
                f.plan
            );

        assert.equal(cancelled, true);

        const journal = f.db.prepare(`
            SELECT id
            FROM file_operation_journal
        `).all();

        assert.equal(journal.length, 0);

        assert.equal(
            fs.existsSync(f.oldPath),
            true
        );

    } finally {
        f.cleanup();
    }
});

test('ファイル移動後は取消を禁止する', async () => {
    const f = createFixture();

    try {
        const journalId =
            await beginMediaRenameWithIdentity(
                f.db,
                f.plan,
                f.oldPath
            );

        fs.renameSync(
            f.oldPath,
            f.newPath
        );

        const cancelled =
            await cancelUnchangedMediaRename(
                f.db,
                journalId,
                f.plan
            );

        assert.equal(cancelled, false);

        const journal = f.db.prepare(`
            SELECT id
            FROM file_operation_journal
        `).all();

        assert.equal(journal.length, 1);

    } finally {
        f.cleanup();
    }
});

test('ファイルの同一性が異なれば取消を禁止する', async () => {
    const f = createFixture();

    try {
        const journalId =
            await beginMediaRenameWithIdentity(
                f.db,
                f.plan,
                f.oldPath
            );

        fs.writeFileSync(
            f.oldPath,
            'different-content-with-different-size'
        );

        const cancelled =
            await cancelUnchangedMediaRename(
                f.db,
                journalId,
                f.plan
            );

        assert.equal(cancelled, false);

        const journal = f.db.prepare(`
            SELECT id
            FROM file_operation_journal
        `).all();

        assert.equal(journal.length, 1);

    } finally {
        f.cleanup();
    }
});
