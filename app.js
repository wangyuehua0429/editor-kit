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
  renderMain();
}

btnSettings.addEventListener("click", openSettings);
btnSave.addEventListener("click", saveSettings);
btnCancel.addEventListener("click", closeSettings);
btnExportLogs.addEventListener("click", () => logger.downloadLogs());

settingsOverlay.addEventListener("click", (e) => {
  if (e.target === settingsOverlay) closeSettings();
});

// ─── 主界面 ──────────────────────────────
function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderNoKey(main) {
  main.replaceChildren();
  const p = document.createElement("p");
  p.append("⚠ 尚未配置 API key。");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "goto-settings";
  btn.textContent = "去设置";
  btn.addEventListener("click", openSettings);
  p.append(btn);
  main.append(p);
}

function renderError(main, msg) {
  main.replaceChildren();
  const p = document.createElement("p");
  p.style.color = "red";
  p.textContent = msg;
  main.append(p);
}

async function renderMain() {
  const s = storage.get("settings", storage.DEFAULT_SETTINGS);
  const main = document.getElementById("main");
  if (!s.api_key) {
    renderNoKey(main);
    return;
  }

  let config;
  try {
    config = await prompts.loadConfig();
  } catch (e) {
    renderError(main, `配置加载失败：${e.message}`);
    return;
  }

  const last = storage.get("last_session", {
    mode: "polish",
    title: "",
    body: "",
    tone: config.polish.default_tone,
    must_preserve: "",
    selected_platforms: config.platforms.map((p) => p.key),
  });

  const platformCheckboxes = config.platforms
    .filter((p) => p.enabled)
    .sort((a, b) => a.order - b.order)
    .map(
      (p) => `
        <label class="platform-check">
          <input type="checkbox" name="platform" value="${escapeHtml(p.key)}"
            ${last.selected_platforms.includes(p.key) ? "checked" : ""} />
          ${escapeHtml(p.name)}
        </label>`
    )
    .join("");

  const toneOptions = config.polish.tones
    .map(
      (t) =>
        `<option value="${escapeHtml(t)}" ${t === last.tone ? "selected" : ""}>${escapeHtml(t)}</option>`
    )
    .join("");

  // 所有动态值均经 escapeHtml 处理，下述模板字符串只含静态结构 + 已转义内容
  main.innerHTML = `
    <section class="editor">
      <div class="mode-bar">
        <label><input type="radio" name="mode" value="direct" ${last.mode === "direct" ? "checked" : ""}> 直接适配</label>
        <label><input type="radio" name="mode" value="polish" ${last.mode === "polish" ? "checked" : ""}> 先润色再适配</label>
      </div>

      <label class="input-block">
        标题（可选，AI 会重拟）
        <input id="input-title" type="text" value="${escapeHtml(last.title)}" />
      </label>

      <label class="input-block">
        正文 / 素材
        <textarea id="input-body" rows="12">${escapeHtml(last.body)}</textarea>
      </label>

      <div class="polish-controls">
        <label>
          润色取向
          <select id="input-tone">${toneOptions}</select>
        </label>
        <label class="grow">
          必须原样保留（用 / 或换行分隔）
          <input id="input-must-preserve" type="text" value="${escapeHtml(last.must_preserve)}" placeholder="如：张三、12.3%、《XX 通知》" />
        </label>
      </div>

      <div class="action-bar">
        <div class="platforms">${platformCheckboxes}</div>
        <button id="btn-adapt" type="button" class="primary">✨ 一键改写</button>
      </div>
    </section>

    <section id="results" class="results"></section>
  `;

  bindEditorEvents();
}

