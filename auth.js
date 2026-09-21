const crypto = require("crypto");

// ============================================================
// 設定
// ============================================================

const SESSION_COOKIE_NAME =
    "photo_manager_session";

const SESSION_MAX_AGE =
    1000 * 60 * 60 * 24 * 7; // 7日

const SESSION_SECRET =
    process.env.SESSION_SECRET;

const AUTH_USERNAME =
    process.env.AUTH_USERNAME;

const AUTH_PASSWORD_HASH =
    process.env.AUTH_PASSWORD_HASH;

// ============================================================
// 起動時チェック
// ============================================================

if (!SESSION_SECRET) {
    throw new Error(
        "SESSION_SECRET is not configured."
    );
}

if (!AUTH_USERNAME) {
    throw new Error(
        "AUTH_USERNAME is not configured."
    );
}

if (!AUTH_PASSWORD_HASH) {
    throw new Error(
        "AUTH_PASSWORD_HASH is not configured."
    );
}

// ============================================================
// パスワード
// ============================================================

function hashPassword(password, salt) {
    return new Promise((resolve, reject) => {
        crypto.scrypt(
            password,
            salt,
            64,
            (error, derivedKey) => {
                if (error) {
                    reject(error);
                    return;
                }

                resolve(
                    derivedKey.toString("hex")
                );
            }
        );
    });
}

async function verifyPassword(
    password,
    storedHash
) {
    const parts =
        storedHash.split("$");

    if (parts.length !== 3) {
        return false;
    }

    const [
        algorithm,
        salt,
        hash
    ] = parts;

    if (
        algorithm !== "scrypt" ||
        !salt ||
        !hash
    ) {
        return false;
    }

    const calculatedHash =
        await hashPassword(
            password,
            salt
        );

    const expected =
        Buffer.from(hash, "hex");

    const actual =
        Buffer.from(
            calculatedHash,
            "hex"
        );

    if (
        expected.length !==
        actual.length
    ) {
        return false;
    }

    return crypto.timingSafeEqual(
        expected,
        actual
    );
}

// ============================================================
// セッション
// ============================================================

function createSignature(value) {
    return crypto
        .createHmac(
            "sha256",
            SESSION_SECRET
        )
        .update(value)
        .digest("hex");
}

function createSessionToken(username) {
    const expiresAt =
        Date.now() +
        SESSION_MAX_AGE;

    const value =
        username +
        "|" +
        expiresAt;

    const signature =
        createSignature(value);

    return (
        value +
        "." +
        signature
    );
}

function verifySessionToken(token) {
    if (!token) {
        return false;
    }

    const separatorIndex =
        token.lastIndexOf(".");

    if (separatorIndex === -1) {
        return false;
    }

    const value =
        token.substring(
            0,
            separatorIndex
        );

    const signature =
        token.substring(
            separatorIndex + 1
        );

    const expectedSignature =
        createSignature(value);

    const actual =
        Buffer.from(signature);

    const expected =
        Buffer.from(
            expectedSignature
        );

    if (
        actual.length !==
        expected.length
    ) {
        return false;
    }

    if (
        !crypto.timingSafeEqual(
            actual,
            expected
        )
    ) {
        return false;
    }

    const valueSeparator =
        value.lastIndexOf("|");

    if (valueSeparator === -1) {
        return false;
    }

    const username =
        value.substring(
            0,
            valueSeparator
        );

    const expiresAt =
        Number(
            value.substring(
                valueSeparator + 1
            )
        );

    if (
        !username ||
        !Number.isFinite(expiresAt)
    ) {
        return false;
    }

    if (
        Date.now() >= expiresAt
    ) {
        return false;
    }

    if (
        username !== AUTH_USERNAME
    ) {
        return false;
    }

    return true;
}

// ============================================================
// Cookie
// ============================================================

function getSessionToken(req) {
    const cookieHeader =
        req.headers.cookie;

    if (!cookieHeader) {
        return null;
    }

    const cookies =
        cookieHeader
            .split(";")
            .map(
                cookie =>
                    cookie.trim()
            );

    for (const cookie of cookies) {
        const separator =
            cookie.indexOf("=");

        if (separator === -1) {
            continue;
        }

        const name =
            cookie.substring(
                0,
                separator
            );

        if (
            name !==
            SESSION_COOKIE_NAME
        ) {
            continue;
        }

        const value =
            cookie.substring(
                separator + 1
            );

        try {
            return decodeURIComponent(
                value
            );
        } catch {
            return null;
        }
    }

    return null;
}

// ============================================================
// 認証ミドルウェア
// ============================================================

// API用
// 未認証なら401を返す
function requireApiAuth(
    req,
    res,
    next
) {
    const token =
        getSessionToken(req);

    if (
        !verifySessionToken(token)
    ) {
        return res
            .status(401)
            .json({
                error:
                    "Authentication required"
            });
    }

    next();
}

// Webページ用
// 未認証ならログイン画面へ移動
function requirePageAuth(
    req,
    res,
    next
) {
    const token =
        getSessionToken(req);

    if (
        !verifySessionToken(token)
    ) {
        return res.redirect(
            "/login.html"
        );
    }

    next();
}

// ============================================================
// ログイン
// ============================================================

async function login(
    username,
    password
) {
    if (
        username !==
        AUTH_USERNAME
    ) {
        return null;
    }

    const valid =
        await verifyPassword(
            password,
            AUTH_PASSWORD_HASH
        );

    if (!valid) {
        return null;
    }

    return createSessionToken(
        username
    );
}

// ============================================================
// Export
// ============================================================

module.exports = {
    SESSION_COOKIE_NAME,
    SESSION_MAX_AGE,
    requireApiAuth,
    requirePageAuth,
    login
};