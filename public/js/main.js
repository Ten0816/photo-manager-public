import {
    initFolderEvents,
    loadFolders
} from "./folder.js";

import {
    initMediaEvents,
    loadMedia
} from "./media/media.js";

import {
    initViewer
} from "./viewer.js";

import {
    initUpload
} from "./upload.js";

import {
    loadStorage
} from "./storage.js";

import {
    initTrash
} from "./trash.js";

import "./theme.js";


async function init() {
    initFolderEvents();
    initMediaEvents();
    initViewer();
    initUpload();
    initTrash();

    await loadFolders();
    await loadMedia();
    await loadStorage();
}

init();