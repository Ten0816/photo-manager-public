'use strict';

const fs = require('node:fs/promises');

const {
    getSafeMediaPath
} = require('./pathUtils');

const {
    isValidIdentity,
    matchesFileIdentity
} = require('./fileIdentity');

async function fileState(filePath) {
    try {
        const stat = await fs.lstat(filePath);

        if (stat.isSymbolicLink()) {
            return 'symlink';
        }

        return stat.isFile() ? 'file' : 'other';

    } catch (error) {
        if (error.code === 'ENOENT') {
            return 'missing';
        }

        throw error;
    }
}

function hasOperationLock(db) {
    const table = db.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name = 'file_operation_lock'
    `).get();

    if (!table) {
        return false;
    }

    return Boolean(
        db.prepare(`
            SELECT 1
            FROM file_operation_lock
            LIMIT 1
        `).get()
    );
}

async function inspectMediaRenameRecovery(db, journalId) {
    if (
        !Number.isSafeInteger(journalId) ||
        journalId <= 0
    ) {
        throw new Error('Invalid journal ID');
    }

    const journal = db.prepare(`
        SELECT id, operation, state, payload
        FROM file_operation_journal
        WHERE id = ?
    `).get(journalId);

    if (!journal) {
        throw new Error('Journal not found');
    }

    if (
        journal.operation !== 'media_rename' ||
        !['pending', 'needs_attention'].includes(journal.state)
    ) {
        throw new Error('Unsupported journal');
    }

    let plan;

    try {
        plan = JSON.parse(journal.payload);
    } catch {
        throw new Error('Invalid journal payload');
    }

    if (
        !plan ||
        !Number.isSafeInteger(plan.id) ||
        plan.id <= 0 ||
        typeof plan.from !== 'string' ||
        typeof plan.to !== 'string' ||
        !plan.from ||
        !plan.to ||
        plan.from === plan.to ||
        !isValidIdentity(plan.identity)
    ) {
        throw new Error(
            'Invalid or legacy journal identity'
        );
    }

    const sourcePath = getSafeMediaPath(plan.from);
    const targetPath = getSafeMediaPath(plan.to);

    if (sourcePath === targetPath) {
        throw new Error('Source and target are identical');
    }

    const [sourceState, targetState] = await Promise.all([
        fileState(sourcePath),
        fileState(targetPath)
    ]);

    const media = db.prepare(`
        SELECT path
        FROM media
        WHERE id = ?
    `).get(plan.id);

    const dbPath = media?.path ?? null;

    let action = 'manual';
    let identityMatches = false;

    if (
        sourceState === 'file' &&
        targetState === 'missing' &&
        dbPath === plan.from
    ) {
        identityMatches = await matchesFileIdentity(
            sourcePath,
            plan.identity
        );

        if (identityMatches) {
            action = 'cancel';
        }

    } else if (
        sourceState === 'missing' &&
        targetState === 'file' &&
        (
            dbPath === plan.from ||
            dbPath === plan.to
        )
    ) {
        identityMatches = await matchesFileIdentity(
            targetPath,
            plan.identity
        );

        if (identityMatches) {
            action =
                dbPath === plan.from
                    ? 'commit'
                    : 'complete';
        }
    }

    return {
        journalId,
        journalPayload: journal.payload,
        state: journal.state,
        plan,
        sourceState,
        targetState,
        dbPath,
        identityMatches,
        action
    };
}

/**
 * ファイルの移動は一切行わない。
 *
 * 呼び出し元は、ストレージを変更する
 * 他のプロセスが停止していることを保証する。
 */
async function applyMediaRenameRecovery(
    db,
    journalId,
    requestedAction
) {
    if (
        !['cancel', 'commit', 'complete'].includes(
            requestedAction
        )
    ) {
        throw new Error('Invalid recovery action');
    }

    if (hasOperationLock(db)) {
        throw new Error(
            'File operation lock exists'
        );
    }

    const report = await inspectMediaRenameRecovery(
        db,
        journalId
    );

    if (report.action !== requestedAction) {
        throw new Error(
            `Recovery action mismatch: expected ${report.action}`
        );
    }

    // DB更新直前に、もう一度ファイル状態を確認。
    const verified = await inspectMediaRenameRecovery(
        db,
        journalId
    );

    if (
        verified.action !== requestedAction ||
        verified.journalPayload !== report.journalPayload
    ) {
        throw new Error(
            'File or journal state changed'
        );
    }

    // DBの更新と履歴削除を原子的に実行する。
    return db.transaction(() => {

        const currentJournal = db.prepare(`
            SELECT operation, state, payload
            FROM file_operation_journal
            WHERE id = ?
        `).get(journalId);

        if (
            !currentJournal ||
            currentJournal.operation !== 'media_rename' ||
            !['pending', 'needs_attention'].includes(
                currentJournal.state
            ) ||
            currentJournal.payload !== report.journalPayload
        ) {
            throw new Error(
                'Journal changed during recovery'
            );
        }

        const currentMedia = db.prepare(`
            SELECT path
            FROM media
            WHERE id = ?
        `).get(report.plan.id);

        if (!currentMedia) {
            throw new Error('Media record missing');
        }

        if (requestedAction === 'commit') {

            if (currentMedia.path !== report.plan.from) {
                throw new Error('Media path changed');
            }

            const result = db.prepare(`
                UPDATE media
                SET path = ?
                WHERE id = ?
                  AND path = ?
            `).run(
                report.plan.to,
                report.plan.id,
                report.plan.from
            );

            if (result.changes !== 1) {
                throw new Error('Media update failed');
            }

        } else {

            const expectedPath =
                requestedAction === 'cancel'
                    ? report.plan.from
                    : report.plan.to;

            if (currentMedia.path !== expectedPath) {
                throw new Error('Media path changed');
            }
        }

        const deleted = db.prepare(`
            DELETE FROM file_operation_journal
            WHERE id = ?
              AND operation = 'media_rename'
              AND state = ?
              AND payload = ?
        `).run(
            journalId,
            currentJournal.state,
            currentJournal.payload
        );

        if (deleted.changes !== 1) {
            throw new Error('Journal deletion failed');
        }

        return {
            journalId,
            action: requestedAction,
            success: true
        };

    })();
}

module.exports = {
    inspectMediaRenameRecovery,
    applyMediaRenameRecovery
};
