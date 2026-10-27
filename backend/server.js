const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const app = express();
const PORT = process.env.PORT || 3001;

// Compression for smaller, faster responses (text/JSON API bodies).
app.use(require('compression')());

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));

// Request timeout middleware — prevents slow Google API calls from holding
// connections open forever.
app.use((req, res, next) => {
  const timeoutMs = Number(process.env.REQUEST_TIMEOUT_MS) || 25000;
  const timer = setTimeout(() => {
    if (!res.headersSent) {
      res.status(504).json({ ok: false, error: 'Request timed out.' });
    }
  }, timeoutMs);
  res.on('finish', () => clearTimeout(timer));
  res.on('close', () => clearTimeout(timer));
  next();
});

// Hide Express fingerprint and set security headers.
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

// Rate limiting: 60 requests per minute per IP for sync-sheet/feedback,
// 30 per minute for everything else. Prevents abuse and protects the
// Google Sheets API quota.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { ok: false, error: 'Too many requests — please slow down.' },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', apiLimiter);

let sheetsClientPromise = null;
let sheetMetadataCache = null;
let sheetMetadataCacheTs = 0;
const SHEET_METADATA_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getSheetsClient() {
  // Build the auth client once and reuse it. GoogleAuth auto-refreshes its
  // access token, so one client is safe across requests and avoids re-parsing
  // the key + resolving a token on every sync. Config/auth errors throw before
  // assignment below, so failures are never cached and the next request retries.
  if (sheetsClientPromise) return sheetsClientPromise;
  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;
  const sheetId = process.env.GOOGLE_SHEET_ID;

  if (!serviceAccountEmail || !privateKey || !sheetId) {
    throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, or GOOGLE_SHEET_ID in environment variables.');
  }

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: serviceAccountEmail,
      private_key: privateKey.replace(/\\n/g, '\n')
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  const authClient = await auth.getClient();
  sheetsClientPromise = google.sheets({ version: 'v4', auth: authClient });
  return sheetsClientPromise;
}

// Nodemailer transporter: create once, reuse across requests. nodemailer pools
// connections internally, so recreating it per feedback POST wastes TCP/TLS
// handshakes on every submission.
let smtpTransporter = null;
function getSmtpTransporter() {
  if (!smtpTransporter) {
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = Number(process.env.SMTP_PORT) || 465;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    if (smtpHost && smtpUser && smtpPass) {
      smtpTransporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: { user: smtpUser, pass: smtpPass }
      });
    }
  }
  return smtpTransporter;
}

// Cache sheet metadata (tab existence) so repeated syncs/feedback don't
// re-fetch the spreadsheet metadata from Google on every request.
async function getSheetMetadata(sheets, sheetId) {
  const now = Date.now();
  if (sheetMetadataCache && sheetMetadataCache.sheetId === sheetId &&
      now - sheetMetadataCacheTs < SHEET_METADATA_TTL_MS) {
    return sheetMetadataCache.data;
  }
  const metadata = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  sheetMetadataCache = { sheetId, data: metadata.data };
  sheetMetadataCacheTs = now;
  return metadata.data;
}

// Every submission (scouting sync or feedback) is also logged to the owner's
// master sheet with a timestamp, so there is one central record of all activity.
const MASTER_SHEET_ID = "1n7MW_vDB0YjMaOsVXrfgkX3Q1RGJ1oYcQdsymsgveCE";
const MASTER_SHEET_NAME = "Submissions";

