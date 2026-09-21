import {
  modal,
  modalContent,
  modalClose
} from "./dom.js";

let currentViewerMedia = null;

let currentViewerMediaInfo = null;

let currentViewerIndex = -1;

let viewerMediaList = [];

let touchStartX = 0;

let touchStartY = 0;


/**
 * メディアビューアを初期化
 */
export function initViewer() {

  // 閉じるボタン
  modalClose.addEventListener(
    "click",
    closeModal
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

  modal.classList.add("active");

  loadViewerMedia(media);

  // 背景ページをスクロールさせない
  document.body.style.overflow = "hidden";
}


/**
 * メディア詳細情報を取得
 */
async function fetchMediaInfo(media) {

  try {

    const response =
      await fetch(
        "/api/media-info?path=" +
        encodeURIComponent(media.path)
      );

    if (!response.ok) {
      throw new Error(
        "Media info request failed: " +
        response.status
      );
    }

    return await response.json();

  } catch (error) {

    console.error(
      "メディア詳細情報の取得に失敗しました:",
      error
    );

    return null;
  }
}


/**
 * ビューアのメディアを切り替える
 */
async function loadViewerMedia(media) {
  currentViewerMedia = media;
  currentViewerMediaInfo = null;

  renderViewer();

  const info =
    await fetchMediaInfo(media);

  if (
    currentViewerMedia?.id !== media.id
  ) {
    return;
  }

  currentViewerMediaInfo = info;

  renderMediaInfo();
}


/**
 * ビューアを描画
 */
export function renderViewer() {

  if (!currentViewerMedia) {
    return;
  }

  modalContent.innerHTML = "";

  // 前回作成したナビゲーションボタンを削除
  modal
    .querySelectorAll(".viewer-button")
    .forEach(button => {
      button.remove();
    });


  const media =
    currentViewerMedia;


  const mediaUrl =
    "/media/" +
    encodeURI(media.path);


  // ========================================================
  // メディア本体
  // ========================================================

  if (media.type === "image") {

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

  } else if (media.type === "video") {

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

  if (currentViewerIndex > 0) {

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
          ${
            info.type === "image"
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
  if (currentViewerIndex <= 0) {
    return;
  }

  currentViewerIndex--;

  const media =
    viewerMediaList[
    currentViewerIndex
    ];

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


  if (bytes < 1024) {
    return bytes + " B";
  }


  if (bytes < 1024 * 1024) {
    return (
      (bytes / 1024).toFixed(1) +
      " KB"
    );
  }


  if (bytes < 1024 * 1024 * 1024) {
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
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


/**
 * モーダルを閉じる
 */
export function closeModal() {

  modalContent.innerHTML = "";

  modal
    .querySelectorAll(".viewer-button")
    .forEach(button => {
      button.remove();
    });

  modal.classList.remove(
    "active"
  );

  document.body.style.overflow =
    "";

  currentViewerMedia = null;

  currentViewerMediaInfo = null;

  currentViewerIndex = -1;

  viewerMediaList = [];
}