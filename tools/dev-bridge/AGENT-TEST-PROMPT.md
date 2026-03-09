# Agent Test Prompt — Design Agent Quality Assessment

Copy the content below into a new Claude Code window to run autonomous multi-dimension testing.

---

## Instructions for Claude Code

You are a **Design Agent QA Tester**. Your job is to test a Figma design generation agent through multiple dimensions, analyze results, and write a structured report.

### Setup

The test infrastructure is ready:
- Dev bridge server runs on `localhost:3456`
- Plugin is loaded in Figma and auto-connects
- Use `npx tsx tools/dev-bridge/test-run.ts` for single tests
- Use `curl` for multi-turn and model switching tests

### Available Models

Switch models via trigger payload `"model": "provider/modelName"`:
- `gemini/gemini-2.5-flash-preview-04-17` — Gemini Flash (fast, good quality)
- `dashscope/kimi-k2.5` — Kimi K2.5 (slower, cross-border latency, may 504)

### Test Dimensions

Run tests in order. For each test, capture: tool calls, duration, errors, screenshot path.

#### 1. Generation Quality (per model)
Test basic component generation. Run each prompt on ALL available models:
- Simple: "Design a login card with email, password, sign-in button"
- Medium: "Design a pricing table with 3 tiers: Free, Pro, Enterprise"
- Complex: "Design a dashboard sidebar with navigation, user avatar, and nested menu items"

#### 2. Multi-turn Conversation
Test sequential modifications (do NOT reset between turns):
- Turn 1: "Design a user profile card with avatar, name, bio, and social links"
- Turn 2: "Change the background to dark mode"
- Turn 3: "Add a settings gear icon in the top right corner"
- Turn 4: "Make the avatar larger and add a green online status indicator"

#### 3. Fine-grained Edits
Test precise modifications:
- Create a button, then: "Change only the button color to red"
- Create a form, then: "Change the placeholder text of the email field to 'Enter work email'"

#### 4. Major Structural Edits
Test large-scale changes:
- Create a simple card, then: "Convert this into a horizontal layout with the image on the left and content on the right"
- Create a list, then: "Add a search bar at the top and pagination at the bottom"

#### 5. Tool Coverage
Verify all 4 tools are exercised:
- `query_knowledge` — "Design a table" (should trigger guidelines query)
- `create` — any generation prompt
- `edit` — any modification prompt (after creating something)
- `read` — check if agent uses screenshot verification

#### 6. Error Recovery
Test edge cases:
- Empty prompt: ""
- Ambiguous: "Make it better"
- Contradictory: "Design a button that is both red and blue"

### How to Run Tests

```bash
# Single test (with reset)
npx tsx tools/dev-bridge/test-run.ts "your prompt" --reset --wait 180

# Multi-turn (no reset between turns, just trigger sequentially)
curl -s -X POST localhost:3456/trigger -H 'Content-Type: application/json' \
  -d '{"prompt": "Turn 1 prompt", "reset": true}'
curl -s "localhost:3456/result/TRIGGER_ID?wait=180"
# Then next turn (no reset):
curl -s -X POST localhost:3456/trigger -H 'Content-Type: application/json' \
  -d '{"prompt": "Turn 2 prompt"}'
curl -s "localhost:3456/result/TRIGGER_ID?wait=180"

# Switch model
curl -s -X POST localhost:3456/trigger -H 'Content-Type: application/json' \
  -d '{"prompt": "Design X", "reset": true, "model": "gemini/gemini-2.5-flash-preview-04-17"}'

# View screenshot
# Use Read tool on: /tmp/figma-bridge/results/TRIGGER_ID/screenshot.png
```

### Report Format

Write the report to `docs/test-reports/YYYY-MM-DD-agent-test.md`:

```markdown
# Agent Test Report — YYYY-MM-DD

## Summary
| Dimension | Tests | Pass | Fail | Notes |
|-----------|-------|------|------|-------|
| Generation | N | N | N | ... |
| Multi-turn | N | N | N | ... |
| ...

## Detailed Results

### 1. Generation Quality
#### Gemini Flash
- **Login Card**: Duration Xs, N tools, [PASS/FAIL] — notes
  - Screenshot: path
  - Issues: ...

#### Kimi K2.5
- ...

### 2. Multi-turn Conversation
...

## Key Findings
- ...

## Recommendations
- ...
```

### Important Notes
- Wait up to 180s per test (DashScope can be slow)
- If DashScope returns 504, note it and continue — don't retry endlessly
- View every screenshot to visually verify quality
- For multi-turn tests, look at the final screenshot (not intermediate)
- The agent may occasionally create duplicates (known Kimi K2.5 issue) — note if it happens
