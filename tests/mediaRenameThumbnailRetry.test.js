'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
    run
} = require('../retry-rename-thumbnails');

const {
    cleanupMediaRenameThumbnails
} = require('../utils/mediaRenameThumbnailCleanup');

const from = 'before/photo.jpg';
const to = 'before/renamed.jpg';

function createDependencies(invalidator) {
    const calls = [];

    return {
        calls,
        dependencies: {
            assertStorageAvailable: async () => {},

            getSafeMediaPath: relativePath =>
                path.resolve(
                    '/tmp/photo-manager-test-media',
                    relativePath
                ),

            cleanupMediaRenameThumbnails: async plan =>
                cleanupMediaRenameThumbnails(
                    plan,
                    async relativePath => {
                        calls.push(relativePath);

                        if (invalidator) {
                            await invalidator(relativePath);
                        }
                    }
                )
        }
    };
}

test('確認モードではキャッシュを変更しない', async () => {
    const f = createDependencies();

    const result = await run(
        [
            '--from', from,
            '--to', to
        ],
        f.dependencies
    );

    assert.equal(result.applied, false);
    assert.equal(result.success, true);
    assert.deepEqual(f.calls, []);
});

test('停止確認がなければ削除を拒否する', async () => {
    const f = createDependencies();

    await assert.rejects(
        run(
            [
                '--from', from,
                '--to', to,
                '--apply'
            ],
            f.dependencies
        ),
        /--confirm-stopped/
    );

    assert.deepEqual(f.calls, []);
});

test('指定した2つのキャッシュを再処理できる', async () => {
    const f = createDependencies();

    const result = await run(
        [
            '--from', from,
            '--to', to,
            '--apply',
            '--confirm-stopped'
        ],
        f.dependencies
    );

    assert.equal(result.applied, true);
    assert.equal(result.success, true);

    assert.deepEqual(
        f.calls,
        [from, to]
    );
});

test('キャッシュ削除失敗を検出できる', async () => {
    const f = createDependencies(async relativePath => {
        if (relativePath === from) {
            throw new Error(
                'Injected thumbnail failure'
            );
        }
    });

    const result = await run(
        [
            '--from', from,
            '--to', to,
            '--apply',
            '--confirm-stopped'
        ],
        f.dependencies
    );

    assert.equal(result.applied, true);
    assert.equal(result.success, false);

    // 片方が失敗しても両方を処理する。
    assert.deepEqual(
        f.calls,
        [from, to]
    );
});
