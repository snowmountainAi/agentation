import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor, act } from "@testing-library/react";
import { PageFeedbackToolbarCSS } from "./index";
import type { Annotation } from "../../types";

// Mock clipboard API
const mockClipboard = {
  writeText: vi.fn().mockResolvedValue(undefined),
};

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("navigator", {
    clipboard: mockClipboard,
    userAgent: "test-agent",
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  mockClipboard.writeText.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(document, "referrer", {
    configurable: true,
    value: "",
  });
});

describe("PageFeedbackToolbarCSS", () => {
  describe("onAnnotationAdd callback", () => {
    it("should accept onAnnotationAdd prop without errors", () => {
      const handleAnnotation = vi.fn();
      expect(() =>
        render(<PageFeedbackToolbarCSS onAnnotationAdd={handleAnnotation} />)
      ).not.toThrow();
    });

    it("should type-check annotation callback parameter", () => {
      // This test verifies TypeScript types are correct at compile time
      const handleAnnotation = (annotation: Annotation) => {
        // Verify all expected properties are accessible
        expect(annotation).toHaveProperty("id");
        expect(annotation).toHaveProperty("x");
        expect(annotation).toHaveProperty("y");
        expect(annotation).toHaveProperty("comment");
        expect(annotation).toHaveProperty("element");
        expect(annotation).toHaveProperty("elementPath");
        expect(annotation).toHaveProperty("timestamp");
      };

      render(<PageFeedbackToolbarCSS onAnnotationAdd={handleAnnotation} />);
    });
  });

  describe("copyToClipboard prop", () => {
    it("should default copyToClipboard to true", () => {
      // Component should render without explicit copyToClipboard prop
      expect(() => render(<PageFeedbackToolbarCSS />)).not.toThrow();
    });

    it("should accept copyToClipboard={false} without errors", () => {
      expect(() =>
        render(<PageFeedbackToolbarCSS copyToClipboard={false} />)
      ).not.toThrow();
    });

    it("should accept copyToClipboard={true} without errors", () => {
      expect(() =>
        render(<PageFeedbackToolbarCSS copyToClipboard={true} />)
      ).not.toThrow();
    });
  });

  describe("combined props", () => {
    it("should accept both onAnnotationAdd and copyToClipboard props", () => {
      const handleAnnotation = vi.fn();
      expect(() =>
        render(
          <PageFeedbackToolbarCSS
            onAnnotationAdd={handleAnnotation}
            copyToClipboard={false}
          />
        )
      ).not.toThrow();
    });
  });

  describe("external submit", () => {
    it("sends pending annotations from all stored pages in submit format", async () => {
      Object.defineProperty(document, "referrer", {
        configurable: true,
        value: "http://localhost:5174/projects/demo",
      });
      localStorage.setItem(
        "feedback-annotations-/",
        JSON.stringify([
          {
            id: "current-page",
            x: 25,
            y: 100,
            comment: "Fix current page",
            element: "Button",
            elementPath: "body > button",
            screenshot: {
              key: "user/visual-feedback/project/current/image.jpg",
              name: "current.jpg",
              contentType: "image/jpeg",
              size: 100,
              width: 150,
              height: 40,
              capturedAt: new Date().toISOString(),
            },
            timestamp: Date.now(),
            status: "pending",
          },
        ]),
      );
      localStorage.setItem(
        "feedback-annotations-/settings",
        JSON.stringify([
          {
            id: "settings-page",
            x: 40,
            y: 160,
            comment: "Fix settings page",
            element: "Input",
            elementPath: "body > form > input",
            screenshot: {
              key: "user/visual-feedback/project/settings/image.jpg",
              name: "settings.jpg",
              contentType: "image/jpeg",
              size: 100,
              width: 150,
              height: 40,
              capturedAt: new Date().toISOString(),
            },
            timestamp: Date.now(),
            status: "pending",
          },
        ]),
      );

      render(
        <PageFeedbackToolbarCSS
          webhookUrl="https://example.test/agentation-webhook"
          externalSubmitMessageType="agentation.submit"
        />,
      );

      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "agentation.submit",
            includedScreenshotAnnotationIds: ["current-page"],
          },
          origin: "http://localhost:5174",
          source: window,
        }),
      );

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          "https://example.test/agentation-webhook",
          expect.objectContaining({ method: "POST" }),
        );
      });

      const [, request] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      const payload = JSON.parse(request.body);
      expect(payload.event).toBe("submit");
      expect(payload.annotations).toHaveLength(2);
      expect(
        payload.annotations.find((annotation: { id: string }) => annotation.id === "current-page")
          ?.screenshot?.name,
      ).toBe("current.jpg");
      expect(
        payload.annotations.find((annotation: { id: string }) => annotation.id === "settings-page")
          ?.screenshot,
      ).toBeUndefined();
      expect(payload.output).toContain("## Page Feedback: /");
      expect(payload.output).toContain("Fix current page");
      expect(payload.output).toContain("## Page Feedback: /settings");
      expect(payload.output).toContain("Fix settings page");
    });
  });

  describe("external mode", () => {
    it("does not announce the default try mode on mount", async () => {
      const postMessageSpy = vi.spyOn(window.parent, "postMessage");

      await act(async () => {
        render(<PageFeedbackToolbarCSS externalModeMessageType="agentation.mode" />);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(postMessageSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "agentation.mode.changed" }),
        "*",
      );
    });
  });
});

describe("Annotation type", () => {
  it("should include all required fields", () => {
    const annotation: Annotation = {
      id: "test-id",
      x: 50,
      y: 100,
      comment: "Test comment",
      element: "Button",
      elementPath: "body > div > button",
      timestamp: Date.now(),
    };

    expect(annotation.id).toBe("test-id");
    expect(annotation.x).toBe(50);
    expect(annotation.y).toBe(100);
    expect(annotation.comment).toBe("Test comment");
    expect(annotation.element).toBe("Button");
    expect(annotation.elementPath).toBe("body > div > button");
    expect(typeof annotation.timestamp).toBe("number");
  });

  it("should allow optional metadata fields", () => {
    const annotation: Annotation = {
      id: "test-id",
      x: 50,
      y: 100,
      comment: "Test comment",
      element: "Button",
      elementPath: "body > div > button",
      timestamp: Date.now(),
      selectedText: "Selected text content",
      boundingBox: { x: 100, y: 200, width: 150, height: 40 },
      nearbyText: "Context around the element",
      cssClasses: "btn btn-primary",
      nearbyElements: "div, span, a",
      computedStyles: "color: blue; font-size: 14px",
      fullPath: "html > body > div#app > main > button.btn",
      accessibility: "role=button, aria-label=Submit",
      isMultiSelect: false,
      isFixed: false,
    };

    expect(annotation.selectedText).toBe("Selected text content");
    expect(annotation.boundingBox).toEqual({
      x: 100,
      y: 200,
      width: 150,
      height: 40,
    });
    expect(annotation.cssClasses).toBe("btn btn-primary");
    expect(annotation.fullPath).toBe("html > body > div#app > main > button.btn");
    expect(annotation.accessibility).toBe("role=button, aria-label=Submit");
    expect(annotation.isMultiSelect).toBe(false);
    expect(annotation.isFixed).toBe(false);
  });
});
