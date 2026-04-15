# T5: AppleScript Feasibility Report

**Date**: 2026-03-07
**Status**: COMPLETED
**Verdict**: PARTIALLY FEASIBLE — requires one-time Accessibility permission grant

## Summary

AppleScript/osascript can do some things with Figma desktop (Electron app), but **full UI automation requires macOS Accessibility permission**, which must be granted manually once in System Settings.

## Capability Matrix

| Capability | Works? | Needs Accessibility? | Method |
|---|---|---|---|
| Activate Figma (bring to front) | YES | NO | `tell application "Figma" to activate` |
| List running processes | YES | NO | System Events `get name of every process` |
| Get window IDs + bounds | YES | NO | CGWindowListCopyWindowInfo (compiled helper) |
| Capture specific window screenshot | YES | NO | `screencapture -l <windowID>` |
| Capture full screen screenshot | YES | NO | `screencapture -x` |
| Open file via URL scheme | YES | NO | `open "figma://file/<key>"` |
| Read window titles/properties | NO | YES | System Events `tell process "Figma"` |
| Send keystrokes | NO | YES | System Events `keystroke` / CGEventPost |
| Navigate menus | NO | YES | System Events menu bar items |
| Click UI elements | NO | YES | AXUIElement APIs |

## What's Confirmed Working (No Accessibility Needed)

### 1. Window Detection
Compiled Obj-C helper using `CGWindowListCopyWindowInfo` can find all Figma windows with their CGWindowIDs, names, bounds, and layer info. This works without any special permissions.

```
FIGMA WINDOW: owner=Figma  id=103610  name='genable_dev'  layer=0
FIGMA WINDOW: owner=Figma Beta  id=166510  name='genable test'  layer=0
```

### 2. Per-Window Screenshots
`screencapture -l <CGWindowID>` captures a specific Figma window at full resolution. Verified: produces correct PNG (3592x2294 RGBA), shows actual Figma content including plugin panel.

### 3. App Activation
`tell application "Figma" to activate` brings Figma to foreground. Works without accessibility.

### 4. URL Scheme
Figma registers `figma://` URL scheme. Can open files. **No known URL scheme for triggering plugins.**

## What Requires Accessibility Permission

### Critical blocker: `osascript is not allowed assistive access (-25211)`

Any System Events interaction that CONTROLS a process (not just reads process names) requires accessibility:
- Getting window properties (`get title of window 1`)
- Sending keystrokes (`keystroke "p" using {command down}`)
- Menu navigation (`get menu bar item of menu bar 1`)
- UI element interaction

### Solution Options

**Option A: Grant Terminal.app accessibility (one-time)**
- System Settings → Privacy & Security → Accessibility → add Terminal.app
- After this, ALL osascript commands from Terminal would have full control
- Easiest, but grants broad permission

**Option B: Grant a compiled helper binary accessibility**
- Built `/tmp/figma_ax_test` that prompts for permission and can traverse Figma's full AX tree
- More targeted than granting Terminal.app
- Tested: AX dialog appears, binary correctly detects permission status

**Option C: Use cliclick or Hammerspoon**
- Neither is installed; would need `brew install cliclick`
- Same accessibility requirement applies

## Figma-Specific Findings

1. **Electron app** (confirmed: `electron.icns`, `Electron Framework.framework`)
   - Bundle ID: `com.figma.Desktop`
   - Standard Electron AX tree should be accessible once permission granted

2. **No scripting dictionary** — Figma doesn't support Apple Events beyond basic `activate`/`open`. Can't do `tell application "Figma" to get name of window 1`.

3. **No plugin URL scheme** — `figma://file/<key>` opens files, but there's no `figma://plugin/<id>/run` or similar.

4. **Plugin trigger would require keyboard shortcut** — Figma plugins can be assigned keyboard shortcuts (e.g., Cmd+Shift+P to open quick actions), but sending those requires accessibility.

## Assessment for H3 (AppleScript Automation Fallback)

**If accessibility is granted** (Option A or B):
- Can activate Figma ✓
- Can send keyboard shortcuts to open plugin ✓ (e.g., navigate Plugins menu)
- Can take window screenshots ✓
- Can read window titles (detect which file is open) ✓
- **Cannot** read Figma node tree (AX tree shows Electron DOM, not Figma canvas)
- **Cannot** export node data (no programmatic access to Figma API from outside)

**Verdict for automation loop**:
- H3 can trigger plugin execution + capture screenshots
- H3 CANNOT capture node tree data or structured results
- H3 is strictly inferior to H1 (dev server bridge) for automation
- H3 only makes sense as fallback for "trigger + screenshot" workflow

## Recommended Next Steps

1. **Try granting Terminal.app accessibility** — one click in System Settings, unlocks full AppleScript control
2. **If H1 (dev server) works** — H3 is unnecessary; screenshots via `screencapture -l` are still useful as a bonus
3. **If H1 fails (CSP blocks localhost)** — H3 + compiled helper can trigger plugin, but result capture is limited to screenshots only
