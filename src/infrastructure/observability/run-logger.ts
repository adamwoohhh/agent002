export type RunLogEvent = {
  type: string;
  timestamp: string;
  [key: string]: unknown;
};

export interface RunLogger {
  readonly runId: string;
  readonly filePath?: string;
  write(event: RunLogEvent): Promise<void>;
}
