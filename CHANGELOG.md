# Changelog

All notable changes to this project will be documented in this file.

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
