// One workstation (UX §5.3–§5.6): plate → glow → monitor → screen → desk → character → chair → badge/bubble →
// name label → status chip, plus the slot hit zone. Decisions come from the pure `visuals.ts`; this class only
// draws them and owns the tweens of its current status (created on entering a status, destroyed on leaving).
import * as Phaser from 'phaser';
import type { Agent } from '@vo/shared';
import type { Lod, ResolvedDesk } from '../officeLayout';
import { SLOT } from '../officeLayout';
import { ART, DEPT, FONT_FAMILY, SCREEN, STATUS, UI, numberToCss } from '../palette';
import { drawChair, drawCharacter, drawDesk, drawGlyph, drawMonitor } from '../textures';
import {
  COMPLETED_BADGE,
  COMPLETED_TINT,
  GLOW_ALPHA,
  ellipsize,
  getVisualSpec,
  type AnimationKey,
  type PlateKind,
  type VisualSpec,
} from '../visuals';

type Container = Phaser.GameObjects.Container;
type Graphics = Phaser.GameObjects.Graphics;
type Rectangle = Phaser.GameObjects.Rectangle;
type Text = Phaser.GameObjects.Text;
type AnyTween = Phaser.Tweens.Tween | Phaser.Tweens.TweenChain;

/** UI state of a desk that does not come from the agent row. */
export interface DeskUi {
  dimmed: boolean;
  selected: boolean;
  hovered: boolean;
  reducedMotion: boolean;
  /** Backend unavailable: the tween manager is paused, so changes are applied without transitions. */
  paused: boolean;
  lod: Lod;
}

/** How an agent update relates to what this desk showed before (from `planAgentUpdates`). */
export interface DeskChange {
  statusChanged: boolean;
  liveCompleted: boolean;
}

export interface DeskHost {
  textResolution(): number;
  registerText(text: Text): void;
  /** The host decides whether the pointer really targets the canvas (QA-5, `inputGuard.ts`). */
  deskPointerOver(desk: AgentDesk, pointer: Phaser.Input.Pointer): void;
  deskPointerOut(desk: AgentDesk): void;
  deskPointerMove(desk: AgentDesk, pointer: Phaser.Input.Pointer): void;
  deskPointerDown(desk: AgentDesk, pointer: Phaser.Input.Pointer): void;
}

const NO_CHANGE: DeskChange = Object.freeze({ statusChanged: false, liveCompleted: false });
const BAR_COUNT = 3;
const BAR_HEIGHT = 3;
const BAR_X = 6;
const BAR_Y = [8, 16, 24] as const;
const GLOW_PAD = 8;
const VACANT_ALPHA = 0.5;
const FADE_OUT_MS = 120;
const FADE_IN_MS = 180;
/** Thought-bubble tail circles in slot coords: (80, 108) r 3 and (76, 113) r 2. */
const BUBBLE_TAIL: readonly (readonly [number, number, number])[] = [
  [80, 108, 3],
  [76, 113, 2],
];

/** Slot hit test: the whole 116 × 200 slot rect (UX §5.3). */
function containsPoint(area: Phaser.Geom.Rectangle, x: number, y: number): boolean {
  return Phaser.Geom.Rectangle.Contains(area, x, y);
}

function snapWidth(value: number): number {
  return Math.max(6, Math.round(value / 6) * 6);
}

function randomTypingWidth(): number {
  return snapWidth(20 + Math.random() * 32);
}

export class AgentDesk {
  readonly layout: ResolvedDesk;
  readonly root: Container;

  private readonly scene: Phaser.Scene;
  private readonly plate: Graphics;
  private readonly body: Container;
  private readonly backLayer: Container;
  private readonly glow: Graphics;
  private readonly screenLayer: Container;
  private readonly screenFill: Graphics;
  private readonly bars: Rectangle[] = [];
  private readonly scanLine: Rectangle;
  private readonly screenCheck: Graphics;
  private readonly screenTint: Rectangle;
  private readonly character: Graphics;
  private readonly frontLayer: Container;
  private readonly outline: Graphics;
  private readonly ring: Graphics;
  private readonly badge: Container;
  private readonly badgeG: Graphics;
  private readonly bubble: Container;
  private readonly dots: Phaser.GameObjects.Arc[] = [];
  private readonly nameLabel: Text;
  private readonly chip: Container;
  private readonly chipG: Graphics;
  private readonly chipLabel: Text;
  private readonly zone: Phaser.GameObjects.Zone;

  private agent: Agent | null = null;
  private ui: DeskUi;
  private spec: VisualSpec | null = null;
  private appliedStatusKey: string | null = null;
  private appliedLod: Lod | null = null;
  private appliedChipKey: string | null = null;
  private appliedPlate: PlateKind = 'none';
  private appliedName: string | null = null;
  private targetAlpha = 1;
  private loops: AnyTween[] = [];
  private fadeTween: AnyTween | null = null;
  private alphaTween: AnyTween | null = null;

  constructor(scene: Phaser.Scene, layout: ResolvedDesk, host: DeskHost, ui: DeskUi) {
    this.scene = scene;
    this.layout = layout;
    this.ui = ui;
    const add = scene.add;
    const { screen, badge } = SLOT;

    this.root = add.container(layout.x, layout.y);
    this.plate = add.graphics();
    this.body = add.container(0, 0);

    // Glow (behind the monitor).
    this.backLayer = add.container(0, 0);
    this.glow = add.graphics();
    this.glow.fillStyle(ART.white, 1); // redrawn per status
    this.backLayer.add(this.glow);

    const monitorG = add.graphics();
    drawMonitor(monitorG);

    // Screen content (inside the bezel).
    this.screenLayer = add.container(0, 0);
    this.screenFill = add.graphics();
    this.screenLayer.add(this.screenFill);
    for (let i = 0; i < BAR_COUNT; i += 1) {
      const bar = add
        .rectangle(screen.x + BAR_X, screen.y + (BAR_Y[i] ?? 0), 1, BAR_HEIGHT, ART.white, 1)
        .setOrigin(0, 0)
        .setVisible(false);
      this.bars.push(bar);
      this.screenLayer.add(bar);
    }
    this.scanLine = add
      .rectangle(screen.x, screen.y + screen.height / 2, screen.width, 1, ART.white, 1)
      .setOrigin(0, 0)
      .setVisible(false);
    this.screenCheck = add.graphics();
    this.screenTint = add
      .rectangle(screen.x, screen.y, screen.width, screen.height, ART.white, 1)
      .setOrigin(0, 0)
      .setVisible(false);
    this.screenLayer.add([this.scanLine, this.screenCheck, this.screenTint]);

    const deskG = add.graphics();
    drawDesk(deskG);
    this.character = add.graphics();
    const chairG = add.graphics();
    drawChair(chairG);

    // Badges, bubble, outline (in front of the character).
    this.frontLayer = add.container(0, 0);
    this.outline = add.graphics();
    this.ring = add.graphics({ x: badge.x, y: badge.y });
    this.badgeG = add.graphics();
    this.badge = add.container(badge.x, badge.y, [this.badgeG]).setVisible(false);
    this.bubble = this.createBubble();
    this.frontLayer.add([this.outline, this.ring, this.badge, this.bubble]);

    this.nameLabel = add
      .text(SLOT.centerX, SLOT.nameY, '', {
        fontFamily: FONT_FAMILY,
        fontSize: '15px',
        fontStyle: '600',
        color: numberToCss(UI.textPrimary),
        resolution: host.textResolution(),
      })
      .setOrigin(0.5, 0.5);
    host.registerText(this.nameLabel);

    this.chipG = add.graphics();
    this.chipLabel = add
      .text(0, 0, '', {
        fontFamily: FONT_FAMILY,
        fontSize: '12px',
        fontStyle: '600',
        color: numberToCss(UI.textSecondary),
        resolution: host.textResolution(),
      })
      .setOrigin(0, 0.5);
    host.registerText(this.chipLabel);
    this.chip = add.container(SLOT.centerX, SLOT.chipY, [this.chipG, this.chipLabel]);

    this.body.add([
      this.backLayer,
      monitorG,
      this.screenLayer,
      deskG,
      this.character,
      chairG,
      this.frontLayer,
      this.nameLabel,
      this.chip,
    ]);

    this.zone = add.zone(0, 0, SLOT.width, SLOT.height).setOrigin(0, 0);
    this.zone.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(0, 0, SLOT.width, SLOT.height),
      hitAreaCallback: containsPoint,
      useHandCursor: true,
    });
    this.zone.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, (pointer: Phaser.Input.Pointer) =>
      host.deskPointerOver(this, pointer),
    );
    this.zone.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, () => host.deskPointerOut(this));
    this.zone.on(Phaser.Input.Events.GAMEOBJECT_POINTER_MOVE, (pointer: Phaser.Input.Pointer) =>
      host.deskPointerMove(this, pointer),
    );
    this.zone.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, (pointer: Phaser.Input.Pointer) =>
      host.deskPointerDown(this, pointer),
    );

    this.root.add([this.plate, this.body, this.zone]);
    this.renderVacant();
  }

  get agentId(): string | null {
    return this.agent?.id ?? null;
  }

  /** Binds (or updates) the agent shown at this desk. */
  setAgent(agent: Agent, ui: DeskUi, change: DeskChange = NO_CHANGE): void {
    this.agent = agent;
    this.ui = ui;
    this.render(change);
  }

  /** Updates UI-only state (filter, selection, hover, LOD, reduced motion, paused). */
  setUi(ui: DeskUi): void {
    const u = this.ui;
    if (
      u.dimmed === ui.dimmed &&
      u.selected === ui.selected &&
      u.hovered === ui.hovered &&
      u.reducedMotion === ui.reducedMotion &&
      u.paused === ui.paused &&
      u.lod === ui.lod
    ) {
      return;
    }
    this.ui = ui;
    if (this.agent) this.render(NO_CHANGE);
  }

  /** Removes the agent (it disappeared from the list); the desk stays as vacant furniture. */
  clearAgent(): void {
    this.agent = null;
    this.renderVacant();
  }

  /** Re-measures the chip after a font load. */
  refreshText(): void {
    this.appliedChipKey = null;
    if (this.spec && this.agent) this.drawChip(this.spec);
  }

  destroy(): void {
    this.killLoops();
    this.stopTween(this.fadeTween);
    this.stopTween(this.alphaTween);
    this.fadeTween = null;
    this.alphaTween = null;
    this.root.destroy();
  }

  // ---------------------------------------------------------------------------------------------------------

  private render(change: DeskChange): void {
    const agent = this.agent;
    if (!agent) return;
    const ui = this.ui;
    const animate = !ui.reducedMotion && !ui.paused;
    const spec = getVisualSpec({
      status: agent.status,
      dimmed: ui.dimmed,
      selected: ui.selected,
      hovered: ui.hovered,
      recentlyCompleted: change.liveCompleted && animate,
      entering: change.statusChanged && animate,
      reducedMotion: ui.reducedMotion,
      lod: ui.lod,
    });
    const previous = this.spec;
    this.spec = spec;

    this.zone.setInteractive(); // re-enables after a vacant period (keeps the original hit area)
    this.nameLabel.setVisible(true);
    this.chip.setVisible(true);
    const name = ellipsize(agent.shortRole);
    if (name !== this.appliedName) {
      this.appliedName = name;
      this.nameLabel.setText(name);
    }

    const statusKey = `${agent.status}|${agent.roomId}|${ui.reducedMotion ? 'rm' : 'm'}`;
    if (statusKey !== this.appliedStatusKey) {
      const crossfade = animate && change.statusChanged && previous !== null;
      this.appliedStatusKey = statusKey;
      if (crossfade) this.crossfadeTo(spec);
      else this.applyStatus(spec);
    } else if (ui.lod !== this.appliedLod) {
      this.drawChip(spec);
    }

    if (spec.plate !== this.appliedPlate) this.drawPlate(spec.plate);
    this.setBodyAlpha(
      spec.alpha,
      animate,
      previous?.status === 'offline' || agent.status === 'offline',
    );
  }

  private renderVacant(): void {
    this.killLoops();
    this.stopTween(this.fadeTween);
    this.fadeTween = null;
    this.spec = null;
    this.appliedStatusKey = null;
    this.appliedChipKey = null;
    this.appliedName = null;
    this.appliedLod = null;
    this.zone.disableInteractive();
    this.glow.clear();
    this.screenFill.clear().fillStyle(SCREEN.offline, 1);
    const { screen } = SLOT;
    this.screenFill.fillRect(screen.x, screen.y, screen.width, screen.height);
    for (const bar of this.bars) bar.setVisible(false);
    this.scanLine.setVisible(false);
    this.screenCheck.clear();
    this.screenTint.setVisible(false);
    this.character.clear();
    this.outline.clear();
    this.ring.clear();
    this.badge.setVisible(false);
    this.bubble.setVisible(false);
    this.nameLabel.setVisible(false);
    this.chip.setVisible(false);
    this.drawPlate('none');
    this.backLayer.setAlpha(1);
    this.screenLayer.setAlpha(1);
    this.frontLayer.setAlpha(1);
    this.setBodyAlpha(VACANT_ALPHA, false, false);
  }

  private crossfadeTo(spec: VisualSpec): void {
    this.killLoops();
    this.stopTween(this.fadeTween);
    const layers = [this.backLayer, this.screenLayer, this.frontLayer];
    this.fadeTween = this.scene.tweens.add({
      targets: layers,
      alpha: 0,
      duration: FADE_OUT_MS,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        this.drawStatus(spec);
        this.startAnimations(spec);
        this.fadeTween = this.scene.tweens.add({
          targets: layers,
          alpha: 1,
          duration: FADE_IN_MS,
          ease: 'Cubic.easeOut',
          onComplete: () => {
            this.fadeTween = null;
          },
        });
      },
    });
  }

  private applyStatus(spec: VisualSpec): void {
    this.killLoops();
    this.stopTween(this.fadeTween);
    this.fadeTween = null;
    this.backLayer.setAlpha(1);
    this.screenLayer.setAlpha(1);
    this.frontLayer.setAlpha(1);
    this.drawStatus(spec);
    this.startAnimations(spec);
  }

  /** Draws the resting (settled) state of a status. Animations then move from/around it. */
  private drawStatus(spec: VisualSpec): void {
    const { screen, monitor } = SLOT;

    this.glow.clear();
    if (spec.glow) {
      this.glow.fillStyle(spec.glow.color, 1);
      this.glow.fillRoundedRect(
        monitor.x - GLOW_PAD,
        monitor.y - GLOW_PAD,
        monitor.width + GLOW_PAD * 2,
        monitor.height + GLOW_PAD * 2,
        6,
      );
      this.glow.setAlpha(spec.glow.alpha);
    }

    const s = spec.screen;
    this.screenFill.clear().fillStyle(s.fill, 1);
    this.screenFill.fillRect(screen.x, screen.y, screen.width, screen.height);
    this.bars.forEach((bar, i) => {
      const width = s.barWidths[i];
      if (i < s.barCount && width !== undefined) {
        bar.setFillStyle(s.barColor, s.barAlpha).setVisible(true);
        bar.scaleX = width;
      } else {
        bar.setVisible(false);
      }
    });
    if (spec.scanLine) {
      this.scanLine
        .setFillStyle(spec.scanLine.color, spec.scanLine.alpha)
        .setVisible(true)
        .setY(screen.y + screen.height / 2);
    } else {
      this.scanLine.setVisible(false);
    }
    this.screenCheck.clear();
    if (s.check) {
      drawGlyph(
        this.screenCheck,
        'check',
        screen.x + screen.width / 2,
        screen.y + screen.height / 2,
        14,
        s.check.color,
        s.check.alpha,
      );
    }
    this.screenTint
      .setVisible(s.tintAlpha > 0)
      .setFillStyle(s.tintColor, 1)
      .setAlpha(s.tintAlpha);

    const agent = this.agent;
    const c = spec.character;
    this.character.clear();
    if (agent) {
      const torso = c.torso === 'department' ? DEPT[agent.roomId] : c.torso;
      drawCharacter(this.character, torso, c.torsoAlpha, c.head, c.headStroke);
    }

    this.outline.clear();
    if (spec.outline) {
      this.drawOutline(spec.outline.color);
      this.outline.setAlpha(spec.outline.alpha);
    }
    this.ring.clear();

    this.badgeG.clear();
    if (spec.badge) {
      this.badgeG.fillStyle(spec.badge.fill, 1);
      this.badgeG.fillCircle(0, 0, SLOT.badge.radius);
      drawGlyph(this.badgeG, spec.badge.glyph, 0, 0, 10, spec.badge.glyphColor, 1);
      this.badge.setVisible(true).setScale(spec.badge.scale).setAlpha(1);
    } else {
      this.badge.setVisible(false);
    }

    if (spec.bubble) {
      this.bubble.setVisible(true).setScale(1);
      for (const dot of this.dots) dot.setAlpha(spec.bubble.dotsAlpha);
    } else {
      this.bubble.setVisible(false);
    }

    this.drawChip(spec);
  }

  private drawOutline(color: number): void {
    this.outline.lineStyle(1, color, 1);
    this.outline.strokeRoundedRect(0.5, 0.5, SLOT.width - 1, SLOT.height - 1, 6);
  }

  private drawChip(spec: VisualSpec): void {
    const chip = spec.chip;
    const key = `${chip.lod}|${chip.label}`;
    this.appliedLod = chip.lod;
    if (key === this.appliedChipKey) return;
    this.appliedChipKey = key;
    const g = this.chipG;
    g.clear();
    if (chip.lod === 'compact') {
      this.chipLabel.setVisible(false);
      g.fillStyle(chip.tint, 1);
      g.fillCircle(0, 0, 10);
      g.lineStyle(1, chip.color, 0.4);
      g.strokeCircle(0, 0, 9.5);
      drawGlyph(g, chip.glyph, 0, 0, 10, chip.color, 1);
      return;
    }
    this.chipLabel.setText(chip.label).setColor(numberToCss(chip.color)).setVisible(true);
    const width = Math.max(72, Math.ceil(8 + 10 + 4 + this.chipLabel.width + 8));
    const left = -width / 2;
    g.fillStyle(chip.tint, 1);
    g.fillRoundedRect(left, -10, width, 20, 10);
    g.lineStyle(1, chip.color, 0.4);
    g.strokeRoundedRect(left + 0.5, -9.5, width - 1, 19, 9.5);
    drawGlyph(g, chip.glyph, left + 8 + 5, 0, 10, chip.color, 1);
    this.chipLabel.setPosition(Math.round(left + 8 + 10 + 4), 0);
  }

  private drawPlate(kind: PlateKind): void {
    this.appliedPlate = kind;
    const g = this.plate;
    g.clear();
    if (kind === 'hover') {
      g.fillStyle(ART.white, 0.04);
      g.fillRoundedRect(2, 2, SLOT.width - 4, SLOT.height - 4, 6);
      g.lineStyle(1, UI.borderStrong, 1);
      g.strokeRoundedRect(2.5, 2.5, SLOT.width - 5, SLOT.height - 5, 6);
    } else if (kind === 'selected') {
      g.fillStyle(UI.accent, 0.08);
      g.fillRoundedRect(2, 2, SLOT.width - 4, SLOT.height - 4, 6);
      g.lineStyle(2, UI.accent, 1);
      g.strokeRoundedRect(3, 3, SLOT.width - 6, SLOT.height - 6, 6);
    }
  }

  private setBodyAlpha(target: number, animate: boolean, offlineChange: boolean): void {
    if (target === this.targetAlpha) return; // already there, or a tween is heading there
    this.targetAlpha = target;
    this.stopTween(this.alphaTween);
    this.alphaTween = null;
    if (!animate) {
      this.body.setAlpha(target);
      return;
    }
    this.alphaTween = this.scene.tweens.add({
      targets: this.body,
      alpha: target,
      duration: offlineChange ? 300 : 200,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        this.alphaTween = null;
      },
    });
  }

  // --- animations (UX §5.4) --------------------------------------------------------------------------------

  private startAnimations(spec: VisualSpec): void {
    for (const key of spec.animations) this.startAnimation(key);
  }

  private startAnimation(key: AnimationKey): void {
    const tweens = this.scene.tweens;
    const { screen } = SLOT;
    switch (key) {
      case 'bubbleIn':
        this.bubble.setScale(0.8);
        this.loops.push(
          tweens.add({ targets: this.bubble, scale: 1, duration: 160, ease: 'Cubic.easeOut' }),
        );
        return;
      case 'thinkingDots':
        this.dots.forEach((dot, i) => {
          dot.setAlpha(0.25);
          this.loops.push(
            tweens.add({
              targets: dot,
              alpha: { from: 0.25, to: 1 },
              duration: 400,
              ease: 'Sine.easeInOut',
              yoyo: true,
              repeat: -1,
              repeatDelay: 400,
              delay: i * 200,
            }),
          );
        });
        return;
      case 'glowPulse':
        this.glow.setAlpha(GLOW_ALPHA.min);
        this.loops.push(
          tweens.add({
            targets: this.glow,
            alpha: { from: GLOW_ALPHA.min, to: GLOW_ALPHA.max },
            duration: 1200,
            ease: 'Sine.easeInOut',
            yoyo: true,
            repeat: -1,
          }),
        );
        return;
      case 'typing':
        this.bars.forEach((bar, i) => {
          if (!bar.visible) return;
          const state = { target: randomTypingWidth() };
          bar.scaleX = 6;
          this.loops.push(
            tweens.addCounter({
              from: 0,
              to: 1,
              duration: 700,
              ease: 'Stepped',
              easeParams: [6],
              repeat: -1,
              repeatDelay: 300,
              delay: i * 250,
              onUpdate: (tween: Phaser.Tweens.Tween) => {
                const v = tween.getValue() ?? 0;
                bar.scaleX = snapWidth(6 + (state.target - 6) * v);
              },
              onRepeat: () => {
                state.target = randomTypingWidth();
              },
            }),
          );
        });
        return;
      case 'badgeIn':
        this.badge.setScale(0.6);
        this.loops.push(
          tweens.add({ targets: this.badge, scale: 1, duration: 200, ease: 'Back.easeOut' }),
        );
        return;
      case 'scanLine':
        this.scanLine.setY(screen.y + 4);
        this.loops.push(
          tweens.add({
            targets: this.scanLine,
            y: { from: screen.y + 4, to: screen.y + screen.height - 5 },
            duration: 1800,
            ease: 'Sine.easeInOut',
            yoyo: true,
            repeat: -1,
          }),
        );
        return;
      case 'completedPop':
        this.startCompletedPop();
        return;
      case 'failedPulse':
        this.loops.push(
          tweens.add({
            targets: this.badge,
            alpha: { from: 1, to: 0.6 },
            scale: { from: 1, to: 1.08 },
            duration: 1000,
            ease: 'Sine.easeInOut',
            yoyo: true,
            repeat: -1,
          }),
        );
        return;
    }
  }

  /** Live transition into completed: pop, ring, screen flash, slot outline, then settle at t = 3000. */
  private startCompletedPop(): void {
    const tweens = this.scene.tweens;
    const completed = this.spec?.chip.color ?? UI.textPrimary;
    this.badge.setScale(0);
    this.loops.push(
      tweens.chain({
        targets: this.badge,
        tweens: [
          { scale: COMPLETED_BADGE.pop, duration: 200, ease: 'Back.easeOut' },
          { scale: 1, duration: 120, ease: 'Sine.easeOut' },
          {
            scale: COMPLETED_BADGE.settled,
            duration: 200,
            delay: 3000 - 320,
            ease: 'Sine.easeInOut',
          },
        ],
      }),
    );
    const ring = this.ring;
    this.loops.push(
      tweens.addCounter({
        from: 0,
        to: 1,
        duration: 600,
        ease: 'Cubic.easeOut',
        onUpdate: (tween: Phaser.Tweens.Tween) => {
          const v = tween.getValue() ?? 1;
          ring.clear();
          ring.lineStyle(1.5, completed, 0.6 * (1 - v));
          ring.strokeCircle(0, 0, 10 + 18 * v);
        },
        onComplete: () => {
          ring.clear();
        },
      }),
    );
    this.screenTint.setVisible(true).setAlpha(COMPLETED_TINT.from);
    this.loops.push(
      tweens.add({
        targets: this.screenTint,
        alpha: COMPLETED_TINT.settled,
        duration: 600,
        ease: 'Cubic.easeOut',
      }),
    );
    this.outline.clear();
    this.drawOutline(completed);
    this.outline.setAlpha(0.6);
    this.loops.push(
      tweens.add({
        targets: this.outline,
        alpha: 0,
        duration: 3000,
        ease: 'Sine.easeOut',
        onComplete: () => {
          this.outline.clear();
        },
      }),
    );
  }

  private killLoops(): void {
    for (const tween of this.loops) this.stopTween(tween);
    this.loops.length = 0;
    this.ring.clear();
  }

  private stopTween(tween: AnyTween | null): void {
    if (tween && !tween.isDestroyed()) tween.stop();
  }

  /** Planning thought bubble (UX §5.4): 30 × 18 r 9 at (84, 92), tail circles toward the character, 3 dots. */
  private createBubble(): Container {
    const b = SLOT.bubble;
    const add = this.scene.add;
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const color = STATUS.planning.color;
    const g = add.graphics();
    g.fillStyle(UI.raisedHover, 1);
    g.lineStyle(1, color, 1);
    for (const [x, y, r] of BUBBLE_TAIL) {
      g.fillCircle(x - cx, y - cy, r);
      g.strokeCircle(x - cx, y - cy, r - 0.5);
    }
    g.fillRoundedRect(-b.width / 2, -b.height / 2, b.width, b.height, b.radius);
    g.strokeRoundedRect(
      -b.width / 2 + 0.5,
      -b.height / 2 + 0.5,
      b.width - 1,
      b.height - 1,
      b.radius - 0.5,
    );
    const container = add.container(cx, cy, [g]).setVisible(false);
    for (const dx of [-7, 0, 7]) {
      const dot = add.circle(dx, 0, 2.5, color, 1);
      this.dots.push(dot);
      container.add(dot);
    }
    return container;
  }
}
