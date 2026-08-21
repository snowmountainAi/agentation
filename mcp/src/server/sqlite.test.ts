import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { createSQLiteStore } from "./sqlite";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("SQLite annotation formatter contract", () => {
  it("preserves source, capture viewport, correlation ID, and author identity", () => {
    const directory = mkdtempSync(join(tmpdir(), "agentation-sqlite-test-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "store.db");
    const store = createSQLiteStore(databasePath);
    const session = store.createSession("https://preview.example/");

    const created = store.addAnnotation(session.id, {
      x: 25,
      y: 100,
      comment: "Move the button",
      element: "Button",
      elementPath: "body > button",
      timestamp: 1234,
      sourceFile: "src/App.tsx:42:7",
      captureViewport: { width: 680, height: 820 },
      clientAnnotationId: "browser-annotation-1",
      authorId: "user-1",
    });
    store.close();

    const reopened = createSQLiteStore(databasePath);
    const pending = reopened.getPendingAnnotations(session.id);
    reopened.close();

    expect(created).toBeDefined();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      sourceFile: "src/App.tsx:42:7",
      captureViewport: { width: 680, height: 820 },
      clientAnnotationId: "browser-annotation-1",
      authorId: "user-1",
    });
  });
});
