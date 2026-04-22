# LangGraph TypeScript Demo

这是一个用 LangGraph Graph API 实现的最小“数学计算 agent”示例。

它接受自然语言输入，通过可切换的 provider 接入模型服务，让 LLM 在 4 个数学工具里选择合适的一个，再返回加减乘除的计算结果。

现在它除了直接计算算式，也支持：

- 结合多轮对话历史继续计算
- 从生活情境里提取数字和运算关系
- 当情境缺少必要信息时，先追问一轮再继续计算

参考资料：

- LangGraph 官方 JavaScript 文档: https://docs.langchain.com/oss/javascript/langgraph/use-graph-api

## 快速开始

```bash
npm install
cp .env.local.example .env.local
# 然后把 .env.local 里的 AGX_API_KEY 改成你自己的 key
npm run dev -- "请帮我算一下 12 加 8"
```

默认会从项目根目录的 `.env.local` 读取配置。

`.env.local` 示例：

```bash
AGX_PROVIDER=openai
AGX_API_KEY=your_api_key_here
AGX_MODEL=gpt-4.1
```

说明：

- `.env.local` 已经被 `.gitignore` 忽略，不会进入仓库
- 仓库里只保留 `.env.local.example` 作为模板
- 代码启动时会自动加载 `.env.local`

Provider 切换：

- `AGX_PROVIDER=openai`
  - 使用 OpenAI 官方 SDK，走 Responses API
  - 依赖 `AGX_API_KEY`
  - 如果配置了 `AGX_BASE_URL`，会一起用于兼容服务
- `AGX_PROVIDER=http`
  - 使用 `fetch` 直接请求 HTTP 模型服务
  - 示例按 OpenAI 兼容的 `chat/completions` 接口编写
  - 可配置 `AGX_HTTP_URL`、`AGX_HTTP_API_KEY`、`AGX_HTTP_MODEL`
  - 如果没有单独传 `AGX_HTTP_API_KEY`，会回退到 `AGX_API_KEY`
  - 如果没有单独传 `AGX_HTTP_URL`，会优先根据 `AGX_BASE_URL` 自动拼出 `chat/completions` 地址

`http` provider 示例环境变量：

```bash
AGX_PROVIDER=http
AGX_HTTP_URL=https://api.openai.com/v1/chat/completions
AGX_HTTP_API_KEY=your_api_key_here
AGX_HTTP_MODEL=gpt-4.1
```

CLI 参数会覆盖环境变量，支持这几个选项：

- `--provider`
- `--api-key`
- `--model`
- `--base-url`
- `--http-url`
- `--http-api-key`
- `--http-model`
- `--http-timeout-ms`

例如：

```bash
npm run dev -- --provider=http --http-timeout-ms=10000 "请帮我算一下 18 除以 3"
```

运行时如果传入一句自然语言，会执行单轮计算：

```bash
npm run dev -- "请帮我算一下 18 除以 3"
```

如果不传输入，会进入交互式多轮模式：

```bash
npm run dev
```

示例：

```text
你> 12 加 8
助手> 12 + 8 = 20
你> 结果再乘 2
助手> 20 * 2 = 40
你> 冰箱里有 3 个苹果，早上我吃了苹果，还剩下几个苹果
助手> 你早上吃了几个苹果？
你> 1个
助手> 还剩下 2 个苹果。
```

## 测试分层

项目现在按三层来组织质量保障：

- `tests/unit/`
  - 单元测试
  - 关注小块代码逻辑是否正确、是否稳定
  - 当前覆盖 CLI 配置解析、`http provider` 请求与解析契约
- `tests/agent/`
  - agent 评测
  - 关注完整任务链路最终行为是否保持稳定
  - 当前覆盖四则运算、输入归一化、不支持场景、除零、provider 异常
- `tests/llm/`
  - 大模型评测
  - 关注真实 provider / 模型在一组样例上的能力回归
  - 默认不跑，避免本地开发和 CI 被真实网络与模型波动影响

运行方式：

```bash
npm run test:unit
npm run test:agent
npm test
```

真实大模型评测：

```bash
AGX_ENABLE_LLM_EVALS=1 npm run eval:llm
```

如果你想把本地稳定测试和真实大模型评测一起跑，可以执行：

```bash
AGX_ENABLE_LLM_EVALS=1 npm run eval
```

说明：

- `npm test` 只跑稳定的本地单元测试和 agent 评测
- `npm run eval:llm` 只跑真实模型评测
- `npm run eval` 会先跑本地稳定测试，再跑真实模型评测

## 当前架构

项目已经从单文件 demo 重构成分层结构：

- `src/app/`
  - 应用入口与 CLI
  - 暴露 `createAgentApp(config)`，统一创建单轮运行和多轮 session
