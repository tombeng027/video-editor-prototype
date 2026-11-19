import { animatedTransform, NORMAL_TRANSFORM, type CanvasRect, type Clip, type Transform } from "@ve/schema";
import { clipDuration } from "@ve/timeline-core";

export function fitToCanvasTransform(clip: Clip): Transform {
  return { ...NORMAL_TRANSFORM, ...clip.transform, x: 0.5, y: 0.5, scale: 1 };
}

/** Converts displayed geometry back to saved appearance without baking in the current animation. */
export function canvasTransformToBase(clip: Clip, frame: number, displayed: Transform): Transform | null {
  const at = (base: Transform) => animatedTransform(clip.animations, clipDuration(clip),
    frame - clip.timelineStart, base, clip.zoom);
  const unit = at(NORMAL_TRANSFORM);
  const scale = displayed.scale / unit.scale;
  const origin = at({ ...NORMAL_TRANSFORM, x: 0, y: 0, scale });
  const shifted = at({ ...NORMAL_TRANSFORM, x: 1, y: 1, scale });
  const dx = shifted.x - origin.x, dy = shifted.y - origin.y;
  if (dx < 1e-6 || dy < 1e-6) return null;
  return {
    x: (displayed.x - origin.x) / dx, y: (displayed.y - origin.y) / dy,
    scale, opacity: clip.transform?.opacity ?? 1,
  };
}

export type SnapTargets = { x: number[]; y: number[] };
export type Guides = { x: number | null; y: number | null };

/** Canvas edges and center, plus the edges and centers of the other visible pictures. */
export function snapTargets(others: CanvasRect[]): SnapTargets {
  const x = [0, 0.5, 1], y = [0, 0.5, 1];
  for (const rect of others) {
    x.push(rect.left, rect.left + rect.width / 2, rect.left + rect.width);
    y.push(rect.top, rect.top + rect.height / 2, rect.top + rect.height);
  }
  return { x, y };
}

function nearest(points: number[], targets: number[], threshold: number): { delta: number; guide: number } | null {
  let best: { delta: number; guide: number } | null = null;
  for (const point of points) {
    for (const target of targets) {
      const delta = target - point;
      if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, guide: target };
    }
  }
  return best;
}

/** Nudges a moved picture so its nearest edge or center lands on a guide. Thresholds are fractions of the frame. */
export function snapMove(rect: CanvasRect, targets: SnapTargets, threshold: { x: number; y: number }) {
  const x = nearest([rect.left, rect.left + rect.width / 2, rect.left + rect.width], targets.x, threshold.x);
  const y = nearest([rect.top, rect.top + rect.height / 2, rect.top + rect.height], targets.y, threshold.y);
  return { dx: x?.delta ?? 0, dy: y?.delta ?? 0, guides: { x: x?.guide ?? null, y: y?.guide ?? null } as Guides };
}

/**
 * Adjusts a center-anchored resize so an edge lands on a guide.
 * `unit` is the picture's half-size at scale 1; the center stays fixed.
 */
export function snapScale(center: { x: number; y: number }, unit: { x: number; y: number; left?: number; top?: number }, scale: number,
  targets: SnapTargets, threshold: { x: number; y: number }): { scale: number; guides: Guides } {
  let best: { scale: number; distance: number; guides: Guides } | null = null;
  const consider = (targetsOnAxis: number[], c: number, edge: number, limit: number, axis: "x" | "y") => {
    for (const target of targetsOnAxis) {
      const reach = target - c;
      const distance = Math.abs(reach - edge * scale);
      if (edge !== 0 && reach / edge > 0 && distance <= limit && (!best || distance < best.distance)) {
        best = { scale: reach / edge, distance, guides: { x: axis === "x" ? target : null, y: axis === "y" ? target : null } };
      }
    }
  };
  const left = unit.left ?? -unit.x, top = unit.top ?? -unit.y;
  for (const edge of [left, left + unit.x * 2]) consider(targets.x, center.x, edge, threshold.x, "x");
  for (const edge of [top, top + unit.y * 2]) consider(targets.y, center.y, edge, threshold.y, "y");
  const found = best as { scale: number; guides: Guides } | null;
  return found ? { scale: found.scale, guides: found.guides } : { scale, guides: { x: null, y: null } };
}

/** The top-most picture containing the point, given rects in back-to-front order. */
export function topmostAt(rects: CanvasRect[], point: { x: number; y: number }): number {
  for (let index = rects.length - 1; index >= 0; index--) {
    const rect = rects[index]!;
    if (point.x >= rect.left && point.x <= rect.left + rect.width && point.y >= rect.top && point.y <= rect.top + rect.height) {
      return index;
    }
  }
  return -1;
}
