import { Vector3 } from "three";

/** Demo navigation only: these are not factual or backend-inferred relationships. */
export function placeholderRelatedEvents<T extends { id: string }>(source: T, events: T[]): T[] {
  const unique = [...new Map(events.map(event => [event.id, event])).values()].sort((a, b) => a.id.localeCompare(b.id));
  const index = unique.findIndex(event => event.id === source.id);
  return Array.from({ length: Math.min(3, unique.length) }, (_, offset) => unique[(Math.max(index, 0) + offset + 1) % unique.length]).filter(event => event.id !== source.id);
}

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

export type Connection<T> = { source: T; target: T };
/** Directed, source-scoped UI connections; never mutate another source's links. */
export function setConnection<T extends { id: string }>(connections: Connection<T>[], source: T, target: T, enabled: boolean): Connection<T>[] {
  const others = connections.filter(link => link.source.id !== source.id || link.target.id !== target.id);
  return enabled && source.id !== target.id ? [...others, { source, target }] : others;
}
export function clearSourceConnections<T extends { id: string }>(connections: Connection<T>[], sourceId: string): Connection<T>[] {
  return connections.filter(link => link.source.id !== sourceId);
}

/** Remove a node and every descendant, retaining unrelated sibling branches. */
export function pruneBranch<T extends { id: string }>(links: Connection<T>[], id: string) {
  const removed = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const link of links) if (removed.has(link.source.id) && !removed.has(link.target.id)) {
      removed.add(link.target.id); changed = true;
    }
  }
  return { removed, links: links.filter(link => !removed.has(link.source.id) && !removed.has(link.target.id)) };
}
/** Each node has one parent. Existing nodes are navigable, never reparented or cycled. */
export function connectTree<T extends { id: string }>(links: Connection<T>[], root: T, source: T, target: T) {
  if (target.id === root.id || links.some(link => link.target.id === target.id)) return links;
  if (source.id !== root.id && !links.some(link => link.target.id === source.id)) return links;
  return setConnection(links, source, target, true);
}
