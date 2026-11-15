'use strict';

// Crash-recovery journal for BULK MOVE only.
// Records must be committed before touching files.

function initializeJournal(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS file_operation_journal (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            operation TEXT NOT NULL,
            state TEXT NOT NULL CHECK(state IN ('pending', 'needs_attention')),
            payload TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
    `);
}

function pendingOperations(db) {
    initializeJournal(db);

    return db.prepare(`
        SELECT id, operation, state, payload, created_at
        FROM file_operation_journal ORDER BY id
    `).all();
}

function assertNoPendingOperations(db) {
    if (pendingOperations(db).length) {
        const error = new Error(
            'Unresolved file operation; run npm run operations:check'
        );
        error.code = 'PENDING_OPERATION';
        throw error;
    }
}

function beginBulkMove(db, plans) {
    initializeJournal(db);

    return db.transaction(() => {
        assertNoPendingOperations(db);

        const payload = JSON.stringify(
            plans.map(({ media, newRelativePath }) => ({
                id: media.id,
                from: media.path,
                to: newRelativePath
            }))
        );

        return db.prepare(`
            INSERT INTO file_operation_journal
            (operation, state, payload, created_at)
            VALUES ('bulk_move', 'pending', ?, ?)
        `).run(payload, Date.now()).lastInsertRowid;
    })();
}

function completeBulkMove(db, journalId, plans) {
    db.transaction(() => {
        const update = db.prepare(
            'UPDATE media SET path = ? WHERE id = ? AND path = ?'
        );

        for (const plan of plans) {
            const result = update.run(
                plan.newRelativePath,
                plan.media.id,
                plan.media.path
            );

            if (result.changes !== 1) {
                throw new Error('Media changed during bulk move');
            }
        }

        db.prepare(
            'DELETE FROM file_operation_journal WHERE id = ?'
        ).run(journalId);
    })();
}

module.exports = {
    initializeJournal,
    pendingOperations,
    assertNoPendingOperations,
    beginBulkMove,
    completeBulkMove
};
