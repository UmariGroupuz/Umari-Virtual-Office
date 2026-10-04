// All UI copy in one module (UX §15) so localization can swap it later (Q-1). Status, task status,
// priority and severity labels come from @vo/shared (ADR-025) and are not repeated here.
import { APP_NAME } from '@vo/shared';

const n = (value: number): string => value.toLocaleString('en-US');
/** "1 agent", "2 agents", "0 tasks" (QA-3). */
const count = (value: number, singular: string, plural: string): string =>
  `${n(value)} ${value === 1 ? singular : plural}`;

export const COPY = {
  appName: APP_NAME,
  skipToAgents: 'Skip to agents list',

  topBar: {
    demoBadge: 'DEMO',
    demoBadgeLabel: 'Demo mode is running',
    simulator: 'Simulator',
    simulatorLabel: 'Developer Simulator',
    agentsOnline: (online: number, total: number) => `${online}/${total} online`,
    agentsOnlineCompact: (online: number, total: number) => `${online}/${total}`,
    agentsOnlineLabel: (online: number, total: number) => `${online} of ${total} agents online`,
    moreMenu: 'More',
    systemStatusLabel: 'System status',
  },

  system: {
    checking: 'Checking…',
    operational: 'Operational',
    degraded: 'Degraded',
    unavailable: 'Backend unavailable',
    tooltipChecking: 'Checking the API and live updates…',
    tooltipOperational: 'Operational: API and live updates are healthy.',
    tooltipDegraded: 'Degraded: the API responds but live updates are interrupted.',
    tooltipUnavailable: 'Backend unavailable: the API at /api is not responding.',
  },

  connection: {
    connecting: 'Connecting…',
    connected: 'Connected',
    reconnecting: 'Reconnecting',
    disconnected: 'Disconnected',
    announce: (label: string) => `Live updates: ${label}`,
  },

  banners: {
    reconnecting: 'Live updates paused — reconnecting to the server…',
    disconnected: 'Disconnected from live updates. The data on screen may be out of date.',
    reconnect: 'Reconnect',
    reconnectPending: 'Reconnecting…',
    reconnected: 'Reconnected — data refreshed.',
    unavailable: (time: string) =>
      `Backend unavailable — showing last known data from ${time}. Actions are paused.`,
    retry: 'Retry',
    retryPending: 'Retrying…',
    retryingEvery: 'Retrying automatically every 5 s',
  },

  noData: {
    title: "Can't reach the AI Virtual Office server",
    body: "The backend isn't responding. Make sure it is running (npm run dev), then try again.",
    retry: 'Retry',
    retryPending: 'Retrying…',
    countdown: (seconds: number) => `Retrying automatically in ${seconds} s`,
  },

  projectSelector: {
    label: 'Project filter',
    clear: 'Clear project filter',
  },

  demo: {
    label: 'Demo mode',
    labelCompact: 'Demo',
    starting: 'Starting…',
    stopping: 'Stopping…',
    tooltip:
      'Simulates realistic team activity through the backend every few seconds. Demo changes are rolled back when you turn it off; your own changes are kept.',
    unavailable: 'Unavailable while the backend is offline',
    stopped: 'Demo mode stopped. Demo changes were rolled back.',
    restoredCounts: (agents: number, tasks: number) =>
      ` · ${count(agents, 'agent', 'agents')} and ${count(tasks, 'task', 'tasks')} restored`,
    startFailed: (message: string) => `Couldn't start demo mode. ${message}`,
    stopFailed: (message: string) => `Couldn't stop demo mode. ${message}`,
  },

  toasts: {
    region: 'Notifications',
    dismiss: 'Dismiss',
  },

  metrics: {
    label: 'Team metrics',
    agentsOnline: 'Agents Online',
    working: 'Working',
    planning: 'Planning',
    waiting: 'Waiting',
    reviewing: 'Reviewing',
    failed: 'Failed',
    activeTasks: 'Active Tasks',
    completedTasks: 'Completed Tasks',
    // Mobile-only short labels (UX §2.7).
    short: {
      agentsOnline: 'Online',
      reviewing: 'Review',
      activeTasks: 'Active',
      completedTasks: 'Done',
    },
  },

  office: {
    eyebrow: 'OFFICE',
    loading: 'Loading office…',
    loadFailed: 'Office view could not be loaded.',
    retry: 'Retry',
    legendLabel: 'Status legend',
    summary: (agents: number, rooms: number, parts: string[]) =>
      `Virtual office floor plan: ${agents} agents in ${rooms} rooms.${
        parts.length > 0 ? ` ${parts.join(', ')}.` : ''
      } Use the Agents list to inspect or open an agent.`,
    tooltipHint: 'Click to open details',
    mobileNote: 'Office view is available on screens 768 px and wider.',
    dismissNote: 'Dismiss note',
  },

  roster: {
    eyebrow: 'AGENTS',
    online: (count: number) => `· ${count} online`,
    noTask: 'No active task',
    noProject: 'No project',
    noAgentsOn: (project: string) => `No agents on ${project}`,
    cardLabel: (parts: {
      name: string;
      status: string;
      project: string | null;
      taskId: string | null;
      taskTitle: string | null;
      progress: number | null;
    }) => {
      let label = `${parts.name}, ${parts.status}`;
      if (parts.project) label += `, project ${parts.project}`;
      if (parts.taskId) {
        const title =
          parts.taskTitle && parts.taskTitle !== parts.taskId ? ` ${parts.taskTitle}` : '';
        label += `, task ${parts.taskId}${title}`;
      }
      if (parts.progress !== null) label += `, ${parts.progress} percent`;
      return `${label}. Open details.`;
    },
    loadError: "Couldn't load agents.",
  },

  panel: {
    close: 'Close agent details',
    back: 'Back',
    showing: (name: string) => `Showing ${name}`,
    fields: {
      currentProject: 'Current project',
      currentTask: 'Current task',
      taskId: 'Task ID',
      progress: 'Progress',
      startedAt: 'Started at',
      runningDuration: 'Running duration',
      currentAction: 'Current action',
      lastActivity: 'Last activity',
      lastMessage: 'Last message',
    },
    showMore: 'Show more',
    showLess: 'Show less',
    empty: '—',
    tabs: {
      label: 'Agent details',
      activity: 'Activity',
      tasks: 'Tasks',
      logs: 'Logs',
      files: 'Files',
      git: 'Git',
    },
    notFoundTitle: 'Agent not found',
    notFoundBody: (id: string) => `No agent with ID “${id}” exists.`,
    notFoundClose: 'Close',
    activityEmptyTitle: 'No activity yet',
    activityEmptyBody: 'Events from this agent will appear here in real time.',
    activityError: "Couldn't load activity.",
    loadOlder: 'Load older',
    loadingOlder: 'Loading…',
    beginning: 'Beginning of activity',
    tasksEmptyTitle: 'No tasks assigned',
    tasksEmptyBody: 'Tasks assigned to this agent will appear here.',
    tasksError: "Couldn't load tasks.",
    logsEmptyTitle: 'No log lines yet',
    logsEmptyBody: "Log lines are derived from this agent's events.",
    logsNotice: 'Derived from stored events — live log streaming arrives in Phase 2',
    sampleNotice: 'Sample data — not connected (Phase 1)',
    gitBranch: 'Branch',
    gitWorkingTree: 'Working tree',
    gitRecentCommits: 'Recent commits',
    gitTree: (modified: number, added: number, deleted: number) => {
      const parts = [`${modified} modified`, `${added} added`];
      if (deleted > 0) parts.push(`${deleted} deleted`);
      return parts.join(', ');
    },
    filesLabel: 'Changed files (sample)',
    changeKind: { M: 'Modified', A: 'Added', D: 'Deleted' } as const,
  },

  feed: {
    eyebrow: 'LIVE ACTIVITY',
    label: 'Live activity',
    hideDemo: 'Hide demo',
    severityLabel: 'Severity filter',
    severity: {
      all: 'All events',
      warnings: 'Warnings and errors',
      errors: 'Errors only',
    },
    filtered: (project: string) => `Filtered: ${project}`,
    showAll: 'Show all projects',
    today: 'Today',
    yesterday: 'Yesterday',
    system: 'System',
    demoTag: 'DEMO',
    warningPrefix: 'Warning:',
    errorPrefix: 'Error:',
    newEvents: (count: number) => `${n(count)} new ${count === 1 ? 'event' : 'events'}`,
    capped: (cap: number) =>
      `Showing the latest ${n(cap)} events. Open an agent for its full history.`,
    emptyAllTitle: 'No activity yet',
    emptyAllBody:
      'Events appear here in real time. Use the Developer Simulator or turn on Demo mode to generate some.',
    emptyProjectTitle: (project: string) => `No activity for ${project} yet`,
    emptyProjectBody: 'Events for this project will appear here in real time.',
    emptyFilteredTitle: 'No matching events',
    emptyFilteredBody: 'Adjust “Hide demo” or the severity filter.',
    resetFilters: 'Reset filters',
    error: "Couldn't load activity.",
    openAgent: (name: string) => `Open details for ${name}`,
  },

  eventLabels: {
    statusChanged: 'Status →',
    assigned: (id: string) => `Assigned ${id}`,
    started: (id: string) => `Started ${id}`,
    completed: (id: string) => `Completed ${id}`,
    failed: (id: string) => `Failed ${id}`,
    progress: (id: string, progress: number | null) =>
      progress === null ? `Progress ${id}` : `Progress ${id} · ${progress}%`,
    message: 'Message',
    connected: 'Connected',
    disconnected: 'Disconnected',
    info: 'Info',
    warning: 'Warning',
    error: 'Error',
    taskCreated: (id: string) => `Task created ${id}`,
    taskUpdated: (id: string) => `Task updated ${id}`,
  },

  simulator: {
    title: 'Developer Simulator',
    hint: 'Sends real events through the backend API',
    close: 'Close Developer Simulator',
    target: 'TARGET',
    status: 'STATUS',
    sendActivity: 'SEND ACTIVITY',
    agent: 'Agent',
    project: 'Project',
    task: 'Task',
    action: 'Action',
    severity: 'Severity',
    message: 'Message',
    agentPlaceholder: 'Select an agent…',
    none: 'None',
    taskNeedsProject: 'Select a project first',
    noTasksIn: (project: string) => `No tasks in ${project}`,
    actionPlaceholder: 'e.g. run_tests',
    messagePlaceholder: 'What is the agent doing?',
    sendEvent: 'Send Event',
    selectAgentHint: 'Select an agent to enable actions.',
    current: '(current)',
    illegalHint: (from: string) => `Not allowed from ${from} — the server will reject this`,
    counter: (length: number, max: number) => `${n(length)}/${n(max)}`,
    accepted: (name: string, status: string, time: string) =>
      `Accepted · ${name} → ${status} · ${time}`,
    eventSent: (action: string, time: string) => `Event sent · ${action} · ${time}`,
    noChange: (name: string, status: string) => `No change · ${name} is already ${status}`,
    allowedFrom: (from: string, buttons: string[]) =>
      `Allowed from ${from}: ${buttons.length > 0 ? buttons.join(', ') : 'none'}`,
    unreachable: "Can't reach the server. Check that the backend is running.",
    unavailable: 'Simulator is unavailable while the backend is offline.',
    livePaused: 'Live updates are paused — results will appear after reconnecting.',
    buttons: {
      idle: 'Set Idle',
      planning: 'Start Planning',
      working: 'Start Work',
      waiting: 'Set Waiting',
      reviewing: 'Start Review',
      completed: 'Complete',
      failed: 'Fail',
      offline: 'Set Offline',
    },
  },

  errors: {
    network: 'Network error',
  },

  mobile: {
    viewSwitch: 'View',
    agentsTab: (count: number | null) => (count === null ? 'Agents' : `Agents (${count})`),
    activityTab: 'Activity',
  },

  appError: {
    title: 'Something went wrong',
    body: 'The dashboard hit an unexpected error. Your data on the server is not affected.',
    retry: 'Retry',
    reload: 'Reload page',
  },

  notFoundPage: {
    title: 'Page not found',
    body: 'This address does not exist in the AI Virtual Office.',
    back: 'Go to the office',
  },
} as const;
