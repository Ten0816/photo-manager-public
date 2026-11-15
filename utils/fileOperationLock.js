'use strict';

const { randomUUID } = require('node:crypto');

function initializeLock(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS file_operation_lock (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            owner TEXT NOT NULL,
            operation TEXT NOT NULL,
            acquired_at INTEGER NOT NULL
        );
    `);
}

function getCurrentLock(db) {
    initializeLock(db);

    return db.prepare(`
        SELECT owner, operation, acquired_at
        FROM file_operation_lock
        WHERE id = 1
    `).get() || null;
}

function assertNoUnresolvedJournal(db) {
    const exists = db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table'
          AND name = 'file_operation_journal'
    `).get();

    if (!exists) return;

    const pending = db.prepare(`
        SELECT id FROM file_operation_journal
        LIMIT 1
    `).get();

    if (pending) {
        const error = new Error(
            'Unresolved file operation journal'
        );

        error.code = 'PENDING_OPERATION';
        throw error;
    }
}

function acquireLock(db, operation) {
    if (typeof operation !== 'string' || !operation.trim()) {
        throw new Error('Operation name is required');
    }

    initializeLock(db);

    const owner = randomUUID();

    db.transaction(() => {
        assertNoUnresolvedJournal(db);

        const result = db.prepare(`
            INSERT INTO file_operation_lock
                (id, owner, operation, acquired_at)
            VALUES (1, ?, ?, ?)
            ON CONFLICT(id) DO NOTHING
        `).run(owner, operation, Date.now());

        if (result.changes !== 1) {
            const error = new Error(
                'Another file operation is running'
            );

            error.code = 'FILE_OPERATION_LOCKED';
            throw error;
        }
    }).immediate();

    return owner;
}

function releaseLock(db, owner) {
    const result = db.prepare(`
        DELETE FROM file_operation_lock
        WHERE id = 1 AND owner = ?
    `).run(owner);

    return result.changes === 1;
}

async function withFileOperationLock(db, operation, callback) {
    const owner = acquireLock(db, operation);

    try {
        return await callback();
    } finally {
        if (!releaseLock(db, owner)) {
            console.error(
                'File operation lock could not be released:',
                operation
            );
        }
    }
}

module.exports = {
    initializeLock,
    getCurrentLock,
    acquireLock,
    releaseLock,
    withFileOperationLock
};
