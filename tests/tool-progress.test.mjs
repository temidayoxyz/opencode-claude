import assert from 'node:assert/strict';
import test from 'node:test';
import { ToolProgress } from '../dist/opencode/progress.js';

test('progress translates internal browser and file tool names into readable actions', () => {
  let output = '';const progress = new ToolProgress(t => { output += t; });
  for (const name of ['opwork_browser_browser_navigate', 'opwork_browser_browser_resize', 'opwork_browser_browser_take_screenshot', 'read', 'edit', 'opwork_browser_browser_evaluate']) progress.tool(name);
  progress.flush();
  assert.match(output, /Opening a page/);assert.match(output, /Checking the page/);assert.match(output, /Reading files/);assert.match(output, /Updating files/);
  assert.doesNotMatch(output, /opwork_browser|OpenCode tool|browser_evaluate/);
});

test('consecutive edits form one group, and the summary counts operations rather than files', () => {
  let output = '';const progress = new ToolProgress(t => { output += t; });
  for (let i = 0; i < 7; i++) progress.tool('edit');
  progress.flush();progress.flush();
  assert.equal((output.match(/Updating files/g) ?? []).length, 1);
  assert.match(output, /File updates: 7 operations/);
  assert.doesNotMatch(output, /7 files|completed|succeeded/i);
});

test('model text and distinct phases split groups without merging separate editing work', () => {
  const chunks = [];const progress = new ToolProgress(t => chunks.push(t));
  progress.tool('edit');progress.tool('write');progress.flush();chunks.push('MODEL TEXT');
  progress.tool('edit');progress.flush();
  const output = chunks.join('');
  assert.ok(output.indexOf('File updates: 2 operations') < output.indexOf('MODEL TEXT'));
  assert.equal((output.match(/Updating files/g) ?? []).length, 2);
});

test('long groups emit a bounded update when new tool activity arrives', () => {
  let now = 0, output = '';const progress = new ToolProgress(t => { output += t; }, () => now);
  progress.tool('edit');now = 1000;progress.tool('edit');
  assert.doesNotMatch(output, /operations/);
  now = 30000;progress.tool('edit');
  assert.match(output, /File updates: 3 operations/);
  progress.flush();assert.equal((output.match(/File updates: 3 operations/g) ?? []).length, 1);
});

test('unknown tool names remain private and progress state belongs to one response', () => {
  let one = '', two = '';const first = new ToolProgress(t => { one += t; });const second = new ToolProgress(t => { two += t; });
  first.tool('PRIVATE_PLUGIN_NAME');second.tool('edit');first.flush();second.flush();
  assert.match(one, /Using a connected tool/);assert.doesNotMatch(one, /PRIVATE_PLUGIN_NAME|Updating files/);assert.match(two, /Updating files/);
});
