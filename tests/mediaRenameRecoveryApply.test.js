'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const Database = require('better-sqlite3');

const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'photo-rename-apply-')
);

const mediaDir = path.join(root, 'Memory');

fs.mkdirSync(mediaDir, { recursive: true });

process.env.MEDIA_DIR = mediaDir;

// MEDIA_DIR設定後に読み込む。
const {
    beginMediaRenameWithIdentity
} = require('../utils/mediaRenameJournal');

const {
    inspectMediaRenameRecovery,
    applyMediaRenameRecovery
} = require('../utils/mediaRenameRecovery');

function fixture() {
    const directory = fs.mkdtempSync(
        path.join(mediaDir, 'case-')
    );

    const relativeDir = path.relative(
        mediaDir,
        directory
    );

    const from = path.join(
        relativeDir,
        'original.jpg'
    );

    const to = path.join(
        relativeDir,
        'renamed.jpg'
    );

    const source = path.join(mediaDir, from);
    const target = path.join(mediaDir, to);

    fs.writeFileSync(source, 'original-photo');

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
        source,
        target,
        cleanup() {
            db.close();

            fs.rmSync(directory, {
                recursive: true,
                force: true
            });
        }
    };
}

function mediaPath(db) {
    return db.prepare(`
        SELECT path
        FROM media
        WHERE id = 1
    `).get().path;
}

function journalCount(db) {
    return db.prepare(`
        SELECT COUNT(*) AS count
        FROM file_operation_journal
    `).get().count;
}

test('移動前の操作をcancelできる', async () => {
    const f = fixture();

    try {
        const id = await beginMediaRenameWithIdentity(
            f.db,
            f.plan,
            f.source
        );

        const report =
            await inspectMediaRenameRecovery(f.db, id);

        assert.equal(report.action, 'cancel');

        await applyMediaRenameRecovery(
            f.db,
            id,
            'cancel'
        );

        assert.equal(mediaPath(f.db), f.plan.from);
        assert.equal(journalCount(f.db), 0);
        assert.equal(fs.existsSync(f.source), true);

    } finally {
        f.cleanup();
    }
});

test('移動後の操作をcommitできる', async () => {
    const f = fixture();

    try {
        const id = await beginMediaRenameWithIdentity(
            f.db,
            f.plan,
            f.source
        );

        fs.renameSync(f.source, f.target);

        const report =
            await inspectMediaRenameRecovery(f.db, id);

        assert.equal(report.action, 'commit');

        await applyMediaRenameRecovery(
            f.db,
            id,
            'commit'
        );

        assert.equal(mediaPath(f.db), f.plan.to);
        assert.equal(journalCount(f.db), 0);
        assert.equal(fs.existsSync(f.target), true);

    } finally {
        f.cleanup();
    }
});

test('別ファイルがある場合は復旧を拒否する', async () => {
    const f = fixture();

    try {
        const id = await beginMediaRenameWithIdentity(
            f.db,
            f.plan,
            f.source
        );

        fs.unlinkSync(f.source);

        fs.writeFileSync(
            f.target,
            'different-content'
        );

        const report =
            await inspectMediaRenameRecovery(f.db, id);

        assert.equal(report.action, 'manual');

        await assert.rejects(
            applyMediaRenameRecovery(
                f.db,
                id,
                'commit'
            )
        );

        assert.equal(mediaPath(f.db), f.plan.from);
        assert.equal(journalCount(f.db), 1);

    } finally {
        f.cleanup();
    }
});

// ==========================================
// 追加テスト：復旧処理の安全性
// ==========================================

test('DB更新済みならcompleteで履歴を整理できる', async () => {
    const f = fixture();

    try {
        const id = await beginMediaRenameWithIdentity(
            f.db,
            f.plan,
            f.source
        );

        // ファイルの名前変更は完了
        fs.renameSync(f.source, f.target);

        // DB更新も完了している状態を再現
        f.db.prepare(`
            UPDATE media
            SET path = ?
            WHERE id = 1
        `).run(f.plan.to);

        // ジャーナルだけが残存
        assert.equal(journalCount(f.db), 1);

        const report =
            await inspectMediaRenameRecovery(f.db, id);

        assert.equal(report.action, 'complete');
        assert.equal(report.identityMatches, true);

        const result = await applyMediaRenameRecovery(
            f.db,
            id,
            'complete'
        );

        assert.equal(result.success, true);
        assert.equal(result.action, 'complete');

        // DB・ファイルとも変更後の状態
        assert.equal(mediaPath(f.db), f.plan.to);
        assert.equal(fs.existsSync(f.source), false);
        assert.equal(fs.existsSync(f.target), true);

        // ジャーナルは削除される
        assert.equal(journalCount(f.db), 0);

    } finally {
        f.cleanup();
    }
});

test('操作ロックが存在する場合は復旧を拒否する', async () => {
    const f = fixture();

    const {
        acquireLock,
        releaseLock
    } = require('../utils/fileOperationLock');

    let owner = null;

    try {
        // 先にロックを取得
        owner = acquireLock(f.db, 'media_rename');

        const id = await beginMediaRenameWithIdentity(
            f.db,
            f.plan,
            f.source
        );

        // 名前変更中の状態を再現
        fs.renameSync(f.source, f.target);

        await assert.rejects(
            applyMediaRenameRecovery(
                f.db,
                id,
                'commit'
            ),
            /File operation lock exists/
        );

        // DB・ジャーナルは変更されない
        assert.equal(mediaPath(f.db), f.plan.from);
        assert.equal(journalCount(f.db), 1);
        assert.equal(fs.existsSync(f.target), true);

    } finally {
        if (owner !== null) {
            releaseLock(f.db, owner);
        }

        f.cleanup();
    }
});

test('誤った復旧方法を指定すると拒否する', async () => {
    const f = fixture();

    try {
        const id = await beginMediaRenameWithIdentity(
            f.db,
            f.plan,
            f.source
        );

        fs.renameSync(f.source, f.target);

        const report =
            await inspectMediaRenameRecovery(f.db, id);

        // 正しい復旧方法はcommit
        assert.equal(report.action, 'commit');

        // あえてcancelを指定
        await assert.rejects(
            applyMediaRenameRecovery(
                f.db,
                id,
                'cancel'
            ),
            /Recovery action mismatch/
        );

        assert.equal(mediaPath(f.db), f.plan.from);
        assert.equal(journalCount(f.db), 1);
        assert.equal(fs.existsSync(f.target), true);

    } finally {
        f.cleanup();
    }
});

test('ファイル変更後は同一性不一致として復旧を拒否する', async () => {
    const f = fixture();

    try {
        const id = await beginMediaRenameWithIdentity(
            f.db,
            f.plan,
            f.source
        );

        fs.renameSync(f.source, f.target);

        // ジャーナル登録後にファイル内容を変更
        fs.appendFileSync(
            f.target,
            '-modified-after-rename'
        );

        const report =
            await inspectMediaRenameRecovery(f.db, id);

        assert.equal(report.identityMatches, false);
        assert.equal(report.action, 'manual');

        await assert.rejects(
            applyMediaRenameRecovery(
                f.db,
                id,
                'commit'
            )
        );

        // 勝手にDBを変更しない
        assert.equal(mediaPath(f.db), f.plan.from);

        // ジャーナルも保持
        assert.equal(journalCount(f.db), 1);

    } finally {
        f.cleanup();
    }
});