- `src/application/`
  - 数学 agent 的应用编排层
  - 包含 graph orchestration、conversation state、prompt builder、decision service、answer renderer
- `src/domain/`
  - 纯领域规则
  - 当前主要是四则运算、领域类型和领域错误
- `src/infrastructure/`
  - provider、配置解析、日志与观测
  - `AppConfig` 在这一层统一收敛环境变量与 CLI 覆盖
- `src/platform/`
  - 通用 agent runtime 骨架
  - 提供 `CapabilityRegistry`、`AgentRuntime`、`ExecutionPolicy`、`TaskManager`

这次重构的目标不是一步变成完整的通用 coding agent，而是先把“单领域 agent”拆清楚，同时为后续平台化能力预留接口。

## Graph 结构

当前数学 agent graph 固定为 4 个职责清晰的节点：

1. `normalizeInput`
2. `decideIntent`
3. `executeOperation`
4. `renderAnswer`

执行链路如下：

```text
START -> normalizeInput -> decideIntent -> executeOperation -> renderAnswer -> END
```

其中：

- `normalizeInput`
  - 做输入归一化，保证 provider 看到的是稳定表达
- `decideIntent`
  - 通过 provider + tool calling 选择数学工具、拒绝或追问
- `executeOperation`
  - 执行纯领域运算
- `renderAnswer`
  - 把计算结果整理成用户可读回答

## LLM 接入方式

`decideIntent` 和 `renderAnswer` 不直接依赖某个具体模型 SDK，而是通过 provider 抽象完成模型调用。当前项目内置两个实现：

- `openai provider`
- `http provider`

无论底层用哪个 provider，都会复用同一套数学工具定义。当前项目把四则运算封装成了 4 个工具：

- `add`
- `subtract`
- `multiply`
- `divide`

模型收到自然语言后会：

1. 判断是否属于“两个数字的一次加减乘除”
2. 如果可以处理，必须选择一个工具并传入 `left` 和 `right`
3. 如果不能处理，则直接返回不支持的说明

这样做的好处是：

- 运算能力以工具形式暴露，更符合 agent 的扩展方向
- 模型接入与业务图编排解耦，可以按环境变量切换 provider
- 模型不需要直接输出结构化意图 schema，而是直接做工具选择
- 后续可以继续增加更多工具，而不是不断扩展解析逻辑
- provider 不再是应用核心，而只是 runtime 能消费的基础设施适配器

## Runtime 骨架

为了给后续往 Codex / Claude Code 风格演进打底，项目现在增加了一个轻量 runtime 骨架：

- `CapabilityRegistry`
  - 注册能力模块
- `MathCapability`
  - 数学能力作为第一个 capability 接入
- `AgentRuntime`
  - 负责创建 task / run、执行 capability、挂接 policy 和 observability
- `ExecutionPolicy`
  - 当前默认 `AllowAll`，但接口已经固定，后续可以接审批和 sandbox 约束

这部分还不是完整的平台能力，但已经把“数学流程”从“唯一主流程”提升成了“可被 runtime 执行的 capability”。

## 支持范围

## 日志查看器

项目内置了一个本地日志 Web Viewer，用来查看 `logs/*.jsonl` 运行日志。

启动方式：

```bash
npm run log:view
```

自定义端口或日志目录：

```bash
npm run log:view -- --port=3789 --log-dir=./logs
```

启动后打开终端输出里的本地地址即可。第一版页面提供：

- 左侧日志文件列表
- 中间事件时间线，展示 `sequence`、`timestamp`、`type` 和 `graph_event.mode`
- 右侧单条事件的完整 JSON 详情
- 顶部摘要卡片与基础筛选（按事件类型、mode、关键字）

当前日志查看器只读，不会修改或删除本地日志文件，也暂不支持实时 tail。

当前示例故意保持简单，只支持：

- 两个数字
- 一次运算
- 加、减、乘、除
- 基于对话历史续算上一轮结果
- 从简单情境里抽取两个数字做一次运算
- 信息缺失时先追问一轮

例如：

- `12 加 8`
- `50 减 6`
- `7 * 9`
- `20 / 5`
- `结果再乘 2`
- `上一次结果除以 4`
- `冰箱里有 3 个苹果，早上我吃了 1 个，还剩下几个苹果`
- `冰箱里有 3 个苹果，早上我吃了苹果，还剩下几个苹果`

## 下一步可以怎么扩展

如果你想把它继续升级成真正的 agent，可以继续做这些事：

1. 增加条件边，区分成功、无法识别、模型异常
2. 支持多步表达式，比如“先加再乘”
3. 让模型在拿到工具结果后继续生成自然语言解释
4. 接入持久化和对话记忆
