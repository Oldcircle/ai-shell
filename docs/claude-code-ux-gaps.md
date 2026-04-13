# Claude Code UX 差距分析 → 修复计划

基于对 claude-code-ref 的深入分析，以下是 ai-shell 需要修复的问题，按优先级排列。

## P0: 影响日常使用

### 1. Spinner 只有一种状态
- **Claude Code**: 根据当前操作显示不同动词 — "Thinking...", "Reading...", "Running...", "Writing..."
- **我们**: 只有 "thinking..."
- **修复**: spinner 接收当前操作状态

### 2. Bash 输出 STDOUT/STDERR 不分离
- **Claude Code**: STDOUT 正常色，STDERR 红/黄色，exit code 独立显示
- **我们**: 全部混在一起
- **修复**: Bash tool 返回结构化结果，REPL 分色显示

### 3. 工具调用前缺少描述
- **Claude Code**: Bash 执行前显示 description，Edit 执行前显示文件路径和行号范围
- **我们**: 有 description 但格式不够清晰
- **修复**: 格式化工具描述

### 4. 错误显示太简陋
- **Claude Code**: 不同错误类型有不同颜色和格式（API error、rate limit、context too long 等）
- **我们**: 统一红色一行文字
- **修复**: 分类错误，特定格式

### 5. `/help` 命令不够完整
- **Claude Code**: 三列布局，显示快捷键、命令、模式
- **我们**: 单列列表
- **修复**: 美化 help 输出

## P1: 提升专业感

### 6. 欢迎界面缺少关键信息
- **Claude Code**: 版本号、用户名、模型、计费类型、CWD、ASCII 艺术
- **我们**: 有版本和模型，但缺少 CWD 和更多上下文
- **修复**: 增加环境信息

### 7. 输入提示符缺少模式区分
- **Claude Code**: `❯` 正常模式，`!` bash 模式，不同颜色
- **我们**: 只有 `❯`
- **修复**: 支持 `!` 前缀直接执行 bash

### 8. 没有 thinking 持续时间显示
- **Claude Code**: "Thinking (2.3s)" 显示思考耗时
- **我们**: 只有 "thinking..."
- **修复**: 记录 thinking 开始时间，完成时显示持续时间

### 9. 代码块缺少语法高亮
- **Claude Code**: 使用 cli-highlight 异步加载语法高亮
- **我们**: markdown.ts 已安装 cli-highlight 但未使用
- **修复**: 在代码块渲染中启用 cli-highlight

## P2: 体验一致性

### 10. blockquote 渲染风格
- **Claude Code**: 使用 `▎` (BLOCKQUOTE_BAR) Unicode 字符
- **我们**: 使用 `│` + dim
- **修复**: 换成 `▎`

### 11. 工具名后缺少 "no colon" 规则
- **Claude Code**: 系统提示词明确说 "Do not use a colon before tool calls"
- **我们**: 没有这条规则
- **修复**: 加到系统提示词

### 12. 输入前缀 `!` 直接执行 bash
- **Claude Code**: `! ls -la` 直接执行，不经过 LLM
- **我们**: 没有这个功能
- **修复**: REPL 中检测 `!` 前缀
