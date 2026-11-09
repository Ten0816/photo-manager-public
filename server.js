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

const mediaRenameRoutes =
    require("./routes/mediaRenameRoutes");

const mediaBulkRenameRoutes =
    require("./routes/mediaBulkRenameRoutes");

const mediaDeleteRoutes =
    require("./routes/mediaDeleteRoutes");

const mediaBulkDeleteRoutes =
    require("./routes/mediaBulkDeleteRoutes");

const mediaMoveRoutes =
    require("./routes/mediaMoveRoutes");

const mediaListRoutes =
    require("./routes/mediaListRoutes");

const mediaInfoRoutes =
    require("./routes/mediaInfoRoutes");

const uploadRoutes =
    require("./routes/uploadRoutes");

const thumbnailRoutes =
    require("./routes/thumbnailRoutes");

const storageRoutes =
    require("./routes/storageRoutes");

const trashRoutes =
    require("./routes/trashRoutes");

const trashDeleteRoutes =
    require("./routes/trashDeleteRoutes");

const authRoutes =
    require("./routes/authRoutes");

const downloadRoutes =
    require("./routes/downloadRoutes");

const { requireStorage } = require("./utils/storageSafety");

const app = express();
app.set("trust proxy", 1);

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
    requireApiAuth,
    requireStorage
);

app.use(
    "/api/folders",
    folderRoutes
);

app.use(
    "/api/media",
    mediaRenameRoutes
);

app.use(
    "/api/media",
    mediaBulkRenameRoutes
);

app.use(
    "/api/media",
    mediaDeleteRoutes
);

app.use(
    "/api/media",
    mediaBulkDeleteRoutes
);

app.use(
    "/api/media",
    mediaMoveRoutes
);

app.use(
    "/api/media",
    mediaListRoutes
);

app.use(
    "/api/media-info",
    mediaInfoRoutes
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

app.use(
    "/api/trash",
    trashDeleteRoutes
);

app.use(
    "/api/download",
    downloadRoutes
);

// ============================================================
// メディアファイル
// ============================================================

// 写真・動画そのものも認証必須
app.use(
    "/media",
    requireApiAuth,
    requireStorage,
    (req, res, next) => {
        try {
            const relative = decodeURIComponent(req.path).replace(/^\/+/, "");
            const { isMediaFile } = require("./services/mediaService");
            if (!isMediaFile(relative)) return res.sendStatus(404);
            require("./utils/pathUtils").getSafeMediaPath(relative);
            next();
        } catch { res.sendStatus(400); }
    },
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