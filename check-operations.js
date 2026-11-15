'use strict';

// Read-only by default. --apply ONLY reconciles operations where ALL items
// unambiguously agree (all at source or all at destination). Never moves or
// deletes physical files. Run while web and scan services are stopped.
const fs = require('fs/promises');
const {
    matchesFileIdentity,
    isValidIdentity
} = require('./utils/fileIdentity');
const db = require('./database');
const { getSafeMediaPath } = require('./utils/pathUtils');
const { assertStorageAvailable } = require('./utils/storageSafety');
const { pendingOperations } = require('./utils/operationJournal');

async function exists(file) {
    try {
        const stat = await fs.lstat(file);
        return stat.isFile() && !stat.isSymbolicLink();
    } catch (e) {
        if (e.code === 'ENOENT') return false;
        throw e;
    }
}


/**
 * 名前変更ジャーナルの復旧候補を判定する。
 *
 * ファイルの同一性情報がないため、
 * 自動復旧は実行しない。
 */
async function inspectMediaRename(record) {
    let entry;

    try {
        entry = JSON.parse(record.payload);
    } catch {
        return {
            id: record.id,
            operation: 'media_rename',
            resolution: 'manual',
            reason: 'Invalid journal payload'
        };
    }

    if (
        !entry ||
        !Number.isSafeInteger(entry.id) ||
        entry.id <= 0 ||
        typeof entry.from !== 'string' ||
        typeof entry.to !== 'string' ||
        !entry.from ||
        !entry.to ||
        entry.from === entry.to
    ) {
        return {
            id: record.id,
            operation: 'media_rename',
            resolution: 'manual',
            reason: 'Invalid rename plan'
        };
    }

    const from = getSafeMediaPath(entry.from);
    const to = getSafeMediaPath(entry.to);

    const [source, target] = await Promise.all([
        exists(from),
        exists(to)
    ]);

    const media = db.prepare(
        'SELECT path FROM media WHERE id = ?'
    ).get(entry.id);

    const dbPath = media?.path ?? null;

    let candidateAction = 'manual';

    if (source && !target && dbPath === entry.from) {
        candidateAction = 'cancel';
    } else if (!source && target && dbPath === entry.from) {
        candidateAction = 'commit';
    } else if (!source && target && dbPath === entry.to) {
        candidateAction = 'complete';
    }

    // ファイル同一性を検証する。
    // 旧ジャーナルとの互換性のため、
    // identityが存在しない場合も読み取りは可能にする。
    let identityStatus = 'missing';
    let identityVerified = false;

    if (entry.identity !== undefined) {

        if (!isValidIdentity(entry.identity)) {
            identityStatus = 'invalid';

        } else {

            // 復旧候補がある場合のみ照合する。
            const candidatePath =
                candidateAction === 'cancel'
                    ? from
                    : (
                        candidateAction === 'commit' ||
                        candidateAction === 'complete'
                    )
                        ? to
                        : null;

            if (candidatePath !== null) {
                try {
                    identityVerified =
                        await matchesFileIdentity(
                            candidatePath,
                            entry.identity
                        );

                    identityStatus =
                        identityVerified
                            ? 'matched'
                            : 'mismatched';

                } catch (error) {
                    identityStatus = 'error';

                    console.error(
                        'File identity verification failed:',
                        error
                    );
                }

            } else {
                identityStatus = 'ambiguous';
            }
        }
    }

    // 不一致・不正な同一性情報の場合は
    // 復旧候補を無効化する。
    if (
        identityStatus === 'mismatched' ||
        identityStatus === 'invalid' ||
        identityStatus === 'error'
    ) {
        candidateAction = 'manual';
    }

    return {
        id: record.id,
        operation: 'media_rename',
        state: record.state,

        // 現段階では常に手動確認。
        resolution: 'manual',

        candidateAction,
        identityStatus,
        identityVerified,

        reason: identityVerified
            ? 'File metadata identity matched; manual review still required'
            : 'File identity is missing, ambiguous, or unverified',

        items: [{
            ...entry,
            source,
            target,
            dbPath
        }]
    };
}

async function inspectOperation(record) {
    if (record.operation === "media_rename") {
        return inspectMediaRename(record);
    }

    if (record.operation !== 'bulk_move') {
        throw new Error(`Unknown operation: ${record.operation}`);
    }

    const entries = JSON.parse(record.payload);
    const items = [];

    for (const entry of entries) {
        const from = getSafeMediaPath(entry.from);
        const to = getSafeMediaPath(entry.to);

        const [source, target] = await Promise.all([
            exists(from),
            exists(to)
        ]);

        const media = db.prepare(
            'SELECT path FROM media WHERE id = ?'
        ).get(entry.id);

        items.push({
            ...entry,
            source,
            target,
            dbPath: media?.path ?? null
        });
    }

    const allAtSource = items.every(
        x => x.source && !x.target && x.dbPath === x.from
    );

    const allAtTarget = items.every(
        x => !x.source && x.target &&
        (x.dbPath === x.from || x.dbPath === x.to)
    );

    return {
        id: record.id,
        state: record.state,
        resolution: allAtSource
            ? 'cancel'
            : allAtTarget
                ? 'commit'
                : 'manual',
        items
    };
}

async function main() {
    await assertStorageAvailable();

    const apply = process.argv.includes('--apply');
    const operations = pendingOperations(db);

    if (!operations.length) {
        console.log('未解決の操作はありません。');
        return;
    }

    let unresolved = false;

    for (const record of operations) {
        const report = await inspectOperation(record);
        console.log(JSON.stringify(report, null, 2));

        if (report.resolution === 'manual') {
            unresolved = true;

            if (apply) {
                db.prepare(
                    "UPDATE file_operation_journal SET state = 'needs_attention' WHERE id = ?"
                ).run(record.id);
            }

            continue;
        }

        if (!apply) continue;

        db.transaction(() => {
            if (report.resolution === 'commit') {
                const update = db.prepare(
                    'UPDATE media SET path = ? WHERE id = ? AND path = ?'
                );

                for (const item of report.items) {
                    if (item.dbPath === item.to) continue;

                    if (update.run(
                        item.to,
                        item.id,
                        item.from
                    ).changes !== 1) {
                        throw new Error('DB mismatch');
                    }
                }
            }

            db.prepare(
                'DELETE FROM file_operation_journal WHERE id = ?'
            ).run(record.id);
        })();

        console.log(
            `Operation ${record.id}: ${report.resolution} applied (no file was moved).`
        );
    }

    if (unresolved) process.exitCode = 2;
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
