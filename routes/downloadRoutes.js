const express = require("express");

const {
    getSafeMediaPath
} = require("../utils/pathUtils");

const router =
    express.Router();

router.get("/", async (req, res) => {
    const relativePath =
        req.query.path;

    if (
        typeof relativePath !== "string" ||
        !relativePath
    ) {
        return res.status(400).json({
            error: "Media path is required"
        });
    }

    try {
        const filePath =
            getSafeMediaPath(
                relativePath
            );

        res.download(
            filePath,
            relativePath.split("/").pop(),
            error => {
                if (error) {
                    console.error(
                        "Download failed:",
                        error
                    );

                    if (!res.headersSent) {
                        res.status(404).json({
                            error:
                                "Media file not found"
                        });
                    }
                }
            }
        );

    } catch (error) {
        console.error(error);

        res.status(400).json({
            error:
                "Invalid media path"
        });
    }
});

module.exports = router;