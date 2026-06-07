// app.js
import * as prompts from "./lib/prompts.js";
import * as storage from "./lib/storage.js";
import * as logger from "./lib/logger.js";
import * as llm from "./lib/llm.js";

// ─── 设置面板 ─────────────────────────────
const settingsOverlay = document.getElementById("settings-overlay");
const btnSettings = document.getElementById("btn-settings");
const btnSave = document.getElementById("btn-settings-save");
const btnCancel = document.getElementById("btn-settings-cancel");
const btnExportLogs = document.getElementById("btn-export-logs");

const inputApiKey = document.getElementById("setting-api-key");
const inputBaseUrl = document.getElementById("setting-base-url");
const inputModel = document.getElementById("setting-model");
const inputTimeout = document.getElementById("setting-timeout");

function loadSettingsToForm() {
  const s = storage.get("settings", storage.DEFAULT_SETTINGS);
  inputApiKey.value = s.api_key || "";
  inputBaseUrl.value = s.base_url || storage.DEFAULT_SETTINGS.base_url;
  inputModel.value = s.model || storage.DEFAULT_SETTINGS.model;
  inputTimeout.value = s.timeout_seconds || storage.DEFAULT_SETTINGS.timeout_seconds;
}

function openSettings() {
  loadSettingsToForm();
  settingsOverlay.classList.remove("hidden");
}

function closeSettings() {
  settingsOverlay.classList.add("hidden");
}

function saveSettings() {
  const s = {
    api_key: inputApiKey.value.trim(),
    base_url: inputBaseUrl.value.trim() || storage.DEFAULT_SETTINGS.base_url,
    model: inputModel.value.trim() || storage.DEFAULT_SETTINGS.model,
    timeout_seconds: parseInt(inputTimeout.value, 10) || storage.DEFAULT_SETTINGS.timeout_seconds,
  };
  storage.set("settings", s);
  closeSettings();
  updateMainState();
}

btnSettings.addEventListener("click", openSettings);
btnSave.addEventListener("click", saveSettings);
btnCancel.addEventListener("click", closeSettings);
btnExportLogs.addEventListener("click", () => logger.downloadLogs());

// 点击遮罩外部关闭
settingsOverlay.addEventListener("click", (e) => {
  if (e.target === settingsOverlay) closeSettings();
});

// ─── 主界面状态 ────────────────────────────
function updateMainState() {
  const s = storage.get("settings", storage.DEFAULT_SETTINGS);
  const main = document.getElementById("main");
  main.replaceChildren();
  const p = document.createElement("p");
  if (!s.api_key) {
    p.append("⚠ 尚未配置 API key。");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "goto-settings";
    btn.textContent = "去设置";
    btn.addEventListener("click", openSettings);
    p.append(btn);
  } else {
    p.textContent = "✅ 设置已就绪。下一步装配编辑器主界面。";
  }
  main.append(p);
}

// 启动
updateMainState();
console.log("editor-kit ready");
