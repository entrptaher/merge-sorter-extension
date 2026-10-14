import { browser, type Browser } from 'wxt/browser';
import {
  DEFAULT_SETTINGS, buildDuplicateGroups, duplicateKey, getSite, isExcluded, isId, isRecord, isSiteTab,
  planSiteGroups, planSort, tabOrder, validateSettings,
  type Action, type ActionResult, type ExtensionState, type Message, type Scope, type Settings,
} from './model';

type SavedTab = Pick<Browser.tabs.Tab, 'id' | 'windowId' | 'index' | 'pinned' | 'active' | 'groupId' | 'incognito' | 'url'> & { id: number };
type SavedWindow = Pick<Browser.windows.Window, 'id' | 'type' | 'state' | 'incognito' | 'left' | 'top' | 'width' | 'height'> & { id: number };
type SavedGroup = Pick<Browser.tabGroups.TabGroup, 'id' | 'windowId' | 'title' | 'color' | 'collapsed'>;
type Recovery = {
  version: 1;
  id: string;
  kind: 'structure' | 'close';
  label: string;
  incognito: boolean;
  tabs: SavedTab[];
  windows: SavedWindow[];
  groups: SavedGroup[];
  touchedIds: number[];
  closedIds: number[];
  pendingCloseIds: number[];
  navigatedIds?: number[];
  restoredTabs: Record<string, number>;
  restoredWindows: Record<string, number>;
  restoredGroups: Record<string, number>;
  windowIntents: Record<string, { seedId: number; fromWindowId: number }>;
};
type LiveState = { tabs: Browser.tabs.Tab[]; windows: Browser.windows.Window[]; groups: Browser.tabGroups.TabGroup[] };
type Work = { recovery: Recovery; settings: Settings; warnings: string[]; succeeded: Set<number>; failures: number };

const COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'] as const;
const LABELS: Record<Action, string> = {
  'close-duplicates': 'Reopen closed duplicate URLs', group: 'Group tabs by site', sort: 'Sort tabs', merge: 'Merge windows',
  ungroup: 'Ungroup tabs', collapse: 'Collapse groups', expand: 'Expand groups',
};
let queue: Promise<unknown> = Promise.resolve();

export function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}

class RecoveryWriteError extends Error {}

function recoveryKey(incognito: boolean): string {
  return incognito ? 'undo-private' : 'undo-normal';
}

async function saveRecovery(recovery: Recovery): Promise<void> {
  try {
    await browser.storage.session.set({ [recoveryKey(recovery.incognito)]: recovery });
  } catch (error) {
    throw new RecoveryWriteError(`Recovery could not be saved. The action stopped. ${errorText(error)}`);
  }
}

function validateRecovery(input: unknown, incognito: boolean): Recovery {
  const invalid = () => { throw new Error('Recovery data is invalid. No tabs were changed.'); };
  if (!isRecord(input) || input.version !== 1 || typeof input.id !== 'string' || input.id.length > 64
    || (input.kind !== 'structure' && input.kind !== 'close') || typeof input.label !== 'string' || input.label.length > 100
    || input.incognito !== incognito) return invalid();
  for (const key of ['tabs', 'windows', 'groups', 'touchedIds', 'closedIds', 'pendingCloseIds']) {
    if (!Array.isArray(input[key]) || input[key].length > 20000) return invalid();
  }
  const windows = input.windows as unknown[];
  if (!windows.every((window) => isRecord(window) && isId(window.id) && window.incognito === incognito
    && ['normal', 'popup'].includes(window.type as string)
    && (window.state === undefined || ['normal', 'minimized', 'maximized', 'fullscreen', 'locked-fullscreen'].includes(window.state as string))
    && ['left', 'top', 'width', 'height'].every((key) => window[key] === undefined || (typeof window[key] === 'number' && Number.isFinite(window[key]))))) return invalid();
  const windowIds = new Set(windows.map((window) => (window as SavedWindow).id));
  const tabs = input.tabs as unknown[];
  if (!tabs.every((tab) => isRecord(tab) && isId(tab.id) && isId(tab.windowId) && windowIds.has(tab.windowId)
    && isId(tab.index) && typeof tab.pinned === 'boolean' && typeof tab.active === 'boolean' && tab.incognito === incognito
    && typeof tab.groupId === 'number' && Number.isSafeInteger(tab.groupId) && tab.groupId >= -1
    && (tab.url === undefined || (typeof tab.url === 'string' && tab.url.length <= 2000000)))) return invalid();
  const tabIds = new Set(tabs.map((tab) => (tab as SavedTab).id));
  if (tabIds.size !== tabs.length || windowIds.size !== windows.length) return invalid();
  for (const key of ['touchedIds', 'closedIds', 'pendingCloseIds']) {
    if (!(input[key] as unknown[]).every((id) => isId(id) && tabIds.has(id))) return invalid();
  }
  if (input.navigatedIds !== undefined && (!Array.isArray(input.navigatedIds)
    || input.navigatedIds.length > 20000 || !input.navigatedIds.every((id) => isId(id) && tabIds.has(id)))) return invalid();
  if (!(input.groups as unknown[]).every((group) => isRecord(group) && isId(group.id) && isId(group.windowId)
    && windowIds.has(group.windowId) && COLORS.includes(group.color as typeof COLORS[number])
    && typeof group.collapsed === 'boolean' && (group.title === undefined || typeof group.title === 'string'))) return invalid();
  for (const key of ['restoredTabs', 'restoredWindows', 'restoredGroups']) {
    if (!isRecord(input[key]) || !Object.entries(input[key]).every(([id, value]) => /^\d+$/.test(id) && isId(value))) return invalid();
  }
  if (!isRecord(input.windowIntents) || !Object.entries(input.windowIntents).every(([id, value]) => /^\d+$/.test(id)
    && isRecord(value) && isId(value.seedId) && isId(value.fromWindowId))) return invalid();
  return input as unknown as Recovery;
}

async function loadRecovery(incognito: boolean): Promise<Recovery | null> {
  const key = recoveryKey(incognito);
  const stored = await browser.storage.session.get(key);
  return stored[key] === undefined ? null : validateRecovery(stored[key], incognito);
}

async function getSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get('settings');
  return validateSettings(stored.settings ?? DEFAULT_SETTINGS);
}

async function saveSettings(input: unknown): Promise<Settings> {
  const settings = validateSettings(input);
  await browser.storage.local.set({ settings });
  return settings;
}

async function readLive(incognito: boolean): Promise<LiveState> {
  const [windows, tabs, groups] = await Promise.all([
    browser.windows.getAll({ windowTypes: ['normal', 'popup'] }), browser.tabs.query({}), browser.tabGroups.query({}),
  ]);
  const eligibleWindows = windows.filter((window) => isId(window.id) && window.incognito === incognito);
  const windowIds = new Set(eligibleWindows.map((window) => window.id));
  return {
    windows: eligibleWindows,
    tabs: tabs.filter((tab) => isId(tab.id) && tab.incognito === incognito && windowIds.has(tab.windowId)).sort(tabOrder),
    groups: groups.filter((group) => windowIds.has(group.windowId)),
  };
}

