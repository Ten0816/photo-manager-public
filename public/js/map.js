let map;
let markerCluster;

/**
 * 地図を初期化
 */
function initializeMap() {
    map = L.map("map").setView(
        [34.3853, 132.4553],
        10
    );

    L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
            maxZoom: 19,
            attribution:
                '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        }
    ).addTo(map);

    /*
     * マーカークラスターを作成
     */
    markerCluster = L.markerClusterGroup({
        showCoverageOnHover: false,
        maxClusterRadius: 50
    });

    map.addLayer(markerCluster);
}


/**
 * GPS情報を持つメディアを取得
 */
async function loadMediaLocations() {
    try {
        const response =
            await fetch("/api/media/locations");

        if (!response.ok) {
            throw new Error(
                `HTTP ${response.status}`
            );
        }

        const data =
            await response.json();

        displayMarkers(data.media);

    } catch (error) {
        console.error(
            "撮影場所の取得に失敗しました:",
            error
        );
    }
}


/**
 * 撮影場所を地図に表示
 */
function displayMarkers(mediaList) {
    const bounds = [];

    for (const media of mediaList) {

        if (
            media.latitude === null ||
            media.longitude === null
        ) {
            continue;
        }

        const latitude = media.latitude;
        const longitude = media.longitude;

        /*
         * サムネイルURL
         */
        const thumbnailUrl =
            `/api/thumbnail?path=${encodeURIComponent(media.path)}`;

        /*
         * 写真マーカー
         */
        const icon =
            L.divIcon({
                className: "photo-marker",

                html: `
                    <img
                        src="${thumbnailUrl}"
                        alt=""
                    >
                `,

                iconSize: [56, 56],
                iconAnchor: [28, 28],
                popupAnchor: [0, -28]
            });

        const marker =
            L.marker(
                [latitude, longitude],
                {
                    icon: icon
                }
            );

        /*
         * ポップアップ
         */
        marker.bindPopup(`
            <div class="photo-popup">

                <img
                    src="${thumbnailUrl}"
                    alt=""
                    class="popup-thumbnail"
                >

                <div class="photo-popup-info">

                    <strong>
                        ${escapeHtml(media.path)}
                    </strong>

                    <br>

                    撮影日時:
                    ${formatDate(media.taken_at)}

                    <br>
                    <br>

                    <a
                        href="/media/${encodeURI(media.path)}"
                        target="_blank"
                    >
                        写真を開く
                    </a>

                </div>

            </div>
        `);

        /*
         * クラスタへ追加
         */
        markerCluster.addLayer(marker);

        bounds.push([
            latitude,
            longitude
        ]);
    }

    /*
     * 全撮影地点が画面に入るようにする
     */
    if (bounds.length > 0) {

        map.fitBounds(
            bounds,
            {
                padding: [30, 30]
            }
        );
    }
}


/**
 * 日付を表示用に変換
 */
function formatDate(dateString) {

    if (!dateString) {
        return "不明";
    }

    const date =
        new Date(dateString);

    if (Number.isNaN(date.getTime())) {
        return dateString;
    }

    return date.toLocaleString(
        "ja-JP"
    );
}


/**
 * HTMLエスケープ
 */
function escapeHtml(value) {

    if (
        value === null ||
        value === undefined
    ) {
        return "";
    }

    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}


/*
 * 起動
 */
initializeMap();
loadMediaLocations();