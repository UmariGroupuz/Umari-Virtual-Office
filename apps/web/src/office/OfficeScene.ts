// The office scene (UX §5, ADR-012): static floor plan from `@vo/shared` OFFICE_ROOMS, 15 workstations placed by
// `deskId`, live updates from the bridge (diffed by `version`, never re-created), zoom-to-fit camera, LOD, hover,
// selection, dimming, room "N active" counts, reduced motion and pause.
import * as Phaser from 'phaser';
import type { Agent, RoomId } from '@vo/shared';
import type { OfficeBridge, OfficeViewState, KnownAgent } from './bridge';
import { planAgentUpdates } from './bridge';
import {
  ALL_DESKS,
  ROOMS,
  WORLD,
  WORLD_CENTER,
  computeViewport,
  countActiveByRoom,
  textResolution,
  worldRectToScreen,
  type Viewport,
} from './officeLayout';
import { isCanvasEvent, isPrimaryCanvasPress } from './inputGuard';
import { AgentDesk, type DeskChange, type DeskHost, type DeskUi } from './objects/AgentDesk';
import { ART, DEPT, FONT_FAMILY, UI, numberToCss } from './palette';
import { isDimmed } from './visuals';

export const OFFICE_SCENE_KEY = 'office';

export interface OfficeSceneData {
  bridge: OfficeBridge;
}

const ROOM_HEADER = Object.freeze({ barX: 12, barY: 10, barW: 3, barH: 12, labelX: 22, labelY: 9 });
const TILE = 24;

export class OfficeScene extends Phaser.Scene implements DeskHost {
  private bridge: OfficeBridge | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly desks = new Map<string, AgentDesk>(); // by deskId
  private readonly deskOfAgent = new Map<string, AgentDesk>(); // by agent id
  private readonly known = new Map<string, KnownAgent>();
  private readonly roomCounts = new Map<RoomId, Phaser.GameObjects.Text>();
  private readonly texts: Phaser.GameObjects.Text[] = [];
  private viewport: Viewport = computeViewport(WORLD.width, WORLD.height);
  private resolution = 1;
  private state: OfficeViewState | null = null;
  private hoveredAgentId: string | null = null;
  private hoverEmittedFor: string | null = null;
  private unknownDeskWarned = new Set<string>();
  private alive = false;

  constructor() {
    super({ key: OFFICE_SCENE_KEY });
  }

  init(data: Partial<OfficeSceneData>): void {
    if (data.bridge) this.bridge = data.bridge;
  }

  create(): void {
    this.alive = true;
    this.resolution = textResolution(window.devicePixelRatio, 1);
    this.cameras.main.setBackgroundColor(UI.bgSunken);
    this.cameras.main.setRoundPixels(true);
    this.drawFloorPlan();
    for (const desk of ALL_DESKS) {
      this.desks.set(desk.deskId, new AgentDesk(this, desk, this, this.deskUi(null)));
    }

    this.input.on(
      Phaser.Input.Events.POINTER_DOWN,
      (pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
        // QA-5: only presses that target the canvas itself (never DOM UI layered over it).
        if (over.length === 0 && isPrimaryCanvasPress(pointer, this.game.canvas)) {
          this.bridge?.clickBackground();
        }
      },
    );
    this.input.on(Phaser.Input.Events.GAME_OUT, () => this.setHovered(null));
    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.teardown);
    this.events.once(Phaser.Scenes.Events.DESTROY, this.teardown);