function currentWindow(live: LiveState, windowId: number): Browser.windows.Window {
  const window = live.windows.find((candidate) => candidate.id === windowId);
  if (!window) throw new Error('The selected window no longer exists or belongs to another browser context.');
  return window;
}

function scopedState(live: LiveState, windowId: number, scope: Scope): LiveState {
  currentWindow(live, windowId);
  if (scope === 'all') return live;
  return {
    windows: live.windows.filter((window) => window.id === windowId),
    tabs: live.tabs.filter((tab) => tab.windowId === windowId),
    groups: live.groups.filter((group) => group.windowId === windowId),
  };
}

function mergeSources(live: LiveState, windowId: number, settings: Settings): number[] {
  if (currentWindow(live, windowId).type !== 'normal') return [];
  return live.windows.filter((window) => window.id !== windowId
    && (window.type === 'normal' || (settings.mergePopups && window.type === 'popup'))
    && (settings.mergeMinimized || window.state !== 'minimized')
    && live.tabs.some((tab) => tab.windowId === window.id && !isExcluded(tab, settings)))
    .map((window) => window.id!);
}

async function getState(windowId: number, scope: Scope, incognito: boolean): Promise<ExtensionState> {
  const [settings, live, recovery] = await Promise.all([getSettings(), readLive(incognito), loadRecovery(incognito)]);
  const scoped = scopedState(live, windowId, scope);
  return {
    ...scoped, currentWindowId: windowId, settings, duplicateGroups: buildDuplicateGroups(scoped.tabs, settings),
    mergeWindowIds: mergeSources(live, windowId, settings), undo: recovery ? { label: recovery.label, kind: recovery.kind } : null,
  };
}

function snapshot(live: LiveState, touchedIds: number[], action: Action, incognito: boolean): Recovery {
  return {
    version: 1, id: crypto.randomUUID(), kind: action === 'close-duplicates' ? 'close' : 'structure', label: LABELS[action], incognito,
    tabs: live.tabs.map(({ id, windowId, index, pinned, active, groupId, incognito: privateTab, url }) => ({
      id: id!, windowId, index, pinned, active, groupId, incognito: privateTab, url,
    })),
    windows: live.windows.map(({ id, type, state, incognito: privateWindow, left, top, width, height }) => ({
      id: id!, type, state, incognito: privateWindow, left, top, width, height,
    })),
    groups: live.groups.map(({ id, windowId, title, color, collapsed }) => ({ id, windowId, title, color, collapsed })),
    touchedIds: [...new Set(touchedIds)], closedIds: [], pendingCloseIds: [], restoredTabs: {}, restoredWindows: {}, restoredGroups: {}, windowIntents: {},
  };
}

async function attempt<T>(work: Work, description: string, action: () => Promise<T>): Promise<T | undefined> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof RecoveryWriteError) throw error;
    work.failures++;
    work.warnings.push(`${description}: ${errorText(error)}`);
    return undefined;
  }
}

function sameIds(tabs: Browser.tabs.Tab[], ids: number[]): boolean {
  return tabs.length === ids.length && tabs.every((tab) => ids.includes(tab.id!));
}

function groupProperties(group: SavedGroup): { title: string; color: Browser.tabGroups.TabGroup['color']; collapsed: boolean } {
  return { title: group.title ?? '', color: group.color, collapsed: group.collapsed };
}

async function verifyGroup(groupId: number, expectedIds: number[], windowId: number, incognito: boolean): Promise<Browser.tabs.Tab[]> {
  const tabs = await browser.tabs.query({ groupId });
  if (!sameIds(tabs, expectedIds) || tabs.some((tab) => tab.windowId !== windowId || tab.incognito !== incognito || tab.pinned)) {
    throw new Error('The group changed during the action. Its remaining tabs were not moved.');
  }
  return tabs;
}

async function closeDuplicates(work: Work, windowId: number, scope: Scope, ids: number[]): Promise<void> {
  for (const id of ids) {
    await attempt(work, `Tab ${id} was not closed`, async () => {
      let live = scopedState(await readLive(work.recovery.incognito), windowId, scope);
      let group = buildDuplicateGroups(live.tabs, work.settings).find((candidate) => candidate.closeIds.includes(id));
      let tab = live.tabs.find((candidate) => candidate.id === id);
      const saved = work.recovery.tabs.find((candidate) => candidate.id === id)!;
      if (!tab || !group || tab.windowId !== saved.windowId || tab.groupId !== saved.groupId
        || duplicateKey(tab, work.settings) !== duplicateKey(saved as Browser.tabs.Tab, work.settings)) {
        throw new Error('The tab is no longer a safe duplicate.');
      }
      Object.assign(saved, { url: tab.url, pinned: tab.pinned, active: tab.active });
      work.recovery.pendingCloseIds = [id];
      await saveRecovery(work.recovery);
      // The second query follows the storage write, so a stale review cannot authorize an arbitrary close.
      live = scopedState(await readLive(work.recovery.incognito), windowId, scope);
      group = buildDuplicateGroups(live.tabs, work.settings).find((candidate) => candidate.closeIds.includes(id));
      tab = live.tabs.find((candidate) => candidate.id === id);
      if (!tab || !group || tab.windowId !== saved.windowId || tab.groupId !== saved.groupId
        || tab.pinned !== saved.pinned || duplicateKey(tab, work.settings) !== duplicateKey(saved as Browser.tabs.Tab, work.settings)) {
        work.recovery.pendingCloseIds = [];
        await saveRecovery(work.recovery);
        throw new Error('The tab or its keeper changed before closure.');
      }
      try {
        await browser.tabs.remove(id);
      } catch (error) {
        const remaining = await browser.tabs.query({});
        if (remaining.some((candidate) => candidate.id === id)) {
          work.recovery.pendingCloseIds = [];
          await saveRecovery(work.recovery);
          throw error;
        }
        work.warnings.push(`Tab ${id} disappeared during closure: ${errorText(error)}`);
      }
      work.succeeded.add(id);
      work.recovery.closedIds.push(id);
      work.recovery.pendingCloseIds = [];
      await saveRecovery(work.recovery);
    });
  }
}

async function groupSites(work: Work, live: LiveState): Promise<void> {
  for (const plan of planSiteGroups(live.tabs, work.settings)) {
    await attempt(work, `The group for ${plan.site} could not be completed`, async () => {
      const window = await browser.windows.get(plan.windowId);
      if (window.incognito !== work.recovery.incognito || window.type !== 'normal') throw new Error('Only normal windows support tab groups.');
      const current = await browser.tabs.query({ windowId: plan.windowId });
      const tabs = current.filter((tab) => plan.tabIds.includes(tab.id!) && isSiteTab(tab, work.settings) && !tab.pinned
        && getSite(tab.url) === plan.site && (!work.settings.preserveGroups || tab.groupId < 0));
      if (tabs.length < work.settings.minimumGroupSize) throw new Error('Too few eligible tabs remain.');
      const previousGroup = tabs[0]!.groupId;
      if (previousGroup >= 0 && tabs.every((tab) => tab.groupId === previousGroup)
        && sameIds(current.filter((tab) => tab.groupId === previousGroup), tabs.map((tab) => tab.id!))) return;
      const groupId = await browser.tabs.group({ tabIds: tabs.map((tab) => tab.id!) as [number, ...number[]], createProperties: { windowId: plan.windowId } });
      const members = await verifyGroup(groupId, tabs.map((tab) => tab.id!), plan.windowId, work.recovery.incognito);
      members.forEach((tab) => work.succeeded.add(tab.id!));
      const color = COLORS[[...plan.site].reduce((sum, character) => sum + character.charCodeAt(0), 0) % COLORS.length];
      await browser.tabGroups.update(groupId, { title: plan.site, color, collapsed: work.settings.collapseNewGroups });
    });
  }
}

