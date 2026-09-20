const express = require("express");
const path = require("path");

const {
    MEDIA_DIR
} = require("./utils/pathUtils");

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


const app = express();

const PORT =
    Number(
        process.env.PORT || 3000
    );


// ============================================================
// Express設定
// ============================================================

app.use(
    express.static(
        path.join(
            __dirname,
            "public"
        )
    )
);

app.use(
    express.json()
);

app.use(
    "/media",
    express.static(MEDIA_DIR)
);


// ============================================================
// API
// ============================================================

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


// ============================================================
// 基本
// ============================================================

app.get("/", (req, res) => {
    res.send(
        "Photo Manager Server is running!"
    );
});


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