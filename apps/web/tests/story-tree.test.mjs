import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const output = ts.transpileModule(readFileSync(new URL('../src/lib/story-tree.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { storyRoot, openStory, focusStory, closeStory, storyLeaves, hasStory } = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);

const story = (id, significance = 50) => ({ id, significance });
const ids = tree => tree.nodes.map(node => node.event.id);

test('many branches open from one root, and branches grow branches of their own', () => {
 let tree = storyRoot(story('r'));
 tree = openStory(tree, 'r', story('a'));
 tree = openStory(tree, 'r', story('b'));
 tree = openStory(tree, 'a', story('a1'));
 assert.deepEqual(ids(tree), ['r', 'a', 'b', 'a1']);
 assert.equal(tree.focus, 'a1', 'the newly opened story takes focus');
 // Re-opening an open story only moves focus; an unknown parent changes nothing.
 assert.deepEqual(ids(openStory(tree, 'b', story('a'))), ids(tree));
 assert.equal(openStory(tree, 'b', story('a')).focus, 'a');
 assert.equal(openStory(tree, 'missing', story('z')), tree);
 assert.equal(focusStory(tree, 'r').focus, 'r');
 assert.equal(focusStory(tree, 'z'), tree);
});

test('closing a story closes its branches; closing the root closes the tree', () => {
 let tree = storyRoot(story('r'));
 for (const [parent, id] of [['r', 'a'], ['r', 'b'], ['a', 'a1'], ['a1', 'a2'], ['b', 'b1']]) tree = openStory(tree, parent, story(id));
 const withoutA = closeStory(tree, 'a');
 assert.deepEqual(ids(withoutA), ['r', 'b', 'b1']);
 assert.equal(withoutA.focus, 'b1', 'focus outside the closed part stays');
 assert.equal(closeStory(focusStory(tree, 'a2'), 'a').focus, 'r', 'focus inside it moves to the parent');
 assert.equal(closeStory(tree, 'r'), null);
 assert.equal(closeStory(tree, 'missing'), tree);
 assert(!hasStory(withoutA, 'a2'));
});

test('leaves list connections by significance, mark open branches, and skip stories open elsewhere', () => {
 let tree = storyRoot(story('r'));
 tree = openStory(tree, 'r', story('a', 10));
 tree = openStory(tree, 'a', story('x', 90));
 const connected = [story('a', 10), story('b', 70), story('x', 90), story('r'), story('c', 70), story('b', 70)];
 assert.deepEqual(storyLeaves(tree, 'r', connected).map(leaf => [leaf.event.id, leaf.open]), [['b', false], ['c', false], ['a', true]]);
 // From a, the root and r's other branches are not repeated; its own branch x is open.
 assert.deepEqual(storyLeaves(tree, 'a', [story('r'), story('x', 90), story('d', 5)]).map(leaf => [leaf.event.id, leaf.open]), [['x', true], ['d', false]]);
});
