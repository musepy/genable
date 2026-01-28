# Private AI-to-Figma Layer Generator Plugin

This plugin uses Google Gemini to generate editable Figma layers from text prompts. It uses a custom DSL to bridge the AI output and Figma's SceneNode API.

## Architecture

1.  **UI Thread (React)**
    -   Handles User Input (Prompt).
    -   Manages Gemini API Key (stored in `localStorage` for privacy).
    -   Constructs the "System Prompt" dynamically (injecting local Variable names).
    -   Validates AI output using `Zod` Schema.
2.  **Logic Thread (Sandbox)**
    -   `renderLayer` recursive function: Transforms JSON DSL -> Figma Nodes.
    -   `GET_VARIABLES`: Scans local variable library.
    -   `CREATE_LAYERS`: Executes the rendering.

## DSL Specification (The Contract)

The AI outputs JSON strictly adhering to this schema:

```typescript
type LayerDSL = {
  type: 'FRAME' | 'TEXT' | 'VECTOR';
  name: string;
  props: {
    layout?: 'VERTICAL' | 'HORIZONTAL' | 'NONE';
    spacing?: number; // itemSpacing
    padding?: number; // padding (all sides)
    fills?: string; // Hex "#FF0000" or "Variable:PrimaryColor"
    svgData?: string; // For VECTOR paths
    content?: string; // For TEXT characters
    width?: 'FILL' | 'FIXED';
    height?: 'FILL' | 'FIXED';
  };
  children?: LayerDSL[];
};
```

## Security & Privacy

-   **API Key:** The Gemini API Key is stored in the browser's `localStorage` within the plugin's iframe sandbox. It is **never** sent to any third-party server other than Google's Generative AI endpoint.
-   **Code:** The codebase does not contain any hardcoded secrets.

## Usage

1.  **Install:** `npm install`
2.  **Build:** `npm run build`
3.  **Load in Figma:**
    -   Open Figma -> Plugins -> Development -> Import plugin from manifest...
    -   Select `manifest.json`.
4.  **Run:**
    -   Enter your Gemini API Key.
    -   Type a prompt (e.g., "A modern card component with an image placeholder, title, and button").
    -   Click "Generate".

## Roadmap (Future Improvements)

-   **Incremental Rendering:** Show placeholders while streaming the response.
-   **Image Support:** Integrate Unsplash or Gemini Image generation.
-   **Styles:** Support for Text Styles and Effect Styles (Shadows/Blur).
