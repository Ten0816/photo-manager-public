'use strict';

const db = require('./database');
const { assertStorageAvailable } = require('./utils/storageSafety');
const { getCurrentLock } = require('./utils/fileOperationLock');
const { pendingOperations } = require('./utils/operationJournal');

async function main() {
    const release = process.argv.includes('--release');
    const confirmed = process.argv.includes('--confirm-stopped');

    // 安全のため、ストレージ異常時には実行しない。
    await assertStorageAvailable();

    const lock = getCurrentLock(db);
    const journal = pendingOperations(db);

    console.log('=== File Operation Lock ===');
    console.log(JSON.stringify({
        lock,
        pendingJournalCount: journal.length,
        pendingJournalIds: journal.map(x => x.id)
    }, null, 2));

    if (!release) {
        console.log('確認モード：変更は行っていません。');
        return;
    }

    if (!confirmed) {
        throw new Error(
            '解除前にサービスを停止し、' +
            '--confirm-stopped を指定してください。'
        );
    }

    if (!lock) {
        console.log('解除対象のロックはありません。');
        return;
    }

    if (lock.operation !== 'bulk_move') {
        throw new Error(
            '未対応の操作ロックです。自動解除しません。'
        );
    }

    if (journal.length !== 0) {
        throw new Error(
            '未完了ジャーナルが存在します。' +
            '先に operations:check で復旧してください。'
        );
    }

    // ロック所有者とジャーナル不在を
    // 同一トランザクション内で再確認する。
    const released = db.transaction(() => {
        const unresolved = db.prepare(`
            SELECT id FROM file_operation_journal
            LIMIT 1
        `).get();

        if (unresolved) {
            throw new Error(
                '未完了ジャーナルを検出しました。'
            );
        }

        const result = db.prepare(`
            DELETE FROM file_operation_lock
            WHERE id = 1
              AND owner = ?
              AND operation = 'bulk_move'
        `).run(lock.owner);

        return result.changes === 1;
    }).immediate();

    if (!released) {
        throw new Error(
            'ロック情報が変更されました。解除を中止します。'
        );
    }

    console.log('残存ロックを解除しました。');
}

main()
    .catch(error => {
        console.error(error.message);
        process.exitCode = 1;
    })
    .finally(() => {
        db.close();
    });
