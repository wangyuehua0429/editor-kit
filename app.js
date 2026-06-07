// app.js
import * as prompts from "./lib/prompts.js";
import * as storage from "./lib/storage.js";
import * as logger from "./lib/logger.js";
import * as llm from "./lib/llm.js";

// ─── 浏览器能力检测 ────────────────────────
(function checkBrowserSupport() {
  const missing = [];
  if (typeof fetch !== "function") missing.push("fetch");
  if (!window.crypto?.subtle) missing.push("crypto.subtle");
  if (!navigator.clipboard?.writeText) missing.push("clipboard");
  if (typeof localStorage === "undefined") missing.push("localStorage");
  if (missing.length > 0) {
    document.body.innerHTML = `
      <div style="padding:2rem;color:red;font-family:sans-serif;">
        <h2>浏览器不兼容</h2>
        <p>当前浏览器缺以下能力：${missing.join(", ")}</p>
        <p>请使用 Chrome / Edge / Safari 现代版本。</p>
      </div>`;
    throw new Error("Unsupported browser");
  }
})();

// ─── 设置面板 ─────────────────────────────
const settingsOverlay = document.getElementById("settings-overlay");
const btnSettings = document.getElementById("btn-settings");
const btnSave = document.getElementById("btn-settings-save");
const btnCancel = document.getElementById("btn-settings-cancel");
const btnExportLogs = document.getElementById("btn-export-logs");
const btnReset = document.getElementById("btn-reset");

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

// 重置：清 prompt 缓存 + 清 last_session（标题/正文/取向/必保留/勾选）+ 刷新页面。
// 保留 settings（API key 等）和 logs。
btnReset.addEventListener("click", () => {
  if (!confirm("确认重置？将清空输入框、平台勾选和 prompt 缓存。\n设置和日志会保留。")) return;
  prompts.clearCache();
  storage.remove("last_session");
  window.location.reload();
});

// 移除了「点遮罩关设置」监听 —— 误触频繁，用户在输入 API key/URL 时
// 一旦点到遮罩就关掉，输入丢失。改为只有「保存」「取消」两个按钮可关闭。

