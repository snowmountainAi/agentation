import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor, act, screen } from "@testing-library/react";
import { PageFeedbackToolbarCSS } from "./index";
import type { Annotation } from "../../types";

const captureDomRegionMock = vi.hoisted(() => vi.fn());

vi.mock("../../utils/screenshot", () => ({
  captureDomRegion: captureDomRegionMock,
}));

// Mock clipboard API
const mockClipboard = {
  writeText: vi.fn().mockResolvedValue(undefined),
};
const originalParentWindow = window.parent;

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("navigator", {
    clipboard: mockClipboard,
    userAgent: "test-agent",
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  mockClipboard.writeText.mockClear();
  captureDomRegionMock.mockReset();
  captureDomRegionMock.mockResolvedValue({
    blob: new Blob(["image"], { type: "image/jpeg" }),
    width: 214,
    height: 104,
  });
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: vi.fn(() => document.body),
  });
  Object.defineProperty(Blob.prototype, "arrayBuffer", {
    configurable: true,
    value: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(window, "parent", {
    configurable: true,
    value: originalParentWindow,
  });
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
    it("sends all stored pages while honoring modal screenshot exclusions", async () => {
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
            excludedScreenshotAnnotationIds: ["current-page"],
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
          ?.screenshot,
      ).toBeUndefined();
      expect(
        payload.annotations.find((annotation: { id: string }) => annotation.id === "settings-page")
          ?.screenshot?.name,
      ).toBe("settings.jpg");
      expect(payload.output).toContain("## Page Feedback: /");
      expect(payload.output).toContain("Fix current page");
      expect(payload.output).toContain("## Page Feedback: /settings");
      expect(payload.output).toContain("Fix settings page");
    });
  });

  describe("editing screenshot consent", () => {
    it("captures and submits a screenshot when editing turns the camera on", async () => {
      Object.defineProperty(document, "referrer", {
        configurable: true,
        value: "http://localhost:5174/projects/demo",
      });
      localStorage.setItem(
        "feedback-annotations-/",
        JSON.stringify([{
          id: "edit-with-camera",
          x: 25,
          y: 100,
          comment: "Capture this state",
          element: "Button",
          elementPath: "body > button",
          boundingBox: { x: 100, y: 200, width: 150, height: 40 },
          timestamp: Date.now(),
          status: "pending",
        }]),
      );
      const parentPostMessage = vi.fn();
      const parentWindow = { postMessage: parentPostMessage } as unknown as Window;
      Object.defineProperty(window, "parent", {
        configurable: true,
        value: parentWindow,
      });
      render(
        <PageFeedbackToolbarCSS
          webhookUrl="https://example.test/agentation-webhook"
          externalSubmitMessageType="agentation.submit"
          screenshotUploadParentOrigin="http://localhost:5174"
        />,
      );
      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", {
          data: { type: "agentation.mode", mode: "feedback" },
        }));
        await Promise.resolve();
      });

      const marker = await waitFor(() => {
        const element = document.querySelector<HTMLElement>("[data-annotation-marker]");
        expect(element).toBeTruthy();
        return element!;
      });
      fireEvent.click(marker);
      fireEvent.click(await screen.findByRole("button", { name: "Include screenshot with this comment" }));
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(captureDomRegionMock).toHaveBeenCalled());
      await waitFor(() => expect(parentPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "agentation.screenshot.upload.request" }),
        "http://localhost:5174",
        expect.any(Array),
      ));
      const uploadRequest = parentPostMessage.mock.calls.find(
        ([message]) => message?.type === "agentation.screenshot.upload.request",
      )?.[0] as { requestId: string };

      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", {
          source: parentWindow,
          origin: "http://localhost:5174",
          data: {
            type: "agentation.screenshot.upload.result",
            requestId: uploadRequest.requestId,
            success: true,
            screenshot: {
              key: "visual/edited.jpg",
              name: "edited.jpg",
              contentType: "image/jpeg",
              size: 100,
              width: 214,
              height: 104,
              capturedAt: new Date().toISOString(),
            },
          },
        }));
        await Promise.resolve();
      });
      window.dispatchEvent(new MessageEvent("message", {
        source: parentWindow,
        origin: "http://localhost:5174",
        data: { type: "agentation.submit" },
      }));

      await waitFor(() => {
        const webhookCall = vi.mocked(fetch).mock.calls.find(
          ([url]) => url === "https://example.test/agentation-webhook",
        );
        expect(webhookCall).toBeTruthy();
        const payload = JSON.parse(String(webhookCall?.[1]?.body));
        expect(payload.annotations[0].screenshot?.name).toBe("edited.jpg");
      });
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