async function logSubmissionToMaster(sheets, source, details) {
  if (!MASTER_SHEET_ID) return;
  try {
    const metadata = await getSheetMetadata(sheets, MASTER_SHEET_ID);
    const exists = (metadata.sheets || []).some((s) => s.properties && s.properties.title === MASTER_SHEET_NAME);
    if (!exists) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: MASTER_SHEET_ID,
        requestBody: {
          requests: [{
            addSheet: {
              properties: {
                title: MASTER_SHEET_NAME,
                sheetType: 'GRID',
                gridProperties: { rowCount: 1000, columnCount: 20 }
              }
            }
          }]
        }
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId: MASTER_SHEET_ID,
        range: `${MASTER_SHEET_NAME}!A1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [['Timestamp', 'Source', 'Details']]
        }
      });
    }
    await sheets.spreadsheets.values.append({
      spreadsheetId: MASTER_SHEET_ID,
      range: `${MASTER_SHEET_NAME}!A1`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[new Date().toISOString(), source, JSON.stringify(details).slice(0, 1000)]]
      }
    });
  } catch (err) {
    // Never fail the user's request because the master log couldn't be written.
    console.error('master submission log failed:', err);
  }
}

const STARTED_AT = new Date().toISOString();

app.get('/health', (req, res) => {
  res.json({ ok: true, status: 'backend running', startedAt: STARTED_AT });
});

app.post('/api/sync-sheet', async (req, res) => {
  try {
    const payload = req.body || {};
    const row = Array.isArray(payload.row)
      ? payload.row
      : Object.values(payload.data || {});

    if (!row.length) {
      return res.status(400).json({ ok: false, error: 'Missing row data.' });
    }

    const sheetId = payload.sheetId || process.env.GOOGLE_SHEET_ID;
    const sheetName = payload.sheetName || process.env.SHEET_NAME || 'Scouting';
    const startColumn = (payload.startColumn || 'A').toUpperCase();

    if (!sheetId) {
      return res.status(400).json({ ok: false, error: 'Missing sheetId.' });
    }

    const sheets = await getSheetsClient();
    const metadata = await getSheetMetadata(sheets, sheetId);
    const exists = (metadata.sheets || []).some((sheet) => sheet.properties && sheet.properties.title === sheetName);

    if (!exists) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: {
          requests: [{
            addSheet: {
              properties: {
                title: sheetName,
                sheetType: 'GRID',
                gridProperties: { rowCount: 1000, columnCount: 50 }
              }
            }
          }]
        }
      });
      // Invalidate metadata cache since we just added a sheet.
      sheetMetadataCache = null;
      sheetMetadataCacheTs = 0;
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${sheetName}!${startColumn}1`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [row]
      }
    });

    // Log every scouting sync to the master sheet with a timestamp.
    await logSubmissionToMaster(sheets, 'scouting-sync', { sheetId, sheetName, rowCount: row.length });

    return res.json({
      ok: true,
      status: 'Row appended successfully.',
      sheetId,
      sheetName,
      rowsAppended: row.length
    });
  } catch (error) {
    console.error('sync-sheet failed:', error);
    return res.status(500).json({
      ok: false,
      error: error && error.message ? error.message : String(error)
    });
  }
});

