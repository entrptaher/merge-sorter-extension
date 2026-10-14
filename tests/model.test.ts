import assert from 'node:assert/strict';
import test from 'node:test';
import type { Browser } from 'wxt/browser';
import {
  DEFAULT_SETTINGS, buildDuplicateGroups, duplicateKey, isExcluded, planSiteGroups, planSort, validateSettings,
} from '../utils/model.ts';

function tab(id: number, values: Partial<Browser.tabs.Tab> = {}): Browser.tabs.Tab {
  return {
    id, index: id - 1, windowId: 1, url: 'https://docs.test/guide?edition=1#intro', title: 'Project guide',
    active: false, highlighted: false, pinned: false, incognito: false, discarded: false,
    autoDiscardable: true, groupId: -1, status: 'complete', ...values,
  } as Browser.tabs.Tab;
}

test('exact duplicate matching preserves query, fragment, scheme, and private context', () => {
  const original = tab(1);
  for (const url of ['https://docs.test/guide?edition=2#intro', 'https://docs.test/guide?edition=1#next',
    'http://docs.test/guide?edition=1#intro']) {
    assert.notEqual(duplicateKey(original, DEFAULT_SETTINGS), duplicateKey(tab(2, { url }), DEFAULT_SETTINGS));
  }
  assert.notEqual(duplicateKey(original, DEFAULT_SETTINGS), duplicateKey(tab(2, { incognito: true }), DEFAULT_SETTINGS));
  assert.equal(duplicateKey(tab(2, { status: 'loading' }), DEFAULT_SETTINGS), null);
  assert.equal(duplicateKey(tab(2, { url: 'chrome://settings/' }), DEFAULT_SETTINGS), null);
  const relaxed = { ...DEFAULT_SETTINGS, ignoreHash: true, ignoreQuery: true };
  assert.equal(duplicateKey(original, relaxed), duplicateKey(tab(2, { url: 'https://docs.test/guide?edition=2#next' }), relaxed));
  const queryOnly = { ...DEFAULT_SETTINGS, ignoreQuery: true };
  assert.notEqual(duplicateKey(original, queryOnly), duplicateKey(tab(2, { url: 'https://docs.test/guide?edition=2#next' }), queryOnly));
});

test('all pinned, active, and audible duplicate copies survive the default plan', () => {
  const copies = [tab(1, { pinned: true }), tab(2, { active: true }), tab(3, { audible: true }), tab(4)];
  const [group] = buildDuplicateGroups(copies, DEFAULT_SETTINGS);
  assert.ok(group);
  assert.deepEqual(group.keepIds, [1, 2, 3]);
  assert.deepEqual(group.closeIds, [4]);
  assert.deepEqual(buildDuplicateGroups(copies.slice(0, 3), DEFAULT_SETTINGS)[0]!.closeIds, []);
  assert.deepEqual(buildDuplicateGroups([tab(5, { lastAccessed: 10 }), tab(6, { lastAccessed: 20 })], DEFAULT_SETTINGS)[0]!.keepIds, [6]);
});

test('hostname exclusions cover subdomains without matching similar hostnames', () => {
  const settings = { ...DEFAULT_SETTINGS, excludedSites: ['work.test'] };
  for (const url of ['https://work.test/a', 'https://mail.work.test/a', 'https://deep.mail.work.test/a']) {
    assert.equal(isExcluded(tab(1, { url }), settings), true, url);
  }
  for (const url of ['https://notwork.test/a', 'https://work.test.evil.test/a']) {
    assert.equal(isExcluded(tab(1, { url }), settings), false, url);
  }
  assert.equal(isExcluded(tab(1, { pendingUrl: 'https://mail.work.test/a' }), settings), true);
  assert.deepEqual(buildDuplicateGroups([tab(1, { url: 'https://work.test/a' }), tab(2, { url: 'https://work.test/a' })], settings), []);
});

test('site groups remain separate across windows and skip pinned or existing groups', () => {
  const tabs = [tab(1), tab(2, { url: 'https://www.docs.test/other' }), tab(3, { windowId: 2 }),
    tab(4, { windowId: 2 }), tab(5, { pinned: true }), tab(6, { groupId: 9 }), tab(7, { windowId: 3 })];
  assert.deepEqual(planSiteGroups(tabs, DEFAULT_SETTINGS), [
    { windowId: 1, site: 'docs.test', tabIds: [1, 2] },
    { windowId: 2, site: 'docs.test', tabIds: [3, 4] },
  ]);
});

test('sort keeps group blocks together and respects pinned and excluded barriers', () => {
  const tabs = [
    tab(1, { pinned: true, title: 'Z pinned' }), tab(2, { groupId: 7, title: 'Zulu' }),
    tab(3, { groupId: 7, title: 'Beta' }), tab(4, { title: 'Alpha' }),
    tab(5, { title: 'Excluded', url: 'https://work.test/' }),
    tab(6, { title: 'Zulu' }), tab(7, { title: 'Alpha' }),
  ];
  const result = planSort(tabs, [], { ...DEFAULT_SETTINGS, sortBy: 'title', excludedSites: ['work.test'] });
  assert.deepEqual(result.map((block) => block.tabs.map((item) => item.id)), [[1], [4], [3, 2], [5], [7], [6]]);
  assert.deepEqual(result.filter((block) => block.fixed).map((block) => block.tabs[0].id), [1, 5]);
  assert.equal(result.find((block) => block.groupId === 7)?.tabs.length, 2);
  assert.deepEqual(tabs.map((item) => item.id), [1, 2, 3, 4, 5, 6, 7], 'The plan must not mutate its input.');
});

test('settings reject malformed values and group sizes outside 2–20', () => {
  const invalid: unknown[] = [null, [], {}, { ...DEFAULT_SETTINGS, scope: 'sometimes' },
    { ...DEFAULT_SETTINGS, protectPinned: 'true' }, { ...DEFAULT_SETTINGS, unknown: true },
    { ...DEFAULT_SETTINGS, excludedSites: ['*.test'] }, { ...DEFAULT_SETTINGS, siteOrder: [1] },
    ...[1, 21, 2.5, NaN, Infinity, '2'].map((minimumGroupSize) => ({ ...DEFAULT_SETTINGS, minimumGroupSize }))];
  for (const input of invalid) assert.throws(() => validateSettings(input), JSON.stringify(input));
  assert.equal(validateSettings({ ...DEFAULT_SETTINGS, minimumGroupSize: 20 }).minimumGroupSize, 20);
  assert.deepEqual(validateSettings({ ...DEFAULT_SETTINGS, excludedSites: [' Work.Test ', 'work.test'] }).excludedSites, ['work.test']);
});
