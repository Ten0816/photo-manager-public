'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

// ==========================================
// テスト専用環境
// ==========================================

const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'photo-rename-fault-')
);

const mediaDir = path.join(root, 'Memory');

fs.mkdirSync(mediaDir, { recursive: true });

process.env.MEDIA_DIR = mediaDir;
process.env.DATABASE_PATH = path.join(root, 'test.db');

const db = require('../database');

// ==========================================
// ファイル移動関数への障害注入
// ==========================================

const fileOperations = require('../utils/fileOperations');

const originalMove = fileOperations.moveFileNoOverwrite;

let injectMoveFailure = false;

fileOperations.moveFileNoOverwrite = async (...args) => {
    if (injectMoveFailure) {
        injectMoveFailure = false;

        const error = new Error(
            'Injected media rename failure'
        );

        error.code = 'INJECTED_FAILURE';

        throw error;
    }

    return originalMove(...args);
};

// モックを設定してからルートを読み込む
const router = require('../routes/mediaRenameRoutes');

const {
    pendingOperations
} = require('../utils/operationJournal');

const {
    getCurrentLock
} = require('../utils/fileOperationLock');

// ==========================================
// HTTPサーバー
// ==========================================

const app = express();

app.use(express.json());
app.use('/api/media', router);

// ==========================================
// テスト用関数
// ==========================================

function createMedia(id, relativePath) {
    const absolutePath = path.join(mediaDir, relativePath);

    fs.mkdirSync(path.dirname(absolutePath), {
        recursive: true
    });

    fs.writeFileSync(
        absolutePath,
        `test-photo-${id}`
    );

    db.prepare(`
        INSERT INTO media
        (id, path, type, file_size, modified_at)
        VALUES (?, ?, 'image', ?, 0)
    `).run(
        id,
        relativePath,
        Buffer.byteLength(`test-photo-${id}`)
    );
}

function exists(relativePath) {
    return fs.existsSync(
        path.join(mediaDir, relativePath)
    );
}

function getMediaPath(id) {
    return db.prepare(`
        SELECT path
        FROM media
        WHERE id = ?
    `).get(id)?.path;
}

function getJournal() {
    return pendingOperations(db);
}

// ==========================================
// 結合テスト
// ==========================================

test('名前変更APIの障害注入テスト', async () => {
    const server = app.listen(0);

    const base =
        `http://127.0.0.1:${server.address().port}`;

    async function rename(relativePath, name) {
        const response = await fetch(
            `${base}/api/media?path=${
                encodeURIComponent(relativePath)
            }`,
            {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ name })
            }
        );

        return {
            status: response.status,
            body: await response.json()
        };
    }

    try {
        // =====================================
        // ① 正常な名前変更
        // =====================================

        createMedia(101, 'before/photo101.jpg');

        const success = await rename(
            'before/photo101.jpg',
            'renamed101.jpg'
        );

        assert.equal(
            success.status,
            200,
            JSON.stringify(success.body)
        );

        assert.equal(
            exists('before/photo101.jpg'),
            false
        );

        assert.equal(
            exists('before/renamed101.jpg'),
            true
        );

        assert.equal(
            getMediaPath(101),
            'before/renamed101.jpg'
        );

        assert.equal(getJournal().length, 0);
        assert.equal(getCurrentLock(db), null);

        // =====================================
        // ② 同名ファイルが存在する
        // =====================================

        createMedia(201, 'before/photo201.jpg');

        fs.writeFileSync(
            path.join(mediaDir, 'before/existing201.jpg'),
            'existing-file'
        );

        const conflict = await rename(
            'before/photo201.jpg',
            'existing201.jpg'
        );

        assert.equal(conflict.status, 409);

        assert.equal(
            exists('before/photo201.jpg'),
            true
        );

        assert.equal(
            getMediaPath(201),
            'before/photo201.jpg'
        );

        assert.equal(getJournal().length, 0);
        assert.equal(getCurrentLock(db), null);

        // =====================================
        // ③ ファイル移動に失敗
        // =====================================

        createMedia(301, 'before/photo301.jpg');

        injectMoveFailure = true;

        const moveFailed = await rename(
            'before/photo301.jpg',
            'renamed301.jpg'
        );

        assert.equal(moveFailed.status, 500);

        assert.equal(
            moveFailed.body.recoveryRequired,
            false
        );

        // ファイルは元の場所にある
        assert.equal(
            exists('before/photo301.jpg'),
            true
        );

        assert.equal(
            exists('before/renamed301.jpg'),
            false
        );

        // DBは変更されていない
        assert.equal(
            getMediaPath(301),
            'before/photo301.jpg'
        );

        // 元の状態が保たれているため
        // ジャーナルは安全に取り消される。
        assert.equal(getJournal().length, 0);

        assert.equal(getCurrentLock(db), null);

        // =====================================
        // ④ SQLite更新に失敗
        // =====================================

        createMedia(401, 'before/photo401.jpg');

        // テスト専用のSQLiteトリガー
        // 指定ファイルのパス更新を強制失敗させる
        db.exec(`
            CREATE TRIGGER test_rename_update_failure
            BEFORE UPDATE OF path ON media
            WHEN OLD.id = 401
            BEGIN
                SELECT RAISE(
                    ABORT,
                    'Injected database update failure'
                );
            END;
        `);

        const dbFailed = await rename(
            'before/photo401.jpg',
            'renamed401.jpg'
        );

        assert.equal(dbFailed.status, 500);

        assert.equal(
            dbFailed.body.recoveryRequired,
            true
        );

        // ファイル移動は成功している
        assert.equal(
            exists('before/photo401.jpg'),
            false
        );

        assert.equal(
            exists('before/renamed401.jpg'),
            true
        );

        // DB更新は失敗している
        assert.equal(
            getMediaPath(401),
            'before/photo401.jpg'
        );

        // ジャーナルは保持されている
        assert.equal(getJournal().length, 1);

        const journal = getJournal()[0];

        assert.equal(
            journal.operation,
            'media_rename'
        );

        const payload = JSON.parse(journal.payload);

        assert.equal(payload.id, 401);
        assert.equal(payload.from, 'before/photo401.jpg');
        assert.equal(payload.to, 'before/renamed401.jpg');

        // 同一性情報も保存されている
        assert.ok(payload.identity);

        assert.equal(getCurrentLock(db), null);

    } finally {
        injectMoveFailure = false;

        await new Promise((resolve, reject) => {
            server.close(error =>
                error ? reject(error) : resolve()
            );
        });

        db.close();

        fs.rmSync(root, {
            recursive: true,
            force: true
        });
    }
});
