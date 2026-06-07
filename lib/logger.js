// lib/logger.js
// 日志环形缓冲，存 localStorage，最多 100 条。提供 sha256 摘要工具。

import { get, set } from "./storage.js";

const LOG_KEY = "logs";
const MAX_LOGS = 100;

// 用浏览器 WebCrypto 算 SHA-256 hash，取前 12 位
export async function sha12(text) {
  const buf = new TextEncoder().encode(text || "");
  const hashBuf = await crypto.subtle.digest("SHA-256", buf);
  const bytes = new Uint8Array(hashBuf);
  return Array.from(bytes.slice(0, 6))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function logCall({
  platform,
  prompt_file,
  prompt_text,
  input_text,
  output_text,
  duration_ms,
  status,
}) {
  const entry = {
    ts: new Date().toISOString(),
    platform,
    prompt_file,
    prompt_hash: await sha12(prompt_text),
    input_hash: await sha12(input_text),
    duration_ms,
    status,
    output_excerpt: (output_text || "").slice(0, 100),
  };
  const logs = get(LOG_KEY, []);
  logs.push(entry);
  // 截断到最近 MAX_LOGS 条
  if (logs.length > MAX_LOGS) {
    logs.splice(0, logs.length - MAX_LOGS);
  }
  set(LOG_KEY, logs);
  return entry;
}

export function getLogs() {
  return get(LOG_KEY, []);
}

export function clearLogs() {
  set(LOG_KEY, []);
}

// 导出为 .jsonl 文件下载
export function downloadLogs() {
  const logs = getLogs();
  const jsonl = logs.map((e) => JSON.stringify(e)).join("\n");
  const blob = new Blob([jsonl], { type: "application/jsonl" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  a.href = url;
  a.download = `editor-kit-logs-${ts}.jsonl`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
