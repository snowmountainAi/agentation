import { describe, expect, it } from "vitest";
import type { Annotation } from "../types";
import { generateOutput, STANDARD_OUTPUT_CONTRACT_VERSION } from "./generate-output";

describe("standard output contract", () => {
  it("formats structured annotations exactly with an explicit submit viewport", () => {
    const annotations: Annotation[] = [
      {
        id: "one",
        x: 17,
        y: 628,
        timestamp: 1,
        element: "Area selection",
        elementPath: "region at (116, 628)",
        comment: "make the text a littttle bigger, just a little",
      },
      {
        id: "two",
        x: 50,
        y: 300,
        timestamp: 2,
        element: "<App> <LandingPage> board",
        elementPath: ".grid > .relative",
        sourceFile: "src/pages/LandingPage.tsx:94:37",
        reactComponents: "<App> <LandingPage>",
        comment: "Put it straight.",
      },
    ];

    expect(STANDARD_OUTPUT_CONTRACT_VERSION).toBe(1);
    expect(generateOutput(annotations, "/", "standard", {
      viewport: { width: 680, height: 820 },
    })).toBe(`## Page Feedback: /
**Viewport:** 680×820

### 1. Area selection
**Location:** region at (116, 628)
**Feedback:** make the text a littttle bigger, just a little

### 2. <App> <LandingPage> board
**Location:** .grid > .relative
**Source:** src/pages/LandingPage.tsx:94:37
**React:** <App> <LandingPage>
**Feedback:** Put it straight.`);
  });
});
