# LangGraph TypeScript Demo

这是一个面向 TypeScript 开发者的最小 LangGraph 入门项目。

参考资料：

- LangGraph 官方 JavaScript 文档: https://docs.langchain.com/oss/javascript/langgraph/use-graph-api

## 项目目标

- 用最少代码理解 `State`
- 理解 `Node` 是如何读写共享状态的
- 理解 `Edge` 如何组织执行流程
- 用一个可运行 demo 建立直觉

## 快速开始

```bash
npm install
npm run dev
```

## 目录结构

```text
.
├── package.json
├── src
│   └── index.ts
└── tsconfig.json
```

## 你会看到什么

这个 demo 里有 3 个节点：

1. `collectIntent`
2. `planStudyPath`
3. `summarize`

它们通过一条简单链路执行：

```text
START -> collectIntent -> planStudyPath -> summarize -> END
```

`messages` 使用了 LangGraph 内置的 `MessagesValue`，适合后续扩展成真正的对话状态。

## 下一步建议

你跑通这个 demo 以后，建议按这个顺序继续：

1. 把 `planStudyPath` 节点改成真实 LLM 调用
2. 给图加条件分支
3. 引入工具调用
4. 试一下持久化和断点恢复
