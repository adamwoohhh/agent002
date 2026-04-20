# LangGraph TypeScript Demo

这是一个用 LangGraph Graph API 实现的最小“数学计算 agent”示例。

它接受自然语言输入，通过可切换的 provider 接入模型服务，让 LLM 在 4 个数学工具里选择合适的一个，再返回加减乘除的计算结果。

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

运行时需要传入一句自然语言：

```bash
npm run dev -- "请帮我算一下 18 除以 3"
```

## 图结构

这个 demo 有 4 个节点：

1. `collectInput`
2. `parseIntent`
3. `runCalculation`
4. `formatAnswer`

执行链路如下：

```text
START -> collectInput -> parseIntent -> runCalculation -> formatAnswer -> END
```

## LLM 接入方式

`parseIntent` 节点现在不直接依赖某个具体模型 SDK，而是通过 provider 抽象完成 tool calling。当前项目内置两个实现：

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

## 支持范围

当前示例故意保持简单，只支持：

- 两个数字
- 一次运算
- 加、减、乘、除

例如：

- `12 加 8`
- `50 减 6`
- `7 * 9`
- `20 / 5`

## 下一步可以怎么扩展

如果你想把它继续升级成真正的 agent，可以继续做这些事：

1. 增加条件边，区分成功、无法识别、模型异常
2. 支持多步表达式，比如“先加再乘”
3. 让模型在拿到工具结果后继续生成自然语言解释
4. 接入持久化和对话记忆
