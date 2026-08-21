import type {
  OutputDetailLevel,
  ReactComponentMode,
} from "../components/page-toolbar-css";
import type { Annotation } from "../types";

export const STANDARD_OUTPUT_CONTRACT_VERSION = 1;

// NOTE: Environment is explicit so trusted server integrations can reproduce the browser
// formatter byte-for-byte without accepting iframe-authored markdown as an action payload.
export type OutputEnvironment = {
  viewport?: { width: number; height: number };
  url?: string;
  userAgent?: string;
  timestamp?: string;
  devicePixelRatio?: number;
};

function browserOutputEnvironment(): OutputEnvironment {
  if (typeof window === "undefined") return {};
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    url: window.location.href,
    userAgent: navigator.userAgent,
    timestamp: new Date().toISOString(),
    devicePixelRatio: window.devicePixelRatio,
  };
}

export const OUTPUT_TO_REACT_MODE: Record<
  OutputDetailLevel,
  ReactComponentMode
> = {
  compact: "off",
  standard: "filtered",
  detailed: "smart",
  forensic: "all",
};

export const OUTPUT_DETAIL_OPTIONS: {
  value: OutputDetailLevel;
  label: string;
}[] = [
  { value: "compact", label: "Compact" },
  { value: "standard", label: "Standard" },
  { value: "detailed", label: "Detailed" },
  { value: "forensic", label: "Forensic" },
];

export function generateOutput(
  annotations: Annotation[],
  pathname: string,
  detailLevel: OutputDetailLevel = "standard",
  environment: OutputEnvironment = browserOutputEnvironment(),
): string {
  if (annotations.length === 0) return "";

  const viewport = environment.viewport
    ? `${environment.viewport.width}×${environment.viewport.height}`
    : "unknown";

  let output = `## Page Feedback: ${pathname}\n`;

  if (detailLevel === "forensic") {
    output += `\n**Environment:**\n`;
    output += `- Viewport: ${viewport}\n`;
    if (environment.url) output += `- URL: ${environment.url}\n`;
    if (environment.userAgent) output += `- User Agent: ${environment.userAgent}\n`;
    if (environment.timestamp) output += `- Timestamp: ${environment.timestamp}\n`;
    if (environment.devicePixelRatio !== undefined) {
      output += `- Device Pixel Ratio: ${environment.devicePixelRatio}\n`;
    }
    output += `\n---\n`;
  } else if (detailLevel !== "compact") {
    output += `**Viewport:** ${viewport}\n`;
  }
  output += "\n";

  annotations.forEach((a, i) => {
    if (detailLevel === "compact") {
      output += `${i + 1}. **${a.element}**${a.sourceFile ? ` (${a.sourceFile})` : ""}: ${a.comment}`;
      if (a.selectedText) {
        output += ` (re: "${a.selectedText.slice(0, 30)}${a.selectedText.length > 30 ? "..." : ""}")`;
      }
      output += "\n";
    } else if (detailLevel === "forensic") {
      output += `### ${i + 1}. ${a.element}\n`;
      if (a.isMultiSelect && a.fullPath) {
        output += `*Forensic data shown for first element of selection*\n`;
      }
      if (a.fullPath) {
        output += `**Full DOM Path:** ${a.fullPath}\n`;
      }
      if (a.cssClasses) {
        output += `**CSS Classes:** ${a.cssClasses}\n`;
      }
      if (a.boundingBox) {
        output += `**Position:** x:${Math.round(a.boundingBox.x)}, y:${Math.round(a.boundingBox.y)} (${Math.round(a.boundingBox.width)}×${Math.round(a.boundingBox.height)}px)\n`;
      }
      output += `**Annotation at:** ${a.x.toFixed(1)}% from left, ${Math.round(a.y)}px from top\n`;
      if (a.selectedText) {
        output += `**Selected text:** "${a.selectedText}"\n`;
      }
      if (a.nearbyText && !a.selectedText) {
        output += `**Context:** ${a.nearbyText.slice(0, 100)}\n`;
      }
      if (a.computedStyles) {
        output += `**Computed Styles:** ${a.computedStyles}\n`;
      }
      if (a.accessibility) {
        output += `**Accessibility:** ${a.accessibility}\n`;
      }
      if (a.nearbyElements) {
        output += `**Nearby Elements:** ${a.nearbyElements}\n`;
      }
      if (a.sourceFile) {
        output += `**Source:** ${a.sourceFile}\n`;
      }
      if (a.reactComponents) {
        output += `**React:** ${a.reactComponents}\n`;
      }
      output += `**Feedback:** ${a.comment}\n\n`;
    } else {
      // standard and detailed
      output += `### ${i + 1}. ${a.element}\n`;
      output += `**Location:** ${a.elementPath}\n`;
      if (a.sourceFile) {
        output += `**Source:** ${a.sourceFile}\n`;
      }
      if (a.reactComponents) {
        output += `**React:** ${a.reactComponents}\n`;
      }
      if (detailLevel === "detailed") {
        if (a.cssClasses) {
          output += `**Classes:** ${a.cssClasses}\n`;
        }
        if (a.boundingBox) {
          output += `**Position:** ${Math.round(a.boundingBox.x)}px, ${Math.round(a.boundingBox.y)}px (${Math.round(a.boundingBox.width)}×${Math.round(a.boundingBox.height)}px)\n`;
        }
      }
      if (a.selectedText) {
        output += `**Selected text:** "${a.selectedText}"\n`;
      }
      if (detailLevel === "detailed" && a.nearbyText && !a.selectedText) {
        output += `**Context:** ${a.nearbyText.slice(0, 100)}\n`;
      }
      output += `**Feedback:** ${a.comment}\n\n`;
    }
  });

  return output.trim();
}
