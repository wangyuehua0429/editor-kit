// lib/prompts.js
// 加载 prompts.config.json + prompts/*.txt，提供占位符替换。

let _config = null;
const _promptCache = new Map();

export async function loadConfig() {
  if (_config) return _config;
  const res = await fetch("./prompts.config.json");
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

export async function loadPrompt(filename) {
  if (_promptCache.has(filename)) return _promptCache.get(filename);
  const res = await fetch(`./prompts/${filename}`);
  if (!res.ok) {
    throw new Error(`无法加载 prompts/${filename} (HTTP ${res.status})`);
  }
  const text = await res.text();
  // 过滤 # 开头的注释行
  const cleaned = text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
  _promptCache.set(filename, cleaned);
  return cleaned;
}

// 清缓存（编辑 prompt 后刷新页面也行，但这个用于调试）
export function clearCache() {
  _promptCache.clear();
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