async function sortTabs(work: Work, live: LiveState): Promise<void> {
  for (const window of live.windows) {
    if (!live.tabs.some((tab) => tab.windowId === window.id && work.recovery.touchedIds.includes(tab.id!))) continue;
    await attempt(work, `Window ${window.id} was not fully sorted`, async () => {
      if (window.type !== 'normal') throw new Error('Chromium does not support tab moves inside popup windows.');
      const originalTabs = live.tabs.filter((tab) => tab.windowId === window.id);
      const blocks = planSort(originalTabs, live.groups, work.settings);
      let index = 0;
      for (const block of blocks) {
        if (block.fixed) { index += block.tabs.length; continue; }
        let current = await browser.tabs.query({ windowId: window.id });
        if (!sameIds(current, originalTabs.map((tab) => tab.id!))) throw new Error('Tabs were added or removed. The remaining sort stopped.');
        const expected = block.tabs.map((tab) => tab.id!);
        const members = current.filter((tab) => expected.includes(tab.id!));
        if (members.some((tab) => isExcluded(tab, work.settings) || tab.pinned !== block.tabs[0].pinned || tab.groupId !== block.groupId)) {
          throw new Error('A tab changed its eligibility or group. The remaining sort stopped.');
        }
        if (block.groupId >= 0) {
          await verifyGroup(block.groupId, expected, window.id!, work.recovery.incognito);
          const firstIndex = Math.min(...members.map((tab) => tab.index));
          if (firstIndex !== index) {
            const moved = await browser.tabGroups.move(block.groupId, { windowId: window.id, index });
            const actualGroupId = moved?.id ?? block.groupId;
            await verifyGroup(actualGroupId, expected, window.id!, work.recovery.incognito);
            if (actualGroupId !== block.groupId) throw new Error('The group ID changed unexpectedly. The remaining sort stopped.');
            expected.forEach((id) => work.succeeded.add(id));
          }
          for (let offset = 0; offset < expected.length; offset++) {
            const tab = await browser.tabs.get(expected[offset]!);
            if (tab.windowId !== window.id || tab.groupId !== block.groupId) throw new Error('A group member moved during the sort.');
            if (tab.index !== index + offset) {
              const moved = await browser.tabs.move(tab.id!, { index: index + offset });
              const result = Array.isArray(moved) ? moved[0] : moved;
              if (result.windowId !== window.id || result.groupId !== block.groupId || result.index !== index + offset) throw new Error('Chromium did not preserve the requested group position.');
              work.succeeded.add(tab.id!);
            }
          }
          const metadata = live.groups.find((group) => group.id === block.groupId);
          if (metadata) await browser.tabGroups.update(block.groupId, groupProperties(metadata));
        } else {
          const tab = members[0]!;
          if (tab.index !== index) {
            const moved = await browser.tabs.move(tab.id!, { index });
            const result = Array.isArray(moved) ? moved[0] : moved;
            if (result.windowId !== window.id || result.index !== index || result.pinned !== tab.pinned) throw new Error('Chromium did not preserve the requested tab position.');
            work.succeeded.add(tab.id!);
          }
        }
        index += block.tabs.length;
      }
    });
  }
}

async function changeGroups(work: Work, live: LiveState, action: 'ungroup' | 'collapse' | 'expand'): Promise<void> {
  for (const group of live.groups) {
    await attempt(work, `Group ${group.id} was not changed`, async () => {
      const original = live.tabs.filter((tab) => tab.groupId === group.id);
      const current = await browser.tabs.query({ groupId: group.id });
      if (!sameIds(current, original.map((tab) => tab.id!)) || current.some((tab) => tab.incognito !== work.recovery.incognito)) {
        throw new Error('The group changed during the action.');
      }
      if (action === 'ungroup') {
        for (const tab of current.filter((tab) => !isExcluded(tab, work.settings))) {
          await browser.tabs.ungroup(tab.id!);
          const updated = await browser.tabs.get(tab.id!);
          if (updated.groupId !== -1) throw new Error('Chromium did not ungroup the tab.');
          work.succeeded.add(tab.id!);
        }
      } else {
        if (current.some((tab) => isExcluded(tab, work.settings))) throw new Error('The group contains an excluded site and was left unchanged.');
        const collapsed = action === 'collapse';
        if (group.collapsed === collapsed) return;
        await browser.tabGroups.update(group.id, { collapsed });
        const updated = await browser.tabGroups.get(group.id);
        if (updated.collapsed !== collapsed) throw new Error('Chromium did not apply the requested group state.');
        current.forEach((tab) => work.succeeded.add(tab.id!));
      }
    });
  }
}

