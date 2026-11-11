(() => {
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
