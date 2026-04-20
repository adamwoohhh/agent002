import { AIMessage } from "@langchain/core/messages";
import {
  END,
  GraphNode,
  START,
  MessagesValue,
  StateGraph,
  StateSchema,
} from "@langchain/langgraph";
import * as z from "zod";

const DemoState = new StateSchema({
  messages: MessagesValue,
  topic: z.string(),
  outline: z.array(z.string()),
  explanation: z.string(),
});

const collectIntent: GraphNode<typeof DemoState> = (state) => {
  const topic = state.topic.trim() || "LangGraph";
  return {
    messages: [
      new AIMessage(`收到主题：${topic}。接下来我会先给出学习路线，再补一个最小图执行结果。`),
    ],
    topic,
  };
};

const planStudyPath: GraphNode<typeof DemoState> = (state) => {
  const outline = [
    `1. 先理解 State: 图里的共享状态，当前主题是 ${state.topic}`,
    "2. 再理解 Node: 每个节点就是一个接收 state 并返回更新的函数",
    "3. 然后理解 Edge: 决定节点之间如何流转",
    "4. 最后开始接 LLM、工具调用、持久化和多分支控制流",
  ];

  return {
    messages: [new AIMessage("我已经生成了第一版学习路线。")],
    outline,
  };
};

const summarize: GraphNode<typeof DemoState> = (state) => {
  const explanation = [
    `主题: ${state.topic}`,
    "",
    "建议先掌握下面几个概念：",
    ...state.outline,
    "",
    "这个 demo 只演示 LangGraph 最核心的 State + Node + Edge。",
    "等你跑通后，可以把第二个节点替换成真正的 LLM 调用。",
  ].join("\n");

  return {
    messages: [new AIMessage("图执行完成，可以开始查看结果了。")],
    explanation,
  };
};

const graph = new StateGraph(DemoState)
  .addNode("collectIntent", collectIntent)
  .addNode("planStudyPath", planStudyPath)
  .addNode("summarize", summarize)
  .addEdge(START, "collectIntent")
  .addEdge("collectIntent", "planStudyPath")
  .addEdge("planStudyPath", "summarize")
  .addEdge("summarize", END)
  .compile();

const result = await graph.invoke({
  messages: [],
  topic: "LangGraph 入门",
  outline: [],
  explanation: "",
});

console.log("=== Final State ===");
console.log(JSON.stringify(result, null, 2));
console.log("\n=== Messages ===");
for (const message of result.messages) {
  console.log(`[${message.getType()}] ${message.content}`);
}
console.log("\n=== Explanation ===");
console.log(result.explanation);
