'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// ==========================================
// テスト専用ストレージ
// ==========================================

const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'photo-thumbnail-integration-')
);

const mediaDir = path.join(root, 'Memory');

fs.mkdirSync(mediaDir, {
    recursive: true
});

// モジュール読み込み前に環境変数を設定
process.env.MEDIA_DIR = mediaDir;

// ==========================================
// アプリの実際のモジュール
// ==========================================

const {
    getThumbnailFilePath,
    invalidateThumbnail
} = require('../services/thumbnailService');

const {
    cleanupMediaRenameThumbnails
} = require('../utils/mediaRenameThumbnailCleanup');

// ==========================================
// テスト用ヘルパー
// ==========================================

const plan = {
    id: 1,
    from: '旅行/photo.jpg',
    to: '旅行/renamed.jpg'
};

function createCache(relativePath) {
    const filename = getThumbnailFilePath(relativePath);

    fs.mkdirSync(path.dirname(filename), {
        recursive: true
    });

    fs.writeFileSync(
        filename,
        'dummy-thumbnail'
    );

    fs.writeFileSync(
        filename + '.json',
        JSON.stringify({
            size: 1234,
            mtimeMs: 1000
        })
    );

    return filename;
}

function cacheExists(relativePath) {
    const filename = getThumbnailFilePath(relativePath);

    return (
        fs.existsSync(filename) ||
        fs.existsSync(filename + '.json')
    );
}

// ==========================================
// ① キャッシュ削除
// ==========================================

test(
    '変更前と変更後の実キャッシュを削除できる',
    async () => {

        const oldThumbnail = createCache(plan.from);
        const newThumbnail = createCache(plan.to);

        assert.equal(cacheExists(plan.from), true);
        assert.equal(cacheExists(plan.to), true);

        const result =
            await cleanupMediaRenameThumbnails(
                plan,
                invalidateThumbnail
            );

        assert.equal(result.success, true);
        assert.equal(result.failed.length, 0);

        // サムネイル本体
        assert.equal(
            fs.existsSync(oldThumbnail),
            false
        );

        assert.equal(
            fs.existsSync(newThumbnail),
            false
        );

        // JSONメタデータ
        assert.equal(
            fs.existsSync(oldThumbnail + '.json'),
            false
        );

        assert.equal(
            fs.existsSync(newThumbnail + '.json'),
            false
        );
    }
);

// ==========================================
// ② 存在しないキャッシュ
// ==========================================

test(
    'キャッシュが存在しなくても正常終了する',
    async () => {

        const result =
            await cleanupMediaRenameThumbnails(
                plan,
                invalidateThumbnail
            );

        assert.equal(result.success, true);
        assert.equal(result.failed.length, 0);

        assert.equal(cacheExists(plan.from), false);
        assert.equal(cacheExists(plan.to), false);
    }
);

// ==========================================
// ③ 実際の削除失敗
// ==========================================

test(
    '実ファイル削除の失敗を検出できる',
    async () => {

        // 変更前のキャッシュをディレクトリにする。
        // fs.rm(file, {force:true}) では削除できない。
        const oldThumbnail =
            getThumbnailFilePath(plan.from);

        fs.mkdirSync(oldThumbnail, {
            recursive: true
        });

        // 変更後は正常なキャッシュ
        createCache(plan.to);

        const result =
            await cleanupMediaRenameThumbnails(
                plan,
                invalidateThumbnail
            );

        // 変更前の削除失敗を検出
        assert.equal(result.success, false);

        assert.equal(result.failed.length, 1);

        assert.equal(
            result.failed[0].path,
            plan.from
        );

        // 変更後の削除は継続される
        assert.equal(cacheExists(plan.to), false);

        // 失敗した対象は残る
        assert.equal(
            fs.existsSync(oldThumbnail),
            true
        );

        // テスト用のディレクトリを整理
        fs.rmSync(oldThumbnail, {
            recursive: true,
            force: true
        });
    }
);

// ==========================================
// 終了後の一時ファイル削除
// ==========================================

test.after(() => {
    fs.rmSync(root, {
        recursive: true,
        force: true
    });
});
