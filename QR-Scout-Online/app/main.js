// Fieldnotes desktop shell.
const { app, BrowserWindow, protocol, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const APP_ROOT = app.isPackaged
  ? process.resourcesPath
  : path.resolve(__dirname, '..', '..');
const APP_ICON = path.join(APP_ROOT, 'assets', 'images', 'icon-512.png');
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json'
};

protocol.registerSchemesAsPrivileged([{
  scheme: 'fieldnotes',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    allowServiceWorkers: true
  }
}]);

async function serveAppFile(request) {
  let filePath;
  try {
    const requestPath = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '') || 'index.html';
    filePath = path.resolve(APP_ROOT, requestPath);
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  const relativePath = path.relative(APP_ROOT, filePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return new Response('Forbidden', { status: 403 });
  }

  try {
    const body = await fs.readFile(filePath);
    return new Response(body, {
      headers: { 'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream' }
    });
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') return new Response('Not found', { status: 404 });
    throw error;
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 420,
    minHeight: 500,
    autoHideMenuBar: true,
    backgroundColor: '#101311',
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
  win.loadURL('fieldnotes://app/index.html');
}

app.whenReady().then(() => {
  protocol.handle('fieldnotes', serveAppFile);
  createWindow();
  app.on('activate', () => {
    // macOS: re-open a window when the dock icon is clicked.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
