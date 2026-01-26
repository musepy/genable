# Runtime Fidelity Standard

This document defines the engineering standards for ensuring that the Genable plugin remains compatible with the Figma runtime environment (QuickJS sandbox).

## 1. Environment Constraints

Figma plugins run in a restricted JavaScript environment. While modern development tools (Node.js, TypeScript, Vite) might support the latest ECMAScript features, the Figma runtime may lag behind.

### Banned Features (ES2020+)
- **BigInt**: Not supported in many Figma environments. Calling `BigInt()` or using bigint literals (`100n`) will cause a runtime crash.
- **Top-level Await**: May not be supported depending on how the plugin is bundled.
- **Modern RegExp Features**: Some newer flag support (e.g., `v` flag) or lookbehind assertions may fail.

## 2. Compilation and Alignment Policy

- **Target**: All code must be compiled down to **ES2018**.
- **Enforcement**: This is enforced via `tsconfig.json` (`"target": "ES2018"`) and the build pipeline.
- **Bundle Guard**: We use a **Build-Time Injection** strategy. The `build.js` script prepends a robust global shim at the absolute top of the generated `build/main.js`. 
- **Absolute Priority**: This ensures the guard runs before any ESBuild-wrapped modules or third-party libraries (like Zod) initialize, effectively preventing "BigInt is not a function" crashes.
- **Diagnostics**: The `initializeDiagnostics()` function in `src/utils/compatibility.ts` provides runtime visibility into the alignment status.

## 3. Data Validation & Coercion

To prevent runtime errors caused by modern JS features leaking through third-party libraries (like Zod), we follow these rules:

### No Implicit Coercion in Schema
Avoid using `z.coerce.number()` or `z.coerce.bigint()`. These features may trigger internal checks in Zod that reference missing globals.

### Centralized Normalization
All "loose" data from the LLM must pass through the `Normalizer` service.
- **Numeric Fields**: Must be explicitly converted using `parseFloat()` or `Number()`.
- **Enum Fields**: Must be normalized to uppercase and matched against known constants.
- **Structural Healing**: The `Normalizer` is responsible for fixing structural inconsistencies (e.g., wrapping arrays) before validation.

## 4. Verification

Before releasing any changes:
1. **Build Check**: Run the build and grep for banned keywords (e.g., `BigInt`).
2. **Runtime Check**: Run the plugin in the Figma Desktop app to ensure no "is not a function" errors occur during startup or generation.

---

> [!IMPORTANT]
> Failure to adhere to these standards results in "Magic Failures" that are difficult for the LLM to understand and for users to debug. Maintain **Runtime Honesty** at all levels of the stack.
