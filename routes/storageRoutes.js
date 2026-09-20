const express = require("express");
const fs = require("fs");

const {
    MEDIA_DIR
} = require("../utils/pathUtils");

const router = express.Router();

/**
 * ストレージ使用量取得
 *
 * GET /api/storage
 */
router.get("/", async (req, res) => {
    try {
        const stats =
            await fs.promises.statfs(MEDIA_DIR);

        const total =
            stats.blocks * stats.bsize;

        const free =
            stats.bavail * stats.bsize;

        const used =
            total - free;

        res.json({
            total,
            used,
            free,
            usagePercent:
                total > 0
                    ? (used / total) * 100
                    : 0
        });

    } catch (error) {
        console.error(
            "Failed to get storage information:",
            error
        );

        res.status(500).json({
            error:
                "Failed to get storage information"
        });
    }
});

module.exports = router;