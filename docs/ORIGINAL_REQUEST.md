# ORIGINAL OWNER REQUEST (verbatim)

Recorded by the PM on 2026-10-03. This is the binding source for requirements and the final audit.

## Repository inspection at intake (PM, 2026-10-03)

- Folder: `C:\Users\User\Music\Claude agentlar\Virtual Office MVP`
- Contents: only `.git/` — no files, no commits yet (branch `master`, clean).
- Node: v24.12.0 · npm: 11.6.2 · OS: Windows 11 (bash + PowerShell available).
- `node:sqlite` (built-in, SQLite 3.50.4) works without flags (prints an ExperimentalWarning).

---

PROJECT NAME:
AI Virtual Office MVP

GOAL:
Build a professional real-time Virtual Office monitoring UI for our AI agent team.

This is NOT yet the real Claude-agent integration.
Phase 1 must build the monitoring system, office visualization, agent state model, real-time event system, mock simulator, and a clean architecture so real Claude Code agents can be connected later.

IMPORTANT RULES:
- Work only inside the current project folder.
- Do NOT modify unrelated folders.
- Do NOT deploy anywhere.
- Do NOT push to GitHub.
- Do NOT commit unless I explicitly ask.
- Do NOT connect to any production system.
- Do NOT use real API keys.
- Do NOT make destructive changes outside this repository.
- If something is unclear, choose the safest reasonable implementation and document the decision.
- Do not stop after creating only a mockup. Build a runnable working MVP.
- After each major phase, verify that it actually works.
- Fix errors yourself before reporting completion.
- Keep the code production-oriented and modular.

## 1. PRODUCT CONCEPT

We are building a Virtual Office for AI agents.

The final long-term product will allow me to:
- See all AI agents visually inside a virtual office
- See who is working
- See who is waiting
- See who is idle
- See who failed
- See what project each agent is working on
- See current task
- See activity history
- See task progress
- Open each agent and inspect logs
- Monitor multiple projects
- Later send commands to agents
- Later connect Telegram
- Later connect Claude Code
- Later connect GitHub
- Later connect terminals
- Later connect browser agents
- Later connect Docker
- Later connect CI/CD
- Later control AI agents remotely

Phase 1 is MONITORING ONLY.

## 2. OUR 15 AI AGENTS

Create and seed these 15 agents:

01. PM / Orchestrator
02. Product Analyst
03. Architect
04. Backend Engineer
05. Frontend Engineer
06. Database Engineer
07. DevOps Engineer
08. Security Engineer
09. QA Engineer
10. UI/UX Designer
11. Mobile Engineer
12. AI Engineer
13. Documentation Engineer
14. Reviewer
15. Product Auditor

Each agent must have:
- id
- code
- name
- role
- shortRole
- avatar
- department
- roomId
- deskId
- status
- currentProject
- currentTask
- taskId
- progress
- startedAt
- lastActivityAt
- currentAction
- lastMessage
- online
- metadata

## 3. AGENT STATUSES

Support these statuses: idle, planning, working, waiting, reviewing, completed, failed, offline

Status meaning:
- idle — no active task; agent is available
- planning — analyzing a task; deciding next steps
- working — actively executing a task
- waiting — blocked or waiting for another agent/system
- reviewing — reviewing code, documents, architecture, or results
- completed — latest task completed successfully
- failed — task or process failed
- offline — agent is disconnected

Create a clean status state machine.
Document legal and illegal transitions.

Example:
idle -> planning
planning -> working
working -> waiting
waiting -> working
working -> reviewing
reviewing -> completed
working -> failed
failed -> planning
completed -> idle

## 4. TECHNOLOGY STACK

Use a modern TypeScript stack.

Frontend: React, TypeScript, Vite, Tailwind CSS, shadcn/ui or clean reusable custom components, Zustand, React Router if needed

Virtual office visualization: Phaser 3

Backend: Node.js, TypeScript, Express, Socket.IO

Database: SQLite for Phase 1

ORM: Use Prisma if it is practical. If Prisma introduces unnecessary friction, use a clean SQLite abstraction.

Testing: Vitest for frontend/shared logic; suitable backend test framework; Supertest for API if appropriate

Code quality: ESLint, Prettier

## 5. PROJECT STRUCTURE

Prefer a simple monorepo. Target structure similar to:

```
ai-virtual-office/
apps/
  web/
  server/
packages/
  shared/
  types/
docs/
data/
scripts/
```

Do not over-engineer.

Possible structure:

```
apps/web
  src/
    components/ office/ agents/ dashboard/ activity/ simulator/ store/ socket/ pages/ types/
apps/server
  src/
    api/ agents/ events/ socket/ services/ db/ seed/ types/
packages/shared
packages/types
docs/
  ARCHITECTURE.md
  EVENT_SYSTEM.md
  AGENT_STATE_MACHINE.md
  ROADMAP.md
```

## 6. MAIN UI

Build a desktop-first professional AI Operations Center.

Main screen must contain:

TOP BAR — Show: Product name: AI Virtual Office; System status; Current project filter; Current time; Connected agents count

PROJECT SELECTOR — Seed these projects: All Projects, Sellway, Ishkun24, ERP, Ana Market.
Selecting a project must filter relevant agent/task activity.

TOP METRICS — Show: Agents Online, Working, Planning, Waiting, Reviewing, Failed, Active Tasks, Completed Tasks

## 7. VIRTUAL OFFICE LAYOUT

Create a real visual office using Phaser 3.

Do NOT make it childish.

Style: dark graphite; premium SaaS; AI operations center; subtle pixel-office influence; professional; clear information hierarchy; smooth but lightweight animation

Office areas:
1. Management — PM / Orchestrator, Product Analyst, Architect
2. Development — Backend Engineer, Frontend Engineer, Database Engineer, Mobile Engineer
3. Design — UI/UX Designer
4. Infrastructure — DevOps Engineer, Security Engineer
5. Quality — QA Engineer, Reviewer
6. AI Lab — AI Engineer
7. Documentation — Documentation Engineer
8. Audit — Product Auditor

Each agent must have: desk/workstation; visual label; status indicator; click target

For Phase 1, simple character sprites or generated placeholder avatars are acceptable.
Avoid dependence on copyrighted game assets.

## 8. STATUS VISUALIZATION

Visual behavior:
- idle: agent sitting normally; neutral indicator
- planning: thinking indicator; subtle bubble/animation
- working: active monitor; typing animation; green/blue activity indicator
- waiting: yellow indicator; paused visual
- reviewing: review/check icon; purple or blue status
- completed: green check; short success state
- failed: red alert; clear error indicator
- offline: gray appearance; inactive workstation

Animations must be subtle.

## 9. AGENT DETAIL PANEL

Clicking an agent must open a side panel.

Show: Agent name, Role, Department, Status, Current project, Current task, Task ID, Progress, Started at, Running duration, Current action, Last activity, Last message

Create tabs: Activity, Tasks, Logs, Files, Git

Phase 1 may use mock data for: Files, Git, Logs.
But Activity and Tasks should be based on actual local stored data.

## 10. LIVE ACTIVITY FEED

Create a real-time activity feed. Example:

```
22:40 Backend Engineer -> Running tests
22:41 QA Engineer -> Waiting for Backend
22:42 Architect -> Reviewing database schema
22:43 PM -> Assigning task to Frontend
22:44 Frontend -> Updating dashboard layout
```

Show: timestamp, agent, action, project, message, severity if relevant

Use Socket.IO.
Do not simulate real-time only inside frontend. Events must go through the backend.

## 11. EVENT SYSTEM

Create a generic agent event system. Core event types should include:

agent.connected, agent.disconnected, agent.status.changed, agent.activity, agent.task.assigned, agent.task.started, agent.task.progress, agent.task.completed, agent.task.failed, agent.message, system.info, system.warning, system.error

## 12. EVENT API

Create: POST /api/events

Example request:

```json
{
  "type": "agent.activity",
  "agentId": "04-backend-engineer",
  "project": "Sellway",
  "taskId": "SW-123",
  "status": "working",
  "action": "run_command",
  "message": "Running backend tests",
  "metadata": {
    "command": "npm test"
  }
}
```

Backend must:
1. validate event
2. store event
3. update agent state where necessary
4. update task state where necessary
5. broadcast event through Socket.IO
6. return accepted event

## 13. API ENDPOINTS

Implement at least:
- GET /api/health
- GET /api/agents
- GET /api/agents/:id
- PATCH /api/agents/:id/status
- GET /api/events
- POST /api/events
- GET /api/tasks
- POST /api/tasks
- PATCH /api/tasks/:id
- GET /api/projects

Use proper validation.

## 14. TASK MODEL

Task fields: id, title, description, project, assignedAgentId, status, priority, progress, createdAt, startedAt, completedAt, blockedBy, metadata

Task statuses: todo, assigned, planning, in_progress, waiting, review, completed, failed, cancelled

Priorities: low, normal, high, critical

## 15. DEVELOPER SIMULATOR

This is very important.

Create a simulator UI so we can test the office without real Claude agents.

Add a Developer Simulator panel. It must allow me to select: Agent, Project, Task, Status

Actions: Set Idle, Start Planning, Start Work, Set Waiting, Start Review, Complete, Fail, Set Offline

Also add: Send Activity — Fields: action, message

Example: Agent: Backend Engineer; Project: Sellway; Action: run_tests; Message: Running API tests; Click: Send Event

The entire UI should update instantly through backend + Socket.IO.
Do NOT directly mutate frontend state as the primary simulator mechanism.
Simulator should use the API.

## 16. DEMO MODE

Add optional Demo Mode. When enabled, every few seconds simulate realistic activity:
PM assigns task, Architect plans, Backend works, Frontend works, QA waits, QA reviews, Reviewer reviews, Product Auditor audits

But: Demo mode must be easy to turn off. Do not permanently overwrite user-generated state.

## 17. DATA SEED

Seed: 15 agents, 5 projects, several realistic tasks, sample historical activity

Example tasks:
- Sellway: Lost Goods API; Dashboard performance optimization; Campaign analytics
- Ishkun24: Vacancy posting workflow; Recruitment pipeline; Telegram bot integration
- ERP: Inventory architecture; Order management module; CRM integration
- Ana Market: Seller dashboard; Marketplace integration

## 18. REAL-TIME ARCHITECTURE

Target flow:

```
External Agent
   |
   v
POST /api/events
   |
   v
Event Service
   +--> Database
   +--> Agent State
   +--> Task State
   v
Socket.IO
   v
React frontend
   v
Virtual Office updates
```

The architecture must NOT depend on Claude specifically. Later any system should be able to send events.
Possible future producers: Claude Code, Telegram, GitHub Actions, Docker, Browser agent, OpenAI agent, Custom scripts, CI/CD, Server monitor

## 19. FUTURE CLAUDE INTEGRATION

DO NOT build the real integration now. But design for future event format like:

```json
{
  "source": "claude-code",
  "agentId": "04-backend-engineer",
  "project": "Sellway",
  "taskId": "SW-123",
  "event": "tool.executed",
  "tool": "terminal",
  "command": "npm test",
  "result": "success"
}
```

Future Claude actions may include: read_file, write_file, edit_file, search, run_command, git_status, git_diff, git_commit, test, build, browser, wait, error

## 20. RESPONSIVE UI

Primary target: Desktop 1440p / 1080p. Also support: Laptop, Tablet.
Mobile can show a simplified monitoring view.
Do not spend too much time on perfect mobile Phaser layout in Phase 1.

## 21. DESIGN

Use a premium dark operations-center aesthetic.
Background: graphite / near black. Panels: dark gray. Borders: subtle. Spacing: clean. Typography: Inter or similar. Cards: slightly rounded.
Avoid: excessive gradients; childish colors; game-like cartoon appearance; huge empty spaces; excessive animation; neon cyberpunk overload.
Dashboard should feel similar to: modern DevOps dashboard; AI control room; professional SaaS; operations center

## 22. EMPTY / ERROR / LOADING STATES

Implement proper: loading state, empty state, error state, disconnected socket state, backend unavailable state.
The UI must not silently fail.

## 23. SOCKET CONNECTION

Show frontend connection status: Connected, Reconnecting, Disconnected.
Automatically reconnect. Avoid duplicate listeners.

## 24. LOGGING

Backend should have structured logs. Log: API request errors, socket connection, socket disconnect, invalid event, database failure.
Avoid excessive console noise.

## 25. VALIDATION

Validate all API inputs. Use Zod if practical. Reject unknown agent IDs. Reject invalid statuses. Reject malformed event payloads.

## 26. SECURITY BASICS

Phase 1 is local only. Still:
- validate payloads
- add reasonable request-size limits
- do not execute arbitrary shell commands
- do not expose filesystem
- do not create terminal execution API
- do not create remote code execution capability

This is monitoring only.

## 27. TESTING

Create meaningful tests for: Agent status transition; Event validation; Event API; Task state update; Project filtering; Socket event propagation if practical; Agent detail rendering; Simulator actions.
Do not only write tests. Run them.

## 28. DOCUMENTATION

Create: README.md, docs/ARCHITECTURE.md, docs/EVENT_SYSTEM.md, docs/AGENT_STATE_MACHINE.md, docs/ROADMAP.md

README must explain: Requirements; Installation; Development; How to start frontend; How to start backend; How to start both; Local URLs; How simulator works; How events work

## 29. ROADMAP

ROADMAP should contain:
- Phase 1 — Virtual Office Monitoring MVP
- Phase 2 — Claude Code event integration
- Phase 3 — Agent-to-agent task handoff
- Phase 4 — Telegram Control Center
- Phase 5 — GitHub monitoring
- Phase 6 — Terminal/browser activity monitoring
- Phase 7 — Remote agent control
- Phase 8 — Authentication and teams
- Phase 9 — Cloud deployment
- Phase 10 — Multi-company SaaS

## 30. DEVELOPMENT WORKFLOW

FIRST: Inspect the current folder. Report: files that already exist; whether git exists; current repository state; detected Node version; npm version.

Then create: docs/IMPLEMENTATION_PLAN.md

The implementation plan must include: architecture; folder structure; dependencies; database model; Socket.IO flow; Phaser architecture; implementation phases; risks.

Then implement the project. DO NOT stop after the plan. Proceed directly to implementation unless there is a critical blocker.

## 31. IMPLEMENTATION ORDER

1. Repository inspection 2. Project scaffolding 3. Shared types 4. Database 5. Backend API 6. Event service 7. Socket.IO 8. Seed data 9. Frontend shell 10. Dashboard metrics 11. Agent cards 12. Phaser virtual office 13. Agent detail panel 14. Activity feed 15. Project filtering 16. Developer Simulator 17. Demo Mode 18. Tests 19. Documentation 20. Full run verification

## 32. VERIFICATION

Before saying the project is complete:
Run install. Run lint. Run typecheck. Run tests. Run backend. Run frontend. Verify health endpoint. Verify agents endpoint. Verify POST /api/events. Verify Socket.IO live update. Verify Simulator.

Verify changing Backend Engineer from idle -> working updates: dashboard metrics; agent visual; detail panel; activity feed.

Verify project filter works. Verify app restarts correctly. Fix issues before final report.

## 33. FINAL REPORT FORMAT

1. STATUS 2. WHAT WAS BUILT 3. PROJECT STRUCTURE 4. FRONTEND 5. BACKEND 6. DATABASE 7. REAL-TIME SYSTEM 8. VIRTUAL OFFICE 9. SIMULATOR 10. TEST RESULTS 11. HOW TO RUN 12. LOCAL URLS 13. KNOWN ISSUES 14. FILES CREATED 15. PHASE 2 RECOMMENDATION

Also explicitly state: Was anything committed? YES/NO; Was anything pushed? YES/NO; Was anything deployed? YES/NO. Expected answer right now: NO / NO / NO

## 34. IMPORTANT PRODUCT PRINCIPLE

Do not build this as a decorative dashboard. Build it as the foundation for a real AI Agent Operations Center.

Every major architectural decision should support this future flow:

```
Me
  |
Telegram / Web
  |
PM / Orchestrator
  |
15 AI Agents
  |
Claude Code / Terminal / GitHub / Browser / APIs
  |
Event System
  |
Virtual Office
  |
Real-time monitoring
```

START NOW. Inspect the current folder first, create the implementation plan, then implement Phase 1 completely.
