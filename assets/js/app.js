(() => {
  // Resolve an element by id. If it's missing (e.g. a stale index.html served
  // against this script), return a harmless no-op stub instead of null so that
  // chained calls like $(el).classList.add(...) never throw and break routing.
  // Lookups are cached so repeated $(id) calls don't re-query the DOM or rebuild
  // the Proxy stub every time.
  const elementCache = new Map();
  const $ = (id) => {
    if (elementCache.has(id)) return elementCache.get(id);
    const el = document.getElementById(id);
    if (el) {
      elementCache.set(id, el);
      return el;
    }
    const noop = () => {};
    const stub = new Proxy({}, {
      get: (_t, prop) => {
        if (prop === "classList") return { add: noop, remove: noop, toggle: () => false, contains: () => false };
        if (prop === "addEventListener" || prop === "removeEventListener" || prop === "appendChild" || prop === "remove" || prop === "focus" || prop === "click" || prop === "scrollIntoView" || prop === "setSelectionRange") return noop;
        if (prop === "dataset") return {};
        if (prop === "style") return {};
        if (prop === "parentElement" || prop === "nextSibling") return null;
        // String/number-ish props: default to "" so chained .trim()/Number() are safe.
        if (prop === "value" || prop === "textContent" || prop === "innerHTML" || prop === "className" || prop === "id") return "";
        if (prop in _t) return _t[prop];
        return "";
      },
      set: (_t, prop, value) => { _t[prop] = value; return true; },
      has: (_t, prop) => prop in _t
    });
    elementCache.set(id, stub);
    return stub;
  };
  const STORAGE_KEY = "qrscoutSavedState";
  // Offline outbox: entries queued while the device has no connection, synced
  // when it comes back (pit / airplane mode). Same-origin key, so the hosted
  // site and the installed PWA share one queue per device.
  const OUTBOX_KEY = "qrscoutOutbox";
  function getOutbox() {
    try {
      const raw = localStorage.getItem(OUTBOX_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (err) {
      return [];
    }
  }
  function saveOutbox(list) {
    try {
      localStorage.setItem(OUTBOX_KEY, JSON.stringify(list));
    } catch (err) {
      // Storage full/blocked: keep the in-memory entry flow working.
    }
    updateOutboxBadge();
  }
  function enqueueOffline(sheetId, sheetName, payload) {
    const list = getOutbox();
    list.push({
      queuedAt: new Date().toISOString(),
      sheetId: sheetId || "",
      sheetName: sheetName || "Sheet1",
      payload
    });
    saveOutbox(list);
  }
  // Fetch with a timeout so a slow/dead backend doesn't hang the UI forever.
  function fetchWithTimeout(url, opts, ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return fetch(url, { ...opts, keepalive: true, signal: controller.signal })
      .then((res) => { clearTimeout(timer); return res; })
      .catch((err) => { clearTimeout(timer); throw err; });
  }

  const FETCH_TIMEOUT_MS = 10000;
  function postEntry(sheetId, sheetName, payload) {
    return fetchWithTimeout(BACKEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sheetId, sheetName, row: payload.row, startColumn: (payload.startColumn || "A").toUpperCase() })
    }, FETCH_TIMEOUT_MS).then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        const raw = data && (data.error || data.status);
        throw new Error(raw || ("Sync failed (HTTP " + res.status + ")."));
      }
      return data.status || "Synced to Google Sheets.";
    });
  }
  function flushOutbox() {
    if (!navigator.onLine) return Promise.resolve(0);
    let list = getOutbox();
    if (!list.length) { updateOutboxBadge(); return Promise.resolve(0); }
    const liveId = ($("googleSheetId") && $("googleSheetId").value.trim()) || "";
    // Sync up to 3 entries in parallel for speed
    const CONCURRENCY = 3;
    const batch = list.slice(0, CONCURRENCY);
    const promises = batch.map((entry) => {
      const sheetId = liveId || entry.sheetId || "";
      if (!sheetId) return Promise.resolve(null);
      return postEntry(sheetId, entry.sheetName, entry.payload)
        .then(() => entry)
        .catch(() => null);
    });
    return Promise.all(promises).then((results) => {
      const synced = results.filter(Boolean);
      if (synced.length) {
        const syncedIds = new Set(synced.map((e) => e.queuedAt));
        const remaining = list.filter((e) => !syncedIds.has(e.queuedAt));
        saveOutbox(remaining);
      }
      updateOutboxBadge();
      const remainingCount = getOutbox().length;
      if (synced.length > 0) {
        showToast(`${synced.length} queued entr${synced.length === 1 ? "y" : "ies"} synced.`, "ok");
      }
      return synced.length;
    });
  }
  function updateOutboxBadge() {
    const pending = getOutbox().length;
    let badge = $("outboxBadge");
    if (!badge) {
      const scoutBtn = $("navScoutBtn");
      if (!scoutBtn || !scoutBtn.parentElement) return;
      badge = document.createElement("span");
      badge.id = "outboxBadge";
      badge.className = "outbox-badge hidden";
      scoutBtn.parentElement.appendChild(badge);
    }
    badge.textContent = pending > 0 ? pending + " pending offline" : "";
    badge.classList.toggle("hidden", pending === 0);
    // Also update the outbox panel UI if visible
    renderOutboxPanel();
  }
  // Toast notification system
  function showToast(message, type = "ok", duration = 3000) {
    const container = document.getElementById("toast-container");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => { toast.remove(); }, duration);
  }
  // Connection indicator
  function updateConnectionIndicator() {
    const el = document.getElementById("connection-indicator");
    const text = document.getElementById("connection-text");
    if (!el || !text) return;
    if (navigator.onLine) {
      el.className = "online";
      text.textContent = "Online";
    } else {
      el.className = "offline";
      text.textContent = "Offline — entries will queue";
    }
  }
  // Outbox management panel
  function renderOutboxPanel() {
    const panel = document.getElementById("outboxPanel");
    const list = document.getElementById("outboxList");
    const count = document.getElementById("outboxCount");
    if (!panel || !list || !count) return;
    const items = getOutbox();
    count.textContent = items.length;
    panel.classList.toggle("hidden", items.length === 0);
    if (items.length === 0) return;
    list.innerHTML = items.map((item, i) => `
      <div class="outbox-item">
        <div class="outbox-meta">${new Date(item.queuedAt).toLocaleString()} — ${item.sheetName || "Sheet1"} (${item.payload?.title || "entry"})</div>
        <div class="outbox-actions">
          <button type="button" onclick="window.__retryOutboxItem(${i})">Retry</button>
          <button type="button" onclick="window.__removeOutboxItem(${i})">Remove</button>
        </div>
      </div>
    `).join("");
  }
  window.__retryOutboxItem = async (index) => {
    const items = getOutbox();
    const item = items[index];
    if (!item) return;
    try {
      await postEntry(item.sheetId, item.sheetName, item.payload);
      items.splice(index, 1);
      saveOutbox(items);
      showToast("Queued entry synced successfully.", "ok");
    } catch (err) {
      showToast("Retry failed: " + (err.message || "Unknown error"), "error");
    }
  };
  window.__removeOutboxItem = (index) => {
    const items = getOutbox();
    items.splice(index, 1);
    saveOutbox(items);
    showToast("Entry removed from queue.", "ok");
  };
  // Shared backend that writes to Google Sheets, and the service account email
  // that each user's sheet must be shared with (as an Editor). Set these once.
  const BACKEND_URL = "https://qr-scout-online.onrender.com/api/sync-sheet";
  const FEEDBACK_URL = "https://qr-scout-online.onrender.com/api/feedback";
  const SERVICE_EMAIL = "frc-scout@frc-scout-511222.iam.gserviceaccount.com";
  let config = null;
  let lastPayload = "";
  let shouldAdvanceMatch = false;

  const sampleConfig = {
    title: "Millerbots Scouting",
    page_title: "Millerbots Scouting",
    teamNumber: 2549,
    delimiter: "\\t",
    sections: [
      {
        name: "Prematch",
        fields: [
          { title: "Scouter Initials", description: "Enter the initials of the scouter.", type: "text", required: true, code: "scouter", defaultValue: "" },
          { title: "Match Number", description: "Select the match number.", type: "number", required: true, code: "matchNumber", defaultValue: 1 },
          { title: "Robot number", description: "Enter the robot number you're scouting.", type: "text", required: true, code: "robot", defaultValue: "" },
          { title: "Starting Position", type: "select", required: true, code: "startPos", defaultValue: "", choices: { B1:"Blue 1", B2:"Blue 2", B3:"Blue 3", R1:"Red 1", R2:"Red 2", R3:"Red 3" } },
          { title: "No Show", type: "boolean", required: false, code: "noShow", defaultValue: false }
        ]
      },
      {
        name: "Autonomous",
        fields: [
          { title: "Had auto?", type: "boolean", code: "Auto", defaultValue: false },
          { title: "Fuel Scored in Auto?", type: "counter", code: "autoFuelScored", defaultValue: 0, min: 0, step: 3 },
          { title: "Fuel Missed in Auto?", type: "counter", code: "autoFuelMissed", defaultValue: 0, min: 0, step: 1 },
          { title: "Climbed in auto?", type: "boolean", code: "auClimb", defaultValue: false },
          { title: "Auto effectiveness", type: "range", code: "autoEff", defaultValue: 4, min: 1, max: 7, step: 1 }
        ]
      },
      {
        name: "Teleop",
        fields: [
          { title: "Alliance won auto?", type: "boolean", code: "allianceWonAuto", defaultValue: false },
          { title: "Fuel Scored in Teleop?", type: "counter", code: "telFuelScored", defaultValue: 0, min: 0, step: 3 },
          { title: "Fuel Missed in Teleop?", type: "counter", code: "telFuelMissed", defaultValue: 0, min: 0, step: 1 },
          { title: "Defended during match?", type: "boolean", code: "robotDefended", defaultValue: false },
          { title: "Passed during match?", type: "boolean", code: "pass", defaultValue: false },
          { title: "Bump?", type: "boolean", code: "bump", defaultValue: false },
          { title: "Trench?", type: "boolean", code: "trench", defaultValue: false },
          { title: "Stuck on fuel during match?", type: "boolean", code: "fuelStuck", defaultValue: false },
          { title: "Issues", type: "select", required: true, code: "Failures", defaultValue: "No", choices: { No:"Zero issues", Mech:"Mechanical issue", Die:"Died/disconnected", Tip:"Tipped/fell over", Stu:"Stuck for >5-10 seconds", F:"Multiple issues (elaborate in comments)" } }
        ]
      },
      {
        name: "Endgame/Postmatch",
        fields: [
          { title: "Climbed", type: "select", required: true, code: "climbedTel", defaultValue: "No", choices: { No:"No Climb", L1:"Level 1", L2:"Level 2", L3:"Level 3", F:"Failed Climb" } },
          { title: "Scored How?", type: "select", required: true, code: "scoredHow", defaultValue: "blank", choices: { blank:"(blank)", driving:"While driving", stationary:"While stationary", both:"Both", none:"No scoring" } },
          { title: "Scoring Accuracy", type: "range", code: "scoringEff", defaultValue: 4, min: 1, max: 7, step: 1 },
          { title: "Scoring Speed", type: "range", code: "scoringSped", defaultValue: 4, min: 1, max: 7, step: 1 },
          { title: "Intake Effectiveness", type: "range", code: "intakeEff", defaultValue: 4, min: 1, max: 7, step: 1 },
          { title: "Driving skill", type: "range", code: "drivSkill", defaultValue: 4, min: 1, max: 7, step: 1 },
          { title: "Passing Skill", type: "range", code: "passSkill", defaultValue: 1, min: 1, max: 7, step: 1 },
          { title: "Defense Skill", type: "range", code: "defSkill", defaultValue: 1, min: 1, max: 7, step: 1 },
          { title: "Yellow/Red Card", type: "select", required: true, code: "yc", defaultValue: "No Card", choices: { "No Card":"No Card", Yellow:"Yellow Card", Red:"Red Card" } },
          { title: "Comments", type: "text", code: "co", defaultValue: "" }
        ]
      }
    ]
  };

  function safeId(value) {
    return "field_" + String(value || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  function getSavedState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function clearSavedState() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function saveCurrentState() {
    if (!config || !$("formArea")) return;
    const formState = {};
    $("formArea").querySelectorAll("[data-field-code]").forEach((control) => {
      const code = control.dataset.fieldCode;
      const type = control.dataset.fieldType;
      let value;
      if (type === "boolean") value = control.checked;
      else if (type === "number" || type === "counter" || type === "range") value = control.value === "" ? "" : Number(control.value);
      else value = control.value;
      formState[code] = value;
    });

    const currentSheetId = $("googleSheetId") ? $("googleSheetId").value.trim() : (config.googleSheetId || "");
    const currentSheetTab = $("sheetTabName") ? $("sheetTabName").value.trim() : (config.googleSheetTab || "Sheet1");
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ config, form: formState, sheetId: currentSheetId, sheetTab: currentSheetTab }));
  }

  function applySavedValues() {
    const saved = getSavedState();
    if (!saved || !saved.form) return;
    $("formArea").querySelectorAll("[data-field-code]").forEach((control) => {
      const code = control.dataset.fieldCode;
      const value = saved.form[code];
      if (value === undefined) return;
      const type = control.dataset.fieldType;
      if (type === "boolean") control.checked = Boolean(value);
      else if (type === "range" || type === "counter" || type === "number") control.value = value ?? "";
      else if (type === "select") control.value = value ?? "";
      else control.value = value ?? "";
    });
  }

  function makeField(field) {
    const wrapper = document.createElement("div");
    wrapper.className = "field";
    const id = safeId(field.code);
    const label = document.createElement("label");
    label.htmlFor = id;
    label.textContent = field.title || field.code || "Field";
    if (field.required) label.textContent += " *";
    wrapper.appendChild(label);

    let input;
    if (field.type === "boolean") {
      const line = document.createElement("div");
      line.className = "checkline";
      input = document.createElement("input");
      input.type = "checkbox";
      input.checked = Boolean(field.defaultValue);
      input.id = id;
      const yes = document.createElement("label");
      yes.htmlFor = id;
      yes.textContent = "Yes";
      line.append(input, yes);
      wrapper.appendChild(line);
    } else if (field.type === "select") {
      input = document.createElement("select");
      input.id = id;
      const blank = document.createElement("option");
      blank.value = "";
      blank.textContent = "Choose an option\u2026";
      input.appendChild(blank);
      Object.entries(field.choices || {}).forEach(([value, text]) => {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = text;
        input.appendChild(opt);
      });
      input.value = field.defaultValue ?? "";
      wrapper.appendChild(input);
    } else if (field.type === "range") {
      input = document.createElement("input");
      input.type = "range";
      input.id = id;
      input.min = field.min ?? 0;
      input.max = field.max ?? 10;
      input.step = field.step ?? 1;
      input.value = field.defaultValue ?? input.min;
      const val = document.createElement("div");
      val.className = "hint";
      const update = () => { val.textContent = "Value: " + input.value; };
      input.addEventListener("input", update);
      update();
      wrapper.append(input, val);
    } else if (field.type === "counter") {
      const counter = document.createElement("div");
      counter.className = "counter-control";
      const minus = document.createElement("button");
      minus.type = "button";
      minus.className = "counter-btn minus";
      minus.textContent = "-";
      input = document.createElement("input");
      input.id = id;
      input.type = "number";
      input.min = field.min ?? 0;
      input.step = field.step ?? 1;
      if (field.max !== undefined) input.max = field.max;
      input.value = field.defaultValue ?? 0;
      const plus = document.createElement("button");
      plus.type = "button";
      plus.className = "counter-btn plus";
      plus.textContent = "+";
      const changeByStep = (direction) => {
        const step = Number(input.step) || 1;
        const current = input.value === "" ? Number(input.min || 0) : Number(input.value);
        let next = current + direction * step;
        if (input.min !== "") next = Math.max(Number(input.min), next);
        if (input.max !== "") next = Math.min(Number(input.max), next);
        input.value = String(next);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      };
      minus.addEventListener("click", () => changeByStep(-1));
      plus.addEventListener("click", () => changeByStep(1));
      counter.append(minus, input, plus);
      wrapper.appendChild(counter);
    } else {
      input = document.createElement("input");
      input.id = id;
      input.type = field.type === "number" ? "number" : "text";
      if (field.type === "number") input.step = field.step ?? 1;
      if (field.max !== undefined && input.type === "text") input.maxLength = Number(field.max);
      input.value = field.defaultValue ?? "";
      wrapper.appendChild(input);
    }

    input.dataset.fieldCode = field.code;
    input.dataset.fieldType = field.type;
    input.dataset.required = field.required ? "true" : "false";
    if (field.description) {
      const hint = document.createElement("div");
      hint.className = "hint";
      hint.textContent = field.description;
      wrapper.appendChild(hint);
    }
    return wrapper;
  }

  function renderForm() {
    const area = $("formArea");
    area.innerHTML = "";
    if (!config || !Array.isArray(config.sections)) return;
    config.sections.forEach((section) => {
      const sectionEl = document.createElement("div");
      sectionEl.className = "section";
      const title = document.createElement("div");
      title.className = "section-title";
      title.textContent = section.name || "Fields";
      sectionEl.appendChild(title);
      (section.fields || []).forEach((field) => sectionEl.appendChild(makeField(field)));
      area.appendChild(sectionEl);
    });
    applySavedValues();
    $("configStatus").textContent = `${config.title || "Configuration"} loaded`;
  }

  function collectData() {
    const data = {};
    const controls = $("formArea").querySelectorAll("[data-field-code]");
    for (const control of controls) {
      const code = control.dataset.fieldCode;
      const type = control.dataset.fieldType;
      const required = control.dataset.required === "true";
      let value;
      if (type === "boolean") value = control.checked;
      else if (type === "number" || type === "counter" || type === "range") {
        value = control.value === "" ? "" : Number(control.value);
      } else {
        value = control.value.trim();
      }
      if (required && (value === "" || value === null || value === undefined)) {
        control.focus();
        throw new Error(`Please complete the required field: ${code}`);
      }
      data[code] = value;
    }
    return {
      title: config.title || "QR Scout",
      teamNumber: config.teamNumber ?? null,
      createdAt: new Date().toISOString(),
      data
    };
  }

  function setStatus(message, isError = false) {
    const el = $("configStatus");
    if (!el) return;
    el.textContent = message;
    el.classList.toggle("error", isError);
    el.classList.toggle("ok", !isError && /loaded|ready|generated|reset/i.test(message));
  }

  function setGoogleFormStatus(message, isError = false) {
    const el = $("googleFormStatus");
    if (!el) return;
    el.textContent = message;
    el.className = "status" + (isError ? " error" : " ok");
  }

  function setFeedbackStatus(message, isError = false, inProgress = false, isSuccess = false) {
    const el = $("feedbackStatus");
    if (!el) return;
    el.textContent = message;
    el.className = "status" + (isError ? " error" : isSuccess || inProgress ? " ok" : "");
  }

  function showChoices() {
    const grid = $("choiceGrid");
    if (grid) grid.classList.remove("hidden");
    const backBtn = $("modalBackBtn");
    if (backBtn) backBtn.classList.add("hidden");
  }

  function hideChoices() {
    const grid = $("choiceGrid");
    if (grid) grid.classList.add("hidden");
    const backBtn = $("modalBackBtn");
    if (backBtn) backBtn.classList.remove("hidden");
  }

  function backToChoices() {
    clearModalContent();
    shouldAdvanceMatch = false;
    showChoices();
  }

  function showModal() {
    shouldAdvanceMatch = false;
    clearModalContent();
    showChoices();
    $("commitModal").classList.remove("hidden");
  }

  function advanceMatchNumber() {
    if (!config || !$("formArea")) return;
    const control = $("formArea").querySelector('[data-field-code="matchNumber"]');
    if (!control) return;
    const step = Number(control.step) || 1;
    const current = control.value === "" ? Number(control.min || 1) : Number(control.value);
    let next = (Number.isFinite(current) ? current : 1) + step;
    const min = control.min !== "" && control.min !== undefined && control.min !== null ? Number(control.min) : null;
    if (min !== null && Number.isFinite(min)) next = Math.max(min, next);
    control.value = String(next);
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function hideModal() {
    if (shouldAdvanceMatch) {
      shouldAdvanceMatch = false;
      advanceMatchNumber();
    }
    $("commitModal").classList.add("hidden");
    clearModalContent();
  }

  function clearModalContent() {
    const status = $("modalStatus");
    if (status) {
      status.textContent = "";
      status.className = "status hidden";
    }
    const qrBox = $("modalQrBox");
    if (qrBox) {
      qrBox.innerHTML = "";
      qrBox.classList.add("hidden");
    }
    const downloadBtn = $("modalDownloadBtn");
    if (downloadBtn) downloadBtn.classList.add("hidden");
  }

  function setModalStatus(message, error = false, ok = false) {
    const el = $("modalStatus");
    el.textContent = message;
    el.className = "status" + (error ? " error" : ok ? " ok" : "");
  }

  function isFileProtocol() {
    return window.location.protocol === "file:";
  }

  function getSyncFailureDetails(scriptUrl, reasonText) {
    const hints = [];
    if (isFileProtocol()) {
      hints.push("Open the site over localhost or GitHub Pages instead of a file path.");
    }
    if (!scriptUrl) {
      hints.push("Paste the running backend API URL.");
    } else {
      try {
        const parsed = new URL(scriptUrl);
        if (!/^https?:/.test(parsed.href)) {
          hints.push("Use a real HTTP or HTTPS backend URL.");
        }
      } catch (err) {
        hints.push("The backend URL is not valid. Copy the full API URL.");
      }
    }
    if (location.protocol === "https:" && /github\.io/i.test(location.hostname)) {
      hints.push("GitHub Pages is allowed, but the backend must be reachable over HTTP or HTTPS.");
    }
    if (String(reasonText).toLowerCase().includes("do get") || String(reasonText).toLowerCase().includes("script function not found")) {
      hints.push("This is a backend endpoint issue. Confirm the API is running and the URL is correct.");
    }
    if (!hints.length) {
      hints.push("Check that the backend is running and serving the API endpoint over HTTP.");
    }
    return `${reasonText} ${hints.join(" ")}`;
  }

  function downloadCsvFallback(payload) {
    const rows = [];
    const keys = Object.keys(payload.data || {});
    rows.push(["field", "value"].join(","));
    keys.forEach((key) => {
      const value = payload.data[key];
      const safeValue = String(value ?? "").replace(/"/g, '""');
      rows.push([`"${key}"`, `"${safeValue}"`].join(","));
    });
    const csv = rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `qr-scout-fallback-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return csv;
  }

  function saveGoogleFormSync() {
    if (!config) {
      setGoogleFormStatus("Load a scouting configuration before saving your sheet.", true);
      return;
    }

    const sheetId = $("googleSheetId").value.trim();
    const sheetTabName = $("sheetTabName").value.trim() || "Sheet1";
    const startColumn = $("startColumn").value.trim() || "A";

    if (!sheetId) {
      setGoogleFormStatus("Enter your Google Sheet ID before saving.", true);
      return;
    }

    config.googleSheetId = sheetId;
    config.googleSheetTab = sheetTabName;
    config.googleStartColumn = startColumn;
    $("googleSheetId").value = sheetId;
    $("sheetTabName").value = sheetTabName;
    $("startColumn").value = startColumn;
    setGoogleFormStatus("Sheet saved. Ready to sync.", false);
    saveCurrentState();
  }

  function clearGoogleFormSync() {
    $("googleSheetId").value = "";
    $("sheetTabName").value = $("sheetTabName").value.trim() || "Sheet1";
    $("startColumn").value = "A";
    if (config) {
      delete config.googleSheetId;
      delete config.googleSheetTab;
      delete config.googleStartColumn;
    }
    setGoogleFormStatus("Sheet cleared.", false);
    saveCurrentState();
  }

  function syncToGoogleForm() {
    hideChoices();
    if (!config || !config.googleSheetId) {
      setModalStatus("Add your Google Sheet ID in the sync panel first.", true);
      return;
    }

    if (isFileProtocol()) {
      setModalStatus("Open this website over https:// or http:// first, not from a local file:// path.", true);
      return;
    }

    if (!BACKEND_URL || BACKEND_URL.indexOf("YOUR-BACKEND") !== -1) {
      setModalStatus("This site's backend is not configured yet. Ask the site owner to set the BACKEND_URL.", true);
      return;
    }

    const scriptUrl = BACKEND_URL;

    try {
      const payload = collectData();
      const sheetId = (config.googleSheetId || "").trim();
      const sheetName = (config.googleSheetTab || $("sheetTabName").value || "Sheet1").trim();

      if (!sheetId) {
        setModalStatus("Add your Google Sheet ID before syncing.", true);
        return;
      }

      const startColumn = ($("startColumn").value.trim() || "A").toUpperCase();
      const rowValues = Object.values(payload.data);

      const body = JSON.stringify({
        title: payload.title,
        teamNumber: payload.teamNumber,
        createdAt: payload.createdAt,
        row: rowValues,
        sheetId: sheetId,
        sheetName: sheetName,
        startColumn: startColumn
      });

      setModalStatus("Sending scouting data to the script...", false, true);

      fetchWithTimeout(scriptUrl, {
        method: "POST",
        mode: "cors",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json"
        },
        body
      }, FETCH_TIMEOUT_MS).then(async (res) => {
        const responseText = await res.text();
        let parsed = null;
        try {
          parsed = responseText ? JSON.parse(responseText) : null;
        } catch (err) {
          parsed = null;
        }

        if (!res.ok) {
          throw new Error(responseText || "Script request failed.");
        }

        if (parsed && parsed.ok === false) {
          throw new Error(parsed.error || "Script request rejected by the backend.");
        }

        setModalStatus("Scouting data sent to your Google Sheet.", false, true);
        shouldAdvanceMatch = true;
      }).catch((err) => {
        const raw = err && err.message ? err.message : "Could not sync to your sheet.";
        const fallbackCsv = downloadCsvFallback(payload);
        const detailed = getSyncFailureDetails(scriptUrl, raw);
        setModalStatus(`${detailed} Manual backup downloaded as CSV so you can import it into Google Sheets.`, true);
        console.warn("Script sync failed. CSV fallback created.", { raw, fallbackCsv, scriptUrl, sheetName });
      });
    } catch (err) {
      const raw = err && err.message ? err.message : "Could not sync to your sheet.";
      const payload = collectData();
      const fallbackCsv = downloadCsvFallback(payload);
      const detailed = getSyncFailureDetails(BACKEND_URL, raw);
      setModalStatus(`${detailed} Manual backup downloaded as CSV so you can import it into Google Sheets.`, true);
      console.warn("Script sync exception. CSV fallback created.", { raw, fallbackCsv, config });
    }
  }

  function generateQrChoice() {
    if (!config) {
      setModalStatus("Please load a JSON configuration first.", true);
      return;
    }
    if (typeof QRCode === "undefined") {
      setModalStatus("QR library did not load. Check your internet connection and refresh.", true);
      return;
    }
    try {
      const payload = collectData();
      lastPayload = JSON.stringify(payload);
      $("modalQrBox").innerHTML = "";
      $("modalQrBox").classList.remove("hidden");
      new QRCode($("modalQrBox"), {
        text: lastPayload,
        width: 256,
        height: 256,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.L
      });
      $("modalDownloadBtn").classList.remove("hidden");
      shouldAdvanceMatch = true;
      hideChoices();
      setModalStatus("QR code generated. Scan it to retrieve the scouting data.", false, true);
    } catch (err) {
      setModalStatus(err.message || "Could not generate QR code.", true);
    }
  }

  function downloadBlob(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function downloadQr() {
    const canvas = $("modalQrBox").querySelector("canvas");
    const img = $("modalQrBox").querySelector("img");
    const url = canvas ? canvas.toDataURL("image/png") : img ? img.src : "";
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `qr-scout-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function resetFields() {
    lastPayload = "";
    shouldAdvanceMatch = false;
    hideModal();
    if (!config) {
      setStatus("No configuration loaded to reset.", true);
      return;
    }
    const preserved = {};
    let nextMatchNumber = null;
    $("formArea").querySelectorAll("[data-field-code]").forEach((control) => {
      const code = control.dataset.fieldCode;
      if (code === "scouter" || code === "startPos") {
        preserved[code] = control.value;
      } else if (code === "matchNumber") {
        const step = Number(control.step) || 1;
        const current = control.value === "" ? Number(control.min || 1) : Number(control.value);
        nextMatchNumber = (Number.isFinite(current) ? current : 1) + step;
      }
    });
    clearSavedState();
    renderForm();
    $("formArea").querySelectorAll("[data-field-code]").forEach((control) => {
      const code = control.dataset.fieldCode;
      if (code === "scouter" || code === "startPos") {
        control.value = preserved[code] ?? control.value;
      } else if (code === "matchNumber" && nextMatchNumber !== null) {
        control.value = String(nextMatchNumber);
      }
    });
    saveCurrentState();
    setStatus("Fields reset to their default values.");
  }

  function setActiveTab(which) {
    $("navAppBtn").classList.toggle("active", which === "home");
    const scoutBtn = $("navScoutBtn");
    if (scoutBtn) scoutBtn.classList.toggle("active", which === "scout");
    $("navGuideBtn").classList.toggle("active", which === "guide");
    const feedbackBtn = $("navFeedbackBtn");
    if (feedbackBtn) feedbackBtn.classList.toggle("active", which === "feedback");
    const downloadBtn = $("navDownloadBtn");
    if (downloadBtn) downloadBtn.classList.toggle("active", which === "app");
  }

  function route() {
    const hash = (location.hash || "").toLowerCase();
    if (hash === "#/start-guide" || hash === "#/startguide") {
      showStartGuide();
    } else if (hash === "#/scout") {
      showScoutPage();
    } else if (hash === "#/feedback") {
      showFeedback();
    } else if (hash === "#/update" || hash === "#/download") {
      showUpdateSection();
    } else {
      showHome();
    }
  }

  function showStartGuide() {
    $("welcomeSection").classList.add("hidden");
    $("scoutingPage").classList.add("hidden");
    $("howToUseSection").classList.add("hidden");
    $("feedbackSection").classList.add("hidden");
    $("updateSection").classList.add("hidden");
    $("startGuideSection").classList.remove("hidden");
    setActiveTab("guide");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function showFeedback() {
    $("welcomeSection").classList.add("hidden");
    $("scoutingPage").classList.add("hidden");
    $("howToUseSection").classList.add("hidden");
    $("startGuideSection").classList.add("hidden");
    $("updateSection").classList.add("hidden");
    $("feedbackSection").classList.remove("hidden");
    setActiveTab("feedback");
    if ((location.hash || "").toLowerCase() !== "#/feedback") {
      history.replaceState(null, "", "#/feedback");
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function showHome() {
    $("startGuideSection").classList.add("hidden");
    $("feedbackSection").classList.add("hidden");
    $("updateSection").classList.add("hidden");
    $("welcomeSection").classList.remove("hidden");
    $("howToUseSection").classList.remove("hidden");
    $("scoutingPage").classList.add("hidden");
    setActiveTab("home");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function showUpdateSection() {
    $("welcomeSection").classList.add("hidden");
    $("scoutingPage").classList.add("hidden");
    $("howToUseSection").classList.add("hidden");
    $("startGuideSection").classList.add("hidden");
    $("feedbackSection").classList.add("hidden");
    $("updateSection").classList.remove("hidden");
    setActiveTab("update");
    if ((location.hash || "").toLowerCase() !== "#/update") {
      history.replaceState(null, "", "#/update");
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }


  function showScoutPage() {
    if (!config) {
      // No config saved yet: fall back to the built-in sample so the Scout
      // tab is always usable instead of bouncing back to Home.
      try {
        applyConfig(sampleConfig);
      } catch (err) {
        setStatus(err.message, true);
      }
      return;
    }
    $("startGuideSection").classList.add("hidden");
    $("feedbackSection").classList.add("hidden");
    $("updateSection").classList.add("hidden");
    $("welcomeSection").classList.add("hidden");
    $("howToUseSection").classList.remove("hidden");
    $("scoutingPage").classList.remove("hidden");
    setActiveTab("scout");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function goHome() {
    showHome();
    $("configStatus").textContent = "Ready for a new config.";
    $("configStatus").className = "status";
    if ((location.hash || "").toLowerCase() !== "#/home") {
      history.replaceState(null, "", "#/home");
    }
  }

  function applyConfig(obj) {
    if (!obj || !Array.isArray(obj.sections)) throw new Error("This JSON does not contain a sections array.");
    config = obj;
    $("welcomeSection").classList.add("hidden");
    $("feedbackSection").classList.add("hidden");
    $("updateSection").classList.add("hidden");
    $("scoutingPage").classList.remove("hidden");
    renderForm();
    $("jsonEditor").value = JSON.stringify(config, null, 2);
    $("managerStatus").textContent = "Configuration loaded. You can edit, replace, or download this JSON.";
    $("managerStatus").className = "status ok";
    setStatus("Configuration loaded. Fill in the fields, then generate a QR code.");
    $("sheetTabName").value = config.googleSheetTab || "Sheet1";
    $("googleSheetId").value = config.googleSheetId || "";
    setGoogleFormStatus(config.googleSheetId ? "Sheet saved. Ready to sync." : "No sheet configured yet.", false);
    saveCurrentState();
    setActiveTab("scout");
    if ((location.hash || "").toLowerCase() !== "#/scout") {
      location.hash = "#/scout";
    }
  }

  function restoreSavedConfiguration() {
    const saved = getSavedState();
    if (!saved || !saved.config || !Array.isArray(saved.config.sections)) return;
    config = saved.config;
    $("welcomeSection").classList.add("hidden");
    $("scoutingPage").classList.remove("hidden");
    renderForm();
    $("jsonEditor").value = JSON.stringify(config, null, 2);
    $("managerStatus").textContent = "Saved scouting data restored.";
    $("managerStatus").className = "status ok";
    $("sheetTabName").value = config.googleSheetTab || "Sheet1";
    $("googleSheetId").value = config.googleSheetId || saved.sheetId || "";
    setStatus("Saved progress restored.");
  }

  $("configFile").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      applyConfig(JSON.parse(await file.text()));
    } catch (err) {
      $("configStatus").textContent = "Could not load JSON.";
      setStatus(err.message || "Invalid JSON.", true);
    }
  });

  $("loadExample").addEventListener("click", () => {
    try {
      applyConfig(sampleConfig);
    } catch (err) {
      setStatus(err.message, true);
    }
  });

  $("brandHomeBtn").addEventListener("click", goHome);
  $("brandHomeBtn").addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      goHome();
    }
  });
  $("clearJsonBtn").addEventListener("click", () => {
    $("jsonEditor").value = "";
    $("managerStatus").textContent = "JSON editor cleared. Load or paste a config to continue.";
    $("managerStatus").className = "status";
  });
  $("commitBtn").addEventListener("click", showModal);
  $("resetBtn").addEventListener("click", resetFields);
  $("resetFormBtn").addEventListener("click", resetFields);
  $("toggleConfigManagerBtn").addEventListener("click", () => {
    const manager = $("configManager");
    const isHidden = manager.classList.toggle("collapsed");
    $("toggleConfigManagerBtn").textContent = isHidden ? "Edit JSON" : "Hide JSON";
    if (!isHidden) manager.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("closeModalBtn").addEventListener("click", hideModal);
  $("commitModal").addEventListener("click", (e) => {
    if (e.target === $("commitModal")) hideModal();
  });
  $("qrChoiceBtn").addEventListener("click", generateQrChoice);
  $("syncChoiceBtn").addEventListener("click", syncToGoogleForm);
  $("applyGoogleFormBtn").addEventListener("click", saveGoogleFormSync);
  $("clearGoogleFormBtn").addEventListener("click", clearGoogleFormSync);
  const retryOutboxBtn = document.getElementById("retryOutboxBtn");
  if (retryOutboxBtn) retryOutboxBtn.addEventListener("click", async () => {
    const items = getOutbox();
    if (!items.length) return;
    let synced = 0;
    for (const item of items) {
      try {
        await postEntry(item.sheetId, item.sheetName, item.payload);
        synced++;
      } catch (e) { break; }
    }
    const remaining = getOutbox().length - synced;
    const newList = getOutbox().slice(synced);
    saveOutbox(newList);
    showToast(synced > 0 ? `${synced} entr${synced === 1 ? "y" : "ies"} synced.` : "Nothing synced.", synced > 0 ? "ok" : "error");
    renderOutboxPanel();
  });
  const clearOutboxBtn = document.getElementById("clearOutboxBtn");
  if (clearOutboxBtn) clearOutboxBtn.addEventListener("click", () => {
    if (confirm("Clear all queued entries? This cannot be undone.")) {
      saveOutbox([]);
      showToast("Queue cleared.", "ok");
    }
  });
  $("toggleGoogleFormBtn").addEventListener("click", () => {
    const panel = $("googleFormSyncPanel");
    const collapsed = panel.classList.toggle("collapsed");
    $("toggleGoogleFormBtn").textContent = collapsed ? "Show sync" : "Hide sync";
    if (!collapsed) panel.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("modalDownloadBtn").addEventListener("click", downloadQr);
  $("modalBackBtn").addEventListener("click", backToChoices);
  $("navAppBtn").addEventListener("click", showHome);
  $("navScoutBtn").addEventListener("click", showScoutPage);
  $("navGuideBtn").addEventListener("click", showStartGuide);
  $("navFeedbackBtn").addEventListener("click", showFeedback);
  $("navUpdateBtn").addEventListener("click", showUpdateSection);


  // PWA "Install app" support (Chrome/Edge/Android): kept for browsers that
  // offer direct install (the phone cards now point at the .apk/.ipa files).
  let deferredInstallPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    const installBtn = $("pwaInstallBtn");
    if (installBtn) installBtn.hidden = false;
  });
  const pwaInstallBtn = $("pwaInstallBtn");
  if (pwaInstallBtn) {
    pwaInstallBtn.addEventListener("click", async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      pwaInstallBtn.hidden = true;
    });
  }
  if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) {
    const pwaHint = $("pwaInstallHint");
    if (pwaHint) pwaHint.textContent = "You're running the installed app \u2014 nice!";
  }
  window.addEventListener("hashchange", route);
  window.addEventListener("online", () => { flushOutbox(); updateConnectionIndicator(); });
  window.addEventListener("offline", () => { updateConnectionIndicator(); });
  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;
    if (e.key === "c" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); document.getElementById("commitBtn")?.click(); }
    if (e.key === "r" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); document.getElementById("resetBtn")?.click(); }
  });
  updateOutboxBadge();
  updateConnectionIndicator();

  // Update checker
  const APP_VERSION = "1.0.0";
  const GITHUB_REPO = "Home-Grown-Code/QR-Scout-Online";
  const RELEASES_API = "https://api.github.com/repos/" + GITHUB_REPO + "/releases/latest";
  function normalizeVersion(v) { return String(v).replace(/^v/i, ""); }
  function versionNewer(latest, current) {
    const a = latest.split(".").map(Number);
    const b = current.split(".").map(Number);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if ((a[i] || 0) > (b[i] || 0)) return true;
      if ((a[i] || 0) < (b[i] || 0)) return false;
    }
    return false;
  }
  async function checkForUpdates() {
    const btn = document.getElementById("checkUpdatesBtn");
    if (btn) btn.disabled = true;
    const status = document.getElementById("updateStatus");
    if (status) status.textContent = "Checking GitHub for the latest release...";
    try {
      const res = await fetch(RELEASES_API, { headers: { Accept: "application/vnd.github+json" } });
      if (!res.ok) throw new Error("GitHub responded " + res.status);
      const release = await res.json();
      const latest = release.tag_name || "";
      const published = release.published_at ? new Date(release.published_at).toLocaleDateString() : "";
      const currentEl = document.getElementById("currentVersion");
      const latestEl = document.getElementById("latestVersion");
      if (currentEl) currentEl.textContent = "v" + APP_VERSION;
      if (latestEl) latestEl.textContent = latest ? normalizeVersion(latest) : "unknown";
      if (latest && versionNewer(normalizeVersion(latest), APP_VERSION)) {
        if (status) status.textContent = "A newer version is available: " + latest + (published ? " (released " + published + ")" : "") + ". Open the releases page to download it.";
        if (status) status.className = "status ok";
      } else if (latest) {
        if (status) status.textContent = "You're up to date — latest release is " + latest + (published ? " (" + published + ")" : "") + ".";
        if (status) status.className = "status ok";
      } else {
        if (status) status.textContent = "No published releases found yet. Check back after the next tagged build.";
        if (status) status.className = "status error";
      }
    } catch (err) {
      if (status) status.textContent = "Couldn't reach GitHub to check for updates (" + err.message + "). You need an internet connection for this.";
      if (status) status.className = "status error";
    } finally {
      if (btn) btn.disabled = false;
    }
  }
  const checkUpdatesBtn = document.getElementById("checkUpdatesBtn");
  if (checkUpdatesBtn) checkUpdatesBtn.addEventListener("click", checkForUpdates);
  const currentVersionEl = document.getElementById("currentVersion");
  if (currentVersionEl) currentVersionEl.textContent = "v" + APP_VERSION;
  // saves the row to the owner's Google Sheet; the browser then emails the
  // owner through FormSubmit - their free plan blocks server-side calls from
  // cloud hosts, but browser posts from this page are fully supported. The
  // owner address is assembled from parts so scrapers can't harvest it here.
  const FEEDBACK_OWNER_EMAIL = ["rileyhh2901", "@", "gmail.com"].join("");
  function emailFeedbackToOwner(fields) {
    const subject = `QR Scout feedback${fields.teamNumber ? ` \u2014 team ${fields.teamNumber}` : ""}${fields.name ? ` from ${fields.name}` : ""}`;
    return fetchWithTimeout(`https://formsubmit.co/ajax/${encodeURIComponent(FEEDBACK_OWNER_EMAIL)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        _subject: subject,
        _captcha: "false",
        _template: "box",
        _replyto: fields.email || undefined,
        name: fields.name || "(not provided)",
        teamNumber: fields.teamNumber || "(not provided)",
        email: fields.email || "(not provided)",
        message: fields.feedback
      })
    }, FETCH_TIMEOUT_MS);
  }
  $("feedbackForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = $("feedbackSubmitBtn");
    const name = $("feedbackName").value.trim();
    const teamNumber = $("feedbackTeam").value.trim();
    const email = $("feedbackEmail").value.trim();
    const feedbackText = $("feedbackText").value.trim();
    const honeypot = $("feedbackWebsite").value;
    if (!feedbackText) {
      setFeedbackStatus("Please enter your feedback before sending.", true);
      return;
    }
    submitBtn.disabled = true;
    setFeedbackStatus("Sending feedback...", false, true);
    try {
      const res = await fetchWithTimeout(FEEDBACK_URL, {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, teamNumber, email, feedback: feedbackText, website: honeypot })
      }, FETCH_TIMEOUT_MS);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `Server responded with status ${res.status}.`);
      }
      // Best-effort email to the owner (the sheet already has the row, so a
      // failure here never blocks the user). Skipped for bots: the backend
      // ignored the honeypot submission and so do we.
      if (!honeypot) {
        emailFeedbackToOwner({ name, teamNumber, email, feedback: feedbackText }).catch((emailError) => {
          console.warn("Feedback email not sent:", emailError);
        });
      }
      setFeedbackStatus(data.status || "Feedback submitted. Thank you!", false, false, true);
      $("feedbackForm").reset();
      const anotherBtn = document.createElement("button");
      anotherBtn.type = "button";
      anotherBtn.className = "secondary";
      anotherBtn.textContent = "Submit another";
      anotherBtn.addEventListener("click", () => {
        $("feedbackForm").reset();
        setFeedbackStatus("Only the feedback box is required.", false);
        setTimeout(() => { anotherBtn.remove(); }, 2000);
      });
      const statusEl = $("feedbackStatus");
      if (statusEl && statusEl.nextSibling) {
        statusEl.parentNode.insertBefore(anotherBtn, statusEl.nextSibling);
      } else if (statusEl) {
        statusEl.appendChild(anotherBtn);
      }
    } catch (err) {
      setFeedbackStatus(`Could not send feedback: ${err.message}`, true);
    } finally {
      submitBtn.disabled = false;
    }
  });
  $("downloadExampleConfigBtn").addEventListener("click", () => {
    downloadBlob("example-config.json", JSON.stringify(sampleConfig, null, 2), "application/json");
  });

  // Debounce the high-frequency form listeners so we don't re-serialize the
  // whole form to localStorage on every keystroke. Direct calls to
  // saveCurrentState() elsewhere stay immediate.
  let saveStateTimer = null;
  function scheduleSaveState() {
    if (saveStateTimer) clearTimeout(saveStateTimer);
    saveStateTimer = setTimeout(() => {
      saveStateTimer = null;
      saveCurrentState();
    }, 250);
  }
  function flushSaveState() {
    if (saveStateTimer) {
      clearTimeout(saveStateTimer);
      saveStateTimer = null;
      saveCurrentState();
    }
  }

  $("formArea").addEventListener("input", scheduleSaveState);
  $("formArea").addEventListener("change", scheduleSaveState);
  // Persist any pending keystroke before the page goes away.
  window.addEventListener("pagehide", flushSaveState);

  $("applyJsonBtn").addEventListener("click", () => {
    try {
      const parsed = JSON.parse($("jsonEditor").value);
      applyConfig(parsed);
    } catch (err) {
      $("managerStatus").textContent = "Invalid JSON. Fix the syntax and try again.";
      $("managerStatus").className = "status error";
    }
  });

  $("uploadNewJsonBtn").addEventListener("click", () => {
    $("managerJsonFile").click();
  });

  $("managerJsonFile").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      applyConfig(parsed);
    } catch (err) {
      $("managerStatus").textContent = "Could not load the JSON file.";
      $("managerStatus").className = "status error";
    }
  });

  $("downloadJsonBtn").addEventListener("click", () => {
    if (!config) return;
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "scouting-config.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  const syncInput = $("googleSheetId");
  if (syncInput) {
    syncInput.value = "";
  }

  const serviceEmailEl = $("serviceAccountEmail");
  if (serviceEmailEl) {
    serviceEmailEl.textContent = SERVICE_EMAIL;
  }

  const saved = getSavedState();
  if (saved && saved.config && Array.isArray(saved.config.sections)) {
    restoreSavedConfiguration();
    if (!location.hash) {
      history.replaceState(null, "", "#/scout");
    }
  }
  // PWA: register the service worker (same folder as the page, so the scope
  // covers the whole site, including the GitHub Pages sub-path) so Chrome can
  // offer "Install QR Scout" on the App tab.
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch((err) => {
        console.warn("Service worker registration failed:", err);
      });
    });
  }
  route();
})();

