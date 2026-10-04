import { Vector3 } from "three";

/** Great-circle samples with elevated ends and a gentle arch. Handles antipodes. */
export function floatingArc(start: Vector3, end: Vector3, radius: number, clearance: number, rise: number) {
  const a = start.clone().normalize(), b = end.clone().normalize();
  const angle = Math.acos(Math.max(-1, Math.min(1, a.dot(b))));
  let tangent = b.clone().addScaledVector(a, -a.dot(b));
  if (tangent.lengthSq() < 1e-12) tangent = new Vector3().crossVectors(a, Math.abs(a.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0));
  tangent.normalize();
  return Array.from({ length: 129 }, (_, i) => {
    const t = i / 128;
    return a.clone().multiplyScalar(Math.cos(angle * t)).addScaledVector(tangent, Math.sin(angle * t))
      .normalize().multiplyScalar(radius * (1 + clearance + rise * Math.sin(Math.PI * t)));
  });
}

type Link = { id: string; sourceId: string; targetId: string };

/** Index links under both endpoints; a link is undirected for display. */
export function indexLinks<L extends Link>(links: L[]): Map<string, L[]> {
  const index = new Map<string, L[]>();
  for (const link of links) {
    for (const id of new Set([link.sourceId, link.targetId])) {
      const list = index.get(id);
      if (list) list.push(link); else index.set(id, [link]);
    }
  }
  return index;
}

/** The far end of a link, seen from one of its events. */
export const otherEnd = (link: Link, id: string) => link.sourceId === id ? link.targetId : link.sourceId;

export type ArcSpec<L> = { link: L; from: string; to: string };
/**
 * Arcs fan out from each origin (selected first, then hovered) to its linked events.
 * Both ends must be shown pins: links to filtered-out events are skipped. A link that
 * two origins share is drawn once, from the earlier origin.
 */
export function arcSpecs<L extends Link>(origins: (string | null | undefined)[], index: Map<string, L[]>, shown: Set<string>): ArcSpec<L>[] {
  const specs: ArcSpec<L>[] = [];
  const seen = new Set<string>();
  for (const origin of origins) {
    if (!origin || !shown.has(origin)) continue;
    for (const link of index.get(origin) ?? []) {
      const to = otherEnd(link, origin);
      if (to === origin || !shown.has(to) || seen.has(link.id)) continue;
      seen.add(link.id);
      specs.push({ link, from: origin, to });
    }
  }
  return specs;
}

export type Hit = { kind: "pin" | "arc" | "surface"; id?: string; distance: number };
export type Pick = { kind: "pin" | "arc"; id: string } | null;
/**
 * Pins win over arcs wherever both are under the pointer, even when the arc is
 * nearer the camera. Anything behind the first surface hit (the far side) is ignored.
 */
export function pickTarget(hits: Hit[]): Pick {
  const sorted = [...hits].sort((a, b) => a.distance - b.distance);
  const surface = sorted.find(hit => hit.kind === "surface")?.distance ?? Infinity;
  const front = sorted.filter(hit => hit.kind !== "surface" && hit.distance <= surface && hit.id);
  const pick = front.find(hit => hit.kind === "pin") ?? front.find(hit => hit.kind === "arc");
  return pick ? { kind: pick.kind as "pin" | "arc", id: pick.id! } : null;
}

/** Ease-out growth from 0 to 1; a negative elapsed time (stagger delay) stays at 0. */
export function growProgress(elapsedMs: number, durationMs: number) {
  const t = Math.max(0, Math.min(1, elapsedMs / durationMs));
  return 1 - (1 - t) ** 3;
}
/** Ease-in retraction from wherever the arc was when it started to leave. */
export function retractProgress(from: number, elapsedMs: number, durationMs: number) {
  const t = Math.max(0, Math.min(1, elapsedMs / durationMs));
  return from * (1 - t ** 3);
}