async function mergeWindows(work: Work, live: LiveState, targetId: number, sourceIds: number[]): Promise<void> {
  const targetActive = live.tabs.find((tab) => tab.windowId === targetId && tab.active);
  for (const sourceId of sourceIds) {
    const original = live.tabs.filter((tab) => tab.windowId === sourceId);
    const source = live.windows.find((window) => window.id === sourceId)!;
    if (source.type === 'popup' && original.length !== 1) {
      // ponytail: Chromium only supports tabs.move between normal windows. A single popup tab can use windows.create(tabId).
      // Multi-tab popups stay intact until Chromium exposes a supported transfer that also permits exact structural recovery.
      work.warnings.push(`Popup window ${sourceId} has multiple tabs and was left intact. Chromium cannot safely transfer this window.`);
      continue;
    }
    const processed = new Set<number>();
    for (const originalTab of original) {
      if (processed.has(originalTab.id!) || !work.recovery.touchedIds.includes(originalTab.id!)) continue;
      await attempt(work, `The transfer from window ${sourceId} was not completed`, async () => {
        const current = await readLive(work.recovery.incognito);
        const sourceWindow = currentWindow(current, sourceId);
        const targetWindow = currentWindow(current, targetId);
        if (targetWindow.type !== 'normal' || (!work.settings.mergeMinimized && sourceWindow.state === 'minimized')
          || (sourceWindow.type === 'popup' && !work.settings.mergePopups)) throw new Error('The source or destination is no longer eligible.');
        const tab = current.tabs.find((candidate) => candidate.id === originalTab.id);
        if (!tab || tab.windowId !== sourceId || isExcluded(tab, work.settings) || tab.groupId !== originalTab.groupId) {
          throw new Error('The tab moved or changed its eligibility.');
        }
        let movedGroup: { id: number; metadata: SavedGroup } | undefined;
        if (tab.groupId >= 0) {
          const originalMembers = original.filter((candidate) => candidate.groupId === originalTab.groupId);
          const currentMembers = current.tabs.filter((candidate) => candidate.groupId === tab.groupId);
          originalMembers.forEach((member) => processed.add(member.id!));
          if (!sameIds(currentMembers, originalMembers.map((member) => member.id!)) || currentMembers.some((member) => member.windowId !== sourceId || member.pinned)) {
            throw new Error('The group changed during the merge.');
          }
          const eligible = currentMembers.filter((member) => work.recovery.touchedIds.includes(member.id!) && !isExcluded(member, work.settings));
          if (!eligible.length) return;
          const metadata = live.groups.find((group) => group.id === originalTab.groupId && group.windowId === sourceId);
          if (!metadata) throw new Error('The original group metadata is unavailable.');
          let movingGroup = tab.groupId;
          if (eligible.length !== currentMembers.length) {
            movingGroup = await browser.tabs.group({ tabIds: eligible.map((member) => member.id!) as [number, ...number[]], createProperties: { windowId: sourceId } });
            await browser.tabGroups.update(movingGroup, groupProperties(metadata));
            work.warnings.push(`Group “${metadata.title || 'Untitled'}” was split. Excluded tabs remain in their source window.`);
          }
          const eligibleIds = eligible.map((member) => member.id!);
          await verifyGroup(movingGroup, eligibleIds, sourceId, work.recovery.incognito);
          const moved = await browser.tabGroups.move(movingGroup, { windowId: targetId, index: -1 });
          const actual = await browser.tabs.query({ windowId: targetId });
          const movedMembers = actual.filter((member) => eligibleIds.includes(member.id!));
          if (movedMembers.length !== eligibleIds.length || movedMembers.some((member) => member.groupId < 0 || member.incognito !== work.recovery.incognito)) {
            throw new Error('Chromium did not transfer the entire group. Recovery remains available.');
          }
          movedMembers.forEach((member) => work.succeeded.add(member.id!));
          const destinationGroup = moved?.id ?? movedMembers[0]!.groupId;
          await verifyGroup(destinationGroup, eligibleIds, targetId, work.recovery.incognito);
          movedGroup = { id: destinationGroup, metadata };
        } else {
          processed.add(tab.id!);
          if (sourceWindow.type === 'popup') {
            const popupTabs = current.tabs.filter((candidate) => candidate.windowId === sourceId);
            if (popupTabs.length !== 1) throw new Error('The popup gained another tab and was left intact.');
            const staging = await browser.windows.create({ tabId: tab.id, type: 'normal', incognito: work.recovery.incognito, focused: false });
            if (!staging || !isId(staging.id)) throw new Error('Chromium did not create the temporary normal window.');
            const stagedTab = await browser.tabs.get(tab.id!);
            if (stagedTab.windowId !== staging.id || stagedTab.incognito !== work.recovery.incognito) throw new Error('The popup tab was not transferred to the temporary window.');
          }
          const targetTabs = await browser.tabs.query({ windowId: targetId });
          const result = await browser.tabs.move(tab.id!, { windowId: targetId, index: tab.pinned ? targetTabs.filter((member) => member.pinned).length : -1 });
          let moved = Array.isArray(result) ? result[0] : result;
          if (moved.windowId !== targetId || moved.incognito !== work.recovery.incognito) throw new Error('Chromium did not transfer the tab.');
          if (moved.pinned !== tab.pinned) {
            await browser.tabs.update(tab.id!, { pinned: tab.pinned });
            moved = await browser.tabs.get(tab.id!);
            if (moved.pinned !== tab.pinned) throw new Error('Chromium did not restore the pinned state.');
          }
          work.succeeded.add(tab.id!);
        }
        if (targetActive) {
          const tabs = await browser.tabs.query({ windowId: targetId });
          const active = tabs.find((tab) => tab.id === targetActive.id && tab.incognito === work.recovery.incognito);
          if (active && !active.active) await browser.tabs.update(active.id!, { active: true });
        }
        // Restore activation first: an active group can expand when its tabs enter the destination.
        if (movedGroup) await browser.tabGroups.update(movedGroup.id, groupProperties(movedGroup.metadata));
      });
    }
  }
}

async function countChanges(work: Work): Promise<number> {
  if (work.recovery.kind === 'close') return work.succeeded.size;
  try {
    const live = await readLive(work.recovery.incognito);
    let changed = 0;
    for (const original of work.recovery.tabs.filter((tab) => work.recovery.touchedIds.includes(tab.id))) {
      const tab = live.tabs.find((candidate) => candidate.id === original.id);
      if (!tab) continue;
      const originalGroup = work.recovery.groups.find((group) => group.id === original.groupId);
      const group = live.groups.find((candidate) => candidate.id === tab.groupId);
      if (tab.windowId !== original.windowId || tab.index !== original.index || tab.pinned !== original.pinned || tab.groupId !== original.groupId
        || (originalGroup && group && ((group.title ?? '') !== (originalGroup.title ?? '') || group.color !== originalGroup.color || group.collapsed !== originalGroup.collapsed))) changed++;
    }
    return changed;
  } catch (error) {
    work.warnings.push(`The final tab count could not be refreshed: ${errorText(error)}`);
    return work.succeeded.size;
  }
}

