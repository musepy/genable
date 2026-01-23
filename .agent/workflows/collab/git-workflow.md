---
description: Git commit conventions and workflow standards using Conventional Commits format
---

# Git Workflow

> **Purpose**: Maintain clean, meaningful commit history with consistent formatting.

---

## Core Rules

### Commit Creation
- Create commits **only when explicitly requested** by the user
- Otherwise: keep changes staged locally or provide a patch/diff for review

### Commit Format
Use **Conventional Commits** style with multiple `-m` flags for multi-paragraph messages:

```bash
git commit -m "feat: add automated deploy pipeline" \
  -m "- Add CI job for image build" \
  -m "- Add SSH-based deploy step"
```

---

## Commit Types

| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Formatting, no code change |
| `refactor` | Code restructuring |
| `test` | Adding tests |
| `chore` | Maintenance tasks |

---

## Guidelines
1. Never auto-commit without explicit user request
2. Use conventional commit format
3. Keep subject line under 72 characters
4. Use imperative mood ("add" not "added")
5. Reference issue numbers when applicable

---

## Examples

### Good Commit
```bash
git commit -m "fix: resolve login timeout on slow networks" \
  -m "- Increase timeout from 5s to 30s" \
  -m "- Add retry logic with exponential backoff" \
  -m "Closes #123"
```

### Avoid
```bash
git commit -m "fixed stuff"
git commit -m "更新了代码"  # No Chinese in commits
```
