# AI Shell 架构文档

## 概览

AI Shell 是一个类 Claude Code 的命令行 AI 编程助手，从零构建。

## 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        CLI Entry                             │
│                       (cli.tsx)                               │
│                          │                                    │
│            ┌─────────────┴──────────────┐                    │
│            │                             │                    │
│       Interactive                   Pipe Mode                │
│      (Ink REPL)                  (stdin → stdout)            │
│            │                             │                    │
│            └─────────────┬──────────────┘                    │
│                          │                                    │
│                    Query Loop                                │
│                    (query.ts)                                 │
│                          │                                    │
│            ┌─────────────┼──────────────┐                    │
│            │             │              │                     │
│       Provider      Tool System    Context                   │
│     (anthropic.ts)  (tool.ts)    (context.ts)                │
│            │             │              │                     │
│       API Calls     6 Built-in    System Prompt              │
│       Streaming     Tools         CLAUDE.md                  │
│                                   Git Status                 │
└─────────────────────────────────────────────────────────────┘
```

## 数据流

### 一次完整的对话循环

```
User Input
    ↓
[1] 构建 messages 数组（历史 + 新输入）
    ↓
[2] query() 调用 provider.stream()
    ↓
[3] Provider 发送请求到 Anthropic API
    ↓
[4] 流式接收响应事件
    ├── text → 直接渲染到 UI
    ├── tool_use → 执行工具
    │   ├── 查找 Tool 对象
    │   ├── 验证输入（Zod）
    │   ├── 检查权限
    │   ├── 调用 tool.call()
    │   └── 将结果作为 tool_result 追加到 messages
    │       ↓
    │   [回到步骤 2，LLM 看到工具结果后继续]
    └── end_turn → 完成，更新 UI
```

### 工具执行流程

```
LLM 返回 tool_use
    ↓
findToolByName(tools, name)
    ↓
tool.checkPermissions(input)
    ├── allow → 继续
    ├── ask → 弹出权限对话框
    └── deny → 返回错误
    ↓
inputSchema.parse(input)  ← Zod 验证
    ↓
tool.call(input, context)
    ↓
ToolResult { content, isError? }
    ↓
createToolResultMessage(id, content)
    ↓
追加到 messages → 继续 query loop
```

## 核心模块

### 1. 消息系统 (core/message.ts)

所有消息的类型定义和工厂函数。对齐 Anthropic Messages API。

**关键类型**:
- `UserMessage` — 用户输入或工具结果
- `AssistantMessage` — AI 回复（文本 + 工具调用）
- `ToolUseBlock` — 工具调用请求
- `ToolResultBlock` — 工具执行结果

### 2. 工具系统 (core/tool.ts)

**设计模式**: `buildTool()` 工厂 + 安全默认值

```typescript
const MyTool = buildTool({
  name: "MyTool",
  description: "...",
  inputSchema: z.object({ ... }),
  async call(input, context) {
    return { content: "result" }
  },
  // 可选方法有安全默认值
  // isReadOnly: () => false (默认)
  // isConcurrencySafe: () => false (默认)
})
```

**安全原则**: Fail-Closed
- 默认不可并发、非只读、需要权限

### 3. Query Loop (query.ts)

**模式**: Async Generator

```typescript
for await (const event of query(params)) {
  switch (event.type) {
    case "text": // 流式文本
    case "tool_start": // 工具开始
    case "tool_end": // 工具完成
    case "done": // 全部完成
  }
}
```

**自动循环**: 当 LLM 返回 `stop_reason: "tool_use"` 时，
执行工具后自动发起下一轮请求，直到 `end_turn`。

### 4. Provider (providers/anthropic.ts)

**模式**: 适配器

将 Anthropic SDK 的事件流转为统一的 `StreamEvent`，
使下游代码不依赖特定 API。

### 5. Context (context.ts)

组装系统提示词，包含：
- 角色指令和使用规则
- 环境信息（OS、Shell、时间）
- Git 状态
- CLAUDE.md 项目指令

## 内置工具

| 工具 | 文件 | 只读 | 可并发 | 说明 |
|------|------|------|--------|------|
| Read | file-read.ts | Yes | Yes | 读取文件（带行号） |
| Write | file-write.ts | No | No | 写入文件 |
| Edit | file-edit.ts | No | No | 精确字符串替换 |
| Bash | bash.ts | No | No | 执行 shell 命令 |
| Glob | glob.ts | Yes | Yes | 文件模式搜索 |
| Grep | grep.ts | Yes | Yes | 内容搜索（ripgrep） |

## 配置

### 环境变量

| 变量 | 必需 | 说明 |
|------|------|------|
| ANTHROPIC_API_KEY | Yes | Anthropic API 密钥 |
| AI_SHELL_VERBOSE | No | 启用详细日志 |

### CLI 选项

```
ai-shell [options] [prompt]

Options:
  -m, --model <model>    使用的模型 (default: claude-sonnet-4-20250514)
  -p, --pipe             管道模式
  --system <prompt>      覆盖系统提示词
  --no-tools             禁用工具
  -v, --verbose          详细输出
```

## 扩展指南

### 添加新工具

1. 在 `src/tools/` 创建文件
2. 定义 Zod schema
3. 用 `buildTool()` 创建工具
4. 在 `src/core/tools.ts` 注册

```typescript
// src/tools/my-tool.ts
import { z } from "zod"
import { buildTool } from "../core/tool"

const inputSchema = z.object({
  param: z.string().describe("Description for LLM"),
})

export const MyTool = buildTool({
  name: "MyTool",
  description: "What this tool does",
  inputSchema,
  isReadOnly: () => true,
  async call(input, context) {
    // 实现
    return { content: "result" }
  },
})
```

### 添加新 Provider

1. 在 `src/providers/` 创建文件
2. 实现 `Provider` 接口
3. 核心是 `stream()` 方法：将第三方 API 响应转为 `StreamEvent`
