import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnnotationPopupCSS } from "./index";

class MockMediaRecorder extends EventTarget {
  static isTypeSupported = vi.fn(() => true);

  state: RecordingState = "inactive";
  mimeType = "audio/webm;codecs=opus";

  start() {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    const dataEvent = new Event("dataavailable");
    Object.defineProperty(dataEvent, "data", {
      value: new Blob(["voice"], { type: this.mimeType }),
    });
    this.dispatchEvent(dataEvent);
    this.dispatchEvent(new Event("stop"));
  }
}

describe("AnnotationPopupCSS voice input", () => {
  const parentWindow = { postMessage: vi.fn() } as unknown as Window;
  const stopTrack = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "parent", { configurable: true, value: parentWindow });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: stopTrack }],
        }),
      },
    });
    vi.stubGlobal("MediaRecorder", MockMediaRecorder);
    Object.defineProperty(Blob.prototype, "arrayBuffer", {
      configurable: true,
      value: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the microphone by default when enabled", () => {
    render(
      <AnnotationPopupCSS
        element="Button"
        enableVoiceInput
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Record voice comment" })).toBeTruthy();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).rows).toBe(5);
  });

  it("opts into a screenshot only when the camera is enabled before Add", () => {
    const onSubmit = vi.fn();
    render(
      <AnnotationPopupCSS
        element="Button"
        initialValue="Increase contrast"
        enableVoiceInput
        enableScreenshotInput
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    const camera = screen.getByRole("button", { name: "Include screenshot with this comment" });
    expect(camera.getAttribute("aria-pressed")).toBe("false");
    expect(camera.getAttribute("title")).toContain("Include a screenshot");

    fireEvent.click(camera);
    const enabledCamera = screen.getByRole("button", { name: "Remove screenshot from this comment" });
    expect(enabledCamera.getAttribute("aria-pressed")).toBe("true");
    expect(enabledCamera.getAttribute("title")).toContain("Screenshot enabled");
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(onSubmit).toHaveBeenCalledWith("Increase contrast", { includeScreenshot: true });
  });

  it("submits without a screenshot when the camera remains disabled", () => {
    const onSubmit = vi.fn();
    render(
      <AnnotationPopupCSS
        element="Button"
        initialValue="Increase contrast"
        enableScreenshotInput
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(onSubmit).toHaveBeenCalledWith("Increase contrast", { includeScreenshot: false });
  });

  it("starts enabled for an existing screenshot and lets editing remove it", () => {
    const onSubmit = vi.fn();
    render(
      <AnnotationPopupCSS
        element="Button"
        initialValue="Increase contrast"
        enableScreenshotInput
        initialIncludeScreenshot
        submitLabel="Save"
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    const enabledCamera = screen.getByRole("button", { name: "Remove screenshot from this comment" });
    expect(enabledCamera.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(enabledCamera);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSubmit).toHaveBeenCalledWith("Increase contrast", { includeScreenshot: false });
  });

  it("reports microphone permission denial without leaving a busy state", async () => {
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(
      new DOMException("Denied", "NotAllowedError"),
    );
    render(
      <AnnotationPopupCSS
        element="Button"
        enableVoiceInput
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Record voice comment" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Microphone access was denied");
    expect((screen.getByRole("button", { name: "Record voice comment" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("inserts the translated transcript at the saved textarea selection", async () => {
    render(
      <AnnotationPopupCSS
        element="Button"
        initialValue="hello world"
        enableVoiceInput
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    textarea.setSelectionRange(6, 11);
    fireEvent.select(textarea);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Record voice comment" }));
      await Promise.resolve();
    });
    const stopButton = await screen.findByRole("button", { name: "Stop recording" });
    await act(async () => {
      fireEvent.click(stopButton);
      await Promise.resolve();
    });

    await waitFor(() => expect(parentWindow.postMessage).toHaveBeenCalled());
    const request = vi.mocked(parentWindow.postMessage).mock.calls[0][0] as {
      requestId: string;
    };
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        source: parentWindow,
        data: {
          type: "agentation.transcription.result",
          requestId: request.requestId,
          success: true,
          transcript: "translated comment",
        },
      }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => expect(textarea.value).toBe("hello translated comment"));
    expect(stopTrack).toHaveBeenCalled();
  });

  it("treats an empty transcript as a successful no-op", async () => {
    render(
      <AnnotationPopupCSS
        element="Button"
        initialValue="keep this draft"
        enableVoiceInput
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    fireEvent.click(screen.getByRole("button", { name: "Record voice comment" }));
    fireEvent.click(await screen.findByRole("button", { name: "Stop recording" }));
    await waitFor(() => expect(parentWindow.postMessage).toHaveBeenCalled());
    const request = vi.mocked(parentWindow.postMessage).mock.calls[0][0] as {
      requestId: string;
    };
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        source: parentWindow,
        data: {
          type: "agentation.transcription.result",
          requestId: request.requestId,
          success: true,
          transcript: "",
        },
      }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("keep this draft");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Record voice comment" })).toBeTruthy();
  });

  it("cancels a recording locally without sending audio to the parent", async () => {
    render(
      <AnnotationPopupCSS
        element="Button"
        enableVoiceInput
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Record voice comment" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel recording" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Record voice comment" })).toBeTruthy();
    });
    expect(parentWindow.postMessage).not.toHaveBeenCalled();
    expect(stopTrack).toHaveBeenCalled();
  });
});
