// app.js
import * as prompts from "./lib/prompts.js";
import * as storage from "./lib/storage.js";
import * as logger from "./lib/logger.js";
import * as llm from "./lib/llm.js";

// 国内常见厂商预设（OpenAI 兼容 chat completions）。base_url 为空表示「自定义」。
const PROVIDERS = [
  { id: "custom",  name: "自定义",         base_url: "",                          model: "" },
  { id: "deepseek", name: "DeepSeek",      base_url: "https://api.deepseek.com", model: "deepseek-v4-flash" },
  { id: "MiniMax", name: "MiniMax",        base_url: "https://api.minimaxi.com/v1", model: "MiniMax-M2.7-highspeed" },
  { id: "qwen",   name: "通义千问 (Qwen)", base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
  { id: "glm",    name: "智谱 GLM",        base_url: "https://open.bigmodel.cn/api/paas/v4/", model: "glm-4-plus" },
  { id: "doubao", name: "豆包 (Doubao)",   base_url: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-pro-32k" },
];

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

// ─── 调试访问控制 ──────────────────────────
const DEBUG_HASH = '6ece4acae1c25b9faf8b9090c7a65f81b8f70e47c5a6aa4c5f2b3af214e63d3a';

let debugAccessGranted = false;

async function checkDebugAccess() {
  const token = new URLSearchParams(location.search).get('debug');
  if (!token) return false;

  try {
    const msgBuffer = new TextEncoder().encode(token);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashHex = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0')).join('');
    return hashHex === DEBUG_HASH;
  } catch {
    return false;
  }
}

async function verifyPassword(input) {
  const msgBuffer = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  return hashHex === DEBUG_HASH;
}

// ─── 设置面板 ─────────────────────────────
const settingsOverlay = document.getElementById("settings-overlay");
const btnSettings = document.getElementById("btn-settings");
const btnSave = document.getElementById("btn-settings-save");
const btnCancel = document.getElementById("btn-settings-cancel");
const btnExportLogs = document.getElementById("btn-export-logs");
const btnReset = document.getElementById("btn-reset");
const btnForgetKey = document.getElementById("btn-forget-key");

const inputApiKey = document.getElementById("setting-api-key");
const inputBaseUrl = document.getElementById("setting-base-url");
const inputModel = document.getElementById("setting-model");
const inputTimeout = document.getElementById("setting-timeout");
const selectProvider = document.getElementById("setting-provider");

function loadSettingsToForm() {
  const s = storage.get("settings", storage.DEFAULT_SETTINGS);
  inputApiKey.value = s.api_key || "";
  inputBaseUrl.value = s.base_url || storage.DEFAULT_SETTINGS.base_url;
  inputModel.value = s.model || storage.DEFAULT_SETTINGS.model;
  inputTimeout.value = s.timeout_seconds || storage.DEFAULT_SETTINGS.timeout_seconds;
  // 按当前 base_url 反匹配预选厂商；匹配不上回退到「自定义」
  const matched = PROVIDERS.find((p) => p.base_url && p.base_url === inputBaseUrl.value);
  selectProvider.value = matched ? matched.id : "custom";
}

selectProvider.addEventListener("change", () => {
  const p = PROVIDERS.find((x) => x.id === selectProvider.value);
  if (p && p.base_url) {
    inputBaseUrl.value = p.base_url;
    inputModel.value = p.model;
  } else {
    // 自定义：清空字段，让用户从头填
    inputBaseUrl.value = "";
    inputModel.value = "";
  }
});

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
  if (s.api_key && s.base_url.startsWith("http://")) {
    if (!confirm("base_url 是 http://，API key 会明文外传。仍要保存吗？")) return;
  }
  storage.set("settings", s);
  closeSettings();
  renderMain();
}

btnSettings.addEventListener("click", openSettings);
btnSave.addEventListener("click", saveSettings);
btnCancel.addEventListener("click", closeSettings);
btnExportLogs.addEventListener("click", () => logger.downloadLogs());
btnForgetKey.addEventListener("click", () => {
  if (!confirm("确认清除本地保存的 API key？\n清除后需要重新设置才能使用。")) return;
  storage.remove("settings");
  closeSettings();
  renderMain();
});

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

// ─── 隐藏调试入口：点版本号 5 次弹出密码框 ────
{
  let clickCount = 0;
  let clickTimer = null;
  document.querySelector('.topbar-version').addEventListener('click', async () => {
    clickCount++;
    clearTimeout(clickTimer);
    if (clickCount >= 5) {
      clickCount = 0;
      const pwd = prompt('请输入调试密码：');
      if (pwd && await verifyPassword(pwd)) {
        debugAccessGranted = true;
        renderMain();
      } else if (pwd) {
        alert('密码错误');
      }
    }
    clickTimer = setTimeout(() => { clickCount = 0; }, 2000);
  });
}

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
    mode: "direct",
    title: "",
    body: "",
    tone: config.polish.default_tone,
    must_preserve: "",
    selected_platforms: [],
    variant: config.variants?.[0]?.key || "",
  });
  last.selected_platforms = [];

  const variantOptions = (config.variants || []).length > 1
    ? config.variants.map(
        (v) =>
          `<option value="${escapeHtml(v.key)}" ${v.key === last.variant ? "selected" : ""}>${escapeHtml(v.name)}</option>`
      ).join("")
    : "";

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
        ${variantOptions ? `<div class="variant-selector"><label>风格取向 <select id="input-variant">${variantOptions}</select></label></div>` : ""}
      </div>

      <label class="input-block">
        标题（可选，AI 会重拟）
        <input id="input-title" type="text" value="${escapeHtml(last.title)}" />
      </label>

      <label class="input-block">
        正文 / 素材
        <textarea id="input-body" rows="12">${escapeHtml(last.body)}</textarea>
      </label>

      <input id="input-tone" type="hidden" value="${escapeHtml(last.tone)}" />
      <input id="input-must-preserve" type="hidden" value="${escapeHtml(last.must_preserve)}" />

      <div class="action-bar">
        <div class="platforms">${platformCheckboxes}</div>
        ${debugAccessGranted ? '<button id="btn-debug-toggle" type="button">🔍 调试</button>' : ''}
        <button id="btn-polish-only" type="button">📄 仅润色</button>
        <button id="btn-adapt" type="button" class="primary">✨ 一键改写</button>
      </div>

      <div id="debug-panel" class="debug-panel hidden">
        <div class="debug-head">
          <span>Prompt 调试</span>
          <select id="debug-prompt-select"></select>
          <label class="debug-tone-label">取向 <select id="debug-tone-select">${toneOptions}</select></label>
          <button id="btn-debug-edit" type="button">✏️ 编辑</button>
          <button id="btn-debug-save" type="button" class="hidden">💾 保存</button>
          <button id="btn-debug-reset" type="button">↩ 恢复默认</button>
          <button id="btn-debug-close" type="button">✕</button>
        </div>
        <div class="debug-body">
          <div class="debug-col">
            <h4>原始模板</h4>
            <pre id="debug-raw-view"></pre>
            <textarea id="debug-raw" class="hidden" spellcheck="false"></textarea>
          </div>
          <div class="debug-col">
            <h4>填充后（将发送给 LLM）</h4>
            <pre id="debug-filled"></pre>
          </div>
        </div>
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

  // ─── 调试面板 ───
  const debugPanel = document.getElementById("debug-panel");
  const debugSelect = document.getElementById("debug-prompt-select");
  const debugTone = document.getElementById("debug-tone-select");
  const debugRawView = document.getElementById("debug-raw-view");
  const debugRaw = document.getElementById("debug-raw");
  const debugFilled = document.getElementById("debug-filled");
  const btnDebugEdit = document.getElementById("btn-debug-edit");
  const btnDebugSave = document.getElementById("btn-debug-save");
  const btnDebugReset = document.getElementById("btn-debug-reset");

  // 同步调试面板的取向与表单的取向 + variant（双向）
  // tone ↔ variant 映射：平实→pingshi, 中性→zhongxing, 严肃→yansu, 活泼→huopo
  const toneVariantMap = { "平实": "pingshi", "中性": "zhongxing", "严肃": "yansu", "活泼": "huopo" };
  const variantToneMap = { "pingshi": "平实", "zhongxing": "中性", "yansu": "严肃", "huopo": "活泼" };

  const inputTone = document.getElementById("input-tone");
  const inputVariant = document.getElementById("input-variant");

  debugTone?.addEventListener("change", () => {
    inputTone.value = debugTone.value;
    inputTone.dispatchEvent(new Event("change"));
    // 同步 variant，触发切换 prompt 文件
    const vKey = toneVariantMap[debugTone.value];
    if (vKey && inputVariant) {
      inputVariant.value = vKey;
      inputVariant.dispatchEvent(new Event("change"));
    }
    refreshFilledPreview();
  });
  inputTone?.addEventListener("change", () => {
    if (debugTone) debugTone.value = inputTone.value;
  });
  // variant 变化时同步回 debug tone
  inputVariant?.addEventListener("change", () => {
    const tVal = variantToneMap[inputVariant.value];
    if (tVal) {
      if (debugTone) debugTone.value = tVal;
      inputTone.value = tVal;
    }
  });

  if (debugAccessGranted) {
    document.getElementById("btn-debug-toggle").addEventListener("click", async () => {
    debugPanel.classList.toggle("hidden");
    if (!debugPanel.classList.contains("hidden")) {
      await refreshDebugPanel();
    }
  });
  document.getElementById("btn-debug-close").addEventListener("click", () => {
    debugPanel.classList.add("hidden");
  });

  debugSelect.addEventListener("change", () => {
    exitEditMode();
    updateDebugContent();
  });

  // 编辑按钮：进入编辑模式
  btnDebugEdit.addEventListener("click", () => {
    debugRaw.value = debugRawView.textContent;
    debugRawView.classList.add("hidden");
    debugRaw.classList.remove("hidden");
    btnDebugEdit.classList.add("hidden");
    btnDebugSave.classList.remove("hidden");
  });

  // 保存按钮：自动更新版本头的日期，存 localStorage，退出编辑模式
  btnDebugSave.addEventListener("click", () => {
    const sel = debugSelect.selectedOptions[0];
    if (!sel) return;
    const file = sel.dataset.file;
    // 自动更新第一行版本头的日期
    const today = new Date().toISOString().slice(0, 10);
    const lines = debugRaw.value.split("\n");
    lines[0] = lines[0].replace(/\d{4}-\d{2}-\d{2}/, today);
    debugRaw.value = lines.join("\n");

    if (prompts.savePromptOverride(file, debugRaw.value)) {
      debugRawView.textContent = debugRaw.value;
      exitEditMode();
      refreshFilledPreview();
      btnDebugSave.textContent = "✓ 已保存";
      setTimeout(() => (btnDebugSave.textContent = "💾 保存"), 1200);
      document.getElementById("results").innerHTML = "";
    } else {
      alert("保存失败，请检查浏览器存储空间");
    }
  });

  btnDebugReset.addEventListener("click", async () => {
    const sel = debugSelect.selectedOptions[0];
    if (!sel) return;
    const file = sel.dataset.file;
    if (!prompts.hasPromptOverride(file)) {
      alert("该 prompt 没有本地修改，无需恢复");
      return;
    }
    if (!confirm(`确认恢复 ${file} 为默认版本？本地修改将丢失。`)) return;
    prompts.deletePromptOverride(file);
    exitEditMode();
    const raw = await prompts.loadPromptRaw(file);
    debugRawView.textContent = raw;
    debugRaw.value = raw;
    refreshFilledPreview();
    document.getElementById("results").innerHTML = "";
  });

  function exitEditMode() {
    debugRawView.classList.remove("hidden");
    debugRaw.classList.add("hidden");
    btnDebugEdit.classList.remove("hidden");
    btnDebugSave.classList.add("hidden");
  }

  // 表单变化时如果调试面板开着就实时刷新填充预览
  document.querySelectorAll("#input-title, #input-body, #input-tone, #input-must-preserve, #input-variant").forEach((el) => {
    el.addEventListener("input", () => {
      if (!debugPanel.classList.contains("hidden")) refreshFilledPreview();
    });
    el.addEventListener("change", () => {
      if (!debugPanel.classList.contains("hidden") && el.id === "input-variant") {
        exitEditMode();
        refreshDebugPanel();
      } else if (!debugPanel.classList.contains("hidden")) {
        refreshFilledPreview();
      }
    });
  });

  async function refreshDebugPanel() {
    const config = await prompts.loadConfig();
    const variant = document.getElementById("input-variant")?.value || "";
    const polishFile = prompts.resolvePromptFile(
      { prompt: config.polish.prompt, alt_prompts: config.polish.alt_prompts },
      variant
    );
    const opts = [{ key: "polish", name: `润色 (${polishFile})`, file: polishFile }];
    config.platforms.filter((p) => p.enabled).forEach((p) => {
      const f = prompts.resolvePromptFile(p, variant);
      opts.push({ key: p.key, name: p.name + " (" + f + ")", file: f });
    });
    debugSelect.innerHTML = opts.map((o) => `<option value="${o.key}" data-file="${o.file}">${o.name}</option>`).join("");
    if (debugTone) debugTone.value = document.getElementById("input-tone").value;
    updateDebugContent();
  }

  async function updateDebugContent() {
    const sel = debugSelect.selectedOptions[0];
    if (!sel) return;
    const file = sel.dataset.file;
    const raw = await prompts.loadPromptRaw(file);
    debugRawView.textContent = raw;
    debugRaw.value = raw;
    refreshFilledPreview();
  }

  function refreshFilledPreview() {
    const raw = debugRaw.classList.contains("hidden") ? debugRawView.textContent : debugRaw.value;
    const vars = {
      INPUT: document.getElementById("input-body").value || "（示例素材文本……）",
      TITLE: document.getElementById("input-title").value || "（示例标题）",
      TONE: document.getElementById("input-tone").value,
      MUST_PRESERVE: document.getElementById("input-must-preserve").value || "（无）",
    };
    debugFilled.textContent = prompts.fillPlaceholders(raw, vars);
  }
  } // end if debugAccessGranted
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
    mode: document.querySelector('input[name="mode"]:checked')?.value || "direct",
    title: document.getElementById("input-title").value,
    body: document.getElementById("input-body").value,
    tone: document.getElementById("input-tone").value,
    must_preserve: document.getElementById("input-must-preserve").value,
    selected_platforms: Array.from(
      document.querySelectorAll('input[name="platform"]:checked')
    ).map((el) => el.value),
    variant: document.getElementById("input-variant")?.value || "",
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

    const polishPromptFile = prompts.resolvePromptFile(
      { prompt: config.polish.prompt, alt_prompts: config.polish.alt_prompts },
      session.variant
    );

    if (session.mode === "polish") {
      // Step 1: 润色
      setResultState("baseline", "loading");
      try {
        const baseline = await adaptOne({
          platformKey: "baseline",
          promptFile: polishPromptFile,
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
            promptFile: prompts.resolvePromptFile(p, session.variant),
            vars: {
              INPUT: inputForPlatforms,
              TITLE: session.title,
              MUST_PRESERVE: session.must_preserve,
            },
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

  const polishPromptFile = prompts.resolvePromptFile(
    { prompt: config.polish.prompt, alt_prompts: config.polish.alt_prompts },
    session.variant
  );

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
        promptFile: polishPromptFile,
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
          <button class="btn-diff" data-platform="baseline" disabled>查看变动</button>
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
          <button class="btn-diff" data-platform="${p.key}" disabled>查看变动</button>
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

  // 绑定「查看变动」按钮
  container.querySelectorAll(".btn-diff").forEach((btn) => {
    btn.addEventListener("click", () => {
      toggleDiff(btn.dataset.platform);
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
  const diffBtn = card.querySelector(".btn-diff");
  const regenBtn = card.querySelector(".btn-regen");
  const clearBtn = card.querySelector(".btn-clear");

  // 移除旧 diff 视图
  const oldDiff = card.querySelector(".diff-view");
  if (oldDiff) oldDiff.remove();

  card.classList.remove("loading", "success", "error");
  card.classList.add(state);

  if (state === "loading") {
    body.textContent = "⏳ 正在生成……";
    copyBtns.forEach((b) => (b.disabled = true));
    if (diffBtn) diffBtn.disabled = true;
    if (regenBtn) regenBtn.disabled = true;
    if (clearBtn) clearBtn.classList.add("hidden");
  } else if (state === "success") {
    body.textContent = content;
    copyBtns.forEach((b) => (b.disabled = false));
    if (diffBtn) diffBtn.disabled = false;
    if (regenBtn) regenBtn.disabled = false;
    if (clearBtn) clearBtn.classList.remove("hidden");
  } else if (state === "error") {
    body.textContent = `❌ ${content}`;
    copyBtns.forEach((b) => (b.disabled = true));
    if (diffBtn) diffBtn.disabled = true;
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
      const polishPromptFile = prompts.resolvePromptFile(
        { prompt: config.polish.prompt, alt_prompts: config.polish.alt_prompts },
        session.variant
      );
      const out = await adaptOne({
        platformKey: "baseline",
        promptFile: polishPromptFile,
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
      promptFile: prompts.resolvePromptFile(p, session.variant),
      vars: {
        INPUT: input,
        TITLE: session.title,
        MUST_PRESERVE: session.must_preserve,
      },
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
  card._inputText = null;
  const diffView = card.querySelector(".diff-view");
  if (diffView) diffView.remove();
  const diffBtn = card.querySelector(".btn-diff");
  if (diffBtn) diffBtn.disabled = true;
  copyBtns.forEach((b) => (b.disabled = true));
  if (regenBtn) regenBtn.disabled = false;
  if (clearBtn) clearBtn.classList.add("hidden");
}

// ─── 行级 diff（妥协清单） ──────────────────
function lineDiff(oldText, newText) {
  const oldLines = (oldText || "").split("\n");
  const newLines = (newText || "").split("\n");

  // LCS 表
  const m = oldLines.length;
  const n = newLines.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // 回溯
  const result = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.unshift({ type: "same", text: oldLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: "add", text: newLines[j - 1] });
      j--;
    } else {
      result.unshift({ type: "remove", text: oldLines[i - 1] });
      i--;
    }
  }
  return result;
}

function renderDiffInline(diffOps) {
  if (diffOps.length === 0) return "<p>（无变动）</p>";
  let html = '<div class="diff-inline">';
  for (const op of diffOps) {
    const cls = op.type === "add" ? "diff-add" : op.type === "remove" ? "diff-remove" : "diff-same";
    html += `<span class="${cls}">${escapeHtml(op.text)}</span>\n`;
  }
  html += "</div>";
  return html;
}

function toggleDiff(platformKey) {
  const card = platformKey === "baseline"
    ? document.getElementById("baseline")
    : document.querySelector(`.result-card[data-platform="${platformKey}"]`);
  if (!card) return;

  let diffEl = card.querySelector(".diff-view");
  if (diffEl) {
    diffEl.remove();
    return;
  }

  const bodyId = platformKey === "baseline" ? "baseline-body" : `body-${platformKey}`;
  const outputText = document.getElementById(bodyId)?.innerText || "";
  const inputText = card._inputText || "";

  diffEl = document.createElement("div");
  diffEl.className = "diff-view";
  const ops = lineDiff(inputText, outputText);
  diffEl.innerHTML = `
    <div class="diff-head">变动对比（<span class="diff-remove">− 原文</span> <span class="diff-add">+ AI 输出</span>）</div>
    ${renderDiffInline(ops)}
  `;
  card.appendChild(diffEl);
}

// 在 setResultState 成功后记录 input 原文
const _origSetResultState = setResultState;
setResultState = function (platformKey, state, content) {
  if (state === "success") {
    const card = platformKey === "baseline"
      ? document.getElementById("baseline")
      : document.querySelector(`.result-card[data-platform="${platformKey}"]`);
    if (card && !card._inputText) {
      const session = collectSession();
      if (platformKey === "baseline") {
        card._inputText = session.body;
      } else if (session.mode === "polish") {
        card._inputText = document.getElementById("baseline-body")?.innerText || session.body;
      } else {
        card._inputText = session.body;
      }
    }
  }
  return _origSetResultState(platformKey, state, content);
};

// 启动
(async () => {
  debugAccessGranted = await checkDebugAccess();
  renderMain();
  if (debugAccessGranted) console.log("editor-kit ready [debug enabled]");
  else console.log("editor-kit ready");
})();
