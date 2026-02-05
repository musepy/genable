---
description: Pull Request creation and management standards using GitHub CLI (gh)
---

# PR Protocol

> **Purpose**: Ensure consistent, well-documented pull requests.

---

## Core Rules

### PR Management
- Open PRs **only when requested**
- Merge PRs **only when explicitly requested**

### Formatting
- Do NOT use escaped `\n` in `--body` (they render literally)
- Prefer `--body-file` to pass Markdown content

---

## PR Structure Template

```markdown
## Summary
Brief description of what this PR does

## Impact
- What areas are affected
- Breaking changes (if any)

## Notes
- Implementation details
- Trade-offs made

## References
- Related issues: #123
- Documentation: [link]
```

---

## Example: Creating PR with gh CLI

```bash
# Create PR body file
cat > /tmp/pr-body.md << 'EOF'
## Summary
Add user authentication with OAuth2

## Impact
- New login flow for all users
- Existing sessions will be invalidated

## Notes
- Using Auth0 as identity provider
- Tokens stored in httpOnly cookies

## References
- Closes #45
- RFC: docs/rfc/auth.md
EOF

# Create PR
gh pr create --title "feat: add OAuth2 authentication" \
  --body-file /tmp/pr-body.md
```

### Avoid
```bash
# Bad: escaped newlines render literally
gh pr create --body "Summary\n\nThis is the description"
```
