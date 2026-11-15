'use strict';

/**
 * 名前変更に伴うサムネイルキャッシュを無効化する。
 *
 * DB復旧とは独立した後処理。
 * 一方の失敗によって、もう一方の処理を中止しない。
 *
 * invalidateThumbnail はテスト時に差し替え可能。
 */
async function cleanupMediaRenameThumbnails(
    plan,
    invalidateThumbnail = require('../services/thumbnailService')
        .invalidateThumbnail
) {
    if (
        !plan ||
        typeof plan.from !== 'string' ||
        typeof plan.to !== 'string' ||
        !plan.from ||
        !plan.to
    ) {
        throw new Error('Invalid rename plan');
    }

    if (typeof invalidateThumbnail !== 'function') {
        throw new Error('Invalid thumbnail invalidator');
    }

    const paths = [...new Set([
        plan.from,
        plan.to
    ])];

    const results = await Promise.allSettled(
        paths.map(relativePath =>
            invalidateThumbnail(relativePath)
        )
    );

    const succeeded = [];
    const failed = [];

    results.forEach((result, index) => {
        const relativePath = paths[index];

        if (result.status === 'fulfilled') {
            succeeded.push(relativePath);
        } else {
            failed.push({
                path: relativePath,
                error: String(
                    result.reason?.message ??
                    result.reason
                )
            });
        }
    });

    return {
        success: failed.length === 0,
        succeeded,
        failed
    };
}

module.exports = {
    cleanupMediaRenameThumbnails
};
