# Changelog

All notable changes to this project will be documented in this file.

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
