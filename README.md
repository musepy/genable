# Genable

![Cover](./assets/cover.svg)

**Genable** is a Figma plugin that uses Google's Gemini AI to generate editable UI components from text prompts.

## Features

-   **AI-Powered Generation:** Create complex layouts (Forms, Cards, Dashboards) using natural language.
-   **Native Figma Nodes:** Outputs Auto Layout frames, Text nodes, and basic Vectors.
-   **Context Awareness:** Can read styles (Colors, Fonts) from your current selection to match the generated design.
-   **Privacy Focused:** Your API key is stored locally in `localStorage`.

## Installation

1.  Clone this repository.
2.  Run `npm install`.
3.  Run `npm run build`.
4.  In Figma, go to **Plugins > Development > Import plugin from manifest...** and select `manifest.json`.

## Usage

1.  Open the plugin "Genable".
2.  Paste your Gemini API Key.
3.  Type a prompt like: *"A mobile profile screen with a circular avatar, stats row, and a settings list."*
4.  Hit Generate.

## Roadmap

-   **v1.1:** Streaming responses (visual feedback while generating).
-   **v1.2:** Support for Figma styles (Effect Styles, Text Styles).
-   **v2.0:** "Refine" mode – modifying existing designs via chat.