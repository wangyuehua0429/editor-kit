// lib/llm.js
// OpenAI 兼容 chat completion 调用，含 60s 超时和 429 退避重试。

const RETRY_DELAYS_MS = [1000, 3000]; // 429 退避：1s, 3s（共重试 2 次）

export class LLMError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

export async function complete({ baseUrl, apiKey, model, messages, timeoutSeconds = 60 }) {
  if (!apiKey) throw new LLMError("API key 未填", "no_key");

  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const body = {
    model,
    messages,
    stream: false,
  };

  // 重试循环
  let lastErr = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.status === 401) {
        throw new LLMError("API key 无效或权限不足 (401)", "invalid_key");
      }
      if (res.status === 429) {
        lastErr = new LLMError("调用频率超限 (429)", "rate_limit");
        if (attempt < RETRY_DELAYS_MS.length) {
          await sleep(RETRY_DELAYS_MS[attempt]);
          continue;
        }
        throw lastErr;
      }
      if (!res.ok) {
        const text = await res.text();
        throw new LLMError(`LLM API 返回 ${res.status}: ${text.slice(0, 200)}`, "http_error");
      }

      const json = await res.json();
      const content = json?.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new LLMError("LLM 返回结构异常：缺 choices[0].message.content", "bad_response");
      }
      return stripThinking(content);
    } catch (e) {
      clearTimeout(timer);
      if (e.name === "AbortError") {
        throw new LLMError(`调用超时（${timeoutSeconds}s）`, "timeout");
      }
      if (e instanceof LLMError) throw e;
      throw new LLMError(`网络错误：${e.message}`, "network_error");
    }
  }
  throw lastErr || new LLMError("未知错误", "unknown");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// 推理模型（如 MiniMax-M3、DeepSeek-V4）会把 <think>...</think> 块拼到 content 里。
// 后处理剥除，避免污染正文。
function stripThinking(text) {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trimStart();
}
