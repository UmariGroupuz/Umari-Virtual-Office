// Files and Git tabs: deterministic SAMPLE data, permanently labelled "Sample data — not connected (Phase 1)";
// non-interactive, no actions implying real operations (REQ-082).
import { useMemo } from 'react';
import { FlaskConical } from 'lucide-react';
import type { RoomId } from '@vo/shared';
import { COPY } from '../../copy';
import { Notice } from '../../components/Feedback';
import { sampleWorkspace } from '../../mocks/sampleWorkspace';

function useSample(agentId: string, roomId: RoomId) {
  return useMemo(() => sampleWorkspace(agentId, roomId), [agentId, roomId]);
}

export function FilesTab({ agentId, roomId }: { agentId: string; roomId: RoomId }) {
  const sample = useSample(agentId, roomId);
  return (
    <div className="flex flex-col gap-2">
      <Notice icon={FlaskConical}>{COPY.panel.sampleNotice}</Notice>
      <ul aria-label={COPY.panel.filesLabel} className="mt-1">
        {sample.files.map((file) => (
          <li
            key={file.path}
            className="flex items-center gap-2 border-b border-border-subtle py-2"
          >
            <span
              title={COPY.panel.changeKind[file.kind]}
              className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm border border-border-subtle bg-raised font-mono text-xs text-text-muted"
            >
              {file.kind}
            </span>
            <span className="sr-only">{COPY.panel.changeKind[file.kind]}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-primary">
              {file.path}
            </span>
            <span className="shrink-0 text-xs text-text-muted">{file.age}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function GitTab({ agentId, roomId }: { agentId: string; roomId: RoomId }) {
  const sample = useSample(agentId, roomId);
  return (
    <div className="flex flex-col gap-3">
      <Notice icon={FlaskConical}>{COPY.panel.sampleNotice}</Notice>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-xs font-medium text-text-muted">{COPY.panel.gitBranch}</dt>
        <dd className="min-w-0 truncate font-mono text-xs text-text-primary">{sample.branch}</dd>
        <dt className="text-xs font-medium text-text-muted">{COPY.panel.gitWorkingTree}</dt>
        <dd className="text-sm text-text-primary">
          {COPY.panel.gitTree(sample.counts.modified, sample.counts.added, sample.counts.deleted)}
        </dd>
      </dl>
      <div>
        <h4 className="mb-1 text-xs font-medium text-text-muted">{COPY.panel.gitRecentCommits}</h4>
        <ul>
          {sample.commits.map((commit) => (
            <li
              key={commit.hash}
              className="flex items-center gap-2 border-b border-border-subtle py-2"
            >
              <span className="shrink-0 font-mono text-xs text-text-muted">{commit.hash}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-text-primary">
                {commit.message}
              </span>
              <span className="shrink-0 text-xs text-text-muted">{commit.age}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
