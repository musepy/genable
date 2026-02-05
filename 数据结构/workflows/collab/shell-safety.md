---
description: Safe shell command execution with timeout handling and non-interactive patterns
---

# Shell Execution & Safety

> **Purpose**: Prevent hanging commands and ensure safe, predictable shell execution.

---

## Core Rules

### Prefer Non-Interactive
- Use **one-shot, non-interactive** commands
- Avoid REPLs and interactive prompts when possible

### Timeout Handling
Always add safeguards to prevent hanging:

```bash
# Use timeout for potentially slow commands
timeout 60s long-running-command

# Use set -euo pipefail for scripts
set -euo pipefail
```

### Blocking Commands
If a command may block (e.g., `tail -f`, REPL, servers):
- **Explain how to stop it before running** (Ctrl+C, kill command)
- Provide the stop command upfront

---

## Common Timeout Patterns

| Scenario | Command |
|----------|---------|
| HTTP request | `timeout 30s curl ...` |
| Git operation | `timeout 60s git clone ...` |
| Build process | `timeout 300s npm run build` |
| Test suite | `timeout 600s npm test` |

---

## Examples

### Safe Command Execution
```bash
# With timeout
timeout 30s curl -sSL https://example.com/api

# Non-interactive package install
npm install --yes
apt-get install -y package-name

# Script with safety options
#!/bin/bash
set -euo pipefail
# script content...
```

### Starting a Server Safely
```bash
# Before running:
# To stop: Press Ctrl+C or run `kill $(lsof -t -i:3000)`

npm run dev
```

### Avoid
```bash
# Bad: May hang indefinitely
curl https://slow-server.com/large-file

# Bad: Requires user interaction
npm init  # Use `npm init -y` instead
```
