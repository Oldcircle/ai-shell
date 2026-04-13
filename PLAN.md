# AI Shell — 开发计划

## 目标

从零构建类 Claude Code 的命令行 AI 编程助手，深入理解每个子系统的设计原理。

---

## Phase 1: 基础骨架 ✅ → 可运行的 CLI + API 调用

### 1.1 项目初始化
- [x] 项目结构、package.json、tsconfig.json、biome.json
- [x] 依赖安装（Anthropic SDK、Ink、Zod、Commander、Zustand）
- [x] 入口文件 `src/cli.tsx`

### 1.2 消息类型系统
- [x] `src/core/message.ts` — UserMessage, AssistantMessage, SystemMessage, ToolUseMessage, ToolResultMessage
- [x] 消息工厂函数

### 1.3 API 客户端
- [x] Provider 接口定义 `src/providers/types.ts`
- [x] Anthropic 直连实现 `src/providers/anthropic.ts`
- [x] 流式响应处理（Server-Sent Events → async generator）
- [x] 错误处理与重试

### 1.4 最小 REPL
- [x] Commander.js 入口 `src/main.tsx`
- [x] 单轮对话：读输入 → 调 API → 打印响应
- [x] 流式输出到终端

**里程碑**: `bun run dev` 启动，输入问题，看到流式回复

---

## Phase 2: 工具系统 ✅ → LLM 能操作本地文件和命令

### 2.1 Tool 接口
- [x] `src/core/tool.ts` — Tool 类型定义 + buildTool() 工厂
- [x] 输入验证（Zod schema，集成到 query loop）
- [x] 工具 schema → API 格式转换 + schema 清洗（兼容 DeepSeek/OpenAI）

### 2.2 核心工具实现
- [x] `BashTool` — 命令执行（子进程、超时、输出捕获）
- [x] `FileReadTool` — 文件读取（行号、偏移、限制）
- [x] `FileWriteTool` — 文件写入
- [x] `FileEditTool` — 精确字符串替换（old_string → new_string）
- [x] `GlobTool` — 文件模式匹配搜索
- [x] `GrepTool` — 内容搜索（ripgrep 封装）

### 2.3 工具注册与执行循环
- [x] `src/core/tools.ts` — 工具注册表
- [x] query 循环中处理 tool_use → 执行 → tool_result 回传
- [x] 多工具并行执行支持（isConcurrencySafe 分流）

### 2.4 多 Provider 支持（提前完成）
- [x] OpenAI 兼容 Provider `src/providers/openai-compatible.ts`
- [x] DeepSeek 支持（SSE 流解析、reasoning_content 映射）
- [x] CLI `--provider` 选项 + 自动降级
- [x] schema 兼容清洗（draft-04 → draft-07 exclusiveMinimum 修复）

**里程碑**: DeepSeek 调用 Read/Write/Edit/Bash/Glob/Grep 全部成功测试

---

## Phase 3: 终端 UI ✅ → 专业的交互体验

### 3.1 Ink REPL 组件
- [x] `src/ui/app.tsx` — 根组件（重写：AbortController + ref 追踪 + 自动保存）
- [x] `src/ui/messages.tsx` — 消息列表渲染（thinking 折叠 + 工具调用 chrome）
- [x] `src/ui/prompt-input.tsx` — 输入框（历史翻阅 + Ctrl+U 清行）
- [x] `src/ui/status-bar.tsx` — 模型、Token 数、耗时
- [x] `src/ui/spinner.tsx` — 思考中动画

### 3.2 工具执行 UI
- [x] `src/ui/tool-result.tsx` — 工具结果展示（耗时、成功/失败状态）
- [x] 工具调用 chrome（⚡ 图标 + 工具名 + 输入摘要）
- [x] 按工具类型格式化（Bash 显示命令、Read 显示路径、Edit 显示替换预览）

### 3.3 键盘交互
- [x] Ctrl+C 中断当前请求（不退出进程，清空状态）
- [x] 上/下箭头翻阅输入历史
- [x] Ctrl+U 清空当前输入行
- [ ] Tab 补全（后续）

**里程碑**: 完整的终端 UI，中断、历史、工具可视化

---

## Phase 4: 权限系统 ✅ → 安全地执行操作

### 4.1 权限模型
- [x] `src/core/permissions.ts` — PermissionMode: default | bypass | deny
- [x] 工具级权限声明（isReadOnly, isDestructive, isConcurrencySafe）
- [x] 规则匹配（精确名、通配符 `*`、工具前缀 `Bash:git *`）

