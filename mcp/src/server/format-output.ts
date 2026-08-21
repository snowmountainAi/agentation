import {
  generateOutput,
  STANDARD_OUTPUT_CONTRACT_VERSION,
  type Annotation as BrowserAnnotation,
} from "agentation/formatter";
import type { Annotation } from "../types.js";

const ANNOTATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const MAX_ANNOTATIONS = 100;

export type PendingFormatRequest = {
  annotationIds: string[];
  viewport: { width: number; height: number };
};

function pagePath(annotation: Annotation): string {
  if (!annotation.url) return "/";
  try {
    const url = new URL(annotation.url);
    return `${url.pathname || "/"}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

export function validatePendingFormatRequest(value: unknown): PendingFormatRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid pending format request");
  }
  const request = value as Record<string, unknown>;
  if (Object.keys(request).some((key) => !["annotationIds", "viewport"].includes(key))) {
    throw new Error("Unsupported pending format field");
  }
  if (
    !Array.isArray(request.annotationIds)
    || request.annotationIds.length === 0
    || request.annotationIds.length > MAX_ANNOTATIONS
    || request.annotationIds.some((id) => typeof id !== "string" || !ANNOTATION_ID_PATTERN.test(id))
    || new Set(request.annotationIds).size !== request.annotationIds.length
  ) {
    throw new Error("Invalid annotation IDs");
  }
  const viewport = request.viewport;
  if (
    !viewport
    || typeof viewport !== "object"
    || Array.isArray(viewport)
    || Object.keys(viewport).some((key) => !["width", "height"].includes(key))
  ) {
    throw new Error("Invalid viewport");
  }
  const dimensions = viewport as Record<string, unknown>;
  if (
    !Number.isInteger(dimensions.width)
    || !Number.isInteger(dimensions.height)
    || (dimensions.width as number) <= 0
    || (dimensions.width as number) > 10_000
    || (dimensions.height as number) <= 0
    || (dimensions.height as number) > 10_000
  ) {
    throw new Error("Invalid viewport");
  }
  return {
    annotationIds: request.annotationIds as string[],
    viewport: {
      width: dimensions.width as number,
      height: dimensions.height as number,
    },
  };
}

export function formatExactPendingAnnotations(
  pending: Annotation[],
  request: PendingFormatRequest,
): { contractVersion: number; output: string } {
  const byId = new Map(pending.map((annotation) => [annotation.id, annotation]));
  if (pending.length !== request.annotationIds.length || request.annotationIds.some((id) => !byId.has(id))) {
    throw new Error("Pending annotations changed");
  }

  const byPage = new Map<string, Annotation[]>();
  for (const id of request.annotationIds) {
    const annotation = byId.get(id)!;
    const page = pagePath(annotation);
    const pageAnnotations = byPage.get(page) ?? [];
    pageAnnotations.push(annotation);
    byPage.set(page, pageAnnotations);
  }

  // NOTE: This endpoint formats only server-loaded pending records. Keeping generateOutput
  // in the paired browser artifact makes markdown compatibility reviewable in one place.
  const output = Array.from(byPage, ([page, annotations]) => generateOutput(
    annotations as BrowserAnnotation[],
    page,
    "standard",
    { viewport: request.viewport },
  )).filter(Boolean).join("\n\n");

  return { contractVersion: STANDARD_OUTPUT_CONTRACT_VERSION, output };
}
