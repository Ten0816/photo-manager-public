import {
  modal,
  modalContent,
  modalClose
} from "./dom.js";

let currentViewerMedia = null;

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

  renderViewer();

  modal.classList.add("active");

  // 背景ページをスクロールさせない
  document.body.style.overflow = "hidden";
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
  // EXIF
  // ========================================================

  const exifInfo =
    document.createElement("div");

  exifInfo.className =
    "exif-info";


  const takenAt =
    formatTakenAt(
      media.taken_at
    );


  const gps =
    media.latitude !== null &&
      media.longitude !== null
      ? `${media.latitude}, ${media.longitude}`
      : "記録されていません";


  exifInfo.innerHTML = `
        <div>
            <strong>撮影日時</strong>
            ${takenAt}
        </div>

        <div>
            <strong>GPS</strong>
            ${gps}
        </div>
    `;


  modalContent.appendChild(
    exifInfo
  );


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
 * 前のメディアを表示
 */
export function showPreviousMedia() {

  if (
    currentViewerIndex <= 0
  ) {
    return;
  }

  currentViewerIndex--;

  currentViewerMedia =
    viewerMediaList[
    currentViewerIndex
    ];

  renderViewer();
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

  currentViewerMedia =
    viewerMediaList[
    currentViewerIndex
    ];

  renderViewer();
}


/**
 * 撮影日時を表示用に変換
 */
export function formatTakenAt(
  dateString
) {

  if (!dateString) {
    return "記録されていません";
  }

  const date =
    new Date(dateString);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return dateString;
  }

  return date.toLocaleString(
    "ja-JP"
  );
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

  currentViewerIndex = -1;

  viewerMediaList = [];
}