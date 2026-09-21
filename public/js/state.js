export let currentFolder = "";

export let currentPage = 1;

export const pageSize = 100;

export let isLoading = false;

export let hasMore = true;


// ==============================
// メディアソート
// ==============================

export let mediaSort = "date-desc";


export function setCurrentFolder(folder) {

    currentFolder = folder;

}


export function resetMediaState() {

    currentPage = 1;

    hasMore = true;

}


export function setIsLoading(value) {

    isLoading = value;

}


export function setHasMore(value) {

    hasMore = value;

}


export function nextPage() {

    currentPage++;

}


export function setMediaSort(value) {

    mediaSort = value;

}