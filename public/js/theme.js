const themeToggleButton =
    document.getElementById(
        "theme-toggle-button"
    );

const themeToggleIcon =
    document.getElementById(
        "theme-toggle-icon"
    );

const themeToggleText =
    document.getElementById(
        "theme-toggle-text"
    );


function updateThemeButton() {

    const isDark =
        document.body.classList.contains(
            "dark-mode"
        );

    if (isDark) {

        themeToggleIcon.textContent =
            "☀";

        themeToggleText.textContent =
            "ライトモード";

    } else {

        themeToggleIcon.textContent =
            "☾";

        themeToggleText.textContent =
            "ナイトモード";
    }
}


function toggleTheme() {

    document.body.classList.toggle(
        "dark-mode"
    );

    updateThemeButton();
}


themeToggleButton.addEventListener(
    "click",
    toggleTheme
);


updateThemeButton();