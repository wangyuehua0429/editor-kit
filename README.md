# 高级编辑小助手 v0.1

给新媒体编辑用的小工具：粘一份素材进去，一次出 5 个平台版本（微信公众号 / 微博 / 小红书 / 新闻客户端 / 传统报纸）+ 一份“专业润色基准稿”。

## 启动

### macOS / Linux

```bash
cd editor-kit
./start.sh
```

或手动：

```bash
python3 -m http.server 8765
```

然后浏览器打开 http://127.0.0.1:8765

### Windows

```bash
cd editor-kit
python -m http.server 8765
```

## 首次使用

1. 启动后点右上角【⚙ 设置】
2. 填入：
   - **API key**：你的国内大模型 API key（DeepSeek / 通义 / 智谱 / Moonshot 均可）
   - **Base URL**：API 端点。例：
     - DeepSeek: `https://api.deepseek.com/v1`
     - 通义千问：`https://dashscope.aliyuncs.com/compatible-mode/v1`
     - 智谱：`https://open.bigmodel.cn/api/paas/v4`
     - Moonshot: `https://api.moonshot.cn/v1`
   - **模型名**：如 `deepseek-chat`、`qwen-plus`、`glm-4`、`moonshot-v1-32k`
3. 点保存，回主界面开始用

## 两种模式

- **直接适配**：原稿已是成稿，只做平台风格转换
- **先润色再适配**：原稿是素材 / 采访整理 / 粗稿，先 AI 润色成专业基准稿，再适配各平台

## 修改 prompt

每个平台的 AI 改写指令都在 `prompts/*.txt`：

```
prompts/polish.txt        # 润色基准稿
prompts/wechat.txt        # 公众号
prompts/weibo.txt         # 微博
prompts/xiaohongshu.txt   # 小红书
prompts/news.txt          # 新闻客户端
prompts/paper.txt         # 报纸
```

用记事本打开任意一个 `.txt` 文件，修改后**刷新浏览器**即可生效。**不需要重启服务**。

支持的占位符：

| 占位符 | 含义 |
|---|---|
| `{INPUT}` | 输入正文 |
| `{TITLE}` | 输入标题 |
| `{TONE}` | 润色取向（仅 polish.txt 用） |
| `{MUST_PRESERVE}` | 必须保留内容（仅 polish.txt 用） |

## 加新平台

1. 写一个新 prompt，如 `prompts/zhihu.txt`
2. 在 `prompts.config.json` 的 `platforms` 数组里加一行：
   ```json
   {"key": "zhihu", "name": "知乎", "prompt": "zhihu.txt", "enabled": true, "order": 6}
   ```
3. 刷新浏览器即生效

## 注意事项

- **AI 输出请人工核对**：所有人名、职务、时间、数字、引语
- API key 存在浏览器 localStorage，**仅本机使用安全**。不要在公用电脑使用本工具
- 日志默认不记原稿和输出全文，只记 hash 和时间。可在设置面板【导出日志】查看
- 浏览器要求：Chrome / Edge / Safari 较新版本

## 已知限制

- 首期不处理图片
- 不支持稿件存档（请自行复制保留输出）
- 不支持流式输出（要等完整结果）
- 单用户本地使用，未做账号体系

## 升级 / 后续

- v0.2：Prompt 调试面板、多版 prompt
- v0.3：妥协清单（AI 自报删了什么）
- v1.0：服务器版（多用户、HTTPS、审计日志）