// Optional SMTP delivery: when the SMTP_* variables are configured the backend
// also emails feedback directly. Free web relays (FormSubmit/Web3Forms) block
// server-side calls from cloud IPs, so by default the browser emails the
// owner — see emailFeedbackToOwner in assets/js/app.js. This address is
// assembled from parts so scrapers can't harvest it from this public repo.
const DEFAULT_FEEDBACK_EMAIL = ['rileyhh2901', '@', 'gmail.com'].join('');
app.post('/api/feedback', async (req, res) => {
  try {
    const payload = req.body || {};
    const name = typeof payload.name === 'string' ? payload.name.trim().slice(0, 100) : '';
    const teamNumber = typeof payload.teamNumber === 'string' ? payload.teamNumber.trim().slice(0, 20) : '';
    const email = typeof payload.email === 'string' ? payload.email.trim().slice(0, 200) : '';
    const feedback = typeof payload.feedback === 'string' ? payload.feedback.trim() : '';

    // Honeypot: humans never see this field. If it's filled, it's a bot —
    // pretend success so the bot doesn't learn, but send nothing.
    if (typeof payload.website === 'string' && payload.website.trim() !== '') {
      return res.json({ ok: true, status: 'Feedback received. Thank you!' });
    }

    if (!feedback) {
      return res.status(400).json({ ok: false, error: 'Feedback text is required.' });
    }
    if (feedback.length > 5000) {
      return res.status(400).json({ ok: false, error: 'Feedback is too long (max 5000 characters).' });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ ok: false, error: 'Email address looks invalid.' });
    }

    // Two delivery paths. The sheet path uses the service account that is
    // already configured for scouting sync, so feedback works with no extra
    // setup. The email path is optional and only runs when SMTP is set up.
    let savedToSheet = false;
    let emailed = false;
    const problems = [];

    const sheetId = process.env.GOOGLE_SHEET_ID;
    const sheetName = process.env.FEEDBACK_SHEET_NAME || 'Feedback';
    if (sheetId) {
      try {
        const sheets = await getSheetsClient();
        const metadata = await getSheetMetadata(sheets, sheetId);
        const exists = (metadata.sheets || []).some((sheet) => sheet.properties && sheet.properties.title === sheetName);

        if (!exists) {
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId: sheetId,
            requestBody: {
              requests: [{
                addSheet: {
                  properties: {
                    title: sheetName,
                    sheetType: 'GRID',
                    gridProperties: { rowCount: 1000, columnCount: 10 }
                  }
                }
              }]
            }
          });
          await sheets.spreadsheets.values.update({
            spreadsheetId: sheetId,
            range: `${sheetName}!A1`,
            valueInputOption: 'RAW',
            requestBody: {
              values: [['Timestamp', 'Name', 'Team number', 'Email', 'Feedback']]
            }
          });
          // Invalidate metadata cache since we just added a sheet.
          sheetMetadataCache = null;
          sheetMetadataCacheTs = 0;
        }

        await sheets.spreadsheets.values.append({
          spreadsheetId: sheetId,
          range: `${sheetName}!A1`,
          valueInputOption: 'RAW',
          insertDataOption: 'INSERT_ROWS',
          requestBody: {
            values: [[new Date().toISOString(), name, teamNumber, email, feedback]]
          }
        });
        savedToSheet = true;

        // Log every feedback submission to the master sheet with a timestamp.
        await logSubmissionToMaster(sheets, 'feedback', { name, teamNumber, email, feedback });
      } catch (sheetError) {
        console.error('feedback sheet append failed:', sheetError);
        problems.push(`sheet: ${sheetError && sheetError.message ? sheetError.message : String(sheetError)}`);
      }
    }

    const toEmail = process.env.FEEDBACK_TO_EMAIL || DEFAULT_FEEDBACK_EMAIL;
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = Number(process.env.SMTP_PORT) || 465;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;

    const emailSubject = `QR Scout feedback${teamNumber ? ` — team ${teamNumber}` : ''}${name ? ` from ${name}` : ''}`;
    const emailFields = {
      name: name || '(not provided)',
      teamNumber: teamNumber || '(not provided)',
      email: email || '(not provided)',
      feedback
    };

    const text = [
      `Name: ${emailFields.name}`,
      `Team number: ${emailFields.teamNumber}`,
      `Email: ${emailFields.email}`,
      '',
      'Feedback:',
      feedback
    ].join('\n');

    try {
      const transporter = getSmtpTransporter();
      if (transporter) {
        await transporter.sendMail({
          from: `"QR Scout Feedback" <${smtpUser}>`,
          to: toEmail,
          replyTo: email || undefined,
          subject: emailSubject,
          text
        });
        emailed = true;
      }
    } catch (mailError) {
      console.error('feedback email failed:', mailError);
      problems.push(`email: ${mailError && mailError.message ? mailError.message : String(mailError)}`);
    }

    if (savedToSheet || emailed) {
      const how = emailed ? 'emailed to the site owner' : 'saved to the Feedback tab in your Google Sheet';
      const responseBody = { ok: true, status: `Feedback received (${how}). Thank you!` };
      // Diagnostic only (the form UI ignores extra fields): tells the caller
      // why a delivery path failed, since Render logs aren't always at hand.
      if (problems.length) responseBody.note = problems.join('; ');
      return res.json(responseBody);
    }

    return res.status(500).json({
      ok: false,
      error: problems.length
        ? `Could not deliver feedback — ${problems.join('; ')}`
        : 'Feedback is not configured on the server yet: set GOOGLE_SHEET_ID (saves to a Feedback tab) and/or the SMTP_* variables (sends an email).'
    });
  } catch (error) {
    console.error('feedback failed:', error);
    return res.status(500).json({
      ok: false,
      error: error && error.message ? error.message : String(error)
    });
  }
});

app.listen(PORT, () => {
  console.log(`QR Scout backend listening on http://localhost:${PORT}`);
});