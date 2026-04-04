# ARCHITECT Role Guide

## Responsibility
Define scope and write the WORK_ORDER before any code is written.

## Before Writing a Brief
1. Identify the exact problem (qmd search if needed, max 2 queries)
2. Name the exact files to be modified or created
3. Specify what NOT to touch
4. Define inputs, outputs, and data flow
5. Flag risks or dependencies

## WORK_ORDER Template
```markdown
## WORK_ORDER — [Task Name]

### Scope
[One sentence describing what this changes]

### Target Files
Modify:
- marketflow/path/to/file.tsx — [what changes]

Create:
- marketflow/path/to/new.py — [what it does]

Do NOT touch:
- marketflow/backend/output/   ← generated data
- [any other protected areas]

### Inputs / Outputs
Input: [data source or API call]
Output: [what the component/script produces]

### Key Constraints
- [any gotchas, pre-existing errors to avoid, layer separation rules]

### Done When
- [ ] [acceptance criterion 1]
- [ ] [acceptance criterion 2]
```

## Rules
- Do not write code — write briefs only
- Do not scan the whole repo — use qmd or named files
- Stop when the brief is complete and handed to Builder
- If the task is unclear, ask before writing the brief
