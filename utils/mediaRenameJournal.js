'use strict';

const {
    initializeJournal,
    assertNoPendingOperations
} = require('./operationJournal');

const {
    captureFileIdentity,
    isValidIdentity
} = require('./fileIdentity');

/**
 * 名前変更操作をジャーナルへ登録する。
 *
 * この関数を呼び出す前に、
 * fileOperationLockによるロックを取得すること。
 */
function beginMediaRename(db, media, identity = null) {
    initializeJournal(db);

    const { id, from, to } = media;

    if (
        !Number.isSafeInteger(id) ||
        id <= 0 ||
        typeof from !== 'string' ||
        typeof to !== 'string' ||
        !from ||
        !to ||
        from === to
    ) {
        throw new Error('Invalid media rename plan');
    }

    return db.transaction(() => {
        assertNoPendingOperations(db);

        const current = db.prepare(`
            SELECT path
            FROM media
            WHERE id = ?
        `).get(id);

        if (!current || current.path !== from) {
            throw new Error(
                'Media path changed before rename'
            );
        }

        if (identity !== null && !isValidIdentity(identity)) {
            throw new Error('Invalid file identity');
        }

        const payload = JSON.stringify({
            id,
            from,
            to,
            ...(identity === null ? {} : { identity })
        });

        const result = db.prepare(`
            INSERT INTO file_operation_journal (
                operation,
                state,
                payload,
                created_at
            )
            VALUES (
                'media_rename',
                'pending',
                ?,
                ?
            )
        `).run(payload, Date.now());

        return Number(result.lastInsertRowid);
    }).immediate();
}

/**
 * DBのパス更新とジャーナル削除を
 * 同一トランザクションで実行する。
 *
 * 実ファイルの名前変更成功後に呼び出すこと。
 */
function completeMediaRename(db, journalId, media) {
    const { id, from, to } = media;

    return db.transaction(() => {
        const journal = db.prepare(`
            SELECT operation, state, payload
            FROM file_operation_journal
            WHERE id = ?
        `).get(journalId);

        if (
            !journal ||
            journal.operation !== 'media_rename' ||
            journal.state !== 'pending'
        ) {
            throw new Error('Invalid rename journal');
        }

        const saved = JSON.parse(journal.payload);

        if (
            saved.id !== id ||
            saved.from !== from ||
            saved.to !== to
        ) {
            throw new Error('Rename journal mismatch');
        }

        const result = db.prepare(`
            UPDATE media
            SET path = ?
            WHERE id = ?
              AND path = ?
        `).run(to, id, from);

        if (result.changes !== 1) {
            throw new Error(
                'Media database update failed'
            );
        }

        const deleted = db.prepare(`
            DELETE FROM file_operation_journal
            WHERE id = ?
              AND operation = 'media_rename'
              AND state = 'pending'
              AND payload = ?
        `).run(journalId, journal.payload);

        if (deleted.changes !== 1) {
            throw new Error(
                'Failed to complete rename journal'
            );
        }
    }).immediate();
}


/**
 * ファイルの同一性情報を取得してから
 * 名前変更ジャーナルを登録する。
 *
 * 呼び出し側で操作ロックを取得しておくこと。
 */
async function beginMediaRenameWithIdentity(
    db,
    media,
    absolutePath
) {
    const identity =
        await captureFileIdentity(absolutePath);

    return beginMediaRename(db, media, identity);
}

module.exports = {
    beginMediaRename,
    beginMediaRenameWithIdentity,
    completeMediaRename
};
