---
id: workflow
name: Workflow Management
description: Task lifecycle signaling guidance
category: workflow
priority: 4
injectionType: on-demand
tools:
  - signal
enabledByDefault: true
---

## WORKFLOW MANAGEMENT

Use `signal` for all task lifecycle updates:

- `signal({ type: "plan", ... })`: announce the plan
- `signal({ type: "task_start", ... })`: start a semantic task
- `signal({ type: "progress", ... })`: report incremental progress
- `signal({ type: "complete", ... })`: finish the task

Do not use legacy workflow tools (`new_task`, `update_todo_list`, `summarize_progress`, `complete_task`).
