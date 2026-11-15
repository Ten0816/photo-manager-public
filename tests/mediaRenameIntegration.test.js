'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'photo-rename-test-')
);

const mediaDir = path.join(root, 'Memory');

fs.mkdirSync(mediaDir, { recursive: true });

process.env.MEDIA_DIR = mediaDir;
process.env.DATABASE_PATH = path.join(root, 'test.db');

const db = require('../database');
const router = require('../routes/mediaRenameRoutes');

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

function createMedia(id, relativePath) {
    const fullPath = path.join(mediaDir, relativePath);

    fs.mkdirSync(path.dirname(fullPath), {
        recursive: true
    });

    fs.writeFileSync(fullPath, `test-${id}`);

    db.prepare(`
        INSERT INTO media
        (id, path, type, file_size, modified_at)
        VALUES (?, ?, 'image', 10, 0)
    `).run(id, relativePath);
}

function exists(relativePath) {
    return fs.existsSync(
        path.join(mediaDir, relativePath)
    );
}

test('名前変更APIのHTTP結合テスト', async () => {
    const server = app.listen(0);

    const base =
        `http://127.0.0.1:${server.address().port}`;

    async function rename(relativePath, name) {
        const response = await fetch(
            `${base}/api/media?path=${encodeURIComponent(relativePath)}`,
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

        createMedia(1, 'before/photo1.jpg');

        const success = await rename(
            'before/photo1.jpg',
            'renamed.png'
        );

        assert.equal(
            success.status,
            200,
            JSON.stringify(success.body)
        );

        // 元の拡張子 .jpg が維持される
        assert.equal(
            exists('before/renamed.jpg'),
            true
        );

        assert.equal(
            exists('before/photo1.jpg'),
            false
        );

        // SQLiteのパスも更新
        assert.equal(
            db.prepare(
                'SELECT path FROM media WHERE id = 1'
            ).get().path,
            'before/renamed.jpg'
        );

        // ロックが解除されている
        assert.equal(getCurrentLock(db), null);

        // =====================================
        // ② ロック競合
        // =====================================

        createMedia(2, 'before/photo2.jpg');

        const owner = acquireLock(
            db,
            'bulk_move'
        );

        try {
            const conflict = await rename(
                'before/photo2.jpg',
                'blocked.jpg'
            );

            assert.equal(conflict.status, 409);

            assert.equal(
                exists('before/photo2.jpg'),
                true
            );

            assert.equal(
                exists('before/blocked.jpg'),
                false
            );

        } finally {
            releaseLock(db, owner);
        }

        // =====================================
        // ③ 未完了ジャーナル
        // =====================================

        beginBulkMove(db, [{
            media: {
                id: 2,
                path: 'before/photo2.jpg'
            },
            newRelativePath: 'after/photo2.jpg'
        }]);

        const blocked = await rename(
            'before/photo2.jpg',
            'blocked2.jpg'
        );

        assert.equal(blocked.status, 409);

        assert.equal(
            pendingOperations(db).length,
            1
        );

        assert.equal(
            exists('before/photo2.jpg'),
            true
        );

        assert.equal(
            exists('before/blocked2.jpg'),
            false
        );

        assert.equal(getCurrentLock(db), null);

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
