# Changelog

All notable changes to this project will be documented in this file.

## [1.3.0] - 2026-02-12

### Added
- **Unified Context Module**: Extracted context management, token estimation, and tool result cleaning into a dedicated module (`src/engine/agent/context/`).
- **Robust Loop Policy**: Introduced `agentLoopPolicy.ts` with configurable retry limits, recovery phases, and failure-aware exit mechanisms.
- **Structured Prompt System**: Migrated system prompts to a dedicated directory (`src/engine/prompt/`) for better version control and modularity.
- **Knowledge Base Expansion**: Added detailed chronicles for Figma sandbox fixes and performance optimizations.

### Changed
- **Agent Runtime Refactor**: Simplified `agentRuntime.ts` by delegating context and loop control to specialized modules.
- **Generate Design Optimization**: Enhanced `generateDesign` tool schema and internal logic for better style adherence and one-shot generation.
- **Visual Pipeline Improvements**: Refined `Normalizer` and `RenderOrchestrator` to fix visual effects (shadows, blurs) loss.

### Fixed
- **Figma Sandbox Import Bug**: Fixed the `possible import expression rejected` error by implementing synchronous esbuild sanitization.
- **Token Bloat**: Reduced context size through more aggressive tool result truncation and unified token counting.



### Added
- **Agentic Orchestration**: Implemented `AgentOrchestrator` for autonomous multi-phase generation (Planning → Execution → Verification).
- **Thinking Transparency**: New `IterationCard` and `ToolCallItem` UI components for real-time visualization of LLM reasoning and tool execution.
- **Remote Debugging Stack**: WebSocket-based `log-server.js` and `remoteLogger.ts` for real-time sandbox diagnostics.
- **Semantic Error Recovery**: Advanced self-correction loop using structured error mapping and autonomous retries.
- **Atomic Tool Flow**: Granular Figma SceneGraph operations (node creation, layout, styling) as LLM-callable tools.

### Changed
- **Unified State Management**: Overhauled `useChat` to handle thinking iterations and tool execution states.
- **Pipeline Refactor**: Deprecated old generators in favor of the new tool-driven `CanvasOrchestrator`.

### Removed
- **Legacy Layout Engine**: Deleted `src/engine/layout-engine/` and associated outdated tests.
- **Distributed Generators**: Removed legacy `distributedGenerator.ts` and `progressiveContext.ts`.

## [1.1.0] - 2026-01-26

### Added
- **Trace Stability Engine**: Overhauled `FlowObserver` to support non-destructive trace resuming, preventing event loss across complex generation cycles.
- **Cross-Context Synchronization**: Implemented explicit ID bridging between Figma Main and UI contexts to ensure consistent logging and state tracking.
- **Enhanced Streaming Pipeline**: Standardized `streamSessionId` propagation and implemented `RenderLifecycleManager` for safer node management during streaming.
- **Runtime Diagnostics**: Added `compatibility.ts` for deep environmental auditing and feature detection within Figma's restricted sandbox.

### Fixed
- **Trace ID Visibility**: Fixed issue where `traceId` became empty in RENDER phase due to environment isolation.
- **Event Resets**: Eliminated destructive `events = []` resets when resuming active generation traces.
- **Layer Synchronization**: Improved throttled rendering logic to reduce flickering and visual artifacts.

## [1.0.0] - 2026-01-23

### Added
- **Intelligent Intent Recognition**: Refactor of `intentRecognizer.ts` to replace heuristic-based guessing with dynamic pattern matching strategies.
- **Unified Property Mapping**: Implemented a standardized `PropertyTransformer` layer to unify property names between Figma API and LLM DSL.
- **Pure Trust Sanitization**: Overhauled `sanitize.ts` to respect LLM design intent, removing aggressive visual stripping (e.g., preserving strokes on text/frames).
- **Knowledge-Driven Rendering**: Enhanced `renderLayer` to better utilize component knowledge base.

### Fixed
- **Rendering Layer Detox**: Removed hardcoded "vanilla" styles and arbitrary layout defaults in `layerRenderer.ts`.
- **Git Hygiene**: Cleaned up experimental directories (`src/_archive`, `src/playground`) and fixed `.gitignore` to track core source files.
- **Build Configuration**: Standardized build process and versioning.
