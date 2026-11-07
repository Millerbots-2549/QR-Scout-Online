// QR Scout Online — desktop shell.
// Loads the full web app from the repository root (index.html + assets/).
// The app is file-based (bundled locally) but can access the internet for
// Google Sheets sync, feedback, and update checks.
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

// Shared logo — the same artwork the website uses (assets/images).
const APP_ICON = path.join(__dirname, '..', 'assets', 'images', 'millerbot-orange.png');

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 420,
    minHeight: 500,
    autoHideMenuBar: true,
    backgroundColor: '#0d1320',
    icon: APP_ICON,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.setMenuBarVisibility(false);

  // Links that target a new window (e.g. external pages) open in the
  // user's default browser instead of a second app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Load the full web app (bundled locally, works offline for scouting;
  // internet access available for Google Sheets sync and updates)
  const appHtmlPath = app.isPackaged
    ? path.join(process.resourcesPath, 'index.html')
    : path.join(__dirname, '..', 'index.html');
  win.loadFile(appHtmlPath);
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    // macOS: re-open a window when the dock icon is clicked.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
