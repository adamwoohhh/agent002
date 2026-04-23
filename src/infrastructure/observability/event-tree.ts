import { randomUUID } from "node:crypto";

export function createEventId(): string {
  return randomUUID();
}
