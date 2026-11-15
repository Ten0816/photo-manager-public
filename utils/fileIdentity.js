'use strict';

const fs = require('node:fs/promises');

async function captureFileIdentity(filePath) {
    const stat = await fs.lstat(filePath, {
        bigint: true
    });

    if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error('Not a regular media file');
    }

    return {
        dev: stat.dev.toString(),
        ino: stat.ino.toString(),
        size: stat.size.toString(),
        mtimeNs: stat.mtimeNs.toString()
    };
}

function isValidIdentity(identity) {
    if (
        !identity ||
        typeof identity !== 'object' ||
        Array.isArray(identity)
    ) {
        return false;
    }

    return ['dev', 'ino', 'size', 'mtimeNs'].every(
        key =>
            typeof identity[key] === 'string' &&
            /^\d+$/.test(identity[key])
    );
}

async function matchesFileIdentity(filePath, identity) {
    if (!isValidIdentity(identity)) {
        return false;
    }

    try {
        const actual = await captureFileIdentity(filePath);

        return (
            actual.dev === identity.dev &&
            actual.ino === identity.ino &&
            actual.size === identity.size &&
            actual.mtimeNs === identity.mtimeNs
        );
    } catch (error) {
        if (
            error.code === 'ENOENT' ||
            error.code === 'ELOOP'
        ) {
            return false;
        }

        throw error;
    }
}

module.exports = {
    captureFileIdentity,
    matchesFileIdentity,
    isValidIdentity
};
