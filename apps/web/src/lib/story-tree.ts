/**
 * Explore's story tree. The story picked from the map or the selected-countries list is the
 * root; its connected stories are leaves. Opening a leaf makes it a branch (with its own
 * leaves), so the tree grows from any open story. Closing a story closes everything
 * opened from it; closing the root closes the tree. One open story has focus (the briefing).
 */
type Story = { id: string };
export type StoryNode<E extends Story> = { event: E; parent: string | null };
export type StoryTree<E extends Story> = { nodes: StoryNode<E>[]; focus: string };

export const storyRoot = <E extends Story>(event: E): StoryTree<E> => ({ nodes: [{ event, parent: null }], focus: event.id });

export const hasStory = <E extends Story>(tree: StoryTree<E>, id: string) => tree.nodes.some(node => node.event.id === id);

/** Opens a story from an open one and focuses it; an already open story just takes focus. */
export function openStory<E extends Story>(tree: StoryTree<E>, parent: string, event: E): StoryTree<E> {
  if (hasStory(tree, event.id)) return { ...tree, focus: event.id };
  if (!hasStory(tree, parent)) return tree;
  return { nodes: [...tree.nodes, { event, parent }], focus: event.id };
}

export const focusStory = <E extends Story>(tree: StoryTree<E>, id: string): StoryTree<E> => hasStory(tree, id) ? { ...tree, focus: id } : tree;

/** Closes a story and every story opened from it. Focus inside the closed part moves to
 * the closed story's parent. Closing the root returns null. */
export function closeStory<E extends Story>(tree: StoryTree<E>, id: string): StoryTree<E> | null {
  const node = tree.nodes.find(node => node.event.id === id);
  if (!node) return tree;
  if (node.parent === null) return null;
  const closed = new Set([id]);
  // Nodes are appended after their parent, so one pass in order finds every descendant.
  for (const item of tree.nodes) if (item.parent !== null && closed.has(item.parent)) closed.add(item.event.id);
  return { nodes: tree.nodes.filter(item => !closed.has(item.event.id)), focus: closed.has(tree.focus) ? node.parent : tree.focus };
}

export type StoryLeaf<E extends Story> = { event: E; open: boolean };
/**
 * What hangs under an open story: its connections by significance (an opened one keeps its
 * place, marked open). Stories already open elsewhere in the tree are left out, so each
 * story appears once.
 */
export function storyLeaves<E extends Story & { significance: number }>(tree: StoryTree<E>, id: string, connected: E[]): StoryLeaf<E>[] {
  const placed = new Map(tree.nodes.map(node => [node.event.id, node.parent]));
  const leaves = new Map<string, StoryLeaf<E>>();
  for (const event of connected) {
    if (event.id === id || leaves.has(event.id)) continue;
    const parent = placed.get(event.id);
    if (parent !== undefined && parent !== id) continue;
    leaves.set(event.id, { event, open: parent === id });
  }
  return Array.from(leaves.values()).sort((a, b) => b.event.significance - a.event.significance || a.event.id.localeCompare(b.event.id));
}
