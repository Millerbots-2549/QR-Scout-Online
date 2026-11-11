(() => {
  "use strict";

  const API_BASE = "https://qr-scout-online.onrender.com";
  const RECORDS_KEY = "fieldnotes-scout-records";
  const SETTINGS_KEY = "fieldnotes-sheet-settings";
  const OUTBOX_KEY = "fieldnotes-sheet-outbox";
  const CONFIG_KEY = "fieldnotes-scout-config";
  const form = document.getElementById("scout-form");
  const status = document.getElementById("form-status");
  let config;
  let toastTimeout;

  function showStatus(message, isError = false) {
    status.textContent = message;
    status.classList.toggle("error", isError);
  }

  function showToast(message) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.remove("show"), 2400);
  }

  function readJsonStorage(key, fallback) {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  }

  function loadRecords() {
    const records = readJsonStorage(RECORDS_KEY, []);
    if (!Array.isArray(records) || !records.every((record) => record && typeof record === "object" && !Array.isArray(record))) {
      throw new Error("Saved matches have an invalid format. Export the backup or clear local saved data before continuing.");
    }
    return records;
  }

  function readOutbox() {
    const entries = readJsonStorage(OUTBOX_KEY, []);
    if (!Array.isArray(entries)) throw new Error("The pending sync queue has an invalid format.");
    return entries;
  }

  function readSettings() {
    const saved = readJsonStorage(SETTINGS_KEY, { sheetId: "", sheetName: "Scouting", startColumn: "A" });
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) throw new Error("Saved Google Sheet settings have an invalid format.");
    return {
      sheetId: typeof saved.sheetId === "string" ? saved.sheetId : "",
      sheetName: typeof saved.sheetName === "string" && saved.sheetName.trim() ? saved.sheetName.trim() : "Scouting",
      startColumn: typeof saved.startColumn === "string" && saved.startColumn.trim() ? saved.startColumn.trim().toUpperCase() : "A"
    };
  }

  function makeId(value) {
    return "section-" + String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function validateConfig(value) {
    if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.sections) || value.sections.length === 0) {
      throw new Error("Config must be an object with at least one section.");
    }
    const codes = new Set();
    for (const section of value.sections) {
      if (!section || typeof section.name !== "string" || !Array.isArray(section.fields)) {
        throw new Error("Each config section needs a name and a fields array.");
      }
      for (const field of section.fields) {
        if (!field || typeof field.title !== "string" || typeof field.code !== "string" || !field.code.trim()) {
          throw new Error("Every field needs a title and a unique code.");
        }
        if (codes.has(field.code)) throw new Error("Field code \"" + field.code + "\" is used more than once.");
        codes.add(field.code);
        if (!["text", "number", "select", "boolean", "counter", "range"].includes(field.type)) {
          throw new Error("Unsupported field type for \"" + field.code + "\".");
        }
        if (field.type === "select" && (!field.choices || typeof field.choices !== "object" || Array.isArray(field.choices))) {
          throw new Error("Select field \"" + field.code + "\" needs a choices object.");
        }
        if (["number", "counter", "range"].includes(field.type)) {
          const min = field.min === undefined ? 0 : Number(field.min);
          const max = field.max === undefined ? Infinity : Number(field.max);
          const step = field.step === undefined ? 1 : Number(field.step);
          if (!Number.isFinite(min) || !(step > 0) || Number.isNaN(max) || max < min) {
            throw new Error("Numeric field \"" + field.code + "\" has invalid min, max, or step values.");
          }
          if (field.defaultValue !== undefined &&
              (!Number.isFinite(Number(field.defaultValue)) || Number(field.defaultValue) < min || Number(field.defaultValue) > max)) {
            throw new Error("Default value for \"" + field.code + "\" must be within its configured range.");
          }
        }
      }
    }
    return value;
  }

  function makeField(field, sectionIndex, fieldIndex) {
    const wrapper = document.createElement("div");
    wrapper.className = "field";
    const id = "field-" + sectionIndex + "-" + fieldIndex;
    const required = field.required === true;

    if (field.type === "boolean") {
      wrapper.className = "toggle-row";
      const label = document.createElement("label");
      label.htmlFor = id;
      label.textContent = field.title;
      const control = createInput("checkbox");
      control.id = id;
      control.name = field.code;
      control.className = "switch";
      control.dataset.fieldCode = field.code;
      control.dataset.fieldType = field.type;
      control.dataset.required = String(required);
      control.checked = Boolean(field.defaultValue);
      control.required = required;
      wrapper.append(label, control);
    } else {
      const label = document.createElement("label");
      label.className = "field-label";
      label.htmlFor = id;
      label.textContent = field.title;
      wrapper.appendChild(label);

      let control;
      if (field.type === "select") {
        control = document.createElement("select");
        control.className = "control";
        const choices = field.choices || {};
        if (field.defaultValue === "" || field.defaultValue === undefined) {
          const placeholder = document.createElement("option");
          placeholder.value = "";
          placeholder.textContent = "Select an option";
          control.appendChild(placeholder);
        }
        Object.entries(choices).forEach(([value, title]) => {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = title;
          control.appendChild(option);
        });
      } else if (field.type === "counter") {
        control = document.createElement("div");
        control.className = "counter";
        const value = Number(field.defaultValue) || 0;
        const step = Number(field.step) || 1;
        const min = Number.isFinite(Number(field.min)) ? Number(field.min) : 0;
        control.innerHTML = '<div class="counter-value" aria-live="polite">' + value + '</div><div class="counter-buttons"><button type="button" data-counter-step="-1" aria-label="Decrease by ' + step + '">−' + step + '</button><button type="button" class="plus" data-counter-step="1" aria-label="Increase by ' + step + '">+' + step + "</button></div>";
        control.dataset.min = String(min);
        control.dataset.step = String(step);
        control.dataset.value = String(value);
        control.dataset.fieldType = "counter";
        control.dataset.fieldCode = field.code;
        control.dataset.required = String(required);
        control.dataset.fieldId = id;
        wrapper.appendChild(control);
      } else if (field.type === "range") {
        control = createInput("range");
        control.min = String(field.min ?? 0);
        control.max = String(field.max ?? 5);
        control.step = String(field.step ?? 1);
        control.value = String(field.defaultValue ?? control.min);
        const row = document.createElement("div");
        row.className = "range-row";
        const output = document.createElement("output");
        output.className = "range-value";
        output.textContent = control.value;
        row.append(control, output);
        wrapper.appendChild(row);
        control.addEventListener("input", () => { output.textContent = control.value; });
      } else if (field.type === "text" && field.code === "co") {
        control = document.createElement("textarea");
        control.className = "control";
        control.value = String(field.defaultValue ?? "");
      } else {
        control = createInput(field.type === "number" ? "number" : "text");
        if (field.type === "number") control.min = String(field.min ?? 1);
        control.value = String(field.defaultValue ?? "");
      }

      if (control && field.type !== "counter") {
        control.id = id;
        control.name = field.code;
        control.dataset.fieldCode = field.code;
        control.dataset.fieldType = field.type;
        control.dataset.required = String(required);
        control.required = required;
        control.classList.add("control");
        if (field.type === "select" && field.defaultValue !== undefined) control.value = String(field.defaultValue);
        if (field.type !== "range") wrapper.appendChild(control);
      }
    }

    if (field.description) {
      const hint = document.createElement("span");
      hint.className = "field-hint";
      hint.textContent = field.description;
      wrapper.appendChild(hint);
    }
    return wrapper;

    function createInput(type) {
      const input = document.createElement("input");
      input.type = type;
      return input;
    }
  }

  function renderConfig() {
    const sections = document.getElementById("scout-sections");
    sections.replaceChildren();
    config.sections.forEach((section, sectionIndex) => {
      const sectionId = makeId(section.name || "fields-" + sectionIndex);

      const panel = document.createElement("section");
      panel.className = "panel section-panel";
      panel.id = sectionId;
      const heading = document.createElement("div");
      heading.className = "panel-heading";
      const title = document.createElement("h2");
      title.textContent = section.name || "Fields";
      heading.appendChild(title);
      const count = document.createElement("span");
      count.className = "panel-note";
      count.textContent = (section.fields || []).length + " fields";
      heading.appendChild(count);
      const body = document.createElement("div");
      body.className = "panel-body";
      (section.fields || []).forEach((field, fieldIndex) => body.appendChild(makeField(field, sectionIndex, fieldIndex)));
      panel.append(heading, body);
      sections.appendChild(panel);
    });
    document.getElementById("config-title").textContent = config.page_title || config.title || "Match scouting";
  }

  function applyDefaults() {
    form.reset();
    form.querySelectorAll("[data-field-code]").forEach((control) => {
      const field = config.sections.flatMap((section) => section.fields || []).find((item) => item.code === control.dataset.fieldCode);
      if (!field) return;
      if (field.type === "boolean") control.checked = Boolean(field.defaultValue);
      else if (field.type === "counter") {
        control.dataset.value = String(field.defaultValue ?? 0);
        control.querySelector(".counter-value").textContent = control.dataset.value;
      } else if (field.defaultValue !== undefined) control.value = String(field.defaultValue);
      const matchField = field.code === "matchNumber";
      if (matchField) control.value = String(nextMatchNumber());
      const output = control.closest(".range-row")?.querySelector("output");
      if (output) output.textContent = control.value;
    });
    updateMatchBadge();
  }

  function nextMatchNumber() {
    const matchField = config.sections.flatMap((section) => section.fields || []).find((field) => field.code === "matchNumber");
    const defaultMatch = Number(matchField?.defaultValue) || 1;
    const records = loadRecords();
    const highest = records.reduce((max, record) => Math.max(max, Number(record.data?.matchNumber ?? record.match) || 0), 0);
    return Math.max(defaultMatch, highest + 1);
  }

  function getFormData() {
    const data = {};
    for (const control of form.querySelectorAll("[data-field-code]")) {
      const { fieldCode, fieldType, required } = control.dataset;
      let value;
      if (fieldType === "boolean") value = control.checked;
      else if (fieldType === "counter") value = Number(control.dataset.value);
      else if (fieldType === "number" || fieldType === "range") value = control.value === "" ? "" : Number(control.value);
      else value = control.value.trim();
      if (required === "true" && (value === "" || value === null || value === undefined)) {
        control.focus();
        throw new Error("Please complete the required field: " + fieldCode);
      }
      data[fieldCode] = value;
    }
    return data;
  }

  function updateMatchBadge() {
    const match = form.querySelector('[data-field-code="matchNumber"]');
    document.getElementById("match-badge").textContent = match?.value ? "#" + match.value : "—";
  }

  function recordFromForm() {
    const data = getFormData();
    const row = config.sections.flatMap((section) => section.fields || []).map((field) => data[field.code] ?? "");
    const match = data.matchNumber ?? "";
    const team = data.robot ?? "";
    return {
      savedAt: new Date().toISOString(),
      configTitle: config.title || "QR Scout",
      initials: String(data.scouter || ""),
      match: Number(match) || match,
      team: Number(team) || team,
      teamNumber: config.teamNumber ?? null,
      title: config.title || "QR Scout",
      createdAt: new Date().toISOString(),
      autoFuel: Number(data.autoFuelScored) || 0,
      teleFuel: Number(data.telFuelScored) || 0,
      row,
      data
    };
  }

  function recordsForUi() {
    return loadRecords();
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }

  function renderHistory() {
    const records = recordsForUi();
    document.getElementById("saved-count").textContent = records.length + (records.length === 1 ? " match saved" : " matches saved");
    const items = document.getElementById("history-items");
    if (!records.length) {
      items.innerHTML = '<div class="empty-state">No matches saved yet. Your completed scouting forms will show up here.</div>';
      return;
    }
    items.innerHTML = records.slice().reverse().map((record, reverseIndex) => {
      const index = records.length - 1 - reverseIndex;
      const date = new Date(record.savedAt);
      const when = Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
      const match = record.data?.matchNumber ?? record.match ?? "—";
      const team = record.data?.robot ?? record.team ?? "—";
      return '<article class="saved-card"><div class="saved-card-main"><strong>Match ' + escapeHtml(match) + " · Team " + escapeHtml(team) + '</strong><small>Scouted by ' + escapeHtml(record.data?.scouter ?? record.initials ?? "—") + (when ? " · " + escapeHtml(when) : "") + '</small></div><button class="button record-options-button" type="button" data-open-record data-index="' + index + '" aria-label="Options for match ' + escapeHtml(match) + ', team ' + escapeHtml(team) + '">Options</button></article>';
    }).join("");
  }

  function updatePendingButton() {
    const button = document.getElementById("sync-pending-button");
    const count = readOutbox().length;
    button.textContent = "Sync pending (" + count + ")";
    button.hidden = count === 0;
  }

  function getSheetSettingsFromForm() {
    return {
      sheetId: document.getElementById("sheet-id").value.trim(),
      sheetName: document.getElementById("sheet-tab").value.trim() || "Scouting",
      startColumn: document.getElementById("sheet-column").value.trim().toUpperCase() || "A"
    };
  }

  function validateSheetSettings(settings) {
    if (!/^[a-zA-Z0-9_-]{20,60}$/.test(settings.sheetId)) {
      throw new Error("Enter a valid Google Sheet ID from the URL between /d/ and /edit.");
    }
    if (!settings.sheetName || settings.sheetName.length > 100) throw new Error("Enter a valid sheet tab name (1–100 characters).");
    if (!/^[A-Z]{1,3}$/.test(settings.startColumn)) throw new Error("Start column must be 1–3 letters (A, Z, AA, etc.).");
  }

  async function fetchWithTimeout(url, options, timeoutMs = 12000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
      if (error.name === "AbortError") throw new Error("The request timed out. Your match is still saved locally.");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function postToSheet(entry) {
    const response = await fetchWithTimeout(API_BASE + "/api/sync-sheet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry)
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.ok === false) {
      throw new Error(result?.error || "Sheet sync failed (HTTP " + response.status + ").");
    }
    return result?.status || "Row synced to Google Sheets.";
  }

  function makeSyncPayload(record, settings) {
    return {
      title: record.configTitle,
      teamNumber: config.teamNumber ?? null,
      createdAt: record.savedAt,
      row: record.row,
      sheetId: settings.sheetId,
      sheetName: settings.sheetName,
      startColumn: settings.startColumn
    };
  }

  function saveOutbox(entries) {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(entries));
    updatePendingButton();
  }

  async function flushOutbox() {
    if (!navigator.onLine) {
      showStatus("You are offline. Pending matches will stay queued on this device.", true);
      return;
    }
    let entries = readOutbox();
    if (!entries.length) return;
    let synced = 0;
    for (let index = 0; index < entries.length; index++) {
      try {
        await postToSheet(entries[index].payload);
        synced++;
      } catch (error) {
        const remaining = entries.slice(index);
        saveOutbox(remaining);
        showStatus(synced
          ? synced + " pending match(es) synced; " + remaining.length + " remain queued. " + error.message
          : "Sync failed. " + remaining.length + " match(es) remain queued. " + error.message, true);
        return;
      }
    }
    saveOutbox([]);
    showStatus(synced + (synced === 1 ? " pending match synced." : " pending matches synced."));
    showToast("Pending matches synced");
  }

  async function saveAndMaybeSync(action) {
    if (!form.reportValidity()) return;
    let record;
    try {
      record = recordFromForm();
    } catch (error) {
      showStatus(error.message, true);
      return;
    }
    let records;
    try {
      records = loadRecords();
      records.push(record);
      localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
      renderHistory();
      applyDefaults();
    } catch (error) {
      console.error("Could not save scouting match locally.", error);
      showStatus("Could not save this match on this device. " + error.message, true);
      return;
    }
    if (action !== "sync") {
      showStatus("Match saved on this device.");
      showToast(action === "qr" ? "Match saved; QR code ready" : "Match saved");
      return record;
    }
    let settings;
    try {
      settings = readSettings();
      validateSheetSettings(settings);
    } catch (error) {
      showStatus("Match saved locally, but sheet sync is not configured. " + error.message, true);
      return;
    }
    showStatus("Match saved locally. Sending it to Google Sheets…");
    const payload = makeSyncPayload(record, settings);
    try {
      const message = await postToSheet(payload);
      showStatus("Match saved locally and synced. " + message);
      showToast("Match synced to Google Sheets");
    } catch (error) {
      console.error("Could not sync scouting match.", error);
      try {
        const outbox = readOutbox();
        outbox.push({ queuedAt: new Date().toISOString(), payload });
        saveOutbox(outbox);
        showStatus("Match saved locally. Sync failed and was queued for retry: " + error.message, true);
      } catch (queueError) {
        console.error("Could not queue scouting match for retry.", queueError);
        showStatus("Match saved locally, but sync and retry queue failed. " + error.message, true);
      }
    }
    return record;
  }

  document.getElementById("sheet-settings-button").addEventListener("click", () => {
    document.getElementById("sheet-settings-dialog").showModal();
  });

  document.getElementById("sheet-settings-form").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const settings = getSheetSettingsFromForm();
      validateSheetSettings(settings);
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      showStatus("Google Sheet saved. Matches can now be synced.");
      showToast("Sheet settings saved");
    } catch (error) {
      showStatus(error.message, true);
    }
  });

  document.getElementById("commit-button").addEventListener("click", () => {
    if (!form.reportValidity()) return;
    try {
      getFormData();
      const commitStatus = document.getElementById("commit-status");
      commitStatus.textContent = "";
      commitStatus.classList.remove("error");
      document.getElementById("commit-dialog").showModal();
    } catch (error) {
      showStatus(error.message, true);
    }
  });

  document.querySelectorAll("[data-commit-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!form.reportValidity()) {
        document.getElementById("commit-dialog").close();
        return;
      }
      const action = button.dataset.commitAction;
      const commitStatus = document.getElementById("commit-status");
      const choices = Array.from(document.querySelectorAll("[data-commit-action]"));
      choices.forEach((choice) => { choice.disabled = true; });
      commitStatus.textContent = action === "sync" ? "Saving and syncing match…" : action === "qr" ? "Saving match and creating QR…" : "Saving match…";
      commitStatus.classList.remove("error");
      try {
        const record = await saveAndMaybeSync(action);
        if (!record) {
          commitStatus.textContent = status.textContent;
          commitStatus.classList.add("error");
          return;
        }
        document.getElementById("commit-dialog").close();
        if (action === "qr") createQr(record);
      } catch (error) {
        console.error("Could not commit scouting match.", error);
        commitStatus.textContent = error.message || "Could not commit scouting match.";
        commitStatus.classList.add("error");
      } finally {
        choices.forEach((choice) => { choice.disabled = false; });
      }
    });
  });

  form.addEventListener("input", updateMatchBadge);
  form.addEventListener("change", updateMatchBadge);
  form.addEventListener("click", (event) => {
    const button = event.target.closest("[data-counter-step]");
    if (!button) return;
    const counter = button.closest('[data-field-type="counter"]');
    const step = Number(counter.dataset.step);
    const min = Number(counter.dataset.min);
    const value = Math.max(min, Number(counter.dataset.value) + Number(button.dataset.counterStep) * step);
    counter.dataset.value = String(value);
    counter.querySelector(".counter-value").textContent = String(value);
  });

  document.getElementById("reset-button").addEventListener("click", () => {
    if (!confirm("Reset all fields in this scouting form?")) return;
    applyDefaults();
    showStatus("Form reset. Your saved matches are unchanged.");
  });

  function qrPayload(record) {
    return JSON.stringify({
      title: record.title || record.configTitle || config.title || "QR Scout",
      teamNumber: record.teamNumber ?? config.teamNumber ?? null,
      createdAt: record.createdAt || record.savedAt || new Date().toISOString(),
      data: record.data || record
    });
  }

  function createQr(record) {
    if (typeof QRCode === "undefined") throw new Error("The QR generator did not load. Refresh the page and try again.");
    const preview = document.getElementById("qr-preview");
    preview.replaceChildren();
    const encoded = qrPayload(record);
    new QRCode(preview, {
      text: encoded,
      width: 300,
      height: 300,
      colorDark: "#000000",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.L
    });
    document.getElementById("qr-caption").textContent = "Match " + (record.data?.matchNumber ?? record.match ?? "—") + " · Team " + (record.data?.robot ?? record.team ?? "—");
    document.getElementById("qr-status").textContent = "This code contains the saved scouting data. Save the PNG to keep or share it.";
    const downloadButton = document.getElementById("download-qr");
    downloadButton.dataset.filename = "fieldnotes-match-" + (record.data?.matchNumber ?? record.match ?? "unknown") + "-team-" + (record.data?.robot ?? record.team ?? "unknown") + "-qr.png";
    downloadButton.disabled = false;
    document.getElementById("qr-dialog").showModal();
  }

  function downloadBlob(filename, content, mimeType) {
    const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function syncSavedRecord(record) {
    const settings = readSettings();
    validateSheetSettings(settings);
    const payload = {
      title: record.title || record.configTitle || config.title || "QR Scout",
      teamNumber: record.teamNumber ?? config.teamNumber ?? null,
      createdAt: record.createdAt || record.savedAt,
      row: record.row || Object.values(record.data || record),
      sheetId: settings.sheetId,
      sheetName: settings.sheetName,
      startColumn: settings.startColumn
    };
    try {
      showStatus("Syncing saved match to Google Sheets…");
      const message = await postToSheet(payload);
      showStatus("Saved match synced. " + message);
      showToast("Match synced to Google Sheets");
    } catch (error) {
      const entries = readOutbox();
      entries.push({ queuedAt: new Date().toISOString(), payload });
      saveOutbox(entries);
      showStatus("Sync failed; saved match is queued for retry: " + error.message, true);
    }
  }

  const recordDialog = document.getElementById("record-dialog");
  document.getElementById("history-items").addEventListener("click", (event) => {
    const button = event.target.closest("[data-open-record]");
    if (!button) return;
    try {
      const records = loadRecords();
      const index = Number(button.dataset.index);
      const record = records[index];
      if (!record) throw new Error("Saved match not found.");
      const match = record.data?.matchNumber ?? record.match ?? "—";
      const team = record.data?.robot ?? record.team ?? "—";
      const date = new Date(record.savedAt);
      const when = Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
      recordDialog.dataset.index = String(index);
      document.getElementById("record-dialog-summary").textContent = "Match " + match + " · Team " + team;
      document.getElementById("record-dialog-meta").textContent = "Scouted by " + (record.data?.scouter ?? record.initials ?? "—") + (when ? " · Saved " + when : "");
      recordDialog.showModal();
    } catch (error) {
      console.error("Could not open saved match options.", error);
      showStatus("Could not open saved match options. " + error.message, true);
    }
  });

  recordDialog.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const index = Number(recordDialog.dataset.index);
    const action = button.dataset.action;
    try {
      const records = loadRecords();
      const record = records[index];
      if (!record) throw new Error("Saved match not found.");
      if (action === "qr") {
        recordDialog.close();
        createQr(record);
        return;
      }
      if (action === "json") {
        recordDialog.close();
        const filename = "fieldnotes-match-" + (record.data?.matchNumber ?? record.match ?? index + 1) + "-team-" + (record.data?.robot ?? record.team ?? "unknown") + ".json";
        downloadBlob(filename, JSON.stringify(record, null, 2), "application/json");
        showToast("Saved match JSON downloaded");
        return;
      }
      if (action === "sync") {
        recordDialog.close();
        await syncSavedRecord(record);
        return;
      }
      if (action !== "delete") return;
      if (!confirm("Delete this saved match? This cannot be undone.")) return;
      records.splice(index, 1);
      localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
      recordDialog.close();
      renderHistory();
      showToast("Saved match removed");
    } catch (error) {
      console.error("Could not complete the saved match action.", error);
      showStatus("Could not complete this saved match action. " + error.message, true);
    }
  });

  document.getElementById("clear-history").addEventListener("click", () => {
    try {
      if (!loadRecords().length || !confirm("Delete all saved matches from this device?")) return;
      localStorage.removeItem(RECORDS_KEY);
      renderHistory();
      applyDefaults();
      showToast("All saved matches cleared");
    } catch (error) {
      console.error("Could not clear saved matches.", error);
      showStatus("Could not clear saved matches. " + error.message, true);
    }
  });

  document.getElementById("download-qr").addEventListener("click", () => {
    const canvas = document.querySelector("#qr-preview canvas");
    const image = document.querySelector("#qr-preview img");
    const url = canvas?.toDataURL("image/png") || image?.src;
    if (!url) {
      document.getElementById("qr-status").textContent = "QR image is not ready to download.";
      return;
    }
    const link = document.createElement("a");
    link.href = url;
    link.download = document.getElementById("download-qr").dataset.filename || "fieldnotes-match-qr.png";
    link.click();
  });

  document.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => document.getElementById(button.dataset.closeDialog).close());
  });

  function openConfigEditor() {
    document.getElementById("config-editor").value = JSON.stringify(config, null, 2);
    document.getElementById("config-status").textContent = "";
    document.getElementById("config-status").classList.remove("error");
    document.getElementById("config-dialog").showModal();
  }

  function applyEditedConfig(candidate) {
    validateConfig(candidate);
    localStorage.setItem(CONFIG_KEY, JSON.stringify(candidate));
    config = candidate;
    renderConfig();
    applyDefaults();
    document.getElementById("config-title").textContent = config.page_title || config.title || "Match scouting";
    document.getElementById("config-status").textContent = "Config applied and saved in this browser.";
    document.getElementById("config-status").classList.remove("error");
    showStatus("Custom scouting config loaded.");
  }

  document.getElementById("edit-config-button").addEventListener("click", openConfigEditor);
  document.getElementById("apply-config").addEventListener("click", () => {
    const configStatus = document.getElementById("config-status");
    try {
      applyEditedConfig(JSON.parse(document.getElementById("config-editor").value));
    } catch (error) {
      configStatus.textContent = error instanceof SyntaxError ? "Invalid JSON: " + error.message : error.message;
      configStatus.classList.add("error");
    }
  });

  const configFile = document.getElementById("config-file");
  document.getElementById("load-config-file").addEventListener("click", () => configFile.click());
  configFile.addEventListener("change", async () => {
    const file = configFile.files[0];
    if (!file) return;
    try {
      document.getElementById("config-editor").value = await file.text();
      document.getElementById("config-status").textContent = "Loaded " + file.name + ". Apply to use it.";
      document.getElementById("config-status").classList.remove("error");
    } catch (error) {
      document.getElementById("config-status").textContent = "Could not read the selected config file.";
      document.getElementById("config-status").classList.add("error");
      console.error("Could not read scouting config file.", error);
    } finally {
      configFile.value = "";
    }
  });

  document.getElementById("reset-config").addEventListener("click", async () => {
    try {
      const response = await fetch("default-config.json", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load default config (HTTP " + response.status + ").");
      const defaultConfig = validateConfig(await response.json());
      document.getElementById("config-editor").value = JSON.stringify(defaultConfig, null, 2);
      applyEditedConfig(defaultConfig);
    } catch (error) {
      document.getElementById("config-status").textContent = error.message;
      document.getElementById("config-status").classList.add("error");
    }
  });

  document.getElementById("download-config").addEventListener("click", () => {
    try {
      const candidate = validateConfig(JSON.parse(document.getElementById("config-editor").value));
      downloadBlob("scouting-config.json", JSON.stringify(candidate, null, 2), "application/json");
      document.getElementById("config-status").textContent = "Config JSON downloaded.";
      document.getElementById("config-status").classList.remove("error");
    } catch (error) {
      document.getElementById("config-status").textContent = error instanceof SyntaxError ? "Invalid JSON: " + error.message : error.message;
      document.getElementById("config-status").classList.add("error");
    }
  });

  document.getElementById("export-json-button").addEventListener("click", () => {
    try {
      const records = loadRecords();
      if (!records.length) return showToast("Save a match before creating a JSON backup");
      const backup = { format: "fieldnotes-scouting", version: 1, exportedAt: new Date().toISOString(), records };
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "fieldnotes-scouting-backup.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      console.error("Could not export scouting JSON.", error);
      showStatus("Could not export JSON backup. " + error.message, true);
    }
  });

  document.getElementById("sync-pending-button").addEventListener("click", flushOutbox);
  window.addEventListener("online", flushOutbox);

  async function initialize() {
    try {
      const response = await fetch("default-config.json", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load default-config.json (HTTP " + response.status + ").");
      const defaultConfig = validateConfig(await response.json());
      config = validateConfig(readJsonStorage(CONFIG_KEY, defaultConfig));
      renderConfig();
      const settings = readSettings();
      document.getElementById("sheet-id").value = settings.sheetId;
      document.getElementById("sheet-tab").value = settings.sheetName;
      document.getElementById("sheet-column").value = settings.startColumn;
      renderHistory();
      updatePendingButton();
      applyDefaults();
      showStatus("Default config loaded. Save locally or sync directly to your Google Sheet.");
    } catch (error) {
      console.error("Could not initialize the scouting form.", error);
      document.getElementById("config-error").textContent = "Could not load the scouting form: " + error.message + " Open the site through an HTTP/HTTPS web server, then try again.";
      document.getElementById("config-error").hidden = false;
      showStatus("The scouting form could not be loaded.", true);
      document.getElementById("commit-button").disabled = true;
    }
  }

  initialize();
})();
