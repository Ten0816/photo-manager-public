'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');

const projectDir = path.resolve(__dirname, '..');
const cliPath = path.join(projectDir, 'recover-media-rename.js');

function createFixture() {
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), 'photo-rename-cli-')
    );

    const mediaDir = path.join(root, 'Memory');
    const dbPath = path.join(root, 'test.db');

    fs.mkdirSync(
        path.join(mediaDir, 'before'),
        { recursive: true }
    );

    // ストレージ識別マーカー
    fs.writeFileSync(
        path.join(mediaDir, '.photo-manager-storage-id'),
        'photo-manager-storage-v1\n'
    );

    const from = 'before/original.jpg';
    const to = 'before/renamed.jpg';

    const source = path.join(mediaDir, from);
    const target = path.join(mediaDir, to);

    fs.writeFileSync(source, 'original-photo');

    const stat = fs.lstatSync(source, {
        bigint: true
    });

    const identity = {
        dev: stat.dev.toString(),
        ino: stat.ino.toString(),
        size: stat.size.toString(),
        mtimeNs: stat.mtimeNs.toString()
    };

    const db = new Database(dbPath);

    db.exec(`
        CREATE TABLE media (
            id INTEGER PRIMARY KEY,
            path TEXT NOT NULL UNIQUE
        );

        CREATE TABLE file_operation_journal (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            operation TEXT NOT NULL,
            state TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );

        INSERT INTO media (id, path)
        VALUES (1, 'before/original.jpg');
    `);

    const payload = JSON.stringify({
        id: 1,
        from,
        to,
        identity
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

    const journalId = Number(result.lastInsertRowid);

    // 名前変更直後・SQLite更新前の状態を再現
    fs.renameSync(source, target);

    function runCli(args = []) {
        return spawnSync(
            process.execPath,
            [
                cliPath,
                '--id',
                String(journalId),
                ...args
            ],
            {
                cwd: projectDir,
                env: {
                    ...process.env,
                    MEDIA_DIR: mediaDir,
                    DATABASE_PATH: dbPath
                },
                encoding: 'utf8',
                timeout: 10000
            }
        );
    }

    function getDbPath() {
        return db.prepare(`
            SELECT path
            FROM media
            WHERE id = 1
        `).get().path;
    }

    function journalCount() {
        return db.prepare(`
            SELECT COUNT(*) AS count
            FROM file_operation_journal
        `).get().count;
    }

    function cleanup() {
        db.close();

        fs.rmSync(root, {
            recursive: true,
            force: true
        });
    }

    return {
        from,
        to,
        target,
        runCli,
        getDbPath,
        journalCount,
        cleanup
    };
}

test('CLI確認モードではDBを変更しない', () => {
    const f = createFixture();

    try {
        const result = f.runCli();

        assert.equal(
            result.status,
            0,
            result.stderr
        );

        assert.match(
            result.stdout,
            /"action": "commit"/
        );

        assert.equal(f.getDbPath(), f.from);
        assert.equal(f.journalCount(), 1);

    } finally {
        f.cleanup();
    }
});

test('停止確認なしの復旧要求は拒否する', () => {
    const f = createFixture();

    try {
        const result = f.runCli([
            '--action',
            'commit',
            '--apply'
        ]);

        assert.notEqual(result.status, 0);

        assert.match(
            result.stderr,
            /--confirm-stopped/
        );

        assert.equal(f.getDbPath(), f.from);
        assert.equal(f.journalCount(), 1);

    } finally {
        f.cleanup();
    }
});

test('誤った復旧方法は拒否する', () => {
    const f = createFixture();

    try {
        const result = f.runCli([
            '--action',
            'cancel',
            '--apply',
            '--confirm-stopped'
        ]);

        assert.notEqual(result.status, 0);

        assert.match(
            result.stderr,
            /Recovery action mismatch/
        );

        assert.equal(f.getDbPath(), f.from);
        assert.equal(f.journalCount(), 1);

    } finally {
        f.cleanup();
    }
});

test('正しい引数ならcommitで復旧できる', () => {
    const f = createFixture();

    try {
        const result = f.runCli([
            '--action',
            'commit',
            '--apply',
            '--confirm-stopped'
        ]);

        assert.equal(
            result.status,
            0,
            result.stderr
        );

        assert.match(
            result.stdout,
            /復旧が完了しました/
        );

        assert.equal(f.getDbPath(), f.to);
        assert.equal(f.journalCount(), 0);

        // 復旧コマンドは実ファイルを移動しない
        assert.equal(
            fs.existsSync(f.target),
            true
        );

    } finally {
        f.cleanup();
    }
});
