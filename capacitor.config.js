/** @type {import('@capacitor/cli').CapacitorConfig} */

// QR Scout Online — mobile shell (Android + iOS).
// Loads a fully offline, self-contained scouting page bundled in mobile/www
// (see mobile/www/index.html). It uses only QR codes — no network access — so
// it works with no Wi-Fi at competitions, exactly like the Electron desktop
// shell in app/main.js.
const config = {
  appId: 'com.homegrowncode.qrscout',
  appName: 'QR Scout',
  webDir: 'mobile/www',
  android: {
    allowMixedContent: false
  },
  ios: {
    allowsLinkPreview: false
  }
};

module.exports = config;
