// =============================================================================
// Drawing Screenshots
// =============================================================================
//
// Captures a DOM region with drawing strokes composited on top.
//
// Uses modern-screenshot for DOM-to-image capture. If it is unavailable,
// callers can fall back to the stroke-only canvas capture below.

type ModernScreenshotModule = {
  domToCanvas: (
    node: Node,
    options?: Record<string, unknown>,
  ) => Promise<HTMLCanvasElement>;
};

let _domCaptureModule: ModernScreenshotModule | null | undefined;

async function getDomCapture(): Promise<ModernScreenshotModule | null> {
  if (_domCaptureModule !== undefined) return _domCaptureModule;
  try {
    _domCaptureModule = await import("modern-screenshot");
    return _domCaptureModule;
  } catch {
    _domCaptureModule = null;
    return null;
  }
}

export async function isDomCaptureAvailable(): Promise<boolean> {
  return (await getDomCapture()) !== null;
}

export type CapturedDomRegion = {
  blob: Blob;
  width: number;
  height: number;
};

type CaptureRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function getCaptureRegion(
  regionX: number,
  regionY: number,
  regionW: number,
  regionH: number,
  padding: number,
): CaptureRegion | null {
  const viewportW = document.documentElement.clientWidth || window.innerWidth;
  const viewportH = document.documentElement.clientHeight || window.innerHeight;
  const left = Math.max(0, regionX - padding);
  const top = Math.max(0, regionY - padding);
  const right = Math.min(viewportW, regionX + regionW + padding);
  const bottom = Math.min(viewportH, regionY + regionH + padding);
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function isTransparentBackgroundColor(value: string): boolean {
  const normalized = value.replace(/\s+/g, "").toLowerCase();
  return (
    !normalized ||
    normalized === "transparent" ||
    normalized === "rgba(0,0,0,0)" ||
    /rgba\([^)]*,0(?:\.0+)?\)/.test(normalized)
  );
}

function hasPaintedBackground(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  const before = window.getComputedStyle(element, "::before");
  const after = window.getComputedStyle(element, "::after");
  return (
    !isTransparentBackgroundColor(style.backgroundColor) ||
    style.backgroundImage !== "none" ||
    before.backgroundImage !== "none" ||
    after.backgroundImage !== "none" ||
    style.backdropFilter !== "none" ||
    style.filter !== "none"
  );
}

function coversCaptureRegion(
  element: HTMLElement,
  capture: CaptureRegion,
): boolean {
  if (element === document.body || element === document.documentElement) return true;
  const rect = element.getBoundingClientRect();
  return (
    rect.left <= capture.x &&
    rect.top <= capture.y &&
    rect.right >= capture.x + capture.width &&
    rect.bottom >= capture.y + capture.height
  );
}

/**
 * Use the nearest painted ancestor that fully covers the crop. Transparent text
 * and foreground nodes otherwise render against white because their inherited
 * ancestor paint is absent from the cloned subtree.
 */
function findCaptureTarget(capture: CaptureRegion): HTMLElement {
  const centerX = Math.min(window.innerWidth - 1, capture.x + capture.width / 2);
  const centerY = Math.min(window.innerHeight - 1, capture.y + capture.height / 2);
  const hit = document
    .elementsFromPoint(centerX, centerY)
    .find(
      (element): element is HTMLElement =>
        element instanceof HTMLElement &&
        !element.closest("[data-agentation-root]") &&
        element.tagName !== "CANVAS",
    );

  let candidate = hit ?? document.body;
  while (candidate && candidate !== document.documentElement) {
    if (coversCaptureRegion(candidate, capture) && hasPaintedBackground(candidate)) {
      return candidate;
    }
    candidate = candidate.parentElement ?? document.documentElement;
  }
  return document.documentElement;
}

