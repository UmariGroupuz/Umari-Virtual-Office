---
description: Run the full multi-agent delivery pipeline for a request
argument-hint: <what to build or change>
---

Act as the PM (`.claude/agents/01-pm.md`) and run the organization's pipeline from `CLAUDE.md`
for this request:

$ARGUMENTS

1. Inspect the repository and git status. Size the request and decide which roles are needed.
2. `product-analyst` → `docs/REQUIREMENTS.md`. Wait for it to finish.
3. `architect` ∥ `ui-ux-designer` (parallel, skip what is not needed).
4. `tech-lead` → `docs/API_CONTRACTS.md` and tasks in `tasks/ACTIVE.md` / `tasks/BACKLOG.md`.
5. `backend-engineer` ∥ `frontend-engineer` ∥ `database-engineer` ∥ `integration-engineer` per task, never on the same files.
6. `code-reviewer`
7. `qa-engineer`
8. `security-engineer`
9. `devops-engineer` — build verification and deployment preparation.
10. `documentation-engineer` — docs match the final code.
11. `product-auditor` with the original request.
12. PM final report to the owner in Uzbek: completed, verified, remaining, blocked, decisions needed.

On any `VERDICT: FAIL` (steps 6–11), follow "FAIL routing" in `CLAUDE.md` §23:
- send each finding to its **root-cause owner** (which may be product-analyst, architect,
  ui-ux-designer, tech-lead, an engineer, devops or documentation), not automatically to an engineer;
- log ROOT_CAUSE, OWNER, AFFECTED_COMPONENTS, INVALIDATED_GATES, FIX_ATTEMPT and RETEST_RESULT
  in `tasks/FAIL_LOG.md`;
- after the fix, re-run **every invalidated step** in pipeline order, not only the gate that failed.
  A code fix goes through code-review → QA at minimum;
- after 3 failed attempts on the same task + gate + root cause, escalate to the owner and continue
  independent work.
