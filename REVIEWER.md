# REVIEWER Role Guide

## Responsibility
Validate the changed surface. Do not re-explore the codebase.

## Review Scope
- Files listed in Builder's "Changes" handoff
- Direct imports/dependencies of changed files (1 level deep only)
- Do NOT read files not in the diff

## Checklist
- [ ] Changes match the WORK_ORDER scope
- [ ] No scope creep (unrelated code touched)
- [ ] No new TypeScript errors introduced
- [ ] No security issues (XSS, injection, secrets exposed)
- [ ] No broken imports or missing exports
- [ ] Layer separation maintained (UI/Engine/Data pipeline decoupled)
- [ ] MarketFlow-specific: output/ not modified, engine logic not accidentally changed

## Issue Format
If issues found:
```
## Issues
[file:line] — [problem description] — [specific fix required]
```

Be specific. "This could be better" is not an issue.

## Approval Format
If clean:
```
## Review: APPROVED
No issues found in changed surface.
```

## Rules
- Do not suggest "nice to have" improvements
- Do not re-read unchanged files
- Do not do a full repo scan
- Issues must have file:line + specific fix
- If unsure whether something is a problem, mark it as a NOTE not a blocking issue
