<p align="center">
  <h1 align="center">⚡ AI Shell</h1>
</p>

<p align="center">
  <strong>从零构建你自己的 Claude Code。</strong><br>
  一个功能完整的 AI 编程助手，就在你的终端里。
</p>

<p align="center">
  <a href="https://github.com/Oldcircle/ai-shell/actions"><img src="https://img.shields.io/badge/tests-89%20passed-brightgreen?style=for-the-badge" alt="Tests"></a>
  <a href="https://github.com/Oldcircle/ai-shell"><img src="https://img.shields.io/badge/TypeScript-strict-blue?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="https://github.com/Oldcircle/ai-shell/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-green?style=for-the-badge" alt="MIT License"></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/runtime-Bun-f472b6?style=for-the-badge&logo=bun&logoColor=white" alt="Bun"></a>
</p>

<p align="center">
  <a href="#快速开始">快速开始</a> ·
  <a href="#功能特性">功能特性</a> ·
  <a href="#架构">架构</a> ·
  <a href="docs/architecture.md">文档</a> ·
  <a href="README.md">English</a>
</p>

---

**如果你想理解 Claude Code 底层是怎么工作的 — 流式查询循环、工具执行、权限系统、上下文管理 — 读这个项目就对了。**

AI Shell 是一个完全从零实现的版本，覆盖所有核心子系统：async generator 流式处理、`buildTool()` 工厂模式、多 Provider 抽象、交互式权限对话框、自动上下文压缩、会话持久化、Markdown 终端渲染。

**5,590 行 TypeScript。89 个测试。不依赖 Claude Code 任何代码。**

```
  ⚡ AI Shell v0.1.0 (deepseek/deepseek-chat)
  Session: 20260413-123752-l5cs | /help for commands | Ctrl+C to interrupt
  ────────────────────────────────────────────────────────────

  ❯ 创建一个 Python 斐波那契函数，测试它，加上 docstring

    ⚡ Write /tmp/fib.py (12 lines) ✓ 1ms
    ⚡ Bash python3 /tmp/fib.py ✓ 45ms
    ⚡ Edit /tmp/fib.py "def fibonacci(n):" ✓ 2ms
    ⚡ Read /tmp/fib.py ✓ 1ms

  完成。创建了斐波那契函数，测试通过（fib(0)=0 到 fib(9)=34），
  并添加了包含 Args/Returns 的 docstring。

    deepseek-chat · 19157↑ 74↓ · $0.0586

  ❯ _
```

## 快速开始

