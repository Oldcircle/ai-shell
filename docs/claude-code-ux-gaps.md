# Claude Code UX 差距分析 → 修复记录

基于对 claude-code-ref 的深入分析，逐项修复。

## P0: 影响日常使用 — 全部已修复 ✅

### 1. ~~Spinner 只有一种状态~~ ✅
→ 上下文动词 spinner（Reading.../Writing.../Running...）

### 2. ~~Bash 输出不分离~~ ✅  
→ 工具结果详情：Edit 红绿 diff，Bash 输出预览，Write 内容预览

### 3. ~~工具调用前缺少描述~~ ✅
→ 格式化工具描述（Bash 显示命令，Edit 显示文件+替换预览）

### 4. ~~错误显示太简陋~~ ✅
→ 分类错误：rate limit 黄色，auth 红色，context 建议 /compact，timeout，网络

### 5. ~~`/help` 不够完整~~ ✅
→ 显示所有命令 + ! bash 模式提示

### 6. ~~25 轮工具限制导致失忆~~ ✅
→ 默认 maxTurns=Infinity，超限时保留消息，提示"continue"

### 7. ~~后台任务不支持~~ ✅
→ run_in_background + 服务器检测 + /tasks + /kill

## P1: 提升专业感 — 全部已修复 ✅

### 8. ~~欢迎界面缺少信息~~ ✅
→ Model/Provider/CWD/Session 四行信息

### 9. ~~输入提示符缺少模式区分~~ ✅
→ `!` 前缀直接执行 bash（不经过 LLM）

### 10. ~~没有 thinking 耗时~~ ✅
→ "Thinking (2.3s)" 显示持续时间

### 11. ~~成本计算对 DeepSeek 不准~~ ✅
→ Provider 感知定价：DeepSeek $0.14/$0.28，Anthropic $3/$15

### 12. ~~FileWrite 盲覆写~~ ✅
→ 已存在但未读取的文件拒绝覆写

### 13. ~~Bash CWD 不持久~~ ✅
→ 命令结束后提取 pwd 更新 context.cwd

## P2: 体验一致性 — 全部已修复 ✅

### 14. ~~blockquote 风格~~ ✅
→ 换成 `▎`（Claude Code 风格）

### 15. ~~"no colon" 规则~~ ✅
→ 系统提示词加入

### 16. ~~工具结果无截断~~ ✅
→ 超 100K 字符自动截断

### 17. ~~Grep 功能不全~~ ✅
→ -i, -A/-B/-C, head_limit, offset, multiline

### 18. ~~Markdown 渲染~~ ✅
→ 流式输出 → 完成后清屏重绘

### 19. ~~空响应崩溃~~ ✅
→ 空 assistant 消息不追加（防止 role alternation 错误）

### 20. ~~/clear 不重置状态~~ ✅
→ 清除 readFiles 集合

## 第三轮深度优化 — 已修复 ✅

### 21. ~~Anthropic Prompt Caching~~ ✅
→ system prompt + tools 标记 `cache_control: ephemeral`，节省 30-50% 输入 token 费用

### 22. ~~Bash 长命令无进度~~ ✅
→ 3 秒以上命令每秒显示 `… N lines · Ns elapsed`（写 stderr，不污染返回值）

### 23. ~~缺失 API key 错误不友好~~ ✅
→ 列出三个 provider 的注册链接 + quick start + 配置文件示例

### 24. ~~402 Insufficient Balance 未识别~~ ✅
→ 新增错误分类，列出三家计费页面链接

### 25. ~~server 检测误判 `--help`~~ ✅
→ `--help/--version/--dry-run/--check` 等一次性 flag 排除

### 26. ~~API 无超时导致 hang~~ ✅
→ OpenAI-compatible provider 加 2 分钟 fetch timeout

## 待实现（P3 后续）

- [ ] 代码块语法高亮（cli-highlight 已安装，需集成）
- [ ] 图片/视觉输入支持
- [ ] Tab 自动补全
- [ ] MCP 客户端