### 4.2 权限 UI
- [x] `src/ui/permission-dialog.tsx` — 审批对话框（Y/N/A 键盘操作）
- [x] 允许 / 拒绝 / 始终允许 三选项
- [x] 按工具类型格式化输入展示（Bash 命令、Write 行数、Edit 替换预览）
- [x] 会话缓存（Always Allow 后不再询问）

### 4.3 权限规则
- [x] 配置文件中的允许/拒绝规则（PermissionRule）
- [x] 通配符模式匹配
- [x] 8 个权限测试通过

**里程碑**: 非只读工具弹出审批对话框

---

## Phase 5: 上下文管理 ✅ → 智能的系统提示词

### 5.1 系统提示词构建
- [x] `src/context.ts` — 组装系统提示词
- [x] 基础指令（角色、能力、约束）
- [x] 系统上下文（日期、平台、shell、CWD）

### 5.2 项目上下文
- [x] CLAUDE.md 层级发现与加载（从 CWD 向上搜索到根）
- [x] Git 状态注入（分支 + 变更摘要）
- [ ] 项目结构摘要

### 5.3 Token 预算
- [x] `src/utils/tokens.ts` — Token 计数估算（中英文自适应）
- [x] 上下文窗口预算分配（模型-窗口映射）
- [x] 超限时自动压缩（80% 阈值 + LLM 摘要）
- [x] `src/core/compact.ts` — tool 配对保护 + 摘要生成

**里程碑**: AI 自动感知项目类型、Git 状态、CLAUDE.md 规则 + 长对话自动压缩

---

## Phase 6: 持久化 ✅ → 跨会话记忆 + 配置 + 命令系统

### 6.1 配置系统
- [x] `src/config/settings.ts` — ~/.ai-shell/config.json
- [x] 项目级配置 .ai-shell/config.json
- [x] 环境变量覆盖（三层优先级）
- [x] API key 自动应用

### 6.2 对话历史
- [x] `src/config/session.ts` — JSONL 会话持久化
- [x] 自动保存（消息变更时）
- [x] `--resume <sessionId>` 恢复会话
- [x] `/history` 命令列出会话

### 6.3 Slash 命令系统
- [x] `src/core/commands.ts` — 9 个内置命令
- [x] /help, /clear, /compact, /cost, /context, /model, /history, /exit, /quit
- [x] 上下文可视化（/context 显示使用率进度条）

### 6.4 可靠性
- [x] `src/utils/retry.ts` — 指数退避重试（429/5xx 自动重试）
- [x] 不可重试错误快速失败

### 6.5 Memory 系统
- [ ] MEMORY.md 发现与加载（后续）

**里程碑**: 关闭终端后可恢复对话，AI 记得之前的工作

---

## Phase 7: 高级功能 ✅ → 生产级体验

### 7.1 Markdown 终端渲染
- [x] `src/utils/markdown.ts` — marked lexer + 自定义 ANSI 渲染
- [x] 标题（h1 粗体下划线、h2 粗体、h3 暗色粗体）
- [x] 代码块（带语言标签 + 缩进边框）
- [x] 行内代码（`cyan` 颜色）
- [x] 粗体/斜体/删除线
- [x] 列表（有序 + 无序）
- [x] 表格（列对齐 + 分隔线）
- [x] 引用块（dim 竖线 + 斜体）

### 7.2 AgentTool
- [x] `src/tools/agent.ts` — 子 Agent 独立 query loop
- [x] 共享工具集，隔离消息流
- [x] 最大 15 轮工具循环限制
- [x] DeepSeek 实测验证通过

### 7.3 模型运行时切换
- [x] /model 命令显示可用模型列表
- [x] /model <name> 切换模型（不重启）
- [x] App 组件状态管理支持

### 7.4 工具注册动态化
- [x] `buildToolSet()` — 运行时构建含 AgentTool 的完整工具集
- [x] 静态工具 + 动态工具分离

### 7.5 未实现（后续可选）
- [ ] MCP 客户端
- [ ] Tab 自动补全
- [ ] Ollama 本地模型测试
- [ ] 语法高亮（cli-highlight 已安装，渲染器已预留）

**里程碑**: AgentTool + Markdown + 模型切换 → 可日常使用

---

## 架构设计原则

### 1. 流式优先
所有 API 交互使用 async generator，支持中断和进度反馈。

### 2. 类型安全
Zod schema 定义工具输入，TypeScript strict 模式，编译时类型检查。

### 3. Fail-Closed 安全
权限默认拒绝，工具默认不可并发，destructive 默认需要确认。

### 4. 模块化
每个工具独立文件，Provider 可插拔，UI 组件可复用。

### 5. 渐进式复杂度
先做最简版本，验证核心流程，再逐步添加高级功能。
