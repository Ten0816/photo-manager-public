'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'photo-thumbnail-race-')
);

const mediaDir = path.join(root, 'Memory');

fs.mkdirSync(mediaDir, {
    recursive: true
});

process.env.MEDIA_DIR = mediaDir;

const {
    getThumbnailFilePath,
    invalidateThumbnail,
    _withThumbnailLock
} = require('../services/thumbnailService');

function deferred() {
    let resolve;

    const promise = new Promise(r => {
        resolve = r;
    });

    return { promise, resolve };
}

function createCache(relativePath) {
    const filename = getThumbnailFilePath(relativePath);

    fs.mkdirSync(path.dirname(filename), {
        recursive: true
    });

    fs.writeFileSync(
        filename,
        'generated-thumbnail'
    );

    fs.writeFileSync(
        filename + '.json',
        '{"size":123,"mtimeMs":1000}'
    );

    return filename;
}

// ==========================================
// ① 生成中の削除要求
// ==========================================

test(
    '生成処理の完了後にキャッシュを削除する',
    async () => {

        const relativePath = 'before/photo.jpg';
        const filename = getThumbnailFilePath(
            relativePath
        );

        const generationStarted = deferred();
        const allowGenerationToFinish = deferred();

        let generationFinished = false;
        let invalidationFinished = false;

        // 生成処理を模擬する。
        // 実際のcreateThumbnailForFileと同じロックを使う。
        const generation = _withThumbnailLock(
            filename,
            async () => {
                generationStarted.resolve();

                await allowGenerationToFinish.promise;

                createCache(relativePath);
                generationFinished = true;
            }
        );

        await generationStarted.promise;

        // 生成が進行中の状態で削除要求。
        const invalidation = invalidateThumbnail(
            relativePath
        ).then(() => {
            invalidationFinished = true;
        });

        // イベントループを一度進める。
        await new Promise(resolve =>
            setImmediate(resolve)
        );

        // 生成中なので削除はまだ完了しない。
        assert.equal(generationFinished, false);
        assert.equal(invalidationFinished, false);

        // 生成処理の完了を許可。
        allowGenerationToFinish.resolve();

        await Promise.all([
            generation,
            invalidation
        ]);

        assert.equal(generationFinished, true);
        assert.equal(invalidationFinished, true);

        // 生成後に削除されたため、古いキャッシュは残らない。
        assert.equal(
            fs.existsSync(filename),
            false
        );

        assert.equal(
            fs.existsSync(filename + '.json'),
            false
        );
    }
);

// ==========================================
// ② 同じキーは直列化される
// ==========================================

test(
    '同じサムネイルへの処理は直列化される',
    async () => {

        const key = 'same-thumbnail-key';

        let active = 0;
        let maxActive = 0;

        const tasks = Array.from(
            { length: 10 },
            (_, index) =>
                _withThumbnailLock(key, async () => {
                    active++;

                    maxActive = Math.max(
                        maxActive,
                        active
                    );

                    await new Promise(resolve =>
                        setTimeout(resolve, 5)
                    );

                    active--;

                    return index;
                })
        );

        const results = await Promise.all(tasks);

        assert.equal(maxActive, 1);

        assert.deepEqual(
            results,
            [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
        );
    }
);

// ==========================================
// ③ 異なるキーは並列処理できる
// ==========================================

test(
    '異なるサムネイルは並列処理できる',
    async () => {

        const startedA = deferred();
        const startedB = deferred();
        const finish = deferred();

        let active = 0;
        let maxActive = 0;

        const taskA = _withThumbnailLock(
            'thumbnail-A',
            async () => {
                active++;
                maxActive = Math.max(maxActive, active);

                startedA.resolve();
                await finish.promise;

                active--;
            }
        );

        const taskB = _withThumbnailLock(
            'thumbnail-B',
            async () => {
                active++;
                maxActive = Math.max(maxActive, active);

                startedB.resolve();
                await finish.promise;

                active--;
            }
        );

        await Promise.all([
            startedA.promise,
            startedB.promise
        ]);

        assert.equal(maxActive, 2);

        finish.resolve();

        await Promise.all([taskA, taskB]);
    }
);

test.after(() => {
    fs.rmSync(root, {
        recursive: true,
        force: true
    });
});