async function runAction(request: Extract<Message, { type: 'run-action' }>, incognito: boolean): Promise<ActionResult> {
  const [settings, allLive, previous] = await Promise.all([getSettings(), readLive(incognito), loadRecovery(incognito)]);
  let live = scopedState(allLive, request.windowId, request.scope);
  const warnings: string[] = [];
  let touchedIds: number[] = [];
  let sourceIds: number[] = [];
  if (request.action === 'close-duplicates') {
    const safeIds = buildDuplicateGroups(live.tabs, settings).flatMap((group) => group.closeIds);
    touchedIds = request.tabIds === undefined ? safeIds : request.tabIds.filter((id) => safeIds.includes(id));
    const rejected = request.tabIds?.filter((id) => !safeIds.includes(id)) ?? [];
    if (rejected.length) warnings.push(`${rejected.length} selected tab(s) are no longer safe duplicates and were not closed.`);
  } else if (request.action === 'group') {
    touchedIds = planSiteGroups(live.tabs, settings).flatMap((group) => group.tabIds);
  } else if (request.action === 'sort') {
    for (const window of live.windows) {
      if (window.type !== 'normal') { warnings.push(`Popup window ${window.id} was not sorted. Chromium only supports tab moves in normal windows.`); continue; }
      const tabs = live.tabs.filter((tab) => tab.windowId === window.id);
      const plan = planSort(tabs, live.groups, settings);
      const desired = plan.flatMap((block) => block.tabs.map((tab) => tab.id!));
      if (tabs.some((tab, index) => tab.id !== desired[index])) touchedIds.push(...plan.filter((block) => !block.fixed).flatMap((block) => block.tabs.map((tab) => tab.id!)));
    }
  } else if (request.action === 'merge') {
    if (currentWindow(allLive, request.windowId).type !== 'normal') throw new Error('Use a normal browser window as the merge destination.');
    const eligible = mergeSources(allLive, request.windowId, settings);
    sourceIds = request.windowIds === undefined ? eligible : request.windowIds.filter((id) => eligible.includes(id));
    const rejected = request.windowIds?.filter((id) => !eligible.includes(id)) ?? [];
    if (rejected.length) warnings.push(`${rejected.length} selected window(s) are no longer eligible and were not merged.`);
    const involved = new Set([request.windowId, ...sourceIds]);
    live = {
      tabs: allLive.tabs.filter((tab) => involved.has(tab.windowId)), windows: allLive.windows.filter((window) => involved.has(window.id!)),
      groups: allLive.groups.filter((group) => involved.has(group.windowId)),
    };
    touchedIds = live.tabs.filter((tab) => sourceIds.includes(tab.windowId) && !isExcluded(tab, settings)).map((tab) => tab.id!);
  } else if (request.action === 'ungroup') {
    touchedIds = live.tabs.filter((tab) => tab.groupId >= 0 && !isExcluded(tab, settings)).map((tab) => tab.id!);
  } else {
    const desired = request.action === 'collapse';
    for (const group of live.groups) {
      const tabs = live.tabs.filter((tab) => tab.groupId === group.id);
      if (tabs.some((tab) => isExcluded(tab, settings))) { warnings.push(`Group “${group.title || 'Untitled'}” contains an excluded site and was left unchanged.`); continue; }
      if (group.collapsed !== desired) touchedIds.push(...tabs.map((tab) => tab.id!));
    }
  }
  if (!touchedIds.length) return { message: 'No eligible tabs need this action.', changed: 0, warnings, undoLabel: previous?.label ?? null };
  const work: Work = { recovery: snapshot(live, touchedIds, request.action, incognito), settings, warnings, succeeded: new Set(), failures: 0 };
  await saveRecovery(work.recovery);
  let persistenceFailed = false;
  try {
    switch (request.action) {
      case 'close-duplicates': await closeDuplicates(work, request.windowId, request.scope, touchedIds); break;
      case 'group': await groupSites(work, live); break;
      case 'sort': await sortTabs(work, live); break;
      case 'merge': await mergeWindows(work, live, request.windowId, sourceIds); break;
      default: await changeGroups(work, live, request.action); break;
    }
  } catch (error) {
    persistenceFailed = error instanceof RecoveryWriteError;
    warnings.push(errorText(error));
  }
  const changed = await countChanges(work);
  if (work.recovery.kind === 'close' && changed) warnings.push('Recovery reopens URLs. Form contents and navigation history are not guaranteed.');
  let undoLabel: string | null = work.recovery.label;
  if (!changed && !persistenceFailed && !work.failures && !work.succeeded.size && !work.recovery.pendingCloseIds.length) {
    if (previous) await saveRecovery(previous);
    else await browser.storage.session.remove(recoveryKey(incognito));
    undoLabel = previous?.label ?? null;
  }
  return {
    message: changed ? `${changed} tab(s) ${request.action === 'close-duplicates' ? 'closed' : 'changed'}.${warnings.length ? ' Review the warnings.' : ''}` : 'No tabs changed.',
    changed, warnings: [...new Set(warnings)], undoLabel,
  };
}

function restoredTabId(recovery: Recovery, id: number): number {
  return recovery.restoredTabs[String(id)] ?? id;
}

function restoredWindowId(recovery: Recovery, id: number): number {
  return recovery.restoredWindows[String(id)] ?? id;
}

function windowMarker(recovery: Recovery, id: number): string {
  return `about:blank#tab-tidy-window:${recovery.id}:${id}`;
}

function tabMarker(recovery: Recovery, id: number): string {
  return `about:blank#tab-tidy-reopen:${recovery.id}:${id}`;
}

function windowBounds(window: SavedWindow): { left?: number; top?: number; width?: number; height?: number } {
  return { left: window.left, top: window.top, width: window.width, height: window.height };
}

async function ensureRecoveryWindow(work: Work, original: SavedWindow, seedId?: number): Promise<number> {
  let live = await readLive(work.recovery.incognito);
  const mappedId = restoredWindowId(work.recovery, original.id);
  const existing = live.windows.find((window) => window.id === mappedId);
  if (existing) {
    if (existing.type !== original.type) throw new Error('The original window type changed.');
    return mappedId;
  }
  const marker = windowMarker(work.recovery, original.id);
  const markedTab = live.tabs.find((tab) => tab.url === marker || tab.pendingUrl === marker);
  const intent = work.recovery.windowIntents[String(original.id)];
  const seed = live.tabs.find((tab) => tab.id === (intent?.seedId ?? seedId));
  if (markedTab || (intent && seed && seed.windowId !== intent.fromWindowId)) {
    const adoptedId = markedTab?.windowId ?? seed!.windowId;
    const adopted = live.windows.find((window) => window.id === adoptedId);
    if (!adopted || adopted.type !== original.type) throw new Error('The reconstructed window changed before recovery could continue.');
    work.recovery.restoredWindows[String(original.id)] = adoptedId;
    await saveRecovery(work.recovery);
    return adoptedId;
  }
  if (seedId !== undefined && !seed) throw new Error('The tab needed to reconstruct the window is no longer present.');
  if (seed) {
    work.recovery.windowIntents[String(original.id)] = { seedId: seed.id!, fromWindowId: seed.windowId };
    await saveRecovery(work.recovery);
    if (seed.groupId >= 0) await browser.tabs.ungroup(seed.id!);
  }
  const created = await browser.windows.create({
    type: original.type === 'popup' ? 'popup' : 'normal', incognito: work.recovery.incognito, focused: false,
    ...windowBounds(original), ...(seed ? { tabId: seed.id } : { url: marker }),
  });
  if (!created || !isId(created.id) || created.incognito !== work.recovery.incognito) throw new Error('Chromium did not reconstruct the original window.');
  live = await readLive(work.recovery.incognito);
  if (seed && !live.tabs.some((tab) => tab.id === seed.id && tab.windowId === created.id)) throw new Error('The seed tab did not enter the reconstructed window.');
  work.recovery.restoredWindows[String(original.id)] = created.id;
  await saveRecovery(work.recovery);
  return created.id;
}

