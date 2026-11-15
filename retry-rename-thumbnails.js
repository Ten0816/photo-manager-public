'use strict';

const path = require('node:path');

function getArgument(args, name) {
    const index = args.indexOf(name);

    if (index === -1) {
        return null;
    }

    const value = args[index + 1];

    if (!value || value.startsWith('--')) {
        throw new Error(`${name} requires a value`);
    }

    return value;
}

/**
 * 名前変更後のサムネイルを再無効化する。
 *
 * SQLiteや実ファイルの名前変更は行わない。
 */
async function run(
    args,
    {
        assertStorageAvailable,
        getSafeMediaPath,
        cleanupMediaRenameThumbnails
    }
) {
    const from = getArgument(args, '--from');
    const to = getArgument(args, '--to');

    if (!from || !to) {
        throw new Error(
            'Usage: node retry-rename-thumbnails.js ' +
            '--from <old-path> --to <new-path> ' +
            '[--apply --confirm-stopped]'
        );
    }

    // メディア保存先の外側を参照しないことを確認する。
    const sourcePath = getSafeMediaPath(from);
    const targetPath = getSafeMediaPath(to);

    if (sourcePath === targetPath) {
        throw new Error(
            'Source and target must be different'
        );
    }

    // このコマンドは同一フォルダ内の名前変更専用。
    if (
        path.dirname(sourcePath) !==
        path.dirname(targetPath)
    ) {
        throw new Error(
            'Source and target must be in the same directory'
        );
    }

    // 名前変更APIは拡張子を維持する設計。
    if (
        path.extname(sourcePath) !==
        path.extname(targetPath)
    ) {
        throw new Error(
            'File extensions must match'
        );
    }

    await assertStorageAvailable();

    const plan = { from, to };

    console.log(
        '対象:',
        JSON.stringify(plan, null, 2)
    );

    if (!args.includes('--apply')) {
        console.log(
            '確認モードです。キャッシュは変更していません。'
        );

        return {
            applied: false,
            success: true
        };
    }

    if (!args.includes('--confirm-stopped')) {
        throw new Error(
            '実行には --confirm-stopped が必要です。'
        );
    }

    const result =
        await cleanupMediaRenameThumbnails(plan);

    if (!result.success) {
        console.error(
            'サムネイルの無効化に失敗しました。'
        );

        console.error(
            JSON.stringify(result, null, 2)
        );

        return {
            applied: true,
            success: false
        };
    }

    console.log(
        'サムネイルキャッシュの無効化が完了しました。'
    );

    return {
        applied: true,
        success: true
    };
}

async function main() {
    const {
        assertStorageAvailable
    } = require('./utils/storageSafety');

    const {
        getSafeMediaPath
    } = require('./utils/pathUtils');

    const {
        cleanupMediaRenameThumbnails
    } = require('./utils/mediaRenameThumbnailCleanup');

    const result = await run(
        process.argv.slice(2),
        {
            assertStorageAvailable,
            getSafeMediaPath,
            cleanupMediaRenameThumbnails
        }
    );

    if (!result.success) {
        process.exitCode = 2;
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error('キャッシュ再処理エラー:', error.message);
        process.exitCode = 1;
    });
}

module.exports = {
    run
};
