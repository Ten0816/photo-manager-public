import {
  modal,
  modalContent,
  modalClose
} from "./dom.js";

import {
  downloadMedia
} from "./media/mediaDownload.js";

import {
  renameMedia,
  deleteMedia
} from "./media/mediaActions.js";


let currentViewerMedia = null;

let currentViewerMediaInfo = null;

let currentViewerIndex = -1;

let viewerMediaList = [];

let touchStartX = 0;

let touchStartY = 0;

// Viewerを開いたときの履歴状態
let viewerHistoryKey = null;


/**
 * メディアビューアを初期化
 */
export function initViewer() {

  // 閉じるボタン
  modalClose.addEventListener(
    "click",
    () => {
      closeModal();
    }
  );


  // モーダル背景をクリックしたら閉じる
  modal.addEventListener(
    "click",
    event => {

      if (
        event.target === modal
      ) {
        closeModal();
      }
    }
  );


  // Escapeキーで閉じる
  document.addEventListener(
    "keydown",
    event => {

      if (
        event.key === "Escape"
      ) {
        closeModal();
      }
    }
  );


  // ブラウザの戻る・進む
  window.addEventListener(
    "popstate",
    handleViewerHistory
  );


  // Viewer操作メニューの外側をクリックしたら閉じる
  document.addEventListener(
    "click",
    event => {

      const menu =
        modal.querySelector(
          ".viewer-actions-menu"
        );

      const button =
        modal.querySelector(
          ".viewer-actions-button"
        );

      if (
        !menu ||
        !button
      ) {
        return;
      }

      if (
        !menu.contains(
          event.target
        ) &&
        event.target !== button
      ) {
        menu.hidden = true;
      }
    }
  );


  // スワイプ開始
  modalContent.addEventListener(
    "touchstart",
    event => {

      if (
        event.touches.length !== 1
      ) {
        return;
      }

      touchStartX =
        event.touches[0].clientX;

      touchStartY =
        event.touches[0].clientY;
    },
    {
      passive: true
    }
  );


  // スワイプ終了
  modalContent.addEventListener(
    "touchend",
    event => {

      if (
        event.changedTouches.length !== 1
      ) {
        return;
      }

      const touchEndX =
        event.changedTouches[0].clientX;

      const touchEndY =
        event.changedTouches[0].clientY;

      const deltaX =
        touchEndX - touchStartX;

      const deltaY =
        touchEndY - touchStartY;


      // 縦方向の操作なら無視
      if (
        Math.abs(deltaY) >
        Math.abs(deltaX)
      ) {
        return;
      }


      // 50px未満ならタップ扱い
      if (
        Math.abs(deltaX) < 50
      ) {
        return;
      }


      if (deltaX < 0) {

        // 左スワイプ
        // → 次
        showNextMedia();

      } else {

        // 右スワイプ
        // → 前
        showPreviousMedia();
      }
    },
    {
      passive: true
    }
  );
}


/**
 * メディアビューアを開く
 */
export function openViewer(media) {

  // 現在DOMに表示されているメディアを取得
  viewerMediaList = Array.from(
    document.querySelectorAll(".media-item")
  )
    .map(item => item.mediaData)
    .filter(Boolean);


  currentViewerIndex =
    viewerMediaList.findIndex(
      item => item.id === media.id
    );


  // 念のため見つからなかった場合
  if (currentViewerIndex === -1) {

    viewerMediaList = [media];

    currentViewerIndex = 0;
  }


  currentViewerMedia = media;


  // Viewer専用の履歴キーを作成
  viewerHistoryKey =
    "viewer-" + Date.now();


  // 現在の一覧ページの履歴に
  // Viewerの基準となる情報を保存
  history.replaceState(
    {
      viewerBase: true,
      viewerHistoryKey
    },
    "",
    window.location.pathname
  );


  // Viewerを開いた履歴を作成
  history.pushState(
    {
      viewer: true,
      mediaId: media.id,
      viewerHistoryKey
    },
    "",
    "?media=" + media.id
  );


  modal.classList.add(
    "active"
  );


  loadViewerMedia(media);


  // 背景ページをスクロールさせない
  document.body.style.overflow =
    "hidden";
}


