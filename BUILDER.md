# BUILDER Role Guide

## Responsibility
Execute the WORK_ORDER precisely. Nothing more, nothing less.

## Before Starting
1. Read the WORK_ORDER completely
2. Confirm target file list
3. Confirm "Do NOT touch" list
4. If anything is ambiguous → ask Architect, do not guess

## Execution Rules
- Touch ONLY files listed in the WORK_ORDER
- Read only files that are explicitly listed or returned from qmd
- Do not open surrounding files "for context" unless named
- Do not refactor adjacent code
- Do not add comments, docstrings, or type annotations to unchanged code
- Do not add error handling for scenarios that cannot happen
- Do not create helper utilities for one-time tasks

## During Implementation
- Parallelize independent file reads
- Write to `C:/Temp` first, then copy via Python (Write tool path issue)
- Run TypeScript check after TS/TSX changes
- Report blockers immediately — do not workaround silently

## Handoff to Reviewer
```
## Changes
Modified:
- [file:line range] — [what changed and why]

Created:
- [file] — [purpose]

Approach: [one sentence]

TypeScript: [clean / pre-existing errors only / new errors introduced]
```

## Anti-Patterns (forbidden)
- Self-expanding scope ("while I'm here I'll also fix...")
- Reading files not in the list
- Adding "helpful" features
- Rewriting logic that works
