export type TelemetryEvent = {
  type: string;
  timestamp: string;
  eventId?: string;
  parentEventId?: string;
  [key: string]: unknown;
};

export interface TelemetryWriter {
  readonly runId: string;
  readonly filePath?: string;
  write(event: TelemetryEvent): Promise<void>;
  flush?(): Promise<void>;
  shutdown?(): Promise<void>;
}
