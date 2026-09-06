(function () {
  "use strict";

  const root = document.documentElement;
  const storageKey = "fritschelab-theme";
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
  let preference = null;
  let toggle;

  function validPreference(value) {
    return value === "light" || value === "dark" ? value : null;
  }

  try {
    preference = validPreference(window.localStorage.getItem(storageKey));
  } catch (_error) {
  }

  function applyTheme() {
    const theme = preference || (systemTheme.matches ? "dark" : "light");
    root.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === "dark" ? "#0d1926" : "#ffffff";
    if (toggle) {
      const dark = theme === "dark";
      toggle.setAttribute("aria-pressed", String(dark));
      toggle.title = "Switch to " + (dark ? "light" : "dark") + " theme";
    }
    window.dispatchEvent(new CustomEvent("themechange", { detail: { theme: theme } }));
  }

  applyTheme();
  systemTheme.addEventListener("change", function () {
    if (!preference) applyTheme();
  });
  window.addEventListener("storage", function (event) {
    if (event.key !== storageKey && event.key !== null) return;
    preference = validPreference(event.newValue);
    applyTheme();
  });

  document.addEventListener("DOMContentLoaded", function () {
    toggle = document.querySelector("[data-theme-toggle]");
    if (!toggle) return;
    applyTheme();
    toggle.hidden = false;
    toggle.addEventListener("click", function () {
      preference = root.dataset.theme === "dark" ? "light" : "dark";
      try {
        window.localStorage.setItem(storageKey, preference);
      } catch (_error) {
      }
      applyTheme();
    });
  });
})();