/**
 * ブラウザの戻る・進むを処理
 */
function handleViewerHistory(event) {

  // Viewerを開いていない状態
  if (
    !modal.classList.contains("active")
  ) {
    return;
  }


  const state =
    event.state;


  // Viewerの履歴
  if (
    state &&
    state.viewer &&
    state.viewerHistoryKey ===
    viewerHistoryKey
  ) {

    const mediaId =
      state.mediaId;


    const index =
      viewerMediaList.findIndex(
        media =>
          media.id === mediaId
      );


    // 現在の一覧に存在しないメディア
    if (index === -1) {

      closeModal(false);

      return;
    }


    currentViewerIndex =
      index;


    const media =
      viewerMediaList[index];


    loadViewerMedia(media);

    return;
  }


  // Viewerの基準履歴まで戻った
  if (
    state &&
    state.viewerBase &&
    state.viewerHistoryKey ===
    viewerHistoryKey
  ) {

    closeModal(false);

    return;
  }


  // Viewerを開く前の履歴まで戻った
  closeModal(false);
}


/**
 * ビューアのメディアを切り替える
 *
 * 詳細情報は /api/media で取得済みの
 * DBデータをそのまま利用する。
 */
function loadViewerMedia(media) {

  currentViewerMedia =
    media;


  currentViewerMediaInfo = {
    id: media.id,
    path: media.path,
    name: media.path.split("/").pop(),
    type: media.type,
    fileSize: media.file_size,
    modifiedAt: media.modified_at,
    takenAt: media.taken_at,
    exif: null
  };


  renderViewer();
}


/**
 * ビューアを描画
 */
export function renderViewer() {

  if (!currentViewerMedia) {
    return;
  }


  modalContent.innerHTML =
    "";


  // 前回作成したナビゲーションボタンを削除
  modal
    .querySelectorAll(
      ".viewer-button"
    )
    .forEach(button => {
      button.remove();
    });


  // 前回作成した操作メニューを削除
  modal
    .querySelectorAll(
      ".viewer-actions-button, .viewer-actions-menu"
    )
    .forEach(element => {
      element.remove();
    });


  // 操作メニュー
  renderViewerActions();


  const media =
    currentViewerMedia;


  const mediaUrl =
    "/media/" +
    encodeURI(media.path);


  // ========================================================
  // メディア本体
  // ========================================================

  if (
    media.type === "image"
  ) {

    const image =
      document.createElement("img");


    image.src =
      mediaUrl;


    image.alt =
      media.path;


    image.draggable =
      false;


    modalContent.appendChild(
      image
    );

  } else if (
    media.type === "video"
  ) {

    const video =
      document.createElement("video");


    video.src =
      mediaUrl;


    video.controls =
      true;


    video.autoplay =
      true;


    video.playsInline =
      true;


    modalContent.appendChild(
      video
    );


    video.play().catch(
      error => {

        console.error(
          "Video playback failed:",
          error
        );
      }
    );
  }


  // ========================================================
  // メディア詳細情報
  // ========================================================

  renderMediaInfo();


  // ========================================================
  // 前へ
  // ========================================================

  if (
    currentViewerIndex > 0
  ) {

    const previousButton =
      document.createElement("button");


    previousButton.className =
      "viewer-button viewer-previous";


    previousButton.textContent =
      "‹";


    previousButton.setAttribute(
      "aria-label",
      "前の写真"
    );


    previousButton.addEventListener(
      "click",
      event => {

        event.stopPropagation();

        showPreviousMedia();
      }
    );


    modal.appendChild(
      previousButton
    );
  }


  // ========================================================
  // 次へ
  // ========================================================

  if (
    currentViewerIndex >= 0 &&
    currentViewerIndex <
    viewerMediaList.length - 1
  ) {

    const nextButton =
      document.createElement("button");


    nextButton.className =
      "viewer-button viewer-next";


    nextButton.textContent =
      "›";


    nextButton.setAttribute(
      "aria-label",
      "次の写真"
    );


    nextButton.addEventListener(
      "click",
      event => {

        event.stopPropagation();

        showNextMedia();
      }
    );


    modal.appendChild(
      nextButton
    );
  }
}


/**
 * Viewerの操作メニューを描画
 */
function renderViewerActions() {

  // ========================================================
  // 「⋯」ボタン
  // ========================================================

  const actionsButton =
    document.createElement("button");


  actionsButton.type =
    "button";


  actionsButton.className =
    "viewer-actions-button";


  actionsButton.textContent =
    "⋯";


  actionsButton.setAttribute(
    "aria-label",
    "メディア操作"
  );


  modal.appendChild(
    actionsButton
  );


  // ========================================================
  // 操作メニュー
  // ========================================================

  const menu =
    document.createElement("div");


  menu.className =
    "viewer-actions-menu";


  menu.hidden =
    true;


  // ========================================================
  // ダウンロード
  // ========================================================

  const downloadButton =
    document.createElement("button");


  downloadButton.type =
    "button";


  downloadButton.textContent =
    "↓ ダウンロード";


  downloadButton.addEventListener(
    "click",
    async event => {

      event.stopPropagation();


      if (!currentViewerMedia) {
        return;
      }


      await downloadMedia(
        currentViewerMedia
      );


      menu.hidden =
        true;
    }
  );


  // ========================================================
  // 名前変更
  // ========================================================

  const renameButton =
    document.createElement("button");


  renameButton.type =
    "button";


  renameButton.textContent =
    "✎ 名前変更";


  renameButton.addEventListener(
    "click",
    async event => {

      event.stopPropagation();


      if (!currentViewerMedia) {
        return;
      }


      const result =
        await renameMedia(
          currentViewerMedia
        );


      if (!result) {
        return;
      }


      currentViewerMedia.path =
        result.newPath;


      const currentItem =
        viewerMediaList.find(
          item =>
            item.id === currentViewerMedia.id
        );


      if (currentItem) {
        currentItem.path =
          result.newPath;
      }


      currentViewerMediaInfo =
        null;


      menu.hidden =
        true;


      loadViewerMedia(
        currentViewerMedia
      );
    }
  );


  // ========================================================
  // 削除
  // ========================================================

  const deleteButton =
    document.createElement("button");


  deleteButton.type =
    "button";


  deleteButton.textContent =
    "🗑 削除";


  deleteButton.addEventListener(
    "click",
    async event => {

      event.stopPropagation();


      if (!currentViewerMedia) {
        return;
      }


      const success =
        await deleteMedia(
          currentViewerMedia
        );


      if (!success) {
        return;
      }


      // 削除後は一覧に戻る
      closeModal();
    }
  );


  menu.appendChild(
    downloadButton
  );


  menu.appendChild(
    renameButton
  );


  menu.appendChild(
    deleteButton
  );


  modal.appendChild(
    menu
  );


  // ========================================================
  // メニューボタン
  // ========================================================

  actionsButton.addEventListener(
    "click",
    event => {

      event.stopPropagation();


      menu.hidden =
        !menu.hidden;
    }
  );
}


/**
 * メディア詳細情報を描画
 */
function renderMediaInfo() {

  const existing =
    modalContent.querySelector(
      ".media-details"
    );


  if (existing) {
    existing.remove();
  }


  const detailsContainer =
    document.createElement("div");


  detailsContainer.className =
    "media-details";


  const detailsButton =
    document.createElement("button");


  detailsButton.className =
    "media-details-toggle";


  detailsButton.type =
    "button";


  detailsButton.innerHTML =
    "▼ 詳細情報";


  const mediaInfo =
    document.createElement("div");


  mediaInfo.className =
    "media-info";


  mediaInfo.hidden =
    true;


  const info =
    currentViewerMediaInfo;


  if (!info) {

    mediaInfo.innerHTML = `
      <div>
        詳細情報を取得中...
      </div>
    `;

  } else {

    mediaInfo.innerHTML = `
      <div>
        <strong>ファイル名</strong>
        <span>
          ${escapeHtml(info.name)}
        </span>
      </div>

      <div>
        <strong>ファイルサイズ</strong>
        <span>
          ${formatFileSize(info.fileSize)}
        </span>
      </div>

      <div>
        <strong>撮影日時</strong>
        <span>
          ${formatDateTime(info.takenAt)}
        </span>
      </div>

      <div>
        <strong>更新日時</strong>
        <span>
          ${formatDateTime(info.modifiedAt)}
        </span>
      </div>

      <div>
        <strong>種類</strong>
        <span>
          ${info.type === "image"
        ? "画像"
        : "動画"
      }
        </span>
      </div>
    `;
  }


  detailsButton.addEventListener(
    "click",
    event => {

      event.stopPropagation();


      const isOpen =
        !mediaInfo.hidden;


      mediaInfo.hidden =
        isOpen;


      detailsButton.innerHTML =
        isOpen
          ? "▼ 詳細情報"
          : "▲ 詳細情報";
    }
  );


  detailsContainer.appendChild(
    detailsButton
  );


  detailsContainer.appendChild(
    mediaInfo
  );


  modalContent.appendChild(
    detailsContainer
  );
}


/**
 * 前のメディアを表示
 */
export function showPreviousMedia() {

  if (
    currentViewerIndex <= 0
  ) {
    return;
  }


  currentViewerIndex--;


  const media =
    viewerMediaList[
      currentViewerIndex
    ];


  // 履歴に追加
  history.pushState(
    {
      viewer: true,
      mediaId: media.id,
      viewerHistoryKey
    },
    "",
    "?media=" + media.id
  );


  loadViewerMedia(media);
}


/**
 * 次のメディアを表示
 */
export function showNextMedia() {

  if (
    currentViewerIndex < 0 ||
    currentViewerIndex >=
    viewerMediaList.length - 1
  ) {
    return;
  }


  currentViewerIndex++;


  const media =
    viewerMediaList[
      currentViewerIndex
    ];


  // 履歴に追加
  history.pushState(
    {
      viewer: true,
      mediaId: media.id,
      viewerHistoryKey
    },
    "",
    "?media=" + media.id
  );


  loadViewerMedia(media);
}


/**
 * 日時を表示用に変換
 */
export function formatDateTime(
  dateValue
) {

  if (
    dateValue === null ||
    dateValue === undefined ||
    dateValue === ""
  ) {

    return "記録されていません";
  }


  const date =
    new Date(dateValue);


  if (
    Number.isNaN(
      date.getTime()
    )
  ) {

    return String(dateValue);
  }


  return date.toLocaleString(
    "ja-JP"
  );
}


/**
 * ファイルサイズを表示用に変換
 */
export function formatFileSize(
  bytes
) {

  if (
    !Number.isFinite(bytes) ||
    bytes < 0
  ) {

    return "不明";
  }


  if (
    bytes < 1024
  ) {

    return bytes + " B";
  }


  if (
    bytes < 1024 * 1024
  ) {

    return (
      (bytes / 1024).toFixed(1) +
      " KB"
    );
  }


  if (
    bytes <
    1024 * 1024 * 1024
  ) {

    return (
      (bytes / (1024 * 1024)).toFixed(1) +
      " MB"
    );
  }


  return (
    (bytes / (1024 * 1024 * 1024)).toFixed(2) +
    " GB"
  );
}


/**
 * HTMLに安全に表示する
 */
function escapeHtml(
  value
) {

  return String(value)
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    )
    .replaceAll(
      '"',
      "&quot;"
    )
    .replaceAll(
      "'",
      "&#039;"
    );
}


/**
 * モーダルを閉じる
 */
export function closeModal(
  updateHistory = true
) {

  // ×、Escape、背景クリックなど
  // ユーザー操作による閉じる処理
  if (updateHistory) {

    // URLだけ一覧状態に戻す
    history.replaceState(
      null,
      "",
      window.location.pathname
    );
  }


  modalContent.innerHTML =
    "";


  modal
    .querySelectorAll(
      ".viewer-button"
    )
    .forEach(button => {
      button.remove();
    });


  modal
    .querySelectorAll(
      ".viewer-actions-button, .viewer-actions-menu"
    )
    .forEach(element => {
      element.remove();
    });


  modal.classList.remove(
    "active"
  );


  document.body.style.overflow =
    "";


  currentViewerMedia =
    null;


  currentViewerMediaInfo =
    null;


  currentViewerIndex =
    -1;


  viewerMediaList =
    [];


  viewerHistoryKey =
    null;
}