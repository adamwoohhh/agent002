export type TelemetryEvent = {
  type: string;
  timestamp: string;
  eventId?: string;
  parentEventId?: string;
  [key: string]: unknown;
};

export type RunLifecycleEvent = TelemetryEvent;
export type SessionTelemetryEvent = TelemetryEvent;
export type GraphTelemetryEvent = TelemetryEvent;
export type ModelTelemetryEvent = TelemetryEvent;
export type RuntimeTelemetryEvent = TelemetryEvent;

export interface TelemetryWriter {
  readonly runId: string;
  readonly filePath?: string;
  runStarted(event: RunLifecycleEvent): Promise<void>;
  runCompleted(event: RunLifecycleEvent): Promise<void>;
  runFailed(event: RunLifecycleEvent): Promise<void>;
  sessionEvent(event: SessionTelemetryEvent): Promise<void>;
  graphEvent(event: GraphTelemetryEvent): Promise<void>;
  modelCall(event: ModelTelemetryEvent): Promise<void>;
  policyRejected(event: RuntimeTelemetryEvent): Promise<void>;
  runtimeTaskCompleted(event: RuntimeTelemetryEvent): Promise<void>;
  flush?(): Promise<void>;
  shutdown?(): Promise<void>;
}
