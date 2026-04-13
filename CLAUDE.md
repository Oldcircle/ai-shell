# AI Shell

## 概述

从零构建的类 Claude Code 命令行 AI 编程助手。学习项目，参考 claude-code-best 逆向实现，但完全重写。

## 技术栈

- **Runtime**: Bun (>=1.2.0)
- **语言**: TypeScript (strict mode)
- **终端 UI**: React + Ink
- **API**: Anthropic SDK (@anthropic-ai/sdk)
- **Schema**: Zod
- **状态管理**: Zustand
- **Lint/Format**: Biome
- **测试**: bun:test

## 目录结构

```
ai-shell/
├── CLAUDE.md              # 本文件
├── PLAN.md                # 开发计划
├── STATUS.md              # 会话交接
├── package.json
├── tsconfig.json
├── biome.json
├── src/
│   ├── cli.tsx            # 入口 — CLI bootstrap
│   ├── main.tsx           # Commander.js 主程序
│   ├── repl.tsx           # REPL 交互循环（React/Ink）
│   ├── query.ts           # 核心查询循环（async generator）
│   ├── context.ts         # 系统提示词构建
│   ├── core/
│   │   ├── tool.ts        # Tool 接口定义 + buildTool() 工厂
│   │   ├── tools.ts       # Tool 注册表
│   │   ├── state.ts       # AppState 定义 + Zustand store
│   │   ├── message.ts     # 消息类型定义
│   │   └── permissions.ts # 权限系统
│   ├── tools/             # 内置工具实现
│   │   ├── bash.ts        # Bash 命令执行
│   │   ├── file-read.ts   # 文件读取
│   │   ├── file-write.ts  # 文件写入
│   │   ├── file-edit.ts   # 文件编辑（diff-based）
│   │   ├── glob.ts        # 文件搜索
│   │   └── grep.ts        # 内容搜索
│   ├── providers/         # API 提供商适配
│   │   ├── anthropic.ts   # Anthropic 直连（主要）
│   │   ├── openai.ts      # OpenAI 兼容（Ollama/DeepSeek 等）
│   │   └── types.ts       # 提供商接口定义
│   ├── ui/                # Ink UI 组件
│   │   ├── app.tsx        # 根组件
│   │   ├── messages.tsx   # 消息渲染
│   │   ├── prompt-input.tsx # 输入框
│   │   ├── status-bar.tsx # 状态栏
│   │   ├── spinner.tsx    # 加载动画
│   │   └── permission-dialog.tsx # 权限对话框
│   ├── config/
│   │   ├── settings.ts    # 配置加载（~/.ai-shell/config.json）
│   │   └── claudemd.ts    # CLAUDE.md 发现与加载
│   └── utils/
│       ├── tokens.ts      # Token 计数
│       ├── git.ts         # Git 状态
│       ├── format.ts      # 输出格式化
│       └── logger.ts      # 日志
├── tests/                 # 测试
│   ├── core/
│   ├── tools/
│   └── fixtures/
└── docs/                  # 文档
    └── architecture.md    # 架构说明
```

## 运行方式

```bash
# 交互模式（需要 API key）
DEEPSEEK_API_KEY=sk-xxx bun run dev --provider deepseek

# 管道模式
DEEPSEEK_API_KEY=sk-xxx bun run dev --provider deepseek -p "your prompt"

# Anthropic
ANTHROPIC_API_KEY=sk-ant-xxx bun run dev

# 使用配置文件（~/.ai-shell/config.json）
bun run dev
```

## 开发命令

```bash
bun install               # 安装依赖
bun run dev               # 开发模式运行（即 bun run src/cli.tsx）
bun run build             # 构建
bun test                  # 运行测试
bun run lint              # Lint 检查
bun run format            # 格式化
```

## 代码约定

- TypeScript strict 模式，`bunx tsc --noEmit` 零错误
- 使用 Conventional Commits：`feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`
- 工具实现使用 `buildTool()` 工厂函数
- Zod schema 定义工具输入
- 权限检查 fail-closed（默认拒绝）
- 所有 API 调用走 Provider 抽象层

## 参考项目

- 源码参考: `/Users/yb/Opensource/vendor/claude-code-ref`
- 这是学习项目，代码完全重写，不复制粘贴

## 首次发布记录

- **GitHub**: https://github.com/Oldcircle/ai-shell
- **可见性**: public
- **日期**: 2026-04-13
- **默认分支**: main

## 活跃文档

- `PLAN.md` — 分阶段开发计划
- `STATUS.md` — 当前进度与会话交接
