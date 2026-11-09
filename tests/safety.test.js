const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const run = promisify(execFile);

const root = require('fs').mkdtempSync(path.join(os.tmpdir(), 'photo-manager-test-'));
process.env.MEDIA_DIR = root;
const { getSafePath, getSafeMediaPath, getTrashPath, STORAGE_MARKER } = require('../utils/pathUtils');
const { assertStorageAvailable } = require('../utils/storageSafety');
const { moveFileNoOverwrite } = require('../utils/fileOperations');
const { createThumbnail, getThumbnailFilePath, invalidateThumbnail } = require('../services/thumbnailService');
after(async () => fs.rm(root, { recursive: true, force: true }));

test('rejects directory traversal and absolute paths', () => {
    for (const invalid of ['../outside', '../../etc/passwd', '/etc/passwd', 'foo\\bar', '.trash/example.jpg', '.thumbnails/example.jpg', '.incoming/a.upload']) {
        assert.throws(() => getSafeMediaPath(invalid));
    }
    assert.equal(getSafeMediaPath('trip/photo.jpg'), path.join(root, 'trip/photo.jpg'));
    assert.equal(getTrashPath('trip/photo.jpg'), path.join(root, '.trash/trip/photo.jpg'));
});

test('rejects symlink paths inside media directory', async () => {
    const link = path.join(root, 'escape');
    await fs.symlink(os.tmpdir(), link);
    assert.throws(() => getSafeMediaPath('escape/private.jpg'), /symbolic links/);
});

test('rejects missing or tampered HDD marker and accepts the correct marker', async () => {
    await assert.rejects(assertStorageAvailable(), { code: 'STORAGE_UNAVAILABLE' });
    const marker = path.join(root, STORAGE_MARKER);
    await fs.writeFile(marker, 'wrong');
    await assert.rejects(assertStorageAvailable(), { code: 'STORAGE_UNAVAILABLE' });
    await fs.writeFile(marker, 'photo-manager-storage-v1\n');
    await assert.doesNotReject(assertStorageAvailable());
});

test('atomic move refuses to overwrite an existing target', async () => {
    const source = path.join(root, 'source.txt');
    const target = path.join(root, 'target.txt');
    await fs.writeFile(source, 'original');
    await fs.writeFile(target, 'existing');
    await assert.rejects(moveFileNoOverwrite(source, target), { code: 'EEXIST' });
    assert.equal(await fs.readFile(source, 'utf8'), 'original');
    assert.equal(await fs.readFile(target, 'utf8'), 'existing');
    await fs.unlink(target);
    await moveFileNoOverwrite(source, target);
    assert.equal(await fs.readFile(target, 'utf8'), 'original');
    await assert.rejects(fs.access(source), { code: 'ENOENT' });
});

test('different media extensions have distinct thumbnails; cache refreshes after source modification', async () => {
    const media1 = path.join(root, 'same.png');
    const media2 = path.join(root, 'same.jpg');
    assert.notEqual(getThumbnailFilePath('same.png'), getThumbnailFilePath('same.jpg'));
    await run('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=16x16', '-frames:v', '1', media1]);
    await run('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=16x16', '-frames:v', '1', media2]);
    const [t1, t2] = await Promise.all([createThumbnail('same.png'), createThumbnail('same.jpg')]);
    assert.notEqual(t1, t2);
    assert.ok((await fs.stat(t1)).size > 0);
    assert.ok((await fs.stat(t2)).size > 0);
    const firstMeta = JSON.parse(await fs.readFile(t1 + '.json', 'utf8'));
    await new Promise(resolve => setTimeout(resolve, 20));
    await fs.appendFile(media1, Buffer.from('padding'));
    await createThumbnail('same.png');
    const secondMeta = JSON.parse(await fs.readFile(t1 + '.json', 'utf8'));
    assert.notEqual(firstMeta.size, secondMeta.size);
    await invalidateThumbnail('same.png');
    await assert.rejects(fs.access(t1), { code: 'ENOENT' });
});