async function transferRecoveryTab(work: Work, id: number, targetId: number, pinned: boolean): Promise<void> {
  const live = await readLive(work.recovery.incognito);
  let tab = live.tabs.find((candidate) => candidate.id === id);
  if (!tab) throw new Error('The tab was closed after the action. Structural recovery does not recreate closed pages.');
  const target = currentWindow(live, targetId);
  if (tab.windowId !== targetId) {
    if (target.type !== 'normal') throw new Error('Chromium cannot add another existing tab to a popup window.');
    const source = currentWindow(live, tab.windowId);
    if (source.type !== 'normal') {
      if (live.tabs.filter((candidate) => candidate.windowId === tab!.windowId).length !== 1) throw new Error('The tab now belongs to a multi-tab popup and cannot be transferred safely.');
      const staging = await browser.windows.create({ tabId: id, type: 'normal', incognito: work.recovery.incognito, focused: false });
      if (!staging || !isId(staging.id)) throw new Error('Chromium could not transfer the popup tab to a normal window.');
    }
    if (tab.groupId >= 0) await browser.tabs.ungroup(id);
    const targetTabs = await browser.tabs.query({ windowId: targetId });
    await browser.tabs.move(id, { windowId: targetId, index: tab.pinned ? targetTabs.filter((candidate) => candidate.pinned).length : -1 });
    tab = await browser.tabs.get(id);
    if (tab.windowId !== targetId || tab.incognito !== work.recovery.incognito) throw new Error('Chromium did not restore the original tab window.');
    work.succeeded.add(id);
  }
  if (tab.pinned !== pinned) {
    await browser.tabs.update(id, { pinned });
    tab = await browser.tabs.get(id);
    if (tab.pinned !== pinned) throw new Error('Chromium did not restore the pinned state.');
    work.succeeded.add(id);
  }
}

async function reopenClosedTabs(work: Work): Promise<void> {
  const ids = [...new Set([...work.recovery.closedIds, ...work.recovery.pendingCloseIds])];
  for (const id of ids) {
    await attempt(work, `Closed tab ${id} could not be recovered`, async () => {
      const original = work.recovery.tabs.find((tab) => tab.id === id)!;
      let live = await readLive(work.recovery.incognito);
      if (live.tabs.some((tab) => tab.id === id)) return;
      const mapped = work.recovery.restoredTabs[String(id)];
      let tab = live.tabs.find((candidate) => candidate.id === mapped);
      if (mapped !== undefined && !tab) {
        work.warnings.push(`Tab ${id} was already reopened and was later closed. It was not recreated again.`);
        return;
      }
      const marker = tabMarker(work.recovery, id);
      if (!tab) tab = live.tabs.find((candidate) => candidate.url === marker || candidate.pendingUrl === marker);
      const originalWindow = work.recovery.windows.find((window) => window.id === original.windowId)!;
      const targetId = await ensureRecoveryWindow(work, originalWindow, tab?.id);
      live = await readLive(work.recovery.incognito);
      if (!tab) {
        // Reuse our empty reconstruction tab. Never remove a placeholder before a recovered page exists.
        tab = live.tabs.find((candidate) => candidate.windowId === targetId && candidate.url === windowMarker(work.recovery, original.windowId)
          && !Object.values(work.recovery.restoredTabs).includes(candidate.id!));
      }
      if (!tab) {
        tab = await browser.tabs.create({ windowId: targetId, url: marker, index: original.index, pinned: original.pinned, active: false });
      }
      if (!isId(tab.id) || tab.incognito !== work.recovery.incognito) throw new Error('Chromium did not create the recovery tab.');
      work.recovery.restoredTabs[String(id)] = tab.id;
      await saveRecovery(work.recovery);
      const placeholder = tab.url === marker || tab.pendingUrl === marker
        || tab.url === windowMarker(work.recovery, original.windowId) || tab.pendingUrl === windowMarker(work.recovery, original.windowId);
      if (placeholder && !work.recovery.navigatedIds?.includes(id)) {
        if (!original.url || getSite(original.url) === null) throw new Error('The saved page URL is not eligible for URL recovery.');
        await browser.tabs.update(tab.id, { url: original.url, pinned: original.pinned });
        // The update accepts navigation; queries can still expose the placeholder, and redirects are valid.
        (work.recovery.navigatedIds ??= []).push(id);
        work.succeeded.add(tab.id);
        await saveRecovery(work.recovery);
      }
      // A retry never navigates an already recovered tab, even if the user subsequently changed its URL.
    });
  }
}

async function restoreMemberships(work: Work, originals: SavedTab[]): Promise<void> {
  for (const original of originals.filter((tab) => tab.groupId < 0)) {
    await attempt(work, `Tab ${original.id} could not return to its original group state`, async () => {
      const id = restoredTabId(work.recovery, original.id);
      const tabs = (await readLive(work.recovery.incognito)).tabs;
      const current = tabs.find((tab) => tab.id === id);
      if (!current) throw new Error('The tab is no longer present.');
      if (current.groupId >= 0) {
        await browser.tabs.ungroup(id);
        if ((await browser.tabs.get(id)).groupId !== -1) throw new Error('Chromium did not restore the ungrouped state.');
        work.succeeded.add(id);
      }
    });
  }
  for (const originalGroup of work.recovery.groups) {
    const originalMembers = originals.filter((tab) => tab.groupId === originalGroup.id);
    if (!originalMembers.length) continue;
    await attempt(work, `Group “${originalGroup.title || 'Untitled'}” could not be fully restored`, async () => {
      let live = await readLive(work.recovery.incognito);
      const targetId = restoredWindowId(work.recovery, originalGroup.windowId);
      const intendedIds = originalMembers.map((tab) => restoredTabId(work.recovery, tab.id));
      const members = live.tabs.filter((tab) => intendedIds.includes(tab.id!) && tab.windowId === targetId && !tab.pinned);
      if (!members.length) throw new Error('No recoverable group members remain in the original window.');
      const originalAllIds = work.recovery.tabs.filter((tab) => tab.groupId === originalGroup.id).map((tab) => restoredTabId(work.recovery, tab.id));
      let groupId = work.recovery.restoredGroups[String(originalGroup.id)] ?? originalGroup.id;
      let group = live.groups.find((candidate) => candidate.id === groupId && candidate.windowId === targetId);
      if (group && live.tabs.some((tab) => tab.groupId === groupId && !originalAllIds.includes(tab.id!))) group = undefined;
      if (!group) {
        const candidateId = members[0]!.groupId;
        const common = candidateId >= 0 && members.every((tab) => tab.groupId === candidateId)
          && live.tabs.filter((tab) => tab.groupId === candidateId).every((tab) => originalAllIds.includes(tab.id!));
        group = common ? live.groups.find((candidate) => candidate.id === candidateId && candidate.windowId === targetId) : undefined;
        if (group) groupId = group.id;
      }
      if (!group || members.some((tab) => tab.groupId !== groupId)) {
        groupId = await browser.tabs.group({
          tabIds: members.map((tab) => tab.id!) as [number, ...number[]],
          ...(group ? { groupId } : { createProperties: { windowId: targetId } }),
        });
        members.forEach((tab) => work.succeeded.add(tab.id!));
      }
      work.recovery.restoredGroups[String(originalGroup.id)] = groupId;
      await saveRecovery(work.recovery);
      await browser.tabGroups.update(groupId, groupProperties(originalGroup));
      live = await readLive(work.recovery.incognito);
      const restored = live.groups.find((candidate) => candidate.id === groupId);
      if (!restored || restored.windowId !== targetId || restored.color !== originalGroup.color
        || (restored.title ?? '') !== (originalGroup.title ?? '') || restored.collapsed !== originalGroup.collapsed
        || members.some((member) => !live.tabs.some((tab) => tab.id === member.id && tab.groupId === groupId))) {
        throw new Error('Chromium did not restore all group members and metadata.');
      }
    });
  }
}

