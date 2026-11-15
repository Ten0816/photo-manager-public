'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    cleanupMediaRenameThumbnails
} = require('../utils/mediaRenameThumbnailCleanup');

const plan = {
    id: 1,
    from: 'before/photo.jpg',
    to: 'before/renamed.jpg'
};

test('変更前と変更後のキャッシュを無効化できる', async () => {
    const called = [];

    const result =
        await cleanupMediaRenameThumbnails(
            plan,
            async relativePath => {
                called.push(relativePath);
            }
        );

    assert.equal(result.success, true);

    assert.deepEqual(
        called,
        [
            'before/photo.jpg',
            'before/renamed.jpg'
        ]
    );

    assert.equal(result.succeeded.length, 2);
    assert.equal(result.failed.length, 0);
});

test('片方が失敗しても他方を処理する', async () => {
    const called = [];

    const result =
        await cleanupMediaRenameThumbnails(
            plan,
            async relativePath => {
                called.push(relativePath);

                if (relativePath === plan.from) {
                    throw new Error(
                        'Injected thumbnail cleanup failure'
                    );
                }
            }
        );

    assert.equal(result.success, false);

    assert.equal(called.length, 2);

    assert.deepEqual(
        result.succeeded,
        [plan.to]
    );

    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].path, plan.from);
});

test('両方が失敗しても失敗内容を返す', async () => {
    const result =
        await cleanupMediaRenameThumbnails(
            plan,
            async () => {
                throw new Error(
                    'Injected cleanup failure'
                );
            }
        );

    assert.equal(result.success, false);
    assert.equal(result.succeeded.length, 0);
    assert.equal(result.failed.length, 2);

    for (const failure of result.failed) {
        assert.match(
            failure.error,
            /Injected cleanup failure/
        );
    }
});
