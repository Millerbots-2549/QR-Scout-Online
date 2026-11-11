# QR Scout Online

QR Scout Online is a browser-based scouting app for FIRST Robotics Competition (FRC) teams. The hosted Fieldnotes site lets scouts fill out a configurable match form, save entries on their device, create QR-code backups, and sync rows to their own Google Sheet. It includes a feedback form and an installable PWA.

## Using the hosted site (no setup)

The easiest way to use QR Scout Online is the deployed site. You do not need to run or host anything yourself.

1. Create a Google Sheet.
2. Share it with the app's service account (`frc-scout@frc-scout-511222.iam.gserviceaccount.com`) as an **Editor**.
3. The default scouting form is ready on the **Scout** page. To customize it, select **Edit JSON** beside **Commit**; load or edit a config and choose **Apply config**.
4. Open **Google Sheets sync settings** below the form actions. Paste the Sheet ID (the part of the sheet URL between `/d/` and `/edit`), set the tab and starting column, then select **Save sheet**.
5. Fill out the form and select **Commit**. Choose **Save to device**, **Generate QR code**, or **Sync to sheet**. Sync appends the match row to your spreadsheet.

Matches are stored in the browser on that device. Offline sync attempts are queued for retry when the device reconnects. Use **JSON backup**, **Import JSON**, or **Export CSV** to transfer or archive match data. Feedback sent from the **Feedback** page goes to the site owner, not to your scouting sheet.

## How it works

- The Fieldnotes website is static and is published from the repository root on GitHub Pages. It can also be installed as a PWA where supported.
- A small Node.js backend receives scouting entries and feedback. The deployed copy runs on Render.
- **Scouting:** each scout enters the ID of their own Google Sheet and shares it with the backend's service account (as an Editor). The backend appends one row per entry to that sheet, so nobody ever shares a Google password with the app.
- **Feedback:** submissions are saved to a `Feedback` tab in the site owner's sheet and can be emailed when SMTP is configured.
- The backend also keeps a central master log of every submission (scouting + feedback) in a `Submissions` tab of the owner's master sheet.
- QR codes and the offline outbox let you keep or transfer entries when you have no connection. Browser storage is local to each device.
- Configurable forms: the scouting config is a JSON file describing sections and fields. Edit it from the Scout page or import/export config and match JSON files.

The website and the backend are separate deployments. Hosting the website does not start the backend. The Scout page sends sheet sync requests to `/api/sync-sheet`; the Feedback page sends feedback to `/api/feedback`.

## Run the backend locally (self-hosting)

You need Node.js and npm installed.

1. Install the project dependencies from the repository root:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in the Google Sheets settings described below.

3. Start the backend:

   ```bash
   npm start
   ```

By default, the API listens at `http://localhost:3001`. Check that it is running at `http://localhost:3001/health`.

### Google Sheets setup

1. In Google Cloud, create or choose a project and enable the Google Sheets API.
2. Create a service account and a JSON key for it.
3. Share the spreadsheet with the service account email and give it Editor access.
4. Put the spreadsheet ID and service account credentials in the root `.env` file:

   ```env
   PORT=3001
   GOOGLE_SHEET_ID=your_google_sheet_id
   GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@your-project.iam.gserviceaccount.com
   GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY_HERE\n-----END PRIVATE KEY-----\n"
   SHEET_NAME=Scouting
   ```

Keep `.env` and the service-account key private. Do not commit credentials to the repository. The backend creates the scouting tab in a scout's own sheet if it does not already exist. The tab name defaults to `Scouting` and can be changed with `SHEET_NAME`. Note that `GOOGLE_SHEET_ID` here is the *owner's* sheet used for the `Feedback` tab and the central submission log; scouting entries are written to whatever sheet ID the scout submits. See `.env.example` for the optional feedback settings (`FEEDBACK_SHEET_NAME`, `FEEDBACK_TO_EMAIL`, and the `SMTP_*` values).

## Run the website locally

The site is a static website. Serve the repository root with a local web server and open the address it provides. Do not open `index.html` directly as a `file://` URL; browser requests and app features need an HTTP or HTTPS origin.

The site currently uses the hosted backend at `https://qr-scout-online.onrender.com`.

## Deploy

1. Push changes to the configured GitHub Pages branch to publish the repository-root site.
2. Deploy the Node.js backend separately using a host that supports Node.js.
3. Configure the backend environment variables on that host and make sure its service account can edit the target spreadsheet.

The backend provides `GET /health`, `POST /api/sync-sheet`, and `POST /api/feedback` routes. The feedback route writes to a `Feedback` tab by default and can send email directly when the `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, and `SMTP_PASS` settings are present. The feedback form and sheet sync require access to the hosted backend.

## Desktop and mobile apps

The repository includes installable app shells:

- **Desktop:** The Electron app is in `app/`; existing release builds are linked from the Apps page. Those published packages are the QR Scout prototype builds and are not rebuilt when the Fieldnotes website changes.
- **Android and iOS:** Capacitor project files. The mobile shell is offline-only: it loads a self-contained scouting page bundled in `mobile/www` (QR codes only, no network access). The Android project is pre-generated in `android/`; the iOS project is generated during CI via `npx cap add ios`. The top-level npm scripts include `npm run mobile:android` and `npm run mobile:ios` to sync the web assets into those projects; you still need the platform's development tools to build them.
- **Release builds:** `.github/workflows/build-apps.yml` builds desktop packages (Windows zip x64/arm64, macOS dmg/zip x64/arm64, Linux AppImage/deb x64/arm64) and mobile packages when run manually or when a `v*` tag is pushed. The Android/iOS jobs are `continue-on-error`. Builds are unsigned, so operating systems may show a security warning and mobile installs may require sideloading.

## Useful files

- `index.html`, `scout.html`, `guide.html`, `apps.html`, and `feedback.html`  website pages
- `scout.js`, `site.js`, and `sw.js`  scouting logic, PWA install support, and offline shell
- `backend/server.js`  API server and Google Sheets integration
- `.env.example`  example backend configuration (no real credentials)
- `app/`  Electron desktop app
- `android/`, `mobile/`, and `capacitor.config.js`  Capacitor mobile app shells (iOS project generated in CI)
- `sw.js` and `manifest.webmanifest`  PWA service worker and manifest
- `.github/workflows/build-apps.yml`  app build workflow
- `.github/workflows/pages.yml`  GitHub Pages deployment workflow