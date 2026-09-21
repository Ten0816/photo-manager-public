const express = require("express");

const path = require("path");

const {
    MEDIA_DIR
} = require("./utils/pathUtils");

const {
    requireApiAuth,
    requirePageAuth
} = require("./auth");

const folderRoutes =
    require("./routes/folderRoutes");

const mediaRoutes =
    require("./routes/mediaRoutes");

const uploadRoutes =
    require("./routes/uploadRoutes");

const thumbnailRoutes =
    require("./routes/thumbnailRoutes");

const storageRoutes =
    require("./routes/storageRoutes");

const trashRoutes =
    require("./routes/trashRoutes");

const authRoutes =
    require("./routes/authRoutes");

const app = express();

const PORT =
    Number(
        process.env.PORT || 3000
    );

const PUBLIC_DIR =
    path.join(
        __dirname,
        "public"
    );

// ============================================================
// Express設定
// ============================================================

app.use(
    express.json()
);

// ============================================================
// 認証API
// ============================================================

// ログイン・ログアウトは認証不要
app.use(
    "/api/auth",
    authRoutes
);

// ============================================================
// API
// ============================================================

// /api/auth 以外のAPIは認証必須
app.use(
    "/api",
    requireApiAuth
);

app.use(
    "/api/folders",
    folderRoutes
);

app.use(
    "/api/media",
    mediaRoutes
);

app.use(
    "/api/upload",
    uploadRoutes
);

app.use(
    "/api/thumbnail",
    thumbnailRoutes
);

app.use(
    "/api/storage",
    storageRoutes
);

app.use(
    "/api/trash",
    trashRoutes
);

// ============================================================
// メディアファイル
// ============================================================

// 写真・動画そのものも認証必須
app.use(
    "/media",
    requireApiAuth,
    express.static(MEDIA_DIR)
);

// ============================================================
// ログイン画面
// ============================================================

// login.htmlだけは認証不要
app.get(
    "/login.html",
    (req, res) => {
        res.sendFile(
            path.join(
                PUBLIC_DIR,
                "login.html"
            )
        );
    }
);

// ============================================================
// Webページ・CSS・JavaScript
// ============================================================

// public以下のファイルは認証必須
//
// index.html
// css/*
// js/*
// などすべてここで保護する
app.use(
    requirePageAuth,
    express.static(PUBLIC_DIR)
);

// ============================================================
// 基本
// ============================================================

app.get(
    "/",
    requirePageAuth,
    (req, res) => {
        res.sendFile(
            path.join(
                PUBLIC_DIR,
                "index.html"
            )
        );
    }
);

// ============================================================
// サーバー起動
// ============================================================

app.listen(
    PORT,
    () => {
        console.log(
            "Server is running on port " +
            PORT
        );
    }
);