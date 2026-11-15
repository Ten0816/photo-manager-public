'use strict';

const fs = require('node:fs/promises');

const {
    getSafeMediaPath
} = require('./pathUtils');

const {
    isValidIdentity,
    matchesFileIdentity
} = require('./fileIdentity');

/**
 * ファイルが存在するか確認する。
 *
 * シンボリックリンクは通常ファイルとして扱わない。
 */
async function getFileState(filePath) {
    try {
        const stat = await fs.lstat(filePath);

        if (stat.isSymbolicLink()) {
            return 'symlink';
        }

        if (!stat.isFile()) {
            return 'other';
        }

        return 'file';

    } catch (error) {
        if (error.code === 'ENOENT') {
            return 'missing';
        }

        throw error;
    }
}

/**
 * 名前変更が実行されていないことを検証し、
 * 不要になったジャーナルを取り消す。
 *
 * 戻り値:
 *   true  : 取消成功
 *   false : 安全性を確認できない
 *
 * 呼び出し側は操作ロックを保持していること。
 */
async function cancelUnchangedMediaRename(
    db,
    journalId,
    plan
) {
    if (
        !plan ||
        !Number.isSafeInteger(plan.id) ||
        typeof plan.from !== 'string' ||
        typeof plan.to !== 'string' ||
        plan.from === plan.to
    ) {
        return false;
    }

    // =====================================
    // ① ジャーナルの確認
    // =====================================

    const journal = db.prepare(`
        SELECT id, operation, state, payload
        FROM file_operation_journal
        WHERE id = ?
    `).get(journalId);

    if (
        !journal ||
        journal.operation !== 'media_rename' ||
        journal.state !== 'pending'
    ) {
        return false;
    }

    let payload;

    try {
        payload = JSON.parse(journal.payload);
    } catch {
        return false;
    }

    if (
        !payload ||
        payload.id !== plan.id ||
        payload.from !== plan.from ||
        payload.to !== plan.to ||
        !isValidIdentity(payload.identity)
    ) {
        return false;
    }

    // =====================================
    // ② ファイルの状態確認
    // =====================================

    const sourcePath = getSafeMediaPath(plan.from);
    const targetPath = getSafeMediaPath(plan.to);

    const [sourceState, targetState] = await Promise.all([
        getFileState(sourcePath),
        getFileState(targetPath)
    ]);

    // 移動元だけが存在する必要がある。
    if (
        sourceState !== 'file' ||
        targetState !== 'missing'
    ) {
        return false;
    }

    // =====================================
    // ③ ファイルの同一性確認
    // =====================================

    const identityMatches = await matchesFileIdentity(
        sourcePath,
        payload.identity
    );

    if (!identityMatches) {
        return false;
    }

    // =====================================
    // ④ SQLiteとジャーナルを再確認
    // =====================================

    // DB操作はトランザクションでまとめる。
    // ファイルシステムの変更までは
    // SQLiteトランザクションで防げないため、
    // 呼び出し側の排他ロックが前提となる。
    return db.transaction(() => {

        const media = db.prepare(`
            SELECT path
            FROM media
            WHERE id = ?
        `).get(plan.id);

        if (!media || media.path !== plan.from) {
            return false;
        }

        const currentJournal = db.prepare(`
            SELECT operation, state, payload
            FROM file_operation_journal
            WHERE id = ?
        `).get(journalId);

        if (
            !currentJournal ||
            currentJournal.operation !== 'media_rename' ||
            currentJournal.state !== 'pending' ||
            currentJournal.payload !== journal.payload
        ) {
            return false;
        }

        const result = db.prepare(`
            DELETE FROM file_operation_journal
            WHERE id = ?
              AND operation = 'media_rename'
              AND state = 'pending'
              AND payload = ?
        `).run(journalId, journal.payload);

        return result.changes === 1;

    })();
}

module.exports = {
    cancelUnchangedMediaRename
};
