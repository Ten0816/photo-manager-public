const fs = require('fs/promises');

// Same-filesystem, no-overwrite move. Avoids fs.rename replacing an existing file
// after a preflight check. Requires hard-link support (NTFS3 and ext4 support it).
async function moveFileNoOverwrite(source, destination) {
    await fs.link(source, destination);
    try {
        await fs.unlink(source);
    } catch (error) {
        // Leave the original intact; remove only the newly created hard-link.
        try { await fs.unlink(destination); } catch (cleanupError) {
            console.error('Unable to remove incomplete hard-link:', cleanupError);
        }
        throw error;
    }
}

module.exports = { moveFileNoOverwrite };
