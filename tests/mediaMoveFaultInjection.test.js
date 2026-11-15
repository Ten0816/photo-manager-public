'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

// テスト専用ディレクトリ
const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'photo-fault-')
);

const mediaDir = path.join(root, 'Memory');

fs.mkdirSync(mediaDir, { recursive: true });

// 必ず本番DBとは別の環境を使用する
process.env.MEDIA_DIR = mediaDir;
process.env.DATABASE_PATH = path.join(root, 'test.db');

const db = require('../database');

// ルートを読み込む前に移動関数を差し替える
const fileOperations = require('../utils/fileOperations');

const originalMove = fileOperations.moveFileNoOverwrite;

let moveCount = 0;
let failCalls = new Set();

fileOperations.moveFileNoOverwrite = async (...args) => {
    moveCount++;

    if (failCalls.has(moveCount)) {
        const error = new Error(
            `Injected failure at move ${moveCount}`
        );

        error.code = 'INJECTED_FAILURE';
        throw error;
    }

    return originalMove(...args);
};

const router = require('../routes/mediaMoveRoutes');

const {
    pendingOperations
} = require('../utils/operationJournal');

const {
    getCurrentLock
} = require('../utils/fileOperationLock');

const app = express();

app.use(express.json());
app.use('/api/media', router);

function createMedia(id, filename) {
    const relative = `before/${filename}`;
    const absolute = path.join(mediaDir, relative);

    fs.mkdirSync(path.dirname(absolute), {
        recursive: true
    });

    fs.writeFileSync(absolute, `photo-${id}`);

    db.prepare(`
        INSERT INTO media
        (id, path, type, file_size, modified_at)
        VALUES (?, ?, 'image', 10, 0)
    `).run(id, relative);
}

function exists(relative) {
    return fs.existsSync(path.join(mediaDir, relative));
}

function setFailures(...calls) {
    moveCount = 0;
    failCalls = new Set(calls);
}

test('一括移動の障害注入テスト', async () => {

    const server = app.listen(0);

    const base =
        `http://127.0.0.1:${server.address().port}`;

    async function move(ids) {
        const response = await fetch(
            `${base}/api/media/bulk-move`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    ids,
                    destination: 'after'
                })
            }
        );

        return response.status;
    }

    try {
        // ======================================
        // テスト①：正常なロールバック
        // ======================================

        createMedia(101, 'test101.jpg');
        createMedia(102, 'test102.jpg');

        // 2回目の移動のみ失敗させる
        setFailures(2);

        const result1 = await move([101, 102]);

        assert.equal(result1, 500);

        // 元のファイルが両方存在する
        assert.equal(exists('before/test101.jpg'), true);
        assert.equal(exists('before/test102.jpg'), true);

        // 移動先には存在しない
        assert.equal(exists('after/test101.jpg'), false);
        assert.equal(exists('after/test102.jpg'), false);

        // DBも元のパスを保持
        assert.equal(
            db.prepare(
                'SELECT path FROM media WHERE id = 101'
            ).get().path,
            'before/test101.jpg'
        );

        // 正常復旧したのでジャーナルは0件
        assert.equal(pendingOperations(db).length, 0);

        // ロックも解除されている
        assert.equal(getCurrentLock(db), null);

        // ======================================
        // テスト②：ロールバックも失敗
        // ======================================

        createMedia(201, 'test201.jpg');
        createMedia(202, 'test202.jpg');

        // 2回目：移動失敗
        // 3回目：ロールバック失敗
        setFailures(2, 3);

        const result2 = await move([201, 202]);

        assert.equal(result2, 500);

        // 1件目は移動されたまま
        assert.equal(exists('before/test201.jpg'), false);
        assert.equal(exists('after/test201.jpg'), true);

        // 2件目は移動されていない
        assert.equal(exists('before/test202.jpg'), true);
        assert.equal(exists('after/test202.jpg'), false);

        // 不完全なのでジャーナルを保持
        assert.equal(pendingOperations(db).length, 1);

        // ロック自体は解除される
        assert.equal(getCurrentLock(db), null);

        // ジャーナルがあるため後続の移動は禁止
        setFailures();

        const blocked = await move([101]);

        assert.equal(blocked, 409);

    } finally {
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
