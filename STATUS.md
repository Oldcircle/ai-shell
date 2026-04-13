# AI Shell — 状态

## 当前阶段

Phase 7 完成（全部 7 个 Phase）

## 项目数据

- **35 源文件，6198 行代码**
- **14 测试文件，1050+ 行测试代码**
- **94 unit tests + expect 集成测试 / 0 fail**
- TypeScript strict 零错误
- DeepSeek 实机全功能验证
- 20/20 Claude Code UX 差距项已修复（见 docs/claude-code-ux-gaps.md）

## 功能全景

### 核心架构
- async generator 驱动的 query loop（流式 + 工具循环 + 并行分流 + abort）
- Provider 抽象（Anthropic + OpenAI 兼容 → DeepSeek/Ollama/OpenAI）
- buildTool() 工厂 + fail-closed 安全默认值 + Zod 验证

### 7 个内置工具
| 工具 | 类型 | 说明 |
|------|------|------|
| Read | 只读 | 文件读取（行号 + 偏移 + 限制） |
| Write | 破坏性 | 文件写入（自动创建目录） |
| Edit | 破坏性 | 精确字符串替换（唯一性检查） |
| Bash | 破坏性 | Shell 命令（超时 + 输出限制） |
| Glob | 只读 | 文件模式搜索 |
| Grep | 只读 | 内容搜索（ripgrep） |
| Agent | 破坏性 | 子 Agent（独立 query loop） |

### 9 个 Slash 命令
/help, /clear, /compact, /cost, /context, /model, /history, /exit, /quit

### 终端 UI
- Markdown 渲染（标题/粗体/斜体/代码块/列表/表格/引用）
- 权限对话框（Y/N/A）
- 输入历史（↑/↓）+ Ctrl+C 中断 + Ctrl+U 清行
- 工具调用 chrome + 结果展示（耗时/状态）
- 模型运行时切换 /model

### 上下文管理
- Token 估算（中英文自适应）
- 自动压缩（80% 阈值 + LLM 摘要 + tool 配对保护）
- /compact 手动压缩 + /context 可视化

### 持久化 + 配置
- JSONL 会话自动保存 + --resume 恢复
- 三层配置（全局 + 项目 + 环境变量）
- 指数退避重试（429/5xx）

## DeepSeek 实机验证

```
✅ Read, Write, Edit, Bash, Glob, Grep — 全部独立通过
✅ 5-tool chain (Write→Read→Bash→Edit→Read)
✅ AgentTool 子 Agent 独立执行
✅ Markdown 渲染（标题/代码块/列表/表格）
✅ Slash 命令（/help /cost /context /model）
✅ 配置系统保存/加载
```

## 文件总览

```
src/ (33 files, 4941 lines)
├── cli.tsx              ← 入口
├── query.ts             ← 核心循环
├── context.ts           ← 系统提示词
├── core/
│   ├── message.ts       ← 消息类型
│   ├── tool.ts          ← Tool 接口
│   ├── tools.ts         ← 工具注册（含动态 AgentTool）
│   ├── state.ts         ← 状态管理
│   ├── permissions.ts   ← 权限系统
│   ├── compact.ts       ← 上下文压缩
│   └── commands.ts      ← Slash 命令（含 /model 切换）
├── providers/
│   ├── types.ts         ← Provider 接口
│   ├── anthropic.ts     ← Anthropic
│   └── openai-compatible.ts ← DeepSeek/OpenAI/Ollama
├── tools/
│   ├── file-read.ts     ← Read
│   ├── file-write.ts    ← Write
│   ├── file-edit.ts     ← Edit
│   ├── bash.ts          ← Bash
│   ├── glob.ts          ← Glob
│   ├── grep.ts          ← Grep
│   └── agent.ts         ← AgentTool (子 Agent)
├── config/
│   ├── session.ts       ← 会话持久化
│   └── settings.ts      ← 配置系统
├── ui/
│   ├── app.tsx          ← 根组件
│   ├── messages.tsx     ← 消息渲染（Markdown）
│   ├── prompt-input.tsx ← 输入框
│   ├── permission-dialog.tsx ← 权限对话框
│   ├── tool-result.tsx  ← 工具结果
│   ├── status-bar.tsx   ← 状态栏
│   └── spinner.tsx      ← 加载动画
└── utils/
    ├── markdown.ts      ← Markdown→ANSI 渲染
    ├── tokens.ts        ← Token 估算
    ├── retry.ts         ← 重试逻辑
    └── logger.ts        ← 日志
```
