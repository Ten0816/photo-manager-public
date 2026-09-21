const express = require("express");

const {
    SESSION_COOKIE_NAME,
    SESSION_MAX_AGE,
    login
} = require("../auth");

const router =
    express.Router();

// ============================================================
// ログイン
// ============================================================

router.post(
    "/login",
    async (req, res) => {
        try {
            const {
                username,
                password
            } = req.body;

            if (
                typeof username !==
                    "string" ||
                typeof password !==
                    "string"
            ) {
                return res
                    .status(400)
                    .json({
                        error:
                            "Username and password are required"
                    });
            }

            const token =
                await login(
                    username,
                    password
                );

            if (!token) {
                return res
                    .status(401)
                    .json({
                        error:
                            "ユーザー名またはパスワードが正しくありません。"
                    });
            }

            res.setHeader(
                "Set-Cookie",
                `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=${Math.floor(SESSION_MAX_AGE / 1000)}; Path=/; HttpOnly; SameSite=Strict`
            );

            res.setHeader(
                "Cache-Control",
                "no-store"
            );

            res.json({
                message:
                    "Login successful"
            });
        } catch (error) {
            console.error(error);

            res
                .status(500)
                .json({
                    error:
                        "Login failed"
                });
        }
    }
);

// ============================================================
// ログアウト
// ============================================================

router.post(
    "/logout",
    (req, res) => {
        res.setHeader(
            "Set-Cookie",
            `${SESSION_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict`
        );

        res.json({
            message:
                "Logout successful"
        });
    }
);

module.exports = router;