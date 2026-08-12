"use client";

import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import styles from "./styles.module.scss";
import { IconTrash } from "../icons";
import { originalSetTimeout } from "../../utils/freeze-animations";

// =============================================================================
// Helpers
// =============================================================================

/** Focus an element while temporarily blocking focus-trap libraries (e.g. Radix
 *  FocusScope) from reclaiming focus via focusin/focusout handlers. */
function focusBypassingTraps(el: HTMLElement | null) {
  if (!el) return;
  const trap = (e: Event) => e.stopImmediatePropagation();
  document.addEventListener("focusin", trap, true);
  document.addEventListener("focusout", trap, true);
  try {
    el.focus();
  } finally {
    document.removeEventListener("focusin", trap, true);
    document.removeEventListener("focusout", trap, true);
  }
}

const MAX_RECORDING_MS = 5 * 60 * 1000;
const TRANSCRIPTION_TIMEOUT_MS = 10 * 60 * 1000;
const RECORDING_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

type VoiceState = "idle" | "requesting" | "recording" | "transcribing" | "error";

function createVoiceRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getSupportedRecordingMimeType() {
  if (
    typeof MediaRecorder === "undefined" ||
    typeof MediaRecorder.isTypeSupported !== "function"
  ) {
    return "";
  }
  return RECORDING_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function formatRecordingTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

// =============================================================================
// Types
// =============================================================================

export interface AnnotationPopupCSSProps {
  /** Element name to display in header */
  element: string;
  /** Optional timestamp display (e.g., "@ 1.23s" for animation feedback) */
  timestamp?: string;
  /** Optional selected/highlighted text */
  selectedText?: string;
  /** Placeholder text for the textarea */
  placeholder?: string;
  /** Initial value for textarea (for edit mode) */
  initialValue?: string;
  /** Label for submit button (default: "Add") */
  submitLabel?: string;
  /** Called when annotation is submitted with text and optional screenshot intent. */
  onSubmit: (text: string, options: { includeScreenshot: boolean }) => void;
  /** Called when popup is cancelled/dismissed */
  onCancel: () => void;
  /** Called when delete button is clicked (only shown if provided) */
  onDelete?: () => void;
  /** Position styles (left, top) */
  style?: React.CSSProperties;
  /** Custom color for submit button and textarea focus (hex) */
  accentColor?: string;
  /** External exit state (parent controls exit animation) */
  isExiting?: boolean;
  /** Light mode styling */
  lightMode?: boolean;
  /** Computed styles for the selected element */
  computedStyles?: Record<string, string>;
  /** Show browser microphone recording and parent-frame transcription bridge. */
  enableVoiceInput?: boolean;
  /** Show a screenshot toggle for the annotation. */
  enableScreenshotInput?: boolean;
  /** Initial screenshot toggle state, used when editing an annotation. */
  initialIncludeScreenshot?: boolean;
}

export interface AnnotationPopupCSSHandle {
  /** Shake the popup (e.g., when user clicks outside) */
  shake: () => void;
}

// =============================================================================
// Component
// =============================================================================

export const AnnotationPopupCSS = forwardRef<AnnotationPopupCSSHandle, AnnotationPopupCSSProps>(
  function AnnotationPopupCSS(
    {
      element,
      timestamp,
      selectedText,
      placeholder = "What should change?",
      initialValue = "",
      submitLabel = "Add",
      onSubmit,
      onCancel,
      onDelete,
      style,
      accentColor = "#3c82f7",
      isExiting = false,
      lightMode = false,
      computedStyles,
      enableVoiceInput = false,
      enableScreenshotInput = false,
      initialIncludeScreenshot = false,
    },
    ref
  ) {
    const [text, setText] = useState(initialValue);
    const [isShaking, setIsShaking] = useState(false);
    const [animState, setAnimState] = useState<"initial" | "enter" | "entered" | "exit">("initial");
    const [isFocused, setIsFocused] = useState(false);
    const [isStylesExpanded, setIsStylesExpanded] = useState(false); // Computed styles accordion state
    const [voiceState, setVoiceState] = useState<VoiceState>("idle");
    const [voiceError, setVoiceError] = useState("");
    const [recordingSeconds, setRecordingSeconds] = useState(0);
    const [includeScreenshot, setIncludeScreenshot] = useState(initialIncludeScreenshot);
    const textRef = useRef(initialValue);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const popupRef = useRef<HTMLDivElement>(null);
    const waveformRef = useRef<HTMLCanvasElement>(null);
    const cancelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const shakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const waveformFrameRef = useRef<number | null>(null);
    const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const recordingLimitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const transcriptionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const recordingStartedAtRef = useRef(0);
    const recordingChunksRef = useRef<Blob[]>([]);
    const activeVoiceRequestRef = useRef<string | null>(null);
    const selectionRef = useRef({ start: initialValue.length, end: initialValue.length });
    const discardRecordingRef = useRef(false);

    const stopRecordingResources = useCallback(() => {
      if (waveformFrameRef.current !== null) {
        cancelAnimationFrame(waveformFrameRef.current);
        waveformFrameRef.current = null;
      }
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      if (recordingLimitTimerRef.current) {
        clearTimeout(recordingLimitTimerRef.current);
        recordingLimitTimerRef.current = null;
      }
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
      const audioContext = audioContextRef.current;
      audioContextRef.current = null;
      if (audioContext && audioContext.state !== "closed") {
        void audioContext.close().catch(() => undefined);
      }
    }, []);

    // Sync with parent exit state
    useEffect(() => {
      if (isExiting && animState !== "exit") {
        setAnimState("exit");
      }
    }, [isExiting, animState]);

    // Animate in on mount and focus textarea
    useEffect(() => {
      // Start enter animation (use originalSetTimeout to bypass freeze patch)
      originalSetTimeout(() => {
        setAnimState("enter");
      }, 0);
      // Transition to entered state after animation completes
      const enterTimer = originalSetTimeout(() => {
        setAnimState("entered");
      }, 200); // Match animation duration
      const focusTimer = originalSetTimeout(() => {
        const textarea = textareaRef.current;
        if (textarea) {
          focusBypassingTraps(textarea);
          textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
          textarea.scrollTop = textarea.scrollHeight;
        }
      }, 50);
      return () => {
        clearTimeout(enterTimer);
        clearTimeout(focusTimer);
        if (cancelTimerRef.current) clearTimeout(cancelTimerRef.current);
        if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
        if (transcriptionTimerRef.current) clearTimeout(transcriptionTimerRef.current);
        discardRecordingRef.current = true;
        activeVoiceRequestRef.current = null;
        const recorder = mediaRecorderRef.current;
        if (recorder && recorder.state !== "inactive") recorder.stop();
        stopRecordingResources();
      };
    }, [stopRecordingResources]);

    useEffect(() => {
      if (!enableVoiceInput) return;
      const onTranscriptionResult = (event: MessageEvent) => {
        if (event.source !== window.parent) return;
        const data = event.data as {
          type?: string;
          requestId?: string;
          success?: boolean;
          transcript?: string;
          error?: string;
        } | null;
        if (
          !data ||
          data.type !== "agentation.transcription.result" ||
          data.requestId !== activeVoiceRequestRef.current
        ) {
          return;
        }

        activeVoiceRequestRef.current = null;
        if (transcriptionTimerRef.current) {
          clearTimeout(transcriptionTimerRef.current);
          transcriptionTimerRef.current = null;
        }
        if (!data.success || typeof data.transcript !== "string") {
          setVoiceState("error");
          setVoiceError(data.error || "The recording could not be transcribed.");
          return;
        }

        const transcript = data.transcript.trim();
        setVoiceState("idle");
        setVoiceError("");
        if (!transcript) {
          // NOTE: Silence is a valid recording result. Preserve the draft and
          // caret without presenting an expected empty transcript as an error.
          originalSetTimeout(() => focusBypassingTraps(textareaRef.current), 0);
          return;
        }
        const current = textRef.current;
        const start = Math.min(selectionRef.current.start, current.length);
        const end = Math.min(Math.max(selectionRef.current.end, start), current.length);
        const caretAfterInsert = start + transcript.length;
        const nextText = `${current.slice(0, start)}${transcript}${current.slice(end)}`;
        selectionRef.current = { start: caretAfterInsert, end: caretAfterInsert };
        textRef.current = nextText;
        setText(nextText);
        originalSetTimeout(() => {
          const textarea = textareaRef.current;
          if (!textarea) return;
          focusBypassingTraps(textarea);
          textarea.setSelectionRange(caretAfterInsert, caretAfterInsert);
        }, 0);
      };

      window.addEventListener("message", onTranscriptionResult);
      return () => window.removeEventListener("message", onTranscriptionResult);
    }, [enableVoiceInput]);

    // Shake animation
    const shake = useCallback(() => {
      if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
      setIsShaking(true);
      shakeTimerRef.current = originalSetTimeout(() => {
        setIsShaking(false);
        focusBypassingTraps(textareaRef.current);
      }, 250);
    }, []);

    const drawWaveform = useCallback((analyser: AnalyserNode) => {
      const frequencyData = new Uint8Array(analyser.frequencyBinCount);
      const hzToMel = (hz: number) => 2595 * Math.log10(1 + hz / 700);
      const melToHz = (mel: number) => 700 * (10 ** (mel / 2595) - 1);
      const draw = () => {
        const canvas = waveformRef.current;
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          const ratio = Math.min(window.devicePixelRatio || 1, 2);
          const width = Math.max(1, Math.floor(rect.width * ratio));
          const height = Math.max(1, Math.floor(rect.height * ratio));
          if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
          }
          const context = canvas.getContext("2d");
          if (context) {
            analyser.getByteFrequencyData(frequencyData);
            context.clearRect(0, 0, width, height);
            context.fillStyle = lightMode ? "rgba(17, 24, 39, 0.62)" : "rgba(255, 255, 255, 0.72)";
            const barWidth = 2 * ratio;
            const gap = 1.5 * ratio;
            const barCount = Math.max(1, Math.floor((width + gap) / (barWidth + gap)));
            const nyquist = analyser.context.sampleRate / 2;
            // NOTE: Stay inside spoken-voice formants (~80Hz–4kHz). Mapping past
            // that parked right-side bars in near-silent spectrum even when loud.
            const minimumVoiceFrequency = 80;
            const maximumVoiceFrequency = Math.min(4000, nyquist);
            const minimumMel = hzToMel(minimumVoiceFrequency);
            const maximumMel = hzToMel(maximumVoiceFrequency);
            const amplitudes = new Float32Array(barCount);
            let framePeak = 0;
            for (let index = 0; index < barCount; index += 1) {
              const lowerFrequency = melToHz(minimumMel + ((maximumMel - minimumMel) * index) / barCount);
              const upperFrequency = melToHz(
                minimumMel + ((maximumMel - minimumMel) * (index + 1)) / barCount,
              );
              const startBin = Math.max(
                1,
                Math.floor((lowerFrequency / nyquist) * frequencyData.length),
              );
              const endBin = Math.max(
                startBin + 1,
                Math.min(
                  frequencyData.length,
                  Math.ceil((upperFrequency / nyquist) * frequencyData.length),
                ),
              );
              let peak = 0;
              let total = 0;
              for (let bin = startBin; bin < endBin; bin += 1) {
                const value = frequencyData[bin];
                peak = Math.max(peak, value);
                total += value;
              }
              const average = total / Math.max(1, endBin - startBin);
              // NOTE: Mild high-shelf so higher pitch/formants aren't drowned by
              // the louder fundamental on the left.
              const highShelf = 0.55 + 0.9 * (index / Math.max(1, barCount - 1));
              const amplitude = Math.min(1, ((peak * 0.72 + average * 0.28) / 255) * highShelf);
              amplitudes[index] = amplitude;
              framePeak = Math.max(framePeak, amplitude);
            }
            // NOTE: Soft per-frame gain keeps pitch *shape* (low vs high) while
            // still lighting the full voice range when the user speaks up.
            const normalizeGain = framePeak > 0.05 ? Math.min(2.4, 0.9 / framePeak) : 1;
            for (let index = 0; index < barCount; index += 1) {
              const amplitude = Math.min(1, amplitudes[index] * normalizeGain);
              const barHeight = Math.max(2 * ratio, amplitude ** 0.78 * height * 0.9);
              const x = index * (barWidth + gap);
              // NOTE: fillRect keeps the visualizer working on older Safari
              // builds where CanvasRenderingContext2D.roundRect is unavailable.
              context.fillRect(x, (height - barHeight) / 2, barWidth, barHeight);
            }
          }
        }
        waveformFrameRef.current = requestAnimationFrame(draw);
      };
      draw();
    }, [lightMode]);

    const stopRecording = useCallback(() => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === "inactive") return;
      setVoiceState("transcribing");
      recorder.stop();
      stopRecordingResources();
    }, [stopRecordingResources]);

    const startRecording = useCallback(async () => {
      setVoiceError("");
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        setVoiceState("error");
        setVoiceError("Voice recording is not supported in this browser.");
        return;
      }
      if (window.parent === window) {
        setVoiceState("error");
        setVoiceError("Voice transcription is available only inside the Qwikbuild preview.");
        return;
      }

      setVoiceState("requesting");
      discardRecordingRef.current = false;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        if (discardRecordingRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        mediaStreamRef.current = stream;
        const mimeType = getSupportedRecordingMimeType();
        let recorder: MediaRecorder;
        try {
          recorder = new MediaRecorder(stream, {
            ...(mimeType ? { mimeType } : {}),
            audioBitsPerSecond: 64_000,
          });
        } catch {
          // NOTE: Safari versions disagree on bitrate/options support; the default
          // constructor still produces a supported MP4/AAC recording.
          recorder = new MediaRecorder(stream);
        }
        mediaRecorderRef.current = recorder;
        recordingChunksRef.current = [];
        recordingStartedAtRef.current = performance.now();
        setRecordingSeconds(0);

        recorder.addEventListener("dataavailable", (event) => {
          if (event.data.size > 0) recordingChunksRef.current.push(event.data);
        });
        recorder.addEventListener("error", () => {
          discardRecordingRef.current = true;
          stopRecordingResources();
          setVoiceState("error");
          setVoiceError("Recording stopped unexpectedly. Please try again.");
        });
        recorder.addEventListener("stop", () => {
          void (async () => {
            stopRecordingResources();
            if (discardRecordingRef.current) {
              recordingChunksRef.current = [];
              return;
            }
            const durationSeconds = Math.min(
              MAX_RECORDING_MS / 1000,
              Math.max(0.1, (performance.now() - recordingStartedAtRef.current) / 1000),
            );
            const resolvedMimeType = recorder.mimeType || mimeType || "audio/webm";
            const blob = new Blob(recordingChunksRef.current, { type: resolvedMimeType });
            recordingChunksRef.current = [];
            if (!blob.size) {
              setVoiceState("error");
              setVoiceError("No audio was captured. Please try again.");
              return;
            }
            const requestId = createVoiceRequestId();
            activeVoiceRequestRef.current = requestId;
            const audio = await blob.arrayBuffer();
            // NOTE: The console parent authenticates the paid request. Wildcard is
            // limited to this outbound hop; the parent validates event.source and
            // answers only to this exact iframe origin.
            window.parent.postMessage(
              {
                type: "agentation.transcription.request",
                requestId,
                audio,
                mimeType: resolvedMimeType,
                durationSeconds,
              },
              "*",
              [audio],
            );
            transcriptionTimerRef.current = originalSetTimeout(() => {
              if (activeVoiceRequestRef.current !== requestId) return;
              activeVoiceRequestRef.current = null;
              setVoiceState("error");
              setVoiceError("Transcription timed out. Your recording was not added.");
            }, TRANSCRIPTION_TIMEOUT_MS);
          })().catch(() => {
            setVoiceState("error");
            setVoiceError("The recording could not be prepared for transcription.");
          });
        });

        const AudioContextConstructor = window.AudioContext ??
          (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AudioContextConstructor) {
          const audioContext = new AudioContextConstructor();
          audioContextRef.current = audioContext;
          const source = audioContext.createMediaStreamSource(stream);
          const analyser = audioContext.createAnalyser();
          // NOTE: Larger FFT + lower noise floor so mel bands across 80Hz–4kHz
          // resolve pitch/formant shifts instead of only the loud fundamental.
          analyser.fftSize = 4096;
          analyser.minDecibels = -95;
          analyser.maxDecibels = -25;
          analyser.smoothingTimeConstant = 0.58;
          source.connect(analyser);
          drawWaveform(analyser);
        }

        recorder.start(1000);
        setVoiceState("recording");
        recordingTimerRef.current = setInterval(() => {
          setRecordingSeconds(
            Math.min(300, Math.floor((performance.now() - recordingStartedAtRef.current) / 1000)),
          );
        }, 1000);
        recordingLimitTimerRef.current = originalSetTimeout(() => {
          if (recorder.state !== "inactive") {
            setVoiceState("transcribing");
            recorder.stop();
            stopRecordingResources();
          }
        }, MAX_RECORDING_MS);
      } catch (error) {
        stopRecordingResources();
        if (discardRecordingRef.current) return;
        setVoiceState("error");
        const name = error instanceof DOMException ? error.name : "";
        if (name === "NotAllowedError" || name === "SecurityError") {
          setVoiceError("Microphone access was denied. Allow it in browser settings and try again.");
        } else if (name === "NotFoundError") {
          setVoiceError("No microphone was found on this device.");
        } else {
          setVoiceError("The microphone could not be started. Please try again.");
        }
      }
    }, [drawWaveform, stopRecordingResources]);

    // Expose shake to parent via ref
    useImperativeHandle(ref, () => ({
      shake,
    }), [shake]);

    const isVoiceBusy = voiceState === "requesting" || voiceState === "recording" || voiceState === "transcribing";

    const discardActiveRecording = useCallback(() => {
      discardRecordingRef.current = true;
      activeVoiceRequestRef.current = null;
      if (transcriptionTimerRef.current) {
        clearTimeout(transcriptionTimerRef.current);
        transcriptionTimerRef.current = null;
      }
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      stopRecordingResources();
    }, [stopRecordingResources]);

    const cancelVoiceRecording = useCallback(() => {
      // NOTE: Mark the recorder as discarded before stopping it so its `stop`
      // event cannot cross the iframe bridge or create a paid backend request.
      discardActiveRecording();
      recordingChunksRef.current = [];
      setRecordingSeconds(0);
      setVoiceState("idle");
      setVoiceError("");
      originalSetTimeout(() => focusBypassingTraps(textareaRef.current), 0);
    }, [discardActiveRecording]);

    // Handle cancel with exit animation
    const handleCancel = useCallback(() => {
      discardActiveRecording();
      setAnimState("exit");
      cancelTimerRef.current = originalSetTimeout(() => {
        onCancel();
      }, 150); // Match exit animation duration
    }, [discardActiveRecording, onCancel]);

    // Handle submit
    const handleSubmit = useCallback(() => {
      if (!text.trim() || isVoiceBusy) return;
      onSubmit(text.trim(), { includeScreenshot });
    }, [includeScreenshot, isVoiceBusy, text, onSubmit]);

    const syncTextareaSelection = useCallback((textarea: HTMLTextAreaElement) => {
      selectionRef.current = {
        start: textarea.selectionStart ?? textarea.value.length,
        end: textarea.selectionEnd ?? textarea.value.length,
      };
    }, []);

    // Handle keyboard
    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          handleSubmit();
        }
        if (e.key === "Escape") {
          handleCancel();
        }
      },
      [handleSubmit, handleCancel]
    );

    const popupClassName = [
      styles.popup,
      lightMode ? styles.light : "",
      animState === "enter" ? styles.enter : "",
      animState === "entered" ? styles.entered : "",
      animState === "exit" ? styles.exit : "",
      isShaking ? styles.shake : "",
    ].filter(Boolean).join(" ");

    return (
      <div
        ref={popupRef}
        className={popupClassName}
        data-annotation-popup
        style={style}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          {computedStyles && Object.keys(computedStyles).length > 0 ? (
            <button
              className={styles.headerToggle}
              onClick={() => {
                const wasExpanded = isStylesExpanded;
                setIsStylesExpanded(!isStylesExpanded);
                if (wasExpanded) {
                  // Refocus textarea when closing
                  originalSetTimeout(() => focusBypassingTraps(textareaRef.current), 0);
                }
              }}
              type="button"
            >
              <svg
                className={`${styles.chevron} ${isStylesExpanded ? styles.expanded : ""}`}
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M5.5 10.25L9 7.25L5.75 4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className={styles.element}>{element}</span>
            </button>
          ) : (
            <span className={styles.element}>{element}</span>
          )}
          {timestamp && <span className={styles.timestamp}>{timestamp}</span>}
        </div>

        {/* Collapsible computed styles section - uses grid-template-rows for smooth animation */}
        {computedStyles && Object.keys(computedStyles).length > 0 && (
          <div className={`${styles.stylesWrapper} ${isStylesExpanded ? styles.expanded : ""}`}>
            <div className={styles.stylesInner}>
              <div className={styles.stylesBlock}>
                {Object.entries(computedStyles).map(([key, value]) => (
                  <div key={key} className={styles.styleLine}>
                    <span className={styles.styleProperty}>
                      {key.replace(/([A-Z])/g, "-$1").toLowerCase()}
                    </span>
                    : <span className={styles.styleValue}>{value}</span>;
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {selectedText && (
          <div className={styles.quote}>
            &ldquo;{selectedText.slice(0, 80)}
            {selectedText.length > 80 ? "..." : ""}&rdquo;
          </div>
        )}

        <textarea
          ref={textareaRef}
          className={styles.textarea}
          style={{ borderColor: isFocused ? accentColor : undefined }}
          placeholder={placeholder}
          value={text}
          onChange={(e) => {
            textRef.current = e.target.value;
            setText(e.target.value);
            syncTextareaSelection(e.currentTarget);
          }}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onSelect={(e) => syncTextareaSelection(e.currentTarget)}
          onClick={(e) => syncTextareaSelection(e.currentTarget)}
          onKeyUp={(e) => syncTextareaSelection(e.currentTarget)}
          rows={5}
          onKeyDown={handleKeyDown}
        />

        {voiceState === "recording" && (
          <div className={styles.recordingPanel} role="status" aria-label="Recording voice comment">
            <span className={styles.recordingDot} aria-hidden="true" />
            <canvas ref={waveformRef} className={styles.waveform} aria-hidden="true" />
            <span className={styles.recordingTime}>{formatRecordingTime(recordingSeconds)}</span>
            <div className={styles.recordingControls}>
              <button
                className={styles.cancelRecording}
                type="button"
                onClick={cancelVoiceRecording}
                aria-label="Cancel recording"
                title="Cancel recording"
              >
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path
                    d="M3.75 3.75 12.25 12.25M12.25 3.75 3.75 12.25"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
              <button
                className={styles.stopRecording}
                type="button"
                onClick={stopRecording}
                aria-label="Stop recording"
                title="Stop recording"
              >
                <span className={styles.stopIcon} aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        {voiceError && (
          <p className={styles.voiceError} role="alert">
            {voiceError}
          </p>
        )}

        <div className={styles.actions}>
          {(onDelete || enableVoiceInput || enableScreenshotInput) && (
            <div className={styles.leftActions}>
              {onDelete && (
                <button
                  className={styles.deleteButton}
                  onClick={onDelete}
                  type="button"
                  disabled={isVoiceBusy}
                  aria-label="Delete comment"
                >
                  <IconTrash size={22} />
                </button>
              )}
              {enableVoiceInput && voiceState !== "recording" && (
                <button
                  className={`${styles.voiceButton} ${voiceState === "transcribing" ? styles.loading : ""}`}
                  onClick={() => void startRecording()}
                  type="button"
                  disabled={voiceState === "requesting" || voiceState === "transcribing"}
                  aria-label={voiceState === "transcribing" ? "Transcribing voice comment" : "Record voice comment"}
                  title={voiceState === "transcribing" ? "Transcribing…" : "Record voice comment"}
                >
                  {voiceState === "requesting" || voiceState === "transcribing" ? (
                    <span className={styles.spinner} aria-hidden="true" />
                  ) : (
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M12 15.5a3.5 3.5 0 0 0 3.5-3.5V6a3.5 3.5 0 1 0-7 0v6a3.5 3.5 0 0 0 3.5 3.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      <path d="M5.5 11.5v.5a6.5 6.5 0 0 0 13 0v-.5M12 18.5V22M9.5 22h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                  )}
                </button>
              )}
              {enableScreenshotInput && voiceState !== "recording" && (
                <button
                  className={`${styles.screenshotButton} ${includeScreenshot ? styles.enabled : ""}`}
                  onClick={() => setIncludeScreenshot((current) => !current)}
                  type="button"
                  disabled={isVoiceBusy}
                  aria-label={includeScreenshot ? "Remove screenshot from this comment" : "Include screenshot with this comment"}
                  aria-pressed={includeScreenshot}
                  title={includeScreenshot ? "Screenshot enabled — click to exclude it" : "Include a screenshot of the selected area"}
                  style={includeScreenshot ? { color: accentColor } : undefined}
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M14.5 5 13 3h-2L9.5 5H6.75A2.75 2.75 0 0 0 4 7.75v8.5A2.75 2.75 0 0 0 6.75 19h10.5A2.75 2.75 0 0 0 20 16.25v-8.5A2.75 2.75 0 0 0 17.25 5H14.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                    <circle cx="12" cy="12" r="3.25" stroke="currentColor" strokeWidth="1.8" />
                  </svg>
                </button>
              )}
              {voiceState === "transcribing" && (
                <span className={styles.transcribingLabel} aria-live="polite">Transcribing…</span>
              )}
            </div>
          )}
          <button className={styles.cancel} onClick={handleCancel} type="button">
            Cancel
          </button>
          <button
            className={styles.submit}
            style={{
              backgroundColor: accentColor,
              opacity: text.trim() && !isVoiceBusy ? 1 : 0.4,
            }}
            onClick={handleSubmit}
            disabled={!text.trim() || isVoiceBusy}
            type="button"
          >
            {submitLabel}
          </button>
        </div>
      </div>
    );
  }
);

export default AnnotationPopupCSS;