// ─── 主界面 ──────────────────────────────
function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// 剥 Markdown 语法，得到可粘贴到纯文本场景的版本。
// 处理：标题、引用、水平线、粗体、斜体、链接、行内代码、列表项编号。
function stripMarkdown(text) {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s*/gm, "")
    .replace(/^[-*_]{3,}\s*$/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^[\s]*[-*+]\s+/gm, "")
    .replace(/^[\s]*\d+\.\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

  // 预检所有 prompt 文件可加载
  const allFiles = [
    config.polish.prompt,
    ...config.platforms.filter((p) => p.enabled).map((p) => p.prompt),
  ];
  const missing = [];
  for (const f of allFiles) {
    try {
      await prompts.loadPrompt(f);
    } catch (e) {
      missing.push(f);
    }
  }
  if (missing.length > 0) {
    main.innerHTML = `<p style="color:red">prompt 文件缺失：${missing.join(", ")}<br>请检查 prompts/ 目录。</p>`;
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
          必须原样保留（用空格、/或换行、顿号分隔均可）
          <input id="input-must-preserve" type="text" value="${escapeHtml(last.must_preserve)}" placeholder="如：张三、12.3%、《XX 通知》" />
        </label>
      </div>

      <div class="action-bar">
        <div class="platforms">${platformCheckboxes}</div>
        <button id="btn-polish-only" type="button">📄 仅润色</button>
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

  // 模式切换时清空已有结果
  document.querySelectorAll('input[name="mode"]').forEach((el) => {
    el.addEventListener("change", () => {
      document.getElementById("results").innerHTML = "";
    });
  });

  const btn = document.getElementById("btn-adapt");
  btn.addEventListener("click", onAdaptClick);
  document.getElementById("btn-polish-only").addEventListener("click", onPolishOnlyClick);
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

async function onAdaptClick() {
  const session = collectSession();
  if (!session.body.trim()) {
    alert("请填入正文 / 素材内容");
    return;
  }
  if (session.selected_platforms.length === 0) {
    alert("请至少勾选 1 个平台");
    return;
  }

  const config = await prompts.loadConfig();
  const selectedPlatforms = config.platforms.filter(
    (p) => session.selected_platforms.includes(p.key) && p.enabled
  );

  const showBaseline = session.mode === "polish";
  renderResultsSkeleton(selectedPlatforms, showBaseline);

  const btn = document.getElementById("btn-adapt");
  btn.disabled = true;
  btn.textContent = "⏳ 适配中……";

  try {
    let inputForPlatforms = session.body;

    if (session.mode === "polish") {
      // Step 1: 润色
      setResultState("baseline", "loading");
      try {
        const baseline = await adaptOne({
          platformKey: "baseline",
          promptFile: config.polish.prompt,
          vars: {
            INPUT: session.body,
            TITLE: session.title,
            TONE: session.tone,
            MUST_PRESERVE: session.must_preserve,
          },
        });
        setResultState("baseline", "success", baseline);
        inputForPlatforms = baseline;
      } catch (e) {
        setResultState("baseline", "error", e.message);
        // 基准稿失败,不进入第二步
        return;
      }
    }

    // Step 2: 并行适配各平台
    selectedPlatforms.forEach((p) => setResultState(p.key, "loading"));

    await Promise.all(
      selectedPlatforms.map(async (p) => {
        try {
          const out = await adaptOne({
            platformKey: p.key,
            promptFile: p.prompt,
            vars: { INPUT: inputForPlatforms, TITLE: session.title },
          });
          setResultState(p.key, "success", out);
        } catch (e) {
          setResultState(p.key, "error", e.message);
        }
      })
    );
  } finally {
    btn.disabled = false;
    btn.textContent = "✨ 一键改写";
  }
}

// 仅润色：调 polish.txt 1 次，渲染 1 张 baseline 卡。不走 5 个平台。
async function onPolishOnlyClick() {
  const session = collectSession();
  if (!session.body.trim()) {
    alert("请填入正文 / 素材内容");
    return;
  }

  const config = await prompts.loadConfig();
  renderResultsSkeleton([], true);

  const btnAdapt = document.getElementById("btn-adapt");
  const btnPolish = document.getElementById("btn-polish-only");
  btnAdapt.disabled = true;
  btnPolish.disabled = true;
  btnPolish.textContent = "⏳ 润色中……";

  try {
    setResultState("baseline", "loading");
    try {
      const baseline = await adaptOne({
        platformKey: "baseline",
        promptFile: config.polish.prompt,
        vars: {
          INPUT: session.body,
          TITLE: session.title,
          TONE: session.tone,
          MUST_PRESERVE: session.must_preserve,
        },
      });
      setResultState("baseline", "success", baseline);
    } catch (e) {
      setResultState("baseline", "error", e.message);
    }
  } finally {
    btnAdapt.disabled = false;
    btnPolish.disabled = false;
    btnPolish.textContent = "📄 仅润色";
  }
}

// ─── 结果区 ──────────────────────────────────
// 每平台状态：'pending' | 'loading' | 'success' | 'error'

function renderResultsSkeleton(platforms, showBaseline) {
  const container = document.getElementById("results");
  const baselineHtml = showBaseline
    ? `
    <div id="baseline" class="result-card baseline" data-platform="baseline">
      <div class="result-head">
        <h3>📄 专业润色稿</h3>
        <div class="result-actions">
          <button class="btn-regen" data-platform="baseline">换一版</button>
          <button class="btn-clear hidden" data-platform="baseline">清空</button>
          <button class="btn-copy-md" data-target="baseline-body" disabled>复制 MD</button>
          <button class="btn-copy-txt" data-target="baseline-body" disabled>复制 TXT</button>
        </div>
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
          <button class="btn-regen" data-platform="${p.key}">换一版</button>
          <button class="btn-clear hidden" data-platform="${p.key}">清空</button>
          <button class="btn-copy-md" data-target="body-${p.key}" disabled>复制 MD</button>
          <button class="btn-copy-txt" data-target="body-${p.key}" disabled>复制 TXT</button>
        </div>
      </div>
      <div class="warning">⚠ 请人工核对人名、职务、时间、数字、引语</div>
      <div id="body-${p.key}" class="result-body">等待开始……</div>
    </div>`
    )
    .join("");

  container.innerHTML = baselineHtml + `<div class="cards">${cardsHtml}</div>`;

  // 绑定复制按钮（MD 保留原文，TXT 剥 Markdown 语法）
  function bindCopyButtons(selector, format) {
    container.querySelectorAll(selector).forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.target;
        const raw = document.getElementById(id)?.innerText || "";
        const text = format === "txt" ? stripMarkdown(raw) : raw;
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
  bindCopyButtons(".btn-copy-md", "md");
  bindCopyButtons(".btn-copy-txt", "txt");

  // 绑定「换一版」按钮
  container.querySelectorAll(".btn-regen").forEach((btn) => {
    btn.addEventListener("click", () => {
      regenerateOnePlatform(btn.dataset.platform);
    });
  });

  // 绑定「清空」按钮
  container.querySelectorAll(".btn-clear").forEach((btn) => {
    btn.addEventListener("click", () => {
      clearOnePlatform(btn.dataset.platform);
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
  const copyBtns = card.querySelectorAll(".btn-copy-md, .btn-copy-txt");
  const regenBtn = card.querySelector(".btn-regen");
  const clearBtn = card.querySelector(".btn-clear");

  card.classList.remove("loading", "success", "error");
  card.classList.add(state);

  if (state === "loading") {
    body.textContent = "⏳ 正在生成……";
    copyBtns.forEach((b) => (b.disabled = true));
    if (regenBtn) regenBtn.disabled = true;
    if (clearBtn) clearBtn.classList.add("hidden");
  } else if (state === "success") {
    body.textContent = content;
    copyBtns.forEach((b) => (b.disabled = false));
    if (regenBtn) regenBtn.disabled = false;
    if (clearBtn) clearBtn.classList.remove("hidden");
  } else if (state === "error") {
    body.textContent = `❌ ${content}`;
    copyBtns.forEach((b) => (b.disabled = true));
    if (regenBtn) regenBtn.disabled = false;
    if (clearBtn) clearBtn.classList.remove("hidden");
  }
}

// ─── 适配核心 ────────────────────────────────
// 调单个 prompt，返回 LLM 输出。负责日志记录。
async function adaptOne({ platformKey, promptFile, vars }) {
  const settings = storage.get("settings", storage.DEFAULT_SETTINGS);
  const promptTemplate = await prompts.loadPrompt(promptFile);
  const filled = prompts.fillPlaceholders(promptTemplate, vars);

  const t0 = Date.now();
  let output = "";
  let status = "ok";
  let errorMsg = null;
  try {
    output = await llm.complete({
      baseUrl: settings.base_url,
      apiKey: settings.api_key,
      model: settings.model,
      messages: [{ role: "user", content: filled }],
      timeoutSeconds: settings.timeout_seconds,
    });
  } catch (e) {
    status = e.code || "error";
    errorMsg = e.message;
  } finally {
    await logger.logCall({
      platform: platformKey,
      prompt_file: promptFile,
      prompt_text: filled,
      input_text: vars.INPUT || "",
      output_text: output,
      duration_ms: Date.now() - t0,
      status,
    });
  }

  if (errorMsg) throw new llm.LLMError(errorMsg, status);
  return output;
}

async function regenerateOnePlatform(platformKey) {
  const session = collectSession();

  // 基准稿：直接用原稿 + 润色取向 + 必保留
  if (platformKey === "baseline") {
    setResultState("baseline", "loading");
    try {
      const config = await prompts.loadConfig();
      const out = await adaptOne({
        platformKey: "baseline",
        promptFile: config.polish.prompt,
        vars: {
          INPUT: session.body,
          TITLE: session.title,
          TONE: session.tone,
          MUST_PRESERVE: session.must_preserve,
        },
      });
      setResultState("baseline", "success", out);
    } catch (e) {
      setResultState("baseline", "error", e.message);
    }
    return;
  }

  // 平台：润色模式用基准稿,直接模式用原稿
  const config = await prompts.loadConfig();
  const p = config.platforms.find((x) => x.key === platformKey);
  if (!p) return;

  let input = session.body;
  if (session.mode === "polish") {
    const baseline = document.getElementById("baseline-body")?.innerText || "";
    if (baseline && !baseline.startsWith("❌") && !baseline.startsWith("⏳")) {
      input = baseline;
    } else {
      alert("基准稿尚未生成成功，无法重试单平台。请重新整体适配。");
      return;
    }
  }

  setResultState(platformKey, "loading");
  try {
    const out = await adaptOne({
      platformKey: p.key,
      promptFile: p.prompt,
      vars: { INPUT: input, TITLE: session.title },
    });
    setResultState(platformKey, "success", out);
  } catch (e) {
    setResultState(platformKey, "error", e.message);
  }
}

function clearOnePlatform(platformKey) {
  const bodyId = platformKey === "baseline" ? "baseline-body" : `body-${platformKey}`;
  const card =
    platformKey === "baseline"
      ? document.getElementById("baseline")
      : document.querySelector(`.result-card[data-platform="${platformKey}"]`);
  if (!card) return;

  const body = document.getElementById(bodyId);
  const copyBtns = card.querySelectorAll(".btn-copy-md, .btn-copy-txt");
  const regenBtn = card.querySelector(".btn-regen");
  const clearBtn = card.querySelector(".btn-clear");

  body.textContent = platformKey === "baseline" ? "等待润色……" : "等待开始……";
  card.classList.remove("loading", "success", "error");
  copyBtns.forEach((b) => (b.disabled = true));
  if (regenBtn) regenBtn.disabled = false;
  if (clearBtn) clearBtn.classList.add("hidden");
}

// 启动
renderMain();
console.log("editor-kit ready");