function insertionIndex(tabs: Browser.tabs.Tab[], desired: number, pinned: boolean): number {
  const pins = tabs.filter((tab) => tab.pinned).length;
  let index = pinned ? Math.min(desired, Math.max(0, pins - 1)) : Math.max(pins, Math.min(desired, tabs.length - 1));
  const at = tabs.find((tab) => tab.index === index);
  const previous = tabs.find((tab) => tab.index === index - 1);
  if (at && previous && at.groupId >= 0 && at.groupId === previous.groupId) {
    index = Math.min(...tabs.filter((tab) => tab.groupId === at.groupId).map((tab) => tab.index));
  }
  return index;
}

async function restoreOrder(work: Work, originals: SavedTab[]): Promise<void> {
  const touched = new Set(originals.map((tab) => tab.id));
  const processedGroups = new Set<number>();
  for (const original of [...originals].sort((a, b) => a.windowId - b.windowId || a.index - b.index)) {
    if (original.groupId >= 0 && processedGroups.has(original.groupId)) continue;
    if (original.groupId >= 0) processedGroups.add(original.groupId);
    await attempt(work, `The original order near tab ${original.id} could not be restored`, async () => {
      const targetId = restoredWindowId(work.recovery, original.windowId);
      const target = await browser.windows.get(targetId);
      if (target.incognito !== work.recovery.incognito) throw new Error('The original window belongs to another browser context.');
      if (target.type !== 'normal') return;
      let current = await browser.tabs.query({ windowId: targetId });
      const savedWindowTabs = work.recovery.tabs.filter((tab) => tab.windowId === original.windowId).sort((a, b) => a.index - b.index);
      const present = savedWindowTabs.filter((saved) => current.some((tab) => tab.id === restoredTabId(work.recovery, saved.id)));
      if (original.groupId >= 0) {
        const groupId = work.recovery.restoredGroups[String(original.groupId)] ?? original.groupId;
        const originalMembers = savedWindowTabs.filter((tab) => tab.groupId === original.groupId);
        const expectedIds = originalMembers.map((tab) => restoredTabId(work.recovery, tab.id));
        const members = current.filter((tab) => tab.groupId === groupId);
        if (!members.length || members.some((tab) => !expectedIds.includes(tab.id!))) throw new Error('Unrelated tabs now share this group. They were left in place.');
        const orderedIds = expectedIds.filter((id) => members.some((tab) => tab.id === id));
        const firstOriginal = originalMembers[0]!;
        const desired = present.filter((tab) => tab.index < firstOriginal.index).length;
        const index = Math.max(current.filter((tab) => tab.pinned).length, desired);
        if (Math.min(...members.map((tab) => tab.index)) !== index) {
          await browser.tabGroups.move(groupId, { windowId: targetId, index });
          await verifyGroup(groupId, orderedIds, targetId, work.recovery.incognito);
          members.filter((tab) => touched.has(work.recovery.tabs.find((saved) => restoredTabId(work.recovery, saved.id) === tab.id)?.id ?? -1))
            .forEach((tab) => work.succeeded.add(tab.id!));
        }
        for (let offset = 0; offset < orderedIds.length; offset++) {
          const tab = await browser.tabs.get(orderedIds[offset]!);
          const groupTabs = await browser.tabs.query({ groupId });
          const start = Math.min(...groupTabs.map((member) => member.index));
          if (tab.groupId !== groupId || tab.windowId !== targetId) throw new Error('A group member moved during recovery.');
          if (tab.index !== start + offset) {
            await browser.tabs.move(tab.id!, { index: start + offset });
            const updated = await browser.tabs.get(tab.id!);
            if (updated.groupId !== groupId || updated.index !== start + offset) throw new Error('Chromium did not restore the tab position within its group.');
            work.succeeded.add(tab.id!);
          }
        }
        const metadata = work.recovery.groups.find((group) => group.id === original.groupId);
        if (metadata) await browser.tabGroups.update(groupId, groupProperties(metadata));
      } else {
        const id = restoredTabId(work.recovery, original.id);
        const tab = current.find((candidate) => candidate.id === id);
        if (!tab || tab.groupId >= 0) throw new Error('The tab is missing or has not returned to its original group state.');
        const desired = present.filter((saved) => saved.index < original.index).length;
        const index = insertionIndex(current, desired, tab.pinned);
        if (tab.index !== index) {
          await browser.tabs.move(id, { index });
          const updated = await browser.tabs.get(id);
          if (updated.windowId !== targetId || updated.pinned !== original.pinned || updated.groupId !== -1) throw new Error('Chromium did not preserve the original tab structure.');
          work.succeeded.add(id);
        }
      }
    });
  }
}

async function restoreWindowMetadata(work: Work): Promise<void> {
  for (const [originalId, actualId] of Object.entries(work.recovery.restoredWindows)) {
    const original = work.recovery.windows.find((window) => window.id === Number(originalId))!;
    await attempt(work, `Window ${originalId} metadata could not be restored`, async () => {
      let window = await browser.windows.get(actualId);
      if (window.incognito !== work.recovery.incognito || window.type !== original.type) throw new Error('The reconstructed window changed context or type.');
      await browser.windows.update(actualId, { state: 'normal', ...windowBounds(original) });
      if (original.state && original.state !== 'normal') await browser.windows.update(actualId, { state: original.state });
      const active = work.recovery.tabs.find((tab) => tab.windowId === original.id && tab.active);
      if (active) {
        const id = restoredTabId(work.recovery, active.id);
        const tabs = await browser.tabs.query({ windowId: actualId });
        if (tabs.some((tab) => tab.id === id && !tab.active)) await browser.tabs.update(id, { active: true });
      }
      window = await browser.windows.get(actualId);
      if (original.state && window.state !== original.state) throw new Error('Chromium did not restore the original window state.');
    });
  }
}

async function restoreStructure(work: Work): Promise<SavedTab[]> {
  const originals = work.recovery.tabs.filter((tab) => work.recovery.touchedIds.includes(tab.id));
  for (const originalWindow of work.recovery.windows) {
    const owned = originals.filter((tab) => tab.windowId === originalWindow.id);
    if (!owned.length) continue;
    await attempt(work, `Window ${originalWindow.id} could not be reconstructed`, async () => {
      const live = await readLive(work.recovery.incognito);
      const seed = owned.find((saved) => live.tabs.some((tab) => tab.id === saved.id));
      if (!seed) throw new Error('All affected tabs in this window were closed after the action.');
      await ensureRecoveryWindow(work, originalWindow, seed.id);
    });
  }
  for (const original of originals) {
    await attempt(work, `Tab ${original.id} could not return to its original window`, async () => {
      await transferRecoveryTab(work, original.id, restoredWindowId(work.recovery, original.windowId), original.pinned);
    });
  }
  await restoreMemberships(work, originals);
  await restoreOrder(work, originals);
  return originals;
}

