// lib/storage.js
// 封装 localStorage，统一 key 前缀和 JSON 序列化。

const PREFIX = "editor-kit:";

export function get(key, defaultValue = null) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return defaultValue;
    return JSON.parse(raw);
  } catch (e) {
    console.warn(`storage.get(${key}) 失败：`, e);
    return defaultValue;
  }
}

export function set(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.error(`storage.set(${key}) 失败：`, e);
    return false;
  }
}

export function remove(key) {
  localStorage.removeItem(PREFIX + key);
}

// 默认设置（首次启动时使用）
export const DEFAULT_SETTINGS = {
  api_key: "",
  base_url: "https://api.deepseek.com/v1",
  model: "deepseek-chat",
  timeout_seconds: 60,
};
