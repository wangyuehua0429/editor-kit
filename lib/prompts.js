// lib/prompts.js
// 加载 prompts.config.json + prompts/*.txt，提供占位符替换。

let _config = null;
const _promptCache = new Map();

export async function loadConfig() {
  if (_config) return _config;
  const res = await fetch(`./prompts.config.json?t=${Date.now()}`);
  if (!res.ok) {
    throw new Error(`无法加载 prompts.config.json (HTTP ${res.status})`);
  }
  const data = await res.json();
  validateConfig(data);
  _config = data;
  return data;
}

function validateConfig(c) {
  if (!Array.isArray(c.platforms) || c.platforms.length === 0) {
    throw new Error("prompts.config.json: platforms 必须为非空数组");
  }
  for (const p of c.platforms) {
    if (!p.key || !p.name || !p.prompt) {
      throw new Error(`prompts.config.json: 平台缺字段 ${JSON.stringify(p)}`);
    }
  }
  if (!c.polish || !c.polish.prompt) {
    throw new Error("prompts.config.json: polish.prompt 必填");
  }
}

// localStorage 覆盖键前缀
const OVERRIDE_PREFIX = "editor-kit:prompt-override:";

function overrideKey(filename) {
  return OVERRIDE_PREFIX + filename;
}

// 加载 raw prompt（不滤注释），用于调试面板编辑
export async function loadPromptRaw(filename) {
  const res = await fetch(`./prompts/${filename}`);
  if (!res.ok) {
    throw new Error(`无法加载 prompts/${filename} (HTTP ${res.status})`);
  }
  return await res.text();
}

export async function loadPrompt(filename) {
  // 优先读 localStorage 覆盖
  try {
    const override = localStorage.getItem(overrideKey(filename));
    if (override !== null) return override;
  } catch (_) { /* localStorage 不可用则忽略 */ }

  if (_promptCache.has(filename)) return _promptCache.get(filename);
  const raw = await loadPromptRaw(filename);
  // 过滤 # 开头的注释行
  const cleaned = raw
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
  _promptCache.set(filename, cleaned);
  return cleaned;
}

// 保存 prompt 覆盖到 localStorage
export function savePromptOverride(filename, content) {
  try {
    localStorage.setItem(overrideKey(filename), content);
    _promptCache.delete(filename); // 清缓存，下次用新版本
    return true;
  } catch (e) {
    console.error("保存 prompt 覆盖失败：", e);
    return false;
  }
}

// 删除 prompt 覆盖，恢复使用文件
export function deletePromptOverride(filename) {
  localStorage.removeItem(overrideKey(filename));
  _promptCache.delete(filename);
}

// 检查某 prompt 是否有本地覆盖
export function hasPromptOverride(filename) {
  try {
    return localStorage.getItem(overrideKey(filename)) !== null;
  } catch (_) {
    return false;
  }
}

// 清缓存（编辑 prompt 后刷新页面也行，但这个用于调试）
export function clearCache() {
  _promptCache.clear();
  _config = null;
}

// 根据 variant 解析平台实际使用的 prompt 文件。
// 平台有 alt_prompts[variant] 就用它，否则回退到 platform.prompt。
export function resolvePromptFile(platform, variant) {
  if (variant && platform.alt_prompts && platform.alt_prompts[variant]) {
    return platform.alt_prompts[variant];
  }
  return platform.prompt;
}

// 占位符替换。未提供的占位符替换为默认值。
export function fillPlaceholders(template, vars) {
  const defaults = {
    INPUT: vars.INPUT || "",
    TITLE: vars.TITLE || "（未提供）",
    TONE: vars.TONE || "中性",
    MUST_PRESERVE: vars.MUST_PRESERVE || "（无）",
  };
  let result = template;
  for (const [key, val] of Object.entries(defaults)) {
    // 全部出现的位置都替换
    result = result.split(`{${key}}`).join(val);
  }
  return result;
}