function bindEditorEvents() {
  const onChange = () => saveLastSession();
  document.querySelectorAll("#main input, #main textarea, #main select").forEach((el) => {
    el.addEventListener("change", onChange);
    el.addEventListener("input", debounce(onChange, 500));
  });

  const btn = document.getElementById("btn-adapt");
  btn.addEventListener("click", onAdaptClick);
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function collectSession() {
  return {
    mode: document.querySelector('input[name="mode"]:checked')?.value || "polish",
    title: document.getElementById("input-title").value,
    body: document.getElementById("input-body").value,
    tone: document.getElementById("input-tone").value,
    must_preserve: document.getElementById("input-must-preserve").value,
    selected_platforms: Array.from(
      document.querySelectorAll('input[name="platform"]:checked')
    ).map((el) => el.value),
  };
}

function saveLastSession() {
  storage.set("last_session", collectSession());
}

function onAdaptClick() {
  const session = collectSession();
  if (!session.body.trim()) {
    alert("请填入正文 / 素材内容");
    return;
  }
  if (session.selected_platforms.length === 0) {
    alert("请至少勾选 1 个平台");
    return;
  }
  // 实际适配在 Phase 6 实现
  console.log("ready to adapt", session);
  alert(`即将适配 ${session.selected_platforms.length} 个平台（Phase 6 实现）`);
}

// ─── 结果区 ──────────────────────────────────
// 每平台状态：'pending' | 'loading' | 'success' | 'error'

function renderResultsSkeleton(platforms, showBaseline) {
  const container = document.getElementById("results");
  const baselineHtml = showBaseline
    ? `
    <div id="baseline" class="result-card baseline">
      <div class="result-head">
        <h3>📄 专业润色稿</h3>
        <button class="btn-copy" data-target="baseline-body" disabled>复制全文</button>
      </div>
      <div class="warning">⚠ 请人工核对人名、职务、时间、数字、引语</div>
      <div id="baseline-body" class="result-body">等待润色……</div>
    </div>`
    : "";

  const cardsHtml = platforms
    .map(
      (p) => `
    <div class="result-card" data-platform="${p.key}">
      <div class="result-head">
        <h3>${p.name}</h3>
        <div class="result-actions">
          <button class="btn-retry hidden" data-platform="${p.key}">重试</button>
          <button class="btn-copy" data-target="body-${p.key}" disabled>复制</button>
        </div>
      </div>
      <div class="warning">⚠ 请人工核对人名、职务、时间、数字、引语</div>
      <div id="body-${p.key}" class="result-body">等待开始……</div>
    </div>`
    )
    .join("");

  container.innerHTML = baselineHtml + `<div class="cards">${cardsHtml}</div>`;

  // 绑定复制按钮（每次重渲染都要重绑）
  container.querySelectorAll(".btn-copy").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.target;
      const text = document.getElementById(id)?.innerText || "";
      navigator.clipboard.writeText(text).then(
        () => {
          const orig = btn.textContent;
          btn.textContent = "✓ 已复制";
          setTimeout(() => (btn.textContent = orig), 1500);
        },
        () => alert("复制失败，请手动选择文本")
      );
    });
  });
}

function setResultState(platformKey, state, content = "") {
  const bodyId = platformKey === "baseline" ? "baseline-body" : `body-${platformKey}`;
  const card =
    platformKey === "baseline"
      ? document.getElementById("baseline")
      : document.querySelector(`.result-card[data-platform="${platformKey}"]`);
  if (!card) return;

  const body = document.getElementById(bodyId);
  const copyBtn = card.querySelector(".btn-copy");
  const retryBtn = card.querySelector(".btn-retry");

  card.classList.remove("loading", "success", "error");
  card.classList.add(state);

  if (state === "loading") {
    body.textContent = "⏳ 正在生成……";
    if (copyBtn) copyBtn.disabled = true;
    if (retryBtn) retryBtn.classList.add("hidden");
  } else if (state === "success") {
    body.textContent = content;
    if (copyBtn) copyBtn.disabled = false;
    if (retryBtn) retryBtn.classList.add("hidden");
  } else if (state === "error") {
    body.textContent = `❌ ${content}`;
    if (copyBtn) copyBtn.disabled = true;
    if (retryBtn) retryBtn.classList.remove("hidden");
  }
}

// 启动
renderMain();
console.log("editor-kit ready");
