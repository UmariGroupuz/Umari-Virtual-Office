// Tasks tab (UX §7.3, REQ-082): tasks assigned to the agent, live; rows are not clickable in Phase 1.
import { TASK_STATUS_COLOR_KEY } from '@vo/shared';
import { COPY } from '../../copy';
import { EmptyState, InlineError, SkeletonRows } from '../../components/Feedback';
import { ProgressBar } from '../../components/ProgressBar';
import { PriorityLabel, TaskStatusChip } from '../../components/StatusChip';
import { ProjectTag } from '../../components/Tags';
import { useOffice } from '../../lib/runtime';
import { STATUS_VISUALS } from '../../lib/statusMeta';
import { projectName } from '../../store/selectors';
import type { AgentTasksView } from '../useAgentData';

export function TasksTab({ data }: { data: AgentTasksView }) {
  const projects = useOffice((s) => s.projects);

  if (data.status === 'loading' && data.tasks.length === 0) {
    return <SkeletonRows count={5} label={COPY.panel.tabs.tasks} />;
  }
  if (data.status === 'error' && data.tasks.length === 0) {
    return <InlineError title={COPY.panel.tasksError} detail={data.error} onRetry={data.retry} />;
  }
  if (data.tasks.length === 0) {
    return <EmptyState title={COPY.panel.tasksEmptyTitle} body={COPY.panel.tasksEmptyBody} />;
  }
  return (
    <ul aria-label={COPY.panel.tabs.tasks}>
      {data.tasks.map((task) => {
        const project = projectName(projects, task.project);
        return (
          <li key={task.id} className="flex flex-col gap-1.5 border-b border-border-subtle py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <TaskStatusChip status={task.status} />
              <span className="shrink-0 font-mono text-xs text-text-muted">{task.id}</span>
              <span className="min-w-0 truncate text-sm text-text-primary">{task.title}</span>
            </div>
            <div className="flex min-w-0 items-center gap-2">
              {project ? <ProjectTag name={project} /> : null}
              <PriorityLabel priority={task.priority} />
              <span className="flex-1" />
              <span className="w-16">
                <ProgressBar
                  value={task.progress}
                  fillClassName={STATUS_VISUALS[TASK_STATUS_COLOR_KEY[task.status]].fill}
                  label={`${task.id} progress`}
                />
              </span>
              <span className="vo-tabular w-9 text-right text-xs text-text-secondary">
                {task.progress}%
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