function getCanvasBackgroundColor(target: HTMLElement): string {
  let element: HTMLElement | null = target;
  while (element) {
    const color = window.getComputedStyle(element).backgroundColor;
    if (!isTransparentBackgroundColor(color)) return color;
    element = element.parentElement;
  }
  return "#ffffff";
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: "image/png" | "image/jpeg",
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

// ---------------------------------------------------------------------------
// DOM capture (modern-screenshot)
// ---------------------------------------------------------------------------

export async function captureDomRegion(
  regionX: number,
  regionY: number,
  regionW: number,
  regionH: number,
  strokes: Array<{
    points: Array<{ x: number; y: number }>;
    color: string;
    fixed: boolean;
  }>,
  padding = 32,
  quality = 0.85,
): Promise<CapturedDomRegion | null> {
  const mod = await getDomCapture();
  if (!mod) return null;

  const capture = getCaptureRegion(
    regionX,
    regionY,
    regionW,
    regionH,
    Math.max(0, padding),
  );
  if (!capture) return null;

  const maxDimension = 1200;
  const outputScale = Math.min(
    1,
    maxDimension / Math.max(capture.width, capture.height),
  );
  const outputWidth = Math.max(1, Math.round(capture.width * outputScale));
  const outputHeight = Math.max(1, Math.round(capture.height * outputScale));

  const agentationRoots = Array.from(
    document.querySelectorAll<HTMLElement>("[data-agentation-root]"),
  );
  const previousVisibility = agentationRoots.map((root) => root.style.visibility);
  agentationRoots.forEach((root) => {
    root.style.visibility = "hidden";
  });

  try {
    const target = findCaptureTarget(capture);
    const targetRect = target.getBoundingClientRect();
    const backgroundColor = getCanvasBackgroundColor(target);

    const domCanvas = await mod.domToCanvas(target, {
      backgroundColor,
      timeout: 5_000,
      features: {
        copyScrollbar: true,
        restoreScrollPosition: true,
      },
    });

    const contentWidth = target.scrollWidth || targetRect.width;
    const contentHeight = target.scrollHeight || targetRect.height;
    const ratioX = domCanvas.width / Math.max(1, contentWidth);
    const ratioY = domCanvas.height / Math.max(1, contentHeight);
    const scrollLeft =
      target === document.body || target === document.documentElement
        ? window.scrollX
        : target.scrollLeft;
    const scrollTop =
      target === document.body || target === document.documentElement
        ? window.scrollY
        : target.scrollTop;

    const sourceX = (capture.x - targetRect.left + scrollLeft) * ratioX;
    const sourceY = (capture.y - targetRect.top + scrollTop) * ratioY;
    const sourceWidth = capture.width * ratioX;
    const sourceHeight = capture.height * ratioY;

    const canvas = document.createElement("canvas");
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const context = canvas.getContext("2d");
    if (!context) return null;

    // NOTE: Match the real ancestor color instead of introducing white strips
    // when a crop touches the viewport or the rendered target boundary.
    context.fillStyle = backgroundColor;
    context.fillRect(0, 0, outputWidth, outputHeight);
    context.drawImage(
      domCanvas,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      outputWidth,
      outputHeight,
    );

    drawStrokesOnCanvas(
      context,
      strokes,
      capture.x,
      capture.y,
      outputScale,
      outputScale,
    );

    const blob = await canvasToBlob(canvas, "image/jpeg", quality);
    return blob
      ? { blob, width: outputWidth, height: outputHeight }
      : null;
  } catch (error) {
    console.warn("[Agentation] DOM capture failed:", error);
    return null;
  } finally {
    agentationRoots.forEach((root, index) => {
      root.style.visibility = previousVisibility[index] ?? "";
    });
  }
}

// ---------------------------------------------------------------------------
// Stroke-only fallback
// ---------------------------------------------------------------------------

export function captureDrawingStrokes(
  regionX: number,
  regionY: number,
  regionW: number,
  regionH: number,
  strokes: Array<{
    points: Array<{ x: number; y: number }>;
    color: string;
    fixed: boolean;
  }>,
  padding = 32,
): string | null {
  try {
    const capture = getCaptureRegion(
      regionX,
      regionY,
      regionW,
      regionH,
      Math.max(0, padding),
    );
    if (!capture) return null;

    const maxDimension = 400;
    const scale = Math.min(
      1,
      maxDimension / Math.max(capture.width, capture.height),
    );
    const outputWidth = Math.max(1, Math.round(capture.width * scale));
    const outputHeight = Math.max(1, Math.round(capture.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const context = canvas.getContext("2d");
    if (!context) return null;

    context.fillStyle = "rgba(255, 255, 255, 0.85)";
    context.fillRect(0, 0, outputWidth, outputHeight);
    drawStrokesOnCanvas(
      context,
      strokes,
      capture.x,
      capture.y,
      scale,
      scale,
    );
    return canvas.toDataURL("image/png");
  } catch (error) {
    console.warn("[Agentation] Stroke capture failed:", error);
    return null;
  }
}

function drawStrokesOnCanvas(
  context: CanvasRenderingContext2D,
  strokes: Array<{
    points: Array<{ x: number; y: number }>;
    color: string;
    fixed: boolean;
  }>,
  originX: number,
  originY: number,
  scaleX: number,
  scaleY: number,
): void {
  const scrollY = window.scrollY;
  for (const stroke of strokes) {
    if (stroke.points.length < 2) continue;

    context.save();
    context.strokeStyle = stroke.color;
    context.lineWidth = Math.max(2, 2.5 * ((scaleX + scaleY) / 2));
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();

    stroke.points.forEach((point, index) => {
      const viewportY = stroke.fixed ? point.y : point.y - scrollY;
      const canvasX = (point.x - originX) * scaleX;
      const canvasY = (viewportY - originY) * scaleY;
      if (index === 0) context.moveTo(canvasX, canvasY);
      else context.lineTo(canvasX, canvasY);
    });

    context.stroke();
    context.restore();
  }
}