async function recoveryIsComplete(work: Work, originals: SavedTab[]): Promise<boolean> {
  const live = await readLive(work.recovery.incognito);
  if (work.recovery.kind === 'close') {
    for (const id of [...new Set([...work.recovery.closedIds, ...work.recovery.pendingCloseIds])]) {
      if (live.tabs.some((tab) => tab.id === id)) continue;
      const mapped = work.recovery.restoredTabs[String(id)];
      if (mapped === undefined) return false;
      const tab = live.tabs.find((candidate) => candidate.id === mapped);
      if (tab && !work.recovery.navigatedIds?.includes(id) && (tab.url === tabMarker(work.recovery, id) || tab.pendingUrl === tabMarker(work.recovery, id)
        || tab.url === windowMarker(work.recovery, work.recovery.tabs.find((saved) => saved.id === id)!.windowId))) return false;
    }
  }
  for (const original of originals) {
    const id = restoredTabId(work.recovery, original.id);
    const tab = live.tabs.find((candidate) => candidate.id === id);
    if (!tab) {
      if (work.recovery.kind === 'close' && work.recovery.restoredTabs[String(original.id)] !== undefined) continue;
      return false;
    }
    if (tab.windowId !== restoredWindowId(work.recovery, original.windowId) || tab.pinned !== original.pinned) return false;
    if (original.groupId < 0 ? tab.groupId >= 0 : tab.groupId !== (work.recovery.restoredGroups[String(original.groupId)] ?? original.groupId)) return false;
    if (original.groupId >= 0) {
      const saved = work.recovery.groups.find((group) => group.id === original.groupId);
      const actual = live.groups.find((group) => group.id === tab.groupId);
      if (!saved || !actual || (actual.title ?? '') !== (saved.title ?? '') || actual.color !== saved.color || actual.collapsed !== saved.collapsed) return false;
    }
  }
  for (const window of work.recovery.windows) {
    const expected = originals.filter((tab) => tab.windowId === window.id)
      .sort((a, b) => a.index - b.index).map((tab) => restoredTabId(work.recovery, tab.id))
      .filter((id) => live.tabs.some((tab) => tab.id === id));
    const actual = live.tabs.filter((tab) => tab.windowId === restoredWindowId(work.recovery, window.id) && expected.includes(tab.id!))
      .sort((a, b) => a.index - b.index).map((tab) => tab.id);
    if (expected.some((id, index) => actual[index] !== id)) return false;
  }
  return true;
}

async function undo(incognito: boolean): Promise<ActionResult> {
  const recovery = await loadRecovery(incognito);
  if (!recovery) return { message: 'There is no action to recover in this browser context.', changed: 0, warnings: [], undoLabel: null };
  const work: Work = { recovery, settings: await getSettings(), warnings: [], succeeded: new Set(), failures: 0 };
  const before = await readLive(incognito);
  let originals: SavedTab[] = [];
  let failed = false;
  try {
    await saveRecovery(recovery);
    if (recovery.kind === 'close') {
      await reopenClosedTabs(work);
      const recovered = await readLive(incognito);
      originals = recovery.tabs.filter((tab) => recovery.restoredTabs[String(tab.id)] !== undefined)
        .filter((saved) => recovered.tabs.some((tab) => tab.id === recovery.restoredTabs[String(saved.id)]));
      for (const original of originals) {
        await attempt(work, `Recovered tab ${original.id} could not return to its original window`, async () => {
          await transferRecoveryTab(work, restoredTabId(recovery, original.id), restoredWindowId(recovery, original.windowId), original.pinned);
        });
      }
      await restoreMemberships(work, originals);
      await restoreOrder(work, originals);
    } else {
      originals = await restoreStructure(work);
    }
    await restoreWindowMetadata(work);
    // Keep failures available for another explicit retry. No retry runs without a manual request.
    failed = work.failures > 0 || !(await recoveryIsComplete(work, originals));
    if (failed) await saveRecovery(recovery);
    else await browser.storage.session.remove(recoveryKey(incognito));
  } catch (error) {
    failed = true;
    work.warnings.push(errorText(error));
  }
  let changed = work.succeeded.size;
  if (recovery.kind === 'structure') {
    try {
      const after = await readLive(incognito);
      changed = recovery.touchedIds.filter((id) => {
        const previous = before.tabs.find((tab) => tab.id === id);
        const current = after.tabs.find((tab) => tab.id === id);
        if (!previous || !current) return false;
        const previousGroup = before.groups.find((group) => group.id === previous.groupId);
        const currentGroup = after.groups.find((group) => group.id === current.groupId);
        return previous.windowId !== current.windowId || previous.index !== current.index || previous.pinned !== current.pinned || previous.groupId !== current.groupId
          || (!!previousGroup && !!currentGroup && ((previousGroup.title ?? '') !== (currentGroup.title ?? '')
            || previousGroup.color !== currentGroup.color || previousGroup.collapsed !== currentGroup.collapsed));
      }).length;
    } catch (error) {
      work.warnings.push(`The recovery count could not be refreshed: ${errorText(error)}`);
    }
  }
  if (recovery.kind === 'close') work.warnings.push('Recovery reopens URLs. Form contents and navigation history are not guaranteed.');
  if (failed) work.warnings.push('Recovery is incomplete. The saved record remains available for a manual retry.');
  return {
    message: failed ? `${changed} tab(s) recovered so far. Review the warnings.` : `${changed} tab(s) recovered.`,
    changed, warnings: [...new Set(work.warnings)], undoLabel: failed ? recovery.label : null,
  };
}

async function dispatch(request: Message, incognito: boolean): Promise<unknown> {
  switch (request.type) {
    case 'get-state': return getState(request.windowId, request.scope, incognito);
    case 'run-action': return runAction(request, incognito);
    case 'undo': return undo(incognito);
    case 'get-settings': return getSettings();
    case 'save-settings': return saveSettings(request.settings);
    case 'reset-settings': return saveSettings(DEFAULT_SETTINGS);
  }
}

export function handleRequest(request: Message, incognito: boolean): Promise<unknown> {
  const result = queue.then(() => dispatch(request, incognito));
  // The caller receives the original rejection. Only the queue tail recovers, so one failed action cannot block later requests.
  queue = result.then(() => undefined, () => undefined);
  return result;
}

export async function runCommand(command: string, incognito: boolean): Promise<ActionResult> {
  if (!['close-duplicates', 'group', 'sort', 'merge'].includes(command)) throw new Error('Unknown keyboard command.');
  const live = await readLive(incognito);
  const focused = await browser.windows.getLastFocused({ windowTypes: ['normal'] });
  const window = live.windows.find((candidate) => candidate.id === focused.id);
  if (!window || !isId(window.id)) throw new Error('There is no eligible focused window in this browser context.');
  const settings = await getSettings();
  return handleRequest({ type: 'run-action', windowId: window.id, scope: settings.scope, action: command as Action }, incognito) as Promise<ActionResult>;
}
