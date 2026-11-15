'use strict';

const db = require('./database');

const {
    assertStorageAvailable
} = require('./utils/storageSafety');

const {
    inspectMediaRenameRecovery,
    applyMediaRenameRecovery
} = require('./utils/mediaRenameRecovery');

const {
    cleanupMediaRenameThumbnails
} = require('./utils/mediaRenameThumbnailCleanup');

function getArgument(name) {
    const index = process.argv.indexOf(name);

    if (index === -1) {
        return null;
    }

    return process.argv[index + 1] ?? null;
}

async function main() {
    const idValue = getArgument('--id');

    if (
        !idValue ||
        !/^[1-9]\d*$/.test(idValue)
    ) {
        throw new Error(
            'Usage: node recover-media-rename.js --id <ID> ' +
            '[--action cancel|commit|complete] ' +
            '[--apply --confirm-stopped]'
        );
    }

    const journalId = Number(idValue);

    if (!Number.isSafeInteger(journalId)) {
        throw new Error('Invalid journal ID');
    }

    await assertStorageAvailable();

    const report = await inspectMediaRenameRecovery(
        db,
        journalId
    );

    console.log(JSON.stringify(report, null, 2));

    const apply = process.argv.includes('--apply');

    if (!apply) {
        console.log(
            '確認モードです。変更は行っていません。'
        );
        return;
    }

    if (
        !process.argv.includes('--confirm-stopped')
    ) {
        throw new Error(
            '復旧には --confirm-stopped が必要です。'
        );
    }

    const action = getArgument('--action');

    if (!action) {
        throw new Error(
            '復旧方法を --action で指定してください。'
        );
    }

    const result = await applyMediaRenameRecovery(
        db,
        journalId,
        action
    );

    console.log(
        'SQLiteとジャーナルの復旧が完了しました:',
        JSON.stringify(result)
    );

    // 復旧が完了した後にのみキャッシュを無効化する。
    // この処理が失敗してもDBの復旧は取り消さない。
    let thumbnailResult;

    try {
        thumbnailResult =
            await cleanupMediaRenameThumbnails(
                report.plan
            );
    } catch (error) {
        thumbnailResult = {
            success: false,
            succeeded: [],
            failed: [{
                path: '(cleanup)',
                error: error.message
            }]
        };
    }

    if (thumbnailResult.success) {
        console.log(
            'サムネイルキャッシュの無効化が完了しました。'
        );
    } else {
        console.error(
            '警告: SQLiteの復旧は完了していますが、' +
            'サムネイルの無効化に失敗しました。'
        );

        console.error(
            JSON.stringify(
                thumbnailResult,
                null,
                2
            )
        );

        // DB復旧は成功済み。
        // ただし、キャッシュの後処理に問題があることを通知する。
        process.exitCode = 2;
    }
}

main().catch(error => {
    console.error('復旧エラー:', error.message);
    process.exitCode = 1;
});
