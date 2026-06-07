// app.js
import * as prompts from "./lib/prompts.js";
import * as storage from "./lib/storage.js";
import * as logger from "./lib/logger.js";
import * as llm from "./lib/llm.js";

console.log("editor-kit loaded", { prompts, storage, logger, llm });
document.getElementById("app").textContent = "✅ 所有模块加载成功，下一步开始装配 UI。";
