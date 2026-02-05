# Semantic Layout Engine: Research & Requirements Report

## 1. Research Validation

### A. Algorithmic Layout Generation
*   **Finding**: Industry standard is **Programmatic Auto Layout**. Tools like "Visual Copilot" and "Figma Automator" rely on structured, nested Auto Layout frames rather than pixel-perfect solving.
*   **Validation**: Our "Semantic > Compiler" approach aligns with this. Instead of solving pixel coordinates (which is brittle), we should solve for **Layout Properties** (declarative).
*   **Key Insight**: "Usage of 'Hug Contents' and 'Fill Container' is paramount for responsiveness" [Source 1, 2].

### B. The "Clip Content" Problem
*   **Finding**: The standard workaround for shadows/overflow in fixed frames is explicitly setting `clipsContent = false` on the parent node [Source 2].
*   **Validation**: The proposed `SemanticOverflowStrategy` (forcing `clipsContent: false` for Buttons/Badges) is the correct, standard API approach. No complex math required.

### C. Text Resizing Strategy
*   **Finding**: `textAutoResize` (Content-driven) vs `layoutSizing` (Parent-driven).
    *   **Independent Text**: Use `textAutoResize` (`WIDTH_AND_HEIGHT` for headings).
    *   **Auto Layout Text**: `textAutoResize` is still respected for "HUG", but `layoutSizing: FILL` overrides it [Source 3].
*   **Validation**: Our strategy must distinguish between "Heading" (Auto Width/Hug) and "Paragraph" (Auto Height/Fill).

---

## 2. Technical Requirements (Converted from Research)

### 2.1. Deterministic Compilation (vs Solver)
*   **Requirement**: The system **MUST** compile high-level Semantic Tags directly to Figma Layout Props.
*   **Rationale**: "Best practices dictate defining how elements behave (Hug/Fill) rather than where they sit."
*   **Implementation**: `SemanticProfile` must strictly map to `layoutSizingHorizontal`, `layoutSizingVertical`, `layoutAlign`, `layoutMode`.

### 2.2. Overflow Management
*   **Requirement**: The system **MUST** support a `NoClip` constraint for specific semantic types (Button, Badge, Tooltip).
*   **Rationale**: Shadows and negative margins require `clipsContent: false`.
*   **Code**: `if (profile.constraints.noClip) node.clipsContent = false`.

### 2.3. Text Responsiveness
*   **Requirement**:
    *   **Headings/Labels**: Must use `textAutoResize: "WIDTH_AND_HEIGHT"` + `layoutSizing: "HUG"`.
    *   **Body/Descriptions**: Must use `textAutoResize: "HEIGHT"` + `layoutSizing: "FILL"`.
*   **Rationale**: Ensures text flows correctly without manual resizing.

### 2.4. Advanced Layout Support
*   **Requirement**: Support `Gap: Auto` via `primaryAxisAlignItems: "SPACE_BETWEEN"`.
*   **Requirement**: Support `Wrapping` via `layoutWrap: "WRAP"`.

---

## 3. Possibility Assessment

| Feature | Possibility | Implementation Path |
| :--- | :--- | :--- |
| **No-Solver Layout** | **High** | Use `HUG/FILL` propagation. Validated by standard Figma workflow. |
| **Clip Prevention** | **High** | API supports `clipsContent`. Trivial to implement via Semantic mapping. |
| **Text Flow** | **Medium** | Requires strict distinction between Heading/Body in Schema. |
| **Gap Auto** | **High** | Direct mapping to `SpaceBetween`. |

**Conclusion**: The "Semantic Layout Engine" proposal is technically sound and aligns with Figma's native verified behaviors. No blockers found.
