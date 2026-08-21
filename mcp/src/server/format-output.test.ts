import { describe, expect, it } from "vitest";
import type { Annotation } from "../types";
import { formatExactPendingAnnotations, validatePendingFormatRequest } from "./format-output";

const annotation = (id: string): Annotation => ({
  id,
  sessionId: "session-1",
  x: 25,
  y: 100,
  comment: "Move the button",
  element: "Button",
  elementPath: "body > button",
  timestamp: 1234,
  sourceFile: "src/App.tsx:42:7",
  reactComponents: "<App> <Button>",
  url: "https://preview.example/settings?tab=profile#name",
  status: "pending",
});

describe("authoritative pending formatter", () => {
  it("uses Agentation's standard formatter for an exact structured set", () => {
    expect(formatExactPendingAnnotations([annotation("server-1")], {
      annotationIds: ["server-1"],
      viewport: { width: 680, height: 820 },
    })).toEqual({
      contractVersion: 1,
      output: `## Page Feedback: /settings?tab=profile#name
**Viewport:** 680×820

### 1. Button
**Location:** body > button
**Source:** src/App.tsx:42:7
**React:** <App> <Button>
**Feedback:** Move the button`,
    });
  });

  it("rejects partial, stale, or open-ended requests", () => {
    expect(() => formatExactPendingAnnotations(
      [annotation("server-1"), annotation("server-2")],
      { annotationIds: ["server-1"], viewport: { width: 680, height: 820 } },
    )).toThrow("Pending annotations changed");
    expect(() => validatePendingFormatRequest({
      annotationIds: ["server-1"],
      viewport: { width: 680, height: 820 },
      output: "arbitrary markdown",
    })).toThrow("Unsupported pending format field");
  });
});
