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
  const isStandalone = window.matchMedia?.("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    if (installButton) {
      installButton.hidden = false;
      installButton.style.display = "inline-flex";
      installButton.disabled = false;
    }
    if (installHint) installHint.textContent = "This browser can install QR Scout Docs.";
  });

  if (installButton) {
    installButton.addEventListener("click", async () => {
      if (!deferredPrompt) {
        if (installHint) installHint.textContent = "This browser has no install prompt available. Use the browser menu to install the site.";
        return;
      }

      const promptEvent = deferredPrompt;
      installButton.disabled = true;
      try {
        await promptEvent.prompt();
        const { outcome } = await promptEvent.userChoice;
        if (outcome === "accepted") {
          if (installHint) installHint.textContent = "QR Scout Docs is being installed.";
        } else if (installHint) {
          installHint.textContent = "Installation was canceled. You can try again from the browser menu.";
        }
      } catch (error) {
        console.error("Could not start app installation.", error);
        if (installHint) installHint.textContent = "Could not start installation. Use the browser menu to install QR Scout Docs.";
      } finally {
        deferredPrompt = null;
        installButton.hidden = true;
        installButton.style.display = "none";
        installButton.disabled = false;
      }
    });
  }

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    if (installButton) {
      installButton.hidden = true;
      installButton.style.display = "none";
    }
    if (installHint) installHint.textContent = "QR Scout Docs is installed on this device.";
  });

  if (isStandalone) {
    if (installButton) {
      installButton.hidden = true;
      installButton.style.display = "none";
    }
    if (installHint) installHint.textContent = "QR Scout Docs is installed on this device.";
  } else if (installButton && installHint && !deferredPrompt) {
    installHint.textContent = "If the Install app button does not appear, use the browser menu to install QR Scout Docs.";
  }
})();
