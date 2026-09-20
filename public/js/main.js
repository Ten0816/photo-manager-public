import {
    initFolderEvents,
    loadFolders
} from "./folder.js";

import {
    initMediaEvents,
    loadMedia
} from "./media.js";

import {
    initViewer
} from "./viewer.js";

import {
    initUpload
} from "./upload.js";

import {
    loadStorage
} from "./storage.js";


// ============================================================
// 初期化
// ============================================================

async function init() {

    initFolderEvents();

    initMediaEvents();

    initViewer();

    initUpload();

    await loadFolders();

    await loadMedia();

    await loadStorage();
}

init();