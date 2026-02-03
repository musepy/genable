---
name: figma-dev-networking
description: Guidelines for configuring Figma plugin manifest.json for local development network access (localhost, logging servers).
---

# Figma Development Networking Skill

This skill provides the correct configuration patterns for allowing a Figma plugin to communicate with local development servers (like a log server on port 3456).

## Core Requirements

When a Figma plugin needs to access a local server (e.g., `http://localhost:3456`), standard `allowedDomains` in `manifest.json` might trigger validation errors or be suboptimal.

### 1. Use `devAllowedDomains`
For local development tools that aren't needed in production, use the `devAllowedDomains` field instead of `allowedDomains`. This tells Figma these are development-only resources.

### 2. The `reasoning` Field
Figma requires a `reasoning` field whenever network access is requested. This must be a human-readable string explaining why the plugin needs this access.

### 3. Avoid IP Addresses
Figma's validator may reject IP addresses like `http://127.0.0.1:3456` as "invalid URLs" even if they are technically correct. Always prefer `http://localhost:[port]`.

## Correct Configuration Pattern

```json
{
  "networkAccess": {
    "allowedDomains": [
       "https://api.external-service.com"
    ],
    "devAllowedDomains": [
      "http://localhost:3456"
    ],
    "reasoning": "Accessing external AI APIs and forwarding logs to a local development server for debugging."
  }
}
```

## Troubleshooting Common Errors

| Error Message | Cause | Resolution |
| :--- | :--- | :--- |
| `Invalid value for networkAccess. If you want to allow localhost, please add a "reasoning" field...` | Missing `reasoning` string in the `networkAccess` object. | Add `"reasoning": "..."` to the object. |
| `Invalid value for networkAccess. ... please add a "devAllowedDomains" field instead.` | Using `localhost` in `allowedDomains` for dev-only work. | Move localhost URLs to `devAllowedDomains`. |
| `Invalid value for devAllowedDomains. 'http://127.0.0.1:xxx' must be a valid URL.` | Figma validator policy against raw IP addresses. | Replace `127.0.0.1` with `localhost`. |

## Implementation Flow

1. Identify the local server URL (e.g., `http://localhost:3456`).
2. Open `manifest.json`.
3. Update the `networkAccess` block as shown in the pattern above.
4. Re-build and re-load the plugin in Figma.
