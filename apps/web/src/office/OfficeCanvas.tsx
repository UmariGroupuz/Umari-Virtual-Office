// The only seam between the web shell and the Phaser office (API_CONTRACTS §10.2, ADR-025). The shell lazy-loads
// this module; it suspends (React `use`) until Phaser is loaded so the shell's Suspense placeholder stays up, then
// renders one full-size div that the single game (gameManager) fills. Props flow into the internal bridge.
import { use, useEffect, useRef, type CSSProperties } from 'react';
import { UI_COLORS, type Agent } from '@vo/shared';
import {
  canRenderOffice,
  getOfficeBridge,
  loadOfficeRuntime,
  mountOffice,
  unmountOffice,
} from './gameManager';

/** Desk slot rectangle in CSS pixels relative to the OfficeCanvas root element's top-left corner. */
export interface OfficeHoverInfo {
  agentId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OfficeCanvasProps {
  agents: readonly Agent[]; // all 15 (store order irrelevant; placed by deskId)
  projectFilter: string | null; // project id; agents with currentProject !== filter are dimmed (alpha .40 / offline .25)
  selectedAgentId: string | null; // selection ring
  reducedMotion: boolean; // true → no tweens (UX §5.4 "Reduced motion" column)
  paused: boolean; // true while backend unavailable → tweens.pauseAll()
  onAgentSelect: (agentId: string) => void;
  onBackgroundClick: () => void; // pointerdown on empty floor (closes the detail panel)
  onAgentHover: (hover: OfficeHoverInfo | null) => void; // null on leave, resize, zoom change
  className?: string;
}

const ROOT_STYLE: CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '100%',
  overflow: 'hidden',
};

const ERROR_STYLE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  margin: 0,
  fontSize: 13,
  color: UI_COLORS.textMuted,
};

export default function OfficeCanvas({
  agents,
  projectFilter,
  selectedAgentId,
  reducedMotion,
  paused,
  onAgentSelect,
  onBackgroundClick,
  onAgentHover,
  className,
}: OfficeCanvasProps) {
  const supported = canRenderOffice();
  // Suspends until Phaser is loaded (stable module-level promise); never loads Phaser where it cannot run.
  const ready = supported ? use(loadOfficeRuntime()) : false;
  const hostRef = useRef<HTMLDivElement>(null);
  const bridge = getOfficeBridge();

  useEffect(() => {
    bridge.setState({ agents, projectFilter, selectedAgentId, reducedMotion, paused });
  }, [bridge, agents, projectFilter, selectedAgentId, reducedMotion, paused]);

  const callbacksRef = useRef({ onAgentSelect, onBackgroundClick, onAgentHover });
  useEffect(() => {
    callbacksRef.current = { onAgentSelect, onBackgroundClick, onAgentHover };
  });

  useEffect(() => {
    bridge.setCallbacks({
      onAgentSelect: (agentId) => callbacksRef.current.onAgentSelect(agentId),
      onBackgroundClick: () => callbacksRef.current.onBackgroundClick(),
      onAgentHover: (hover) => callbacksRef.current.onAgentHover(hover),
    });
    return () => bridge.setCallbacks(null);
  }, [bridge]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !ready) return;
    mountOffice(host);
    return () => unmountOffice(host);
  }, [ready]);

  return (
    <div ref={hostRef} className={className} style={ROOT_STYLE} data-testid="office-canvas">
      {supported && !ready ? <p style={ERROR_STYLE}>Office view could not be loaded.</p> : null}
    </div>
  );
}
