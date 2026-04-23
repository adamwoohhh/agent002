import type { AppConfig } from "../config/app-config.js";
import { FornaxTelemetryRuntime, type FornaxSpanLike, type FornaxTracerLike } from "./fornax-telemetry-runtime.js";
import { buildBaggage, buildTags, getSpanKind, getSpanName, resolveSpanDescriptor } from "./telemetry-span-mapping.js";
import type {
  GraphTelemetryEvent,
  ModelTelemetryEvent,
  RunLifecycleEvent,
  RuntimeTelemetryEvent,
  SessionTelemetryEvent,
  TelemetryEvent,
  TelemetryWriter,
} from "./telemetry-writer.js";

/**
 * FornaxTelemetryWriter - 基于 Fornax 追踪系统的遥测事件写入器
 *
 * 职责：将 TelemetryEvent 转换为 Fornax Span，构建完整的调用链追踪。
 * 支持乱序事件处理：当子事件先于父事件到达时，会暂存到待处理队列，
 * 等父 Span 创建后再批量回放。
 */
export class FornaxTelemetryWriter implements TelemetryWriter {
  /** Fornax 运行时，负责实际的 Span 创建和上报 */
  private readonly runtime: FornaxTelemetryRuntime;
  /** 事件 ID → Span 映射，用于根据 eventId 查找对应的 Span（包括父 Span 查找） */
  private readonly spansByEventId = new Map<string, FornaxSpanLike>();
  /** 父事件 ID → 等待处理的子事件队列，处理乱序到达的事件 */
  private readonly pendingEventsByParentId = new Map<string, TelemetryEvent[]>();
  /** 已调用 end() 的 Span 事件 ID 集合，防止重复结束 */
  private readonly endedEventIds = new Set<string>();
  /** 根 Span（即 run_started 事件）的事件 ID */
  private rootEventId: string | null = null;

  constructor(
    readonly runId: string,
    config: AppConfig,
    tracer?: FornaxTracerLike,
  ) {
    this.runtime = new FornaxTelemetryRuntime(config, tracer);
  }

  /**
   * 写入遥测事件的入口方法
   *
   * 处理流程：
   * 1. 检查运行时是否启用
   * 2. 按事件类型分发：run_started → 创建根 Span，run_completed/failed → 结束根 Span
   * 3. 对于其他事件，查找父 Span；若父 Span 尚未创建，则入队等待
   * 4. 父 Span 已存在时，直接处理子事件
   */
  async runStarted(event: RunLifecycleEvent): Promise<void> { await this.dispatch(event); }
  async runCompleted(event: RunLifecycleEvent): Promise<void> { await this.dispatch(event); }
  async runFailed(event: RunLifecycleEvent): Promise<void> { await this.dispatch(event); }
  async sessionEvent(event: SessionTelemetryEvent): Promise<void> { await this.dispatch(event); }
  async graphEvent(event: GraphTelemetryEvent): Promise<void> { await this.dispatch(event); }
  async modelCall(event: ModelTelemetryEvent): Promise<void> { await this.dispatch(event); }
  async policyRejected(event: RuntimeTelemetryEvent): Promise<void> { await this.dispatch(event); }
  async runtimeTaskCompleted(event: RuntimeTelemetryEvent): Promise<void> { await this.dispatch(event); }

  private async dispatch(event: TelemetryEvent): Promise<void> {
    if (!this.runtime.isEnabled()) {
      return;
    }

    if (event.type === "run_started") {
      this.handleRunStarted(event);
      return;
    }

    if (event.type === "run_completed" || event.type === "run_failed") {
      this.handleRunFinished(event);
      return;
    }

    const parentSpan = this.resolveParentSpan(event.parentEventId);
    // 父事件 ID 存在但父 Span 尚未创建 → 乱序事件，暂存到待处理队列
    if (event.parentEventId && !parentSpan) {
      this.enqueuePendingEvent(event.parentEventId, event);
      return;
    }

    this.processEventWithParent(event, parentSpan);
  }

  /** 强制刷新缓冲区，将待上报的 Span 数据发送到 Fornax 后端 */
  async flush(): Promise<void> {
    await this.runtime.flush();
  }

  /**
   * 关闭写入器，执行清理操作
   *
   * 1. 结束所有尚未关闭的 Span（防止泄漏）
   * 2. 关闭运行时连接
   * 3. 清空所有内部数据结构
   */
  async shutdown(): Promise<void> {
    for (const [eventId, span] of this.spansByEventId.entries()) {
      if (!this.endedEventIds.has(eventId)) {
        span.end();
        this.endedEventIds.add(eventId);
      }
    }

    await this.runtime.shutdown();
    this.spansByEventId.clear();
    this.pendingEventsByParentId.clear();
    this.endedEventIds.clear();
    this.rootEventId = null;
  }

  /**
   * 处理 run_started 事件 — 创建根 Span（agent_run）
   *
   * 1. 解析父事件 ID，若父 Span 不存在则入队等待
   * 2. 创建名为 "agent_run" 的 Agent 类型 Span
   * 3. 设置标签和输入数据（input、phase、stateBeforeTurn、initialContext）
   * 4. 立即 end() 上报根 Span
   * 5. 注册到 spansByEventId，记录为 rootEventId（若无父事件）
   * 6. 回放所有等待该 Span 的子事件
   */
  private handleRunStarted(event: TelemetryEvent): void {
    const parentEventId = typeof event.parentEventId === "string" ? event.parentEventId : undefined;
    const parentSpan = this.resolveParentSpan(parentEventId);
    if (parentEventId && !parentSpan) {
      this.enqueuePendingEvent(parentEventId, event);
      return;
    }

    const eventId = typeof event.eventId === "string" ? event.eventId : undefined;
    const span = this.runtime.startSpan({
      name: getSpanName(event),
      type: getSpanKind(event),
      parent: parentSpan,
      threadId: this.runId,
      baggage: buildBaggage(event, this.runId),
    });

    if (!span) {
      return;
    }

    const descriptor = resolveSpanDescriptor(event, this.runId);
    span.setTags(descriptor.tags);
    if (descriptor.input !== undefined) {
      span.setInput(descriptor.input);
    }
    span.end();

    if (eventId) {
      this.spansByEventId.set(eventId, span);
      this.endedEventIds.add(eventId);
      if (!parentEventId) {
        this.rootEventId = eventId;
      }
      this.flushPendingChildren(eventId);
    }
  }

  /**
   * 处理 run_completed / run_failed 事件 — 结束根 Span
   *
   * Root span 已在创建后立即上报，这里只做存在性确认，不再二次结束。
   */
  private handleRunFinished(event: TelemetryEvent): void {
    const rootEventId = typeof event.parentEventId === "string" ? event.parentEventId : this.rootEventId ?? undefined;
    const rootSpan = rootEventId ? this.spansByEventId.get(rootEventId) : undefined;
    if (!rootSpan) {
      return;
    }
  }

  /**
   * 为非 run_started/finished 事件创建子 Span 并立即结束
   *
   * 子 Span 是即时完成的（创建后立即 end），因为中间事件
   * 不需要追踪持续时间，只需记录输入/输出快照。
   *
   * 1. 根据 event 类型获取 Span 名称、类型、详情
   * 2. 设置标签、输入、输出（或错误）
   * 3. 立即结束 Span
   * 4. 注册到 spansByEventId 并回放等待的子事件
   */
  private createAndRecordChildSpan(event: TelemetryEvent, parent?: FornaxSpanLike): void {
    const span = this.runtime.startSpan({
      name: getSpanName(event),
      type: getSpanKind(event),
      parent,
      threadId: this.runId,
      baggage: buildBaggage(event, this.runId),
    });

    if (!span) {
      return;
    }

    const descriptor = resolveSpanDescriptor(event, this.runId);
    span.setTags(descriptor.tags);

    if (descriptor.input !== undefined) {
      span.setInput(descriptor.input);
    }

    if (descriptor.error !== undefined) {
      span.setError(descriptor.error);
    } else if (descriptor.output !== undefined) {
      span.setOutput(descriptor.output);
    }

    span.end();

    if (typeof event.eventId === "string") {
      this.spansByEventId.set(event.eventId, span);
      this.endedEventIds.add(event.eventId);
      this.flushPendingChildren(event.eventId);
    }
  }

  private processEventWithParent(event: TelemetryEvent, parent?: FornaxSpanLike): void {
    if (event.type === "run_started") {
      this.handleRunStarted(event);
      return;
    }

    this.createAndRecordChildSpan(event, parent);
  }

  /** 根据 parentEventId 查找已创建的父 Span */
  private resolveParentSpan(parentEventId: string | undefined): FornaxSpanLike | undefined {
    if (!parentEventId) {
      return undefined;
    }

    return this.spansByEventId.get(parentEventId);
  }

  /**
   * 将乱序到达的事件暂存到待处理队列
   *
   * 当子事件的 parentEventId 对应的 Span 尚未创建时调用。
   * 等父 Span 创建后，flushPendingChildren() 会批量回放这些事件。
   */
  private enqueuePendingEvent(parentEventId: string, event: TelemetryEvent): void {
    const pendingEvents = this.pendingEventsByParentId.get(parentEventId) ?? [];
    pendingEvents.push(event);
    this.pendingEventsByParentId.set(parentEventId, pendingEvents);
  }

  /**
   * 回放所有等待指定父 Span 的子事件
   *
   * 在父 Span 创建并注册到 spansByEventId 后调用，
   * 将暂存的子事件逐个处理并挂载到父 Span 下。
   */
  private flushPendingChildren(parentEventId: string): void {
    const pendingEvents = this.pendingEventsByParentId.get(parentEventId);
    if (!pendingEvents?.length) {
      return;
    }

    this.pendingEventsByParentId.delete(parentEventId);
    const parentSpan = this.spansByEventId.get(parentEventId);
    for (const pendingEvent of pendingEvents) {
      this.processEventWithParent(pendingEvent, parentSpan);
    }
  }
}
