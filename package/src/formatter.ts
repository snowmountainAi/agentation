// NOTE: Keep the formatter as a side-effect-free subpath so the paired MCP can bundle the
// exact markdown contract without pulling React or Agentation's browser UI into the server.
export {
  generateOutput,
  STANDARD_OUTPUT_CONTRACT_VERSION,
} from "./utils/generate-output";
export type { OutputEnvironment } from "./utils/generate-output";
export type { Annotation } from "./types";
