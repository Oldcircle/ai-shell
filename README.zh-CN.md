# AI Shell

> **从零构建你自己的 Claude Code。** 一个功能完整的 AI 编程助手，就在你的终端里。

```
  AI Shell v0.1.0 (deepseek/deepseek-chat)
  Session: 20260413-123752-l5cs | /help for commands | Ctrl+C to interrupt
  ────────────────────────────────────────────────────────────

  ❯ 读取 package.json 告诉我项目名
    ⚡ Read /Users/me/project/package.json ✓ 2ms
  项目名是 **ai-shell**。

    deepseek-chat · 10285↑ 62↓ · $0.0318

  ❯ 
```

## 为什么做 AI Shell？

Claude Code 是一个出色的工具——但它不开源。AI Shell 是一个 **完全从零实现** 的版本，帮助你理解 AI 编程助手底层的每一个设计：

- **Async Generator 查询循环** — 流式响应 + 工具执行循环
- **`buildTool()` 工厂模式** — 类型安全的工具定义 + fail-closed 默认值
- **Provider 抽象层** — Anthropic、DeepSeek、OpenAI、Ollama 统一接口
- **权限系统** — 危险操作交互式审批（Y/N/A）
- **上下文压缩** — 80% token 阈值时自动摘要旧消息

**5,590 行 TypeScript。89 个测试。不依赖 Claude Code 任何代码。**

## 功能特性

### 7 个内置工具

| 工具 | 类型 | 说明 |
|------|------|------|
| `Read` | 只读 | 读取文件（行号 + 偏移 + 限制） |
| `Write` | 破坏性 | 创建或覆盖文件 |
| `Edit` | 破坏性 | 精确字符串替换（智能引号归一化） |
| `Bash` | 破坏性 | 执行 Shell 命令（安全检测） |
| `Glob` | 只读 | 文件模式搜索 |
| `Grep` | 只读 | 内容搜索（ripgrep） |
| `Agent` | 破坏性 | 启动独立子 Agent 并行任务 |

### 9 个 Slash 命令

```
/help      显示可用命令
/clear     清空对话历史
/compact   压缩对话释放上下文空间
/cost      显示 Token 用量和花费
/context   显示上下文窗口使用情况（含进度条）
/model     显示或切换模型
/history   列出保存的会话
/exit      退出
/quit      退出（/exit 别名）
```

### 多 Provider 支持

```bash
# Anthropic (Claude)
ANTHROPIC_API_KEY=sk-ant-xxx ai-shell

# DeepSeek
DEEPSEEK_API_KEY=sk-xxx ai-shell --provider deepseek

# OpenAI / Ollama / 任何 OpenAI 兼容 API
OPENAI_API_KEY=sk-xxx OPENAI_BASE_URL=http://localhost:11434/v1 ai-shell --provider openai
```

### 安全与权限

- **危险命令检测** — `rm -rf`、`git push --force`、`sudo`、`dd` 等
- **交互式权限对话框** — `[Y]es / [N]o / [A]lways allow`
- **只读工具自动放行** — Read、Glob、Grep 无需确认
- **会话级缓存** — "Always Allow" 记住你的选择

### 上下文智能

- **CLAUDE.md 自动发现** — 从 CWD 向上遍历到根目录
- **Git 状态注入** — 分支、变更、最近提交写入系统提示词
- **自动压缩** — 到达 80% 上下文窗口时 LLM 摘要旧消息
- **Token 估算** — 中英文混合自适应字符计数

### 会话持久化

- **自动保存** — JSONL 格式存储在 `~/.ai-shell/sessions/`
- **恢复会话** — `ai-shell --resume <session-id>`
- **配置文件** — `~/.ai-shell/config.json` 设置默认 provider、模型、API key

## 快速开始

```bash
# 前置条件：Bun >= 1.2, ripgrep（用于 Grep 工具）
git clone https://github.com/Oldcircle/ai-shell.git
cd ai-shell
bun install

# 交互模式
DEEPSEEK_API_KEY=sk-xxx bun run dev --provider deepseek

# 管道模式（用于脚本）
echo "解释这个错误" | DEEPSEEK_API_KEY=sk-xxx bun run dev --provider deepseek -p

# 单次提问
DEEPSEEK_API_KEY=sk-xxx bun run dev --provider deepseek -p "列出所有 TODO 注释"
```

## 架构

```
用户输入 → Slash 命令？ → 本地执行（/help, /compact, /cost...）
                ↓ 否
           需要压缩？ → LLM 摘要旧消息
                ↓
           Query Loop → Provider.stream() → 流式响应
                ↓ tool_use？
           权限检查 → 需要确认？ → 对话框（Y/N/A）
                ↓ 允许
           Zod 验证 → Tool.call() → 结果 → 继续循环
                ↓ end_turn
           渲染（Markdown）+ 自动保存 JSONL
```

### 核心模块

| 模块 | 行数 | 说明 |
|------|------|------|
| `query.ts` | 340 | Async generator 查询循环 + 工具执行 |
| `context.ts` | 210 | 系统提示词构建（角色 + 工具 + Git + CLAUDE.md） |
| `core/tool.ts` | 200 | Tool 接口 + `buildTool()` 工厂 + Schema 清洗 |
| `core/compact.ts` | 250 | 上下文压缩（LLM 摘要） |
| `core/commands.ts` | 260 | Slash 命令系统 |
| `providers/openai-compatible.ts` | 400 | OpenAI/DeepSeek/Ollama 适配器 |
| `repl.ts` | 220 | Readline REPL + 工具展示 |
| `utils/markdown.ts` | 220 | Markdown → ANSI 终端渲染器 |

### 设计原则

1. **流式优先** — 全链路 async generator，可中断响应
2. **Fail-Closed 安全** — 工具默认不可并发、非只读、需要权限
3. **类型安全** — Zod schema 运行时验证 + JSON Schema 跨 API 兼容清洗
4. **Provider 无关** — 统一接口，自由切换 Anthropic/DeepSeek/OpenAI/Ollama

## 开发

```bash
bun run dev          # 开发模式运行
bun test             # 运行 89 个测试
bun run typecheck    # TypeScript strict 检查
bun run lint         # Biome lint
bun run format       # Biome format
```

## 项目数据

```
34 源文件    ·  5,590 行代码
13 测试文件  ·    971 行测试
89 测试      ·  0 失败
```

## 致谢

架构参考 [Claude Code](https://claude.ai/code)（Anthropic）设计。完全从零实现的学习项目——未复制任何代码。

## 许可证

MIT
