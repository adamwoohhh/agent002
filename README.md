# LangGraph TypeScript Demo

这是一个用 LangGraph Graph API 实现的最小“数学计算 agent”示例。

它接受自然语言输入，通过 OpenAI SDK 的 tool calling 能力，让 LLM 在 4 个数学工具里选择合适的一个，再返回加减乘除的计算结果。

参考资料：

- LangGraph 官方 JavaScript 文档: https://docs.langchain.com/oss/javascript/langgraph/use-graph-api

## 快速开始

```bash
npm install
cp .env.local.example .env.local
# 然后把 .env.local 里的 OPENAI_API_KEY 改成你自己的 key
npm run dev -- "请帮我算一下 12 加 8"
```

默认会从项目根目录的 `.env.local` 读取配置。

`.env.local` 示例：

```bash
OPENAI_API_KEY=your_api_key_here
OPENAI_MODEL=gpt-4.1
```

说明：

- `.env.local` 已经被 `.gitignore` 忽略，不会进入仓库
- 仓库里只保留 `.env.local.example` 作为模板
- 代码启动时会自动加载 `.env.local`

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

`parseIntent` 节点使用 OpenAI 官方 JavaScript SDK 的 function tool calling 能力。当前项目把四则运算封装成了 4 个工具：

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
