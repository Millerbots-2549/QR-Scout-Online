(() => {
  const themeToggle = document.getElementById("theme-toggle");
  if (themeToggle) {
    const updateTheme = (theme) => {
      const dark = theme === "dark";
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      themeToggle.setAttribute("aria-pressed", String(dark));
      themeToggle.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
      themeToggle.querySelector(".theme-toggle-icon").textContent = dark ? "☀" : "☾";
      themeToggle.querySelector(".theme-toggle-label").textContent = dark ? "Light mode" : "Dark mode";
      document.querySelector('meta[name="theme-color"]').content = dark ? "#0c1823" : "#e8f5ff";
    };

    updateTheme(document.documentElement.dataset.theme);
    themeToggle.addEventListener("click", () => {
      const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      updateTheme(nextTheme);
      try {
        localStorage.setItem("qr-scout-theme", nextTheme);
      } catch (error) {
        console.error("Could not save the theme preference.", error);
      }
    });
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch((error) => {
        console.error("Could not register the offline app shell.", error);
      });
    });
  }

  const installButton = document.getElementById("pwaInstallBtn");
  const installHint = document.getElementById("pwaInstallHint");
  let deferredPrompt = null;

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    if (installButton) installButton.hidden = false;
  });

  if (installButton) {
    installButton.addEventListener("click", async () => {
      if (!deferredPrompt) return;
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      installButton.hidden = true;
    });
  }

  if (window.matchMedia?.("(display-mode: standalone)").matches && installHint) {
    installHint.textContent = "QR Scout Docs is installed on this device.";
  }
})();