    this.applyViewport(this.scale.width, this.scale.height);
    if (this.bridge) this.attachBridge(this.bridge);
    this.refreshTextsWhenFontsLoad();
  }

  /** Swaps the bridge (never needed with the page-level bridge, kept for robustness). */
  attachBridge(bridge: OfficeBridge): void {
    this.unsubscribe?.();
    this.bridge = bridge;
    this.unsubscribe = bridge.subscribe((next) => this.sync(next, false));
    this.known.clear();
    this.sync(bridge.getState(), true);
  }

  // --- DeskHost --------------------------------------------------------------------------------------------

  textResolution(): number {
    return this.resolution;
  }

  registerText(text: Phaser.GameObjects.Text): void {
    this.texts.push(text);
  }

  deskPointerOver(desk: AgentDesk, pointer: Phaser.Input.Pointer): void {
    if (!isCanvasEvent(pointer, this.game.canvas)) return; // QA-5
    this.setHovered(desk.agentId);
  }

  deskPointerOut(desk: AgentDesk): void {
    if (this.hoveredAgentId === desk.agentId) this.setHovered(null);
  }

  deskPointerMove(desk: AgentDesk, pointer: Phaser.Input.Pointer): void {
    if (!isCanvasEvent(pointer, this.game.canvas)) return; // QA-5
    // Re-emit after a resize/scroll cleared the tooltip while the pointer stayed on the desk.
    if (desk.agentId !== null && this.hoverEmittedFor !== desk.agentId)
      this.setHovered(desk.agentId);
  }

  deskPointerDown(desk: AgentDesk, pointer: Phaser.Input.Pointer): void {
    // QA-5: a press on DOM UI that overlaps the canvas area must not select the desk underneath.
    if (!isPrimaryCanvasPress(pointer, this.game.canvas)) return;
    if (desk.agentId !== null) this.bridge?.selectAgent(desk.agentId);
  }

  /** Called by the game manager on page scroll: the HTML tooltip must hide (UX §5.6). */
  clearHoverInfo(): void {
    if (this.hoverEmittedFor !== null) {
      this.hoverEmittedFor = null;
      this.bridge?.hoverAgent(null);
    }
  }

  // --- state sync --------------------------------------------------------------------------------------------

  private sync(state: OfficeViewState, initial: boolean): void {
    if (!this.alive) return;
    const previous = this.state;
    this.state = state;

    if (!previous || previous.paused !== state.paused) {
      if (state.paused) this.tweens.pauseAll();
      else this.tweens.resumeAll();
    }

    const plan = planAgentUpdates(this.known, state.agents, initial);
    for (const id of plan.removedIds) {
      this.known.delete(id);
      const desk = this.deskOfAgent.get(id);
      if (desk) {
        this.deskOfAgent.delete(id);
        if (desk.agentId === id) desk.clearAgent();
      }
      if (this.hoveredAgentId === id) this.setHovered(null);
    }
    for (const update of plan.updates) {
      this.applyAgent(update.agent, update);
    }

    const uiChanged =
      !previous ||
      previous.projectFilter !== state.projectFilter ||
      previous.selectedAgentId !== state.selectedAgentId ||
      previous.reducedMotion !== state.reducedMotion ||
      previous.paused !== state.paused;
    if (uiChanged) this.refreshDeskUi();
    if (plan.updates.length > 0 || plan.removedIds.length > 0 || uiChanged) this.updateRoomCounts();
  }

  private applyAgent(agent: Agent, change: DeskChange): void {
    const desk = this.desks.get(agent.deskId) ?? null;
    const previousDesk = this.deskOfAgent.get(agent.id) ?? null;
    if (previousDesk && previousDesk !== desk) {
      previousDesk.clearAgent();
      this.deskOfAgent.delete(agent.id);
    }
    if (!desk) {
      // Unknown deskId: keep the agent out of the scene instead of crashing (layout adapter contract).
      if (!this.unknownDeskWarned.has(agent.deskId)) {
        this.unknownDeskWarned.add(agent.deskId);
        console.warn(`[office] Agent ${agent.id} has unknown deskId "${agent.deskId}"; not drawn.`);
      }
      this.known.set(agent.id, { version: agent.version, status: agent.status });
      return;
    }
    const occupant = desk.agentId;
    if (occupant !== null && occupant !== agent.id) {
      if (!this.unknownDeskWarned.has(`dup:${agent.deskId}`)) {
        this.unknownDeskWarned.add(`dup:${agent.deskId}`);
        console.warn(
          `[office] Desk "${agent.deskId}" is already used by ${occupant}; ${agent.id} not drawn.`,
        );
      }
      this.known.set(agent.id, { version: agent.version, status: agent.status });
      return;
    }
    this.deskOfAgent.set(agent.id, desk);
    this.known.set(agent.id, { version: agent.version, status: agent.status });
    desk.setAgent(
      agent,
      this.deskUi(agent),
      previousDesk === desk ? change : { statusChanged: false, liveCompleted: false },
    );
  }

  private deskUi(agent: Agent | null): DeskUi {
    const state = this.state;
    return {
      dimmed:
        agent !== null && state !== null && isDimmed(agent.currentProject, state.projectFilter),
      selected: agent !== null && state?.selectedAgentId === agent.id,
      hovered: agent !== null && this.hoveredAgentId === agent.id,
      reducedMotion: state?.reducedMotion ?? false,
      paused: state?.paused ?? false,
      lod: this.viewport.lod,
    };
  }

  private refreshDeskUi(): void {
    if (!this.state) return;
    for (const agent of this.state.agents) {
      const desk = this.deskOfAgent.get(agent.id);
      if (desk && desk.agentId === agent.id) desk.setUi(this.deskUi(agent));
    }
  }

  private updateRoomCounts(): void {
    if (!this.state) return;
    const counts = countActiveByRoom(this.state.agents, this.state.projectFilter);
    for (const [roomId, text] of this.roomCounts) {
      const n = counts[roomId];
      text.setVisible(n > 0);
      if (n > 0) {
        const label = `${n} active`;
        if (text.text !== label) text.setText(label);
      }
    }
  }

  // --- hover ---------------------------------------------------------------------------------------------------

  private setHovered(agentId: string | null): void {
    const changed = this.hoveredAgentId !== agentId;
    this.hoveredAgentId = agentId;
    if (changed) this.refreshDeskUi();
    if (agentId === null) {
      this.hoverEmittedFor = null;
      this.bridge?.hoverAgent(null);
      return;
    }
    const desk = this.deskOfAgent.get(agentId);
    if (!desk) return;
    const rect = worldRectToScreen(desk.layout, this.viewport);
    this.hoverEmittedFor = agentId;
    this.bridge?.hoverAgent({ agentId, ...rect });
  }

  // --- viewport ------------------------------------------------------------------------------------------------

  private readonly handleResize = (gameSize: Phaser.Structs.Size): void => {
    this.applyViewport(gameSize.width, gameSize.height);
  };

  private applyViewport(width: number, height: number): void {
    const previous = this.viewport;
    const viewport = computeViewport(width, height);
    this.viewport = viewport;
    const camera = this.cameras.main;
    camera.setSize(Math.max(1, width), Math.max(1, height));
    camera.setZoom(viewport.zoom);
    camera.centerOn(WORLD_CENTER.x, WORLD_CENTER.y);

    const resolution = textResolution(window.devicePixelRatio, viewport.zoom);
    if (resolution !== this.resolution) {
      this.resolution = resolution;
      for (const text of this.texts) if (text.active) text.setResolution(resolution);
    }
    if (previous.lod !== viewport.lod) this.refreshDeskUi();
    if (
      previous.zoom !== viewport.zoom ||
      previous.width !== viewport.width ||
      previous.height !== viewport.height
    ) {
      // UX §5.6 / API-C §10.2: the tooltip anchor is stale after a resize/zoom change.
      this.clearHoverInfo();
    }
  }

  // --- floor plan ------------------------------------------------------------------------------------------------

  private drawFloorPlan(): void {
    const floor = this.add.graphics();
    floor.fillStyle(UI.roomFloor, 1);
    for (const room of ROOMS) floor.fillRoundedRect(room.x, room.y, room.width, room.height, 6);

    // "Pixel-office" tile grid: 1-px lines every 24 px at 2.5 % white (UX §5.2).
    for (const room of ROOMS) {
      this.add
        .grid(room.x + 1, room.y + 1, room.width - 2, room.height - 2, TILE, TILE)
        .setOrigin(0, 0)
        .setOutlineStyle(ART.white, 0.025);
    }

    const frame = this.add.graphics();
    frame.lineStyle(1, UI.borderSubtle, 1);
    for (const room of ROOMS) {
      frame.strokeRoundedRect(room.x + 0.5, room.y + 0.5, room.width - 1, room.height - 1, 6);
      frame.fillStyle(DEPT[room.roomId], 1);
      frame.fillRect(
        room.x + ROOM_HEADER.barX,
        room.y + ROOM_HEADER.barY,
        ROOM_HEADER.barW,
        ROOM_HEADER.barH,
      );
    }

    for (const room of ROOMS) {
      const label = this.add.text(
        room.x + ROOM_HEADER.labelX,
        room.y + ROOM_HEADER.labelY,
        room.label.toUpperCase(),
        {
          fontFamily: FONT_FAMILY,
          fontSize: '13px',
          fontStyle: '600',
          color: numberToCss(UI.textSecondary),
          resolution: this.resolution,
        },
      );
      label.setLetterSpacing(1.2);
      this.texts.push(label);
      const count = this.add
        .text(room.x + room.width - 12, room.y + ROOM_HEADER.labelY + 1, '', {
          fontFamily: FONT_FAMILY,
          fontSize: '12px',
          fontStyle: '400',
          color: numberToCss(UI.textMuted),
          resolution: this.resolution,
        })
        .setOrigin(1, 0)
        .setVisible(false);
      this.texts.push(count);
      this.roomCounts.set(room.roomId, count);
    }
  }

  /** Canvas text is rasterized once; re-measure after Inter (loaded by the shell) becomes available. */
  private refreshTextsWhenFontsLoad(): void {
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    if (!fonts) return;
    const refresh = () => {
      if (!this.alive) return;
      for (const text of this.texts) if (text.active) text.style.update(true);
      for (const desk of this.desks.values()) desk.refreshText();
    };
    Promise.all([
      fonts.load(`600 15px ${FONT_FAMILY}`),
      fonts.load(`600 12px ${FONT_FAMILY}`),
      fonts.load(`400 12px ${FONT_FAMILY}`),
    ])
      .then(refresh)
      .catch(() => undefined);
    void fonts.ready.then(refresh).catch(() => undefined);
  }

  private readonly teardown = (): void => {
    if (!this.alive) return;
    this.alive = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize);
    for (const desk of this.desks.values()) desk.destroy();
    this.desks.clear();
    this.deskOfAgent.clear();
    this.known.clear();
    this.roomCounts.clear();
    this.texts.length = 0;
    if (this.hoverEmittedFor !== null) this.bridge?.hoverAgent(null);
    this.hoverEmittedFor = null;
    this.hoveredAgentId = null;
    this.state = null;
  };
}
