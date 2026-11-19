/**
 * curvedText.ts
 * -----------------------------------------------------------------------------
 * PicsArt-style "Bend" text: renders a text block's characters along a circular
 * arc as a Fabric Group (per-character placement + tangent rotation). Used by
 * buildTextObject whenever `style.curve` is non-zero, so the editor, the
 * page-turn preview and the exporter all render the same arc.
 */
import { Group, FabricText, Shadow } from 'fabric';
import type { TextBlock } from '@shared/pebble.types';

let measureCtx: CanvasRenderingContext2D | null = null;
function measure(font: string, text: string): number {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * 10;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

/** Bend amount (−100..100) → total arc angle in radians (±100 ≈ full circle). */
function arcAngle(curve: number): number {
  const c = Math.max(-100, Math.min(100, curve));
  return (c / 100) * Math.PI * 2;
}

/**
 * Build the curved-text Group for a block. The group's left/top is the block's
 * position; the arc is centred horizontally on the block's width.
 */
export function buildCurvedTextGroup(tb: TextBlock): Group {
  const s = tb.style;
  const chars = [...tb.content];
  const font = `${s.fontStyle === 'italic' ? 'italic ' : ''}${s.fontWeight === 'bold' ? 'bold ' : ''}${s.fontSize}px ${s.fontFamily}`;
  const spacing = s.letterSpacing || 0;
  const widths = chars.map((ch) => measure(font, ch) + spacing);
  const total = Math.max(1, widths.reduce((a, b) => a + b, 0));
  const theta = arcAngle(s.curve ?? 0) || 0.0001;
  const R = total / Math.abs(theta);
  const up = (s.curve ?? 0) > 0; // positive bend: rainbow (arc bulges up)

  const objs: FabricText[] = [];
  let acc = 0;
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    if (ch === ' ') { acc += widths[i]; continue; }
    // Character centre along the arc, angle from the arc's midpoint.
    const t = (acc + widths[i] / 2) / total - 0.5; // −0.5 .. 0.5
    const phi = t * Math.abs(theta);
    acc += widths[i];
    // For an upward arc the circle centre sits BELOW the text; chars sit on the
    // top of the circle. Downward arcs mirror vertically.
    const x = R * Math.sin(phi);
    const y = up ? R * (1 - Math.cos(phi)) : -R * (1 - Math.cos(phi));
    const angle = (up ? phi : -phi) * (180 / Math.PI);
    const c = new FabricText(ch, {
      left: x, top: y, originX: 'center', originY: 'center',
      angle,
      fontFamily: s.fontFamily, fontSize: s.fontSize,
      fontWeight: s.fontWeight, fontStyle: s.fontStyle,
      fill: s.color,
    });
    if (s.textStroke && s.textStroke.width > 0) {
      c.set({ stroke: s.textStroke.color, strokeWidth: s.textStroke.width, paintFirst: 'stroke' });
    }
    if (s.textShadow) {
      c.set('shadow', new Shadow({ color: s.textShadow.color, blur: s.textShadow.blur, offsetX: s.textShadow.offsetX, offsetY: s.textShadow.offsetY }));
    }
    objs.push(c);
  }

  const g = new Group(objs.length ? objs : [new FabricText(' ', { fontSize: s.fontSize })], {
    left: tb.position.x, top: tb.position.y,
    originX: 'left', originY: 'top',
    angle: tb.position.rotation,
    opacity: s.opacity,
  });
  (g as unknown as { pebbleId: string; pebbleType: string }).pebbleId = tb.id;
  (g as unknown as { pebbleType: string }).pebbleType = 'text';
  return g;
}
