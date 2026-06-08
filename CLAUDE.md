# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 启动

```bash
./start.sh                              # 自动开浏览器
# 或：python3 -m http.server 8765      # 端口 8765（不是 8000）
```

**无构建步骤、无测试套件、无 lint 工具。** 改完 JS / CSS / HTML / prompt 文件后 `Cmd+Shift+R` 强刷即可（普通刷新会读到 `lib/prompts.js` 里 `_promptCache` 的旧版本）。

## 架构

单页应用，给新媒体编辑用的「一稿多投」工具：粘一份素材 → 5 个平台版 + 1 份润色基准稿。

**调用链**（`app.js:251` `onAdaptClick`）：

- **直接适配模式**：`原稿` → 并行调 5 个平台 prompt → 5 张结果卡
- **先润色再适配模式**：`原稿` → `polish.txt` → 基准稿 → 并行调 5 个平台 → 6 张结果卡（polish 1 次 + 平台 5 次，共 6 次 LLM 调用）

**模块边界：**

- `app.js` —— 唯一负责 UI。渲染、事件绑定、状态机（`pending/loading/success/error`）、结果区骨架。所有 DOM 写入优先用 `textContent` + `escapeHtml`，避免 XSS。
- `lib/llm.js` —— OpenAI 兼容 chat completions。`complete()` 负责 fetch + `AbortController` 超时 + 429 退避重试（1s/3s）。
- `lib/prompts.js` —— 加载 `prompts.config.json` + `prompts/*.txt`，做占位符替换。**`loadPrompt()` 会过滤 `#` 开头的行当注释**（L42-43），写 prompt 时别用 `#` 起头的内容行。
- `lib/storage.js` —— `localStorage` 封装，统一前缀 `editor-kit:`。
- `lib/logger.js` —— 日志环形缓冲（最多 100 条）。每条只存 `output_excerpt`（前 100 字）和 `prompt_hash` / `input_hash`（SHA-256 前 12 位 hex），**不存原文**。

**6 个 prompt 文件**：`polish.txt`（基准稿，1 个）+ 5 个平台（`wechat.txt` / `weibo.txt` / `xiaohongshu.txt` / `news.txt` / `paper.txt`）。平台列表和启用状态在 `prompts.config.json`。

**localStorage 三把 key**：

- `editor-kit:settings` —— `api_key` / `base_url` / `model` / `timeout_seconds`
- `editor-kit:last_session` —— 草稿（mode / title / body / tone / must_preserve / selected_platforms），输入即自动保存
- `editor-kit:logs` —— 调用日志环形缓冲

## 关键陷阱

1. **推理模型泄漏 `<think>…</think>` 块** —— `lib/llm.js:79-83` 的 `stripThinking()` 后处理剥除。改 LLM 响应解析时保留这个调用。
2. **DeepSeek URL 是裸域名** —— `https://api.deepseek.com`，**不带 `/v1`**。`llm.js:16` 的拼接方式是 `${baseUrl}/chat/completions`，用户填带 `/v1` 的会变成 `/v1/chat/completions`（404）。
3. **推理模型要 ≥ 60s 超时** —— MiniMax-M3、DeepSeek-V4 单次调用 60-180s。在设置面板里调 timeout，不是改代码。
4. **prompt 文件以 `#` 开头的行会被吃掉** —— 见上文 `lib/prompts.js` 注释过滤。要写 `#` 起始的内容，换行或加空格规避。
5. **改 prompt 必 `Cmd+Shift+R`** —— 否则 `_promptCache` 还在用旧版。或点顶栏「↻ 重置」清缓存。

## 加新平台

1. 写 `prompts/xxx.txt`
2. `prompts.config.json` 的 `platforms` 数组里加一项：`{"key": "xxx", "name": "xxx", "prompt": "xxx.txt", "enabled": true, "order": N}`
3. 刷新浏览器

`order` 决定勾选时从左到右的排列顺序。

## 标点与文案约定

- 用户可见文案、prompt 模板、日志文案一律中文全角标点
- 引号用弯引号 `""''`，禁止英文直引号
- 占位符：`{INPUT}` / `{TITLE}` / `{TONE}`（仅 `polish.txt` 用）/ `{MUST_PRESERVE}`（仅 `polish.txt` 用）

## v0.2 新增功能

### Prompt 调试面板

点「🔍 调试」按钮，在编辑器下方展开面板。左侧显示原始 prompt 模板，右侧显示占位符填充后的完整内容（即实际发送给 LLM 的文本）。可切换查看各平台和润色 prompt。表单内容变化时实时刷新。

### 多版 prompt 切换

`prompts.config.json` 新增可选的 `variants` 数组，定义多套 prompt 版本。平台和 polish 可通过 `alt_prompts` 字段指定某 variant 对应的 prompt 文件，未指定则回退到默认 `prompt`。仅当 variants 数量 > 1 时，编辑器顶部才显示「Prompt 版本」下拉框。

示例配置：
```json
{
  "variants": [{"key": "standard", "name": "标准版"}, {"key": "casual", "name": "轻松版"}],
  "platforms": [
    {"key": "wechat", "prompt": "wechat.txt", "alt_prompts": {"casual": "wechat-casual.txt"}, ...}
  ],
  "polish": {
    "prompt": "polish.txt",
    "alt_prompts": {"casual": "polish-casual.txt"},
    ...
  }
}
```

### 妥协清单（变动对比）

每张结果卡新增「查看变动」按钮。点开后用行级 LCS diff 对比原文和 AI 输出：红色 − 删除行、绿色 + 新增行、灰色 不变行。再次点击收起。不额外调用 LLM。

## 版本

git tag 落地：

- `v0.1` —— 7 个验收场景 + 导出日志附加项全通过
- `v0.1.1` —— 重置按钮 + 单卡片换一版/清空 + 复制 MD/TXT 双格式 + 标点规范强化
- `v0.2` —— prompt 调试面板 + 多版 prompt 切换 + 妥协清单（变动对比）
- `v0.3` —— 5 平台 × 4 取向专用 prompt 体系（20 个文件）+ 调试面板取向联动 + 全部 prompt 表述审计修复
- `v0.3.1` —— 全局 prompt 优化：输出禁区全覆盖 + 风格段多段化 + 平台×取向专项适配（80+ 次实测驱动）