**前置条件：** [Bun](https://bun.sh) >= 1.2, [ripgrep](https://github.com/BurntSushi/ripgrep)（Grep 工具需要）

```bash
git clone https://github.com/Oldcircle/ai-shell.git
cd ai-shell
bun install
```

**用 DeepSeek 运行**（最便宜）：
```bash
DEEPSEEK_API_KEY=sk-xxx bun run dev --provider deepseek
```

**用 Anthropic 运行**（Claude）：
```bash
ANTHROPIC_API_KEY=sk-ant-xxx bun run dev
```

**用任何 OpenAI 兼容 API 运行**（Ollama、vLLM、Together）：
```bash
OPENAI_API_KEY=sk-xxx OPENAI_BASE_URL=http://localhost:11434/v1 bun run dev --provider openai
```

**管道模式**（用于脚本）：
```bash
ai-shell -p "解释这段错误日志" < error.txt
ai-shell -p "列出 src/ 下所有 TODO 注释"
```

### 持久化配置

保存一次 API key，之后直接用：

```json5
// ~/.ai-shell/config.json
{
  "provider": "deepseek",
  "model": "deepseek-chat",
  "apiKeys": {
    "deepseek": "sk-xxx"
  }
}
```

然后直接：`bun run dev`

---

## 功能特性

### 亮点

- **[7 个内置工具](#工具)** — Read、Write、Edit、Bash、Glob、Grep、Agent — 覆盖文件操作、搜索、命令执行和并行子 Agent
- **[多 Provider 支持](#provider)** — Anthropic、DeepSeek、OpenAI、Ollama 统一 `Provider` 接口，自动降级
- **[权限系统](#安全)** — 交互式 `[Y]es / [N]o / [A]lways allow` 对话框，含危险命令检测
- **[上下文压缩](#上下文智能)** — 80% token 阈值自动摘要旧消息，保护 tool call 配对完整性
- **[会话持久化](#会话持久化)** — JSONL 自动保存，`--resume` 跨终端恢复对话
- **[Markdown 渲染](#markdown)** — 终端原生 ANSI 渲染：粗体、斜体、代码块、表格、列表、引用
- **[9 个 Slash 命令](#slash-命令)** — `/help`、`/compact`、`/cost`、`/context`、`/model`、`/history`、`/clear`、`/exit`、`/quit`
- **[智能编辑](#工具)** — 弯引号自动归一化、空白不匹配提示、失败时最近匹配建议

### 工具

| 工具 | 安全性 | 可并发 | 说明 |
|------|--------|--------|------|
| `Read` | 只读 | ✓ | 读取文件带行号，支持 offset/limit |
| `Write` | 破坏性 | — | 创建或覆写文件，自动创建父目录 |
| `Edit` | 破坏性 | — | 精确字符串替换，智能引号归一化，唯一性检查 |
| `Bash` | 破坏性 | — | Shell 执行，超时控制，输出限制，危险命令检测 |
| `Glob` | 只读 | ✓ | 快速文件模式匹配，忽略 `node_modules` 和 `.git` |
| `Grep` | 只读 | ✓ | 基于 ripgrep 的内容搜索，正则、glob 过滤、上下文行 |
| `Agent` | 破坏性 | — | 启动独立子 Agent，拥有自己的 query loop 和消息历史 |

**并发策略：** LLM 同时请求多个只读工具时并行执行，破坏性工具串行执行。

### Provider

```
┌──────────────────────────────────────────────┐
│              Provider 接口                     │
│          stream() → AsyncGenerator            │
├──────────┬───────────┬───────────┬───────────┤
│ Anthropic│ DeepSeek  │  OpenAI   │  Ollama   │
│ (SDK)    │ (SSE)     │  (SSE)    │  (SSE)    │
└──────────┴───────────┴───────────┴───────────┘
```

所有 Provider 适配为相同的 `StreamEvent` 接口，用 `--provider` 自由切换：

```bash
ai-shell --provider deepseek    # DeepSeek API
ai-shell --provider anthropic   # Claude（默认）
ai-shell --provider openai      # 任何 OpenAI 兼容端点
```

OpenAI 兼容层自动处理 DeepSeek 的 `reasoning_content`（思考链）和 JSON Schema draft-04/07 差异。

### 安全

**危险命令检测** — Bash 工具在执行前扫描 12+ 种高风险模式：

```
rm -rf    git push --force    git reset --hard    sudo
dd if=    chmod -R 777        dropdb              mkfs
kill -9   git branch -D       git checkout --     pkill
```

检测到后弹出权限对话框：

```
┌─────────────────────────────────────────────┐
│ ? Bash wants to execute:                    │
│   $ rm -rf /tmp/test-dir                    │
│                                             │
│   [Y]es / [N]o / [A]lways allow             │
└─────────────────────────────────────────────┘
```

- **只读工具**（Read、Glob、Grep）— 自动放行
- **Always allow** — 本次会话内记住选择
- **`GIT_TERMINAL_PROMPT=0`** — 防止 git 在认证时 hang 住

### 上下文智能

```
❯ /context
Context Window: deepseek-chat
  [===============               ]
  25,600 / 64,000 tokens (40.0%)
  Auto-compact at: 51,200 tokens (80%)
  Messages: 42
```

- **CLAUDE.md 自动发现** — 从 CWD 向上遍历到根目录，加载 `CLAUDE.md` 和 `AGENTS.md`，检查 `.claude/` 子目录，加载全局 `~/.claude/CLAUDE.md`
- **Git 状态注入** — 当前分支、主分支名、工作区变更、最近 5 条提交
- **自动压缩** — 对话达到模型上下文窗口 80% 时，LLM 摘要旧消息。tool_use/tool_result 配对不会被拆分
- **Token 估算** — CJK（1.5 字符/token）和 Latin（3.8 字符/token）自适应

### 会话持久化

对话自动保存为 JSONL 到 `~/.ai-shell/sessions/`：

```bash
# 列出最近会话
ai-shell   # 输入 /history

# 恢复会话
ai-shell --resume 20260413-123752-l5cs
```

### Slash 命令

| 命令 | 说明 |
|------|------|
| `/help` | 显示所有命令和键盘快捷键 |
| `/clear` | 清空对话历史 |
| `/compact` | 手动压缩对话释放上下文空间 |
| `/cost` | Token 用量明细（输入、输出、缓存、花费） |
| `/context` | 上下文窗口使用率（含可视化进度条） |
| `/model` | 显示当前模型或切换（`/model deepseek-reasoner`） |
| `/history` | 列出已保存会话 |
| `/exit` | 退出 |

**键盘快捷键：** `Ctrl+C` 中断请求 · `↑↓` 翻阅历史 · `Ctrl+U` 清空输入

---

## 架构

```
用户输入
    │
    ├─ /command? ──→ 本地执行 (commands.ts)
    │
    ├─ 需要压缩? ──→ LLM 摘要旧消息 (compact.ts)
    │
    └─ Query Loop (query.ts)
         │
         ├─ Provider.stream() ──→ SSE 流式响应
         │
         ├─ tool_use? ──→ 权限检查 (permissions.ts)
         │                    │
         │                    ├─ allow ──→ Zod 验证 → Tool.call()
         │                    ├─ ask ──→ 对话框 (Y/N/A)
         │                    └─ deny ──→ 错误返回 LLM
         │
         ├─ tool_result ──→ 合并为 user 消息 → 继续循环
         │
         └─ end_turn ──→ 渲染 (markdown.ts) + 自动保存 (session.ts)
```

### 核心模块

| 模块 | 行数 | 职责 |
|------|-----:|------|
| `query.ts` | 340 | Async generator 查询循环 — 流式、工具执行、并行调度 |
| `context.ts` | 210 | 系统提示词组装 — 角色、工具、Git、CLAUDE.md、环境 |
| `core/tool.ts` | 200 | `Tool` 接口、`buildTool()` 工厂、JSON Schema 清洗 |
| `core/compact.ts` | 250 | 上下文压缩 — LLM 摘要、tool 配对保护 |
| `core/commands.ts` | 260 | Slash 命令注册表和处理器 |
| `core/permissions.ts` | 140 | 三模式权限系统（default / bypass / deny） |
| `providers/openai-compatible.ts` | 400 | SSE 流解析（DeepSeek/OpenAI/Ollama） |
| `providers/anthropic.ts` | 180 | Anthropic SDK 流式适配 |
| `repl.ts` | 220 | Readline REPL + 工具内联展示 |
| `utils/markdown.ts` | 220 | `marked` lexer → ANSI 终端渲染器 |
| `utils/tokens.ts` | 86 | Token 估算（CJK 自适应） |
| `utils/retry.ts` | 89 | 指数退避重试（429/5xx 自动重试） |

### 设计原则

1. **流式优先** — 全链路 async generator，AbortController 可中断
2. **Fail-Closed 安全** — 工具默认 `isConcurrencySafe: false`、`isReadOnly: false`，必须通过权限检查
3. **类型安全** — Zod schema 运行时验证，自动清洗为 JSON Schema draft-07 兼容格式
4. **Provider 无关** — 统一 `Provider` 接口，所有 API 差异在适配层吸收

---

## 开发

```bash
bun run dev          # 开发模式运行
bun test             # 89 个测试，13 个文件
bun run typecheck    # TypeScript strict，零错误
bun run lint         # Biome lint
bun run format       # Biome format
```

### 添加新工具

```typescript
// src/tools/my-tool.ts
import { z } from "zod"
import { buildTool } from "../core/tool"

export const MyTool = buildTool({
  name: "MyTool",
  description: "工具做什么 + 什么时候用",
  inputSchema: z.object({
    param: z.string().describe("给 LLM 看的参数说明"),
  }),
  isReadOnly: () => true,
  isConcurrencySafe: () => true,

  async call(input, context) {
    return { content: "结果" }
  },
})
```

在 `src/core/tools.ts` 注册即可。

### 添加新 Provider

实现 `Provider` 接口 — 核心是 `stream()` 方法，将你的 API 响应格式转为统一的 `StreamEvent` async generator。

---

## 项目数据

```
34 源文件    ·  5,590 行代码
13 测试文件  ·    971 行测试
89 单元测试  ·  0 失败
 + expect 集成测试（REPL 启动 → 命令 → AI 对话 → 工具调用 → 退出）
```

## 致谢

架构参考 [Claude Code](https://claude.ai/code)（Anthropic）。参考实现：[claude-code-best](https://github.com/claude-code-best/claude-code)。完全从零构建 — 未复制任何代码。

## 许可证

[MIT](LICENSE) — 随便用。
