import { describe, it, expect } from "vitest";
import {
  VALID_STATUS_TRANSITIONS,
  isValidStatusTransition,
  EvaluationStatus,
} from "@/lib/evaluations/types";

describe("Evaluation Job State Machine & Transitions", () => {
  it("allows valid transitions from queued to processing and cancelled", () => {
    expect(isValidStatusTransition("queued", "processing")).toBe(true);
    expect(isValidStatusTransition("queued", "cancelled")).toBe(true);
    expect(isValidStatusTransition("queued", "completed")).toBe(false);
    expect(isValidStatusTransition("queued", "failed")).toBe(false);
  });

  it("allows valid transitions from processing to completed, failed, and cancelled", () => {
    expect(isValidStatusTransition("processing", "completed")).toBe(true);
    expect(isValidStatusTransition("processing", "failed")).toBe(true);
    expect(isValidStatusTransition("processing", "cancelled")).toBe(true);
    expect(isValidStatusTransition("processing", "queued")).toBe(false);
  });

  it("prohibits transitions out of terminal states (completed, failed, cancelled)", () => {
    const terminalStates: EvaluationStatus[] = ["completed", "failed", "cancelled"];
    const allStates: EvaluationStatus[] = ["queued", "processing", "completed", "failed", "cancelled"];

    for (const terminal of terminalStates) {
      expect(VALID_STATUS_TRANSITIONS[terminal]).toHaveLength(0);
      for (const target of allStates) {
        expect(isValidStatusTransition(terminal, target)).toBe(false);
      }
    }
  });
});
