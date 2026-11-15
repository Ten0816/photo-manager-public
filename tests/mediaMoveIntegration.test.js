'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'photo-move-api-')
);

const mediaDir = path.join(root, 'Memory');

fs.mkdirSync(mediaDir, { recursive: true });

process.env.MEDIA_DIR = mediaDir;
process.env.DATABASE_PATH = path.join(root, 'test.db');

const db = require('../database');
const router = require('../routes/mediaMoveRoutes');

const {
    acquireLock,
    releaseLock,
    getCurrentLock
} = require('../utils/fileOperationLock');

const {
    beginBulkMove,
    pendingOperations
} = require('../utils/operationJournal');

const app = express();
app.use(express.json());
app.use('/api/media', router);

function createMedia(id, relativePath, createFile = true) {
    const absolute = path.join(mediaDir, relativePath);

    fs.mkdirSync(path.dirname(absolute), {
        recursive: true
    });

    if (createFile) {
        fs.writeFileSync(absolute, `photo-${id}`);
    }

    db.prepare(`
        INSERT INTO media
        (id, path, type, file_size, modified_at)
        VALUES (?, ?, 'image', 10, 0)
    `).run(id, relativePath);
}

test('一括移動APIの結合テスト', async () => {
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;

    async function move(ids, destination) {
        const response = await fetch(
            `${base}/api/media/bulk-move`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ ids, destination })
            }
        );

        return {
            status: response.status,
            body: await response.json()
        };
    }

    try {
        // 1. 正常な一括移動
        createMedia(1, 'before/photo1.jpg');

        const success = await move([1], 'after');

        assert.equal(success.status, 200, JSON.stringify(success.body));

        assert.equal(
            db.prepare('SELECT path FROM media WHERE id = 1').get().path,
            'after/photo1.jpg'
        );

        assert.ok(
            fs.existsSync(path.join(mediaDir, 'after/photo1.jpg'))
        );

        assert.equal(pendingOperations(db).length, 0);
        assert.equal(getCurrentLock(db), null);

        // 2. 既存ロックとの競合
        createMedia(2, 'before/photo2.jpg');

        const owner = acquireLock(db, 'bulk_move');

        try {
            const conflict = await move([2], 'after');
            assert.equal(conflict.status, 409);
        } finally {
            releaseLock(db, owner);
        }

        assert.equal(
            db.prepare('SELECT path FROM media WHERE id = 2').get().path,
            'before/photo2.jpg'
        );

        // 3. 未完了ジャーナルがある場合
        beginBulkMove(db, [{
            media: {
                id: 2,
                path: 'before/photo2.jpg'
            },
            newRelativePath: 'after/photo2.jpg'
        }]);

        const blocked = await move([2], 'after');

        assert.equal(blocked.status, 409);
        assert.equal(pendingOperations(db).length, 1);

        // テスト用DBの履歴を消去
        db.prepare('DELETE FROM file_operation_journal').run();

        // 4. 移動途中の失敗とロールバック
        createMedia(3, 'before/photo3.jpg');
        createMedia(4, 'before/photo4.jpg', false);

        const failed = await move([3, 4], 'after');

        assert.equal(failed.status, 404);

        assert.ok(
            fs.existsSync(path.join(mediaDir, 'before/photo3.jpg'))
        );

        assert.equal(
            fs.existsSync(path.join(mediaDir, 'after/photo3.jpg')),
            false
        );

        // 移動元ファイルが存在しないため、
        // 整合性を保証できずジャーナルを保持する。
        assert.equal(pendingOperations(db).length, 1);
        assert.equal(getCurrentLock(db), null);

    } finally {
        await new Promise((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
        });

        db.close();

        fs.rmSync(root, {
            recursive: true,
            force: true
        });
    }
});
