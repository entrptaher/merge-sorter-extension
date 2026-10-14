import { browser, type Browser } from 'wxt/browser';
import type { Action, ActionResult, ExtensionState, Scope, Settings } from '../../utils/model';
import { getSite, isExcluded, planSiteGroups, planSort } from '../../utils/model';
import { sendRequest } from '../../utils/client';
import '../../assets/tidy.css';
import './style.css';

const main = document.querySelector<HTMLElement>('#popup-main')!;
const scopeInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="scope"]'));
const summary = document.querySelector<HTMLElement>('#tab-summary')!;
const optionsButton = document.querySelector<HTMLButtonElement>('#options-button')!;
const refreshButton = document.querySelector<HTMLButtonElement>('#refresh-button')!;
const closeButton = document.querySelector<HTMLButtonElement>('#close-button')!;
const duplicateCount = document.querySelector<HTMLElement>('#duplicate-count')!;
const duplicateNote = document.querySelector<HTMLElement>('#duplicate-note')!;
const duplicateReview = document.querySelector<HTMLDetailsElement>('#duplicate-review')!;
const reviewCount = document.querySelector<HTMLElement>('#review-count')!;
const duplicateList = document.querySelector<HTMLElement>('#duplicate-list')!;
const sortSelect = document.querySelector<HTMLSelectElement>('#sort-by')!;
const sortButton = document.querySelector<HTMLButtonElement>('#sort-button')!;
const sortNote = document.querySelector<HTMLElement>('#sort-note')!;
const groupSelect = document.querySelector<HTMLSelectElement>('#group-action')!;
const groupButton = document.querySelector<HTMLButtonElement>('#group-button')!;
const groupNote = document.querySelector<HTMLElement>('#group-note')!;
const mergeButton = document.querySelector<HTMLButtonElement>('#merge-button')!;
const mergeCount = document.querySelector<HTMLElement>('#merge-count')!;
const mergeNote = document.querySelector<HTMLElement>('#merge-note')!;
const mergeReview = document.querySelector<HTMLDetailsElement>('#merge-review')!;
const mergeList = document.querySelector<HTMLElement>('#merge-list')!;
const status = document.querySelector<HTMLElement>('#status')!;
const warnings = document.querySelector<HTMLElement>('#warnings')!;
const undoButton = document.querySelector<HTMLButtonElement>('#undo-button')!;
const undoLabel = document.querySelector<HTMLElement>('#undo-label')!;
const retryButton = document.querySelector<HTMLButtonElement>('#retry-button')!;

let windowId: number | null = null;
let scope: Scope = 'current';
let state: ExtensionState | null = null;
let sourceState: ExtensionState | null = null;
let busy = false;
let refreshing = true;
let stale = true;
let readFailed = false;
let loadedOnce = false;
let sortChoiceChanged = false;
let refreshSequence = 0;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let pendingRefresh = false;
let lastResult: ActionResult | null = null;
let reviewFocusId = '';
const duplicateChoices = new Map<number, boolean>();
const windowChoices = new Map<number, boolean>();

const plural = (count: number, word: string) => `${count} ${count === 1 ? word : word.endsWith('copy') ? `${word.slice(0, -1)}ies` : `${word}s`}`;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'An unexpected browser error occurred.';

function showFeedback(message: string, tone = 'neutral', details: string[] = []) {
  status.textContent = message;
  status.dataset.tone = tone;
  warnings.replaceChildren(...details.map((warning) => {
    const item = document.createElement('li');
    item.textContent = warning;
    return item;
  }));
  warnings.hidden = details.length === 0;
}

function selectedDuplicateIds(): number[] {
  const ids = state?.duplicateGroups.flatMap((group) => group.closeIds) ?? [];
  return [...new Set(ids)].filter((id) => duplicateChoices.get(id) !== false);
}

function selectedWindowIds(): number[] {
  return state?.mergeWindowIds.filter((id) => windowChoices.get(id) !== false) ?? [];
}

function canSort(): boolean {
  if (!state) return false;
  if (sortSelect.value === 'custom' && state.settings.siteOrder.length === 0) return false;
  const settings = { ...state.settings, sortBy: sortSelect.value as Settings['sortBy'] };
  for (const id of new Set(state.tabs.map((tab) => tab.windowId))) {
    if (state.windows.find((window) => window.id === id)?.type !== 'normal') continue;
    const tabs = state.tabs.filter((tab) => tab.windowId === id).sort((a, b) => a.index - b.index);
    const desired = planSort(tabs, state.groups, settings).flatMap((block) => block.tabs);
    if (desired.some((tab, index) => tab.id !== tabs[index]?.id)) return true;
  }
  return false;
}

function canGroup(action: string): boolean {
  if (!state) return false;
  const current = state;
  if (action === 'group') {
    return planSiteGroups(current.tabs, current.settings).some((plan) => {
      if (current.windows.find((window) => window.id === plan.windowId)?.type !== 'normal') return false;
      const tabs = current.tabs.filter((tab) => plan.tabIds.includes(tab.id ?? -1));
      const groupId = tabs[0]?.groupId ?? -1;
      const alreadyGrouped = groupId >= 0 && tabs.every((tab) => tab.groupId === groupId)
        && current.tabs.filter((tab) => tab.groupId === groupId).length === tabs.length;
      return !alreadyGrouped;
    });
  }
  const settings = state.settings;
  return current.groups.some((group) => {
    const tabs = current.tabs.filter((tab) => tab.groupId === group.id);
    if (action === 'ungroup') return tabs.some((tab) => !isExcluded(tab, settings));
    return tabs.length > 0 && tabs.every((tab) => !isExcluded(tab, settings))
      && (action === 'collapse' ? !group.collapsed : group.collapsed);
  });
}

function updateControls() {
  const blocked = busy || refreshing || stale || !state;
  const activeId = document.activeElement instanceof HTMLElement ? document.activeElement.id : '';
  if (/^(duplicate|window|tab-title)-\d+$/.test(activeId)) reviewFocusId = activeId;
  main.setAttribute('aria-busy', String(busy || refreshing));
  optionsButton.disabled = busy;
  refreshButton.disabled = busy || refreshing || windowId === null;
  retryButton.disabled = busy || refreshing;
  retryButton.hidden = !readFailed;
  for (const input of scopeInputs) {
    input.checked = input.value === scope;
    input.disabled = busy || windowId === null;
  }
  const selected = selectedDuplicateIds().length;
  const removable = new Set(state?.duplicateGroups.flatMap((group) => group.closeIds) ?? []).size;
  duplicateCount.textContent = String(selected);
  closeButton.setAttribute('aria-label', `Close ${plural(selected, 'duplicate tab')}`);
  closeButton.disabled = blocked || selected === 0;
  if (state) {
    reviewCount.textContent = plural(state.duplicateGroups.length, 'page');
    duplicateNote.textContent = removable === 0
      ? 'No removable duplicates.'
      : selected === removable
        ? `${plural(selected, 'duplicate')} selected. Protected tabs stay open.`
        : `${selected} of ${plural(removable, 'duplicate')} selected.`;
  }
  sortSelect.disabled = blocked;
  sortButton.disabled = blocked || !canSort();
  groupSelect.disabled = blocked;
  groupButton.disabled = blocked || !canGroup(groupSelect.value);
  groupButton.textContent = groupSelect.value === 'group' ? 'Group' : 'Apply';
  groupButton.setAttribute('aria-label', groupSelect.selectedOptions[0]?.textContent ?? 'Apply group action');
  const sources = state?.mergeWindowIds.length ?? 0;
  const chosenSources = selectedWindowIds().length;
  mergeCount.textContent = String(chosenSources);
  mergeButton.disabled = blocked || chosenSources === 0;
  mergeButton.setAttribute('aria-label', `Merge ${plural(chosenSources, 'source window')} into this window`);
  mergeNote.textContent = sources === chosenSources
    ? `${plural(sources, 'eligible window')} → this window`
    : `${chosenSources} of ${plural(sources, 'eligible window')} → this window`;
  for (const control of document.querySelectorAll<HTMLInputElement | HTMLButtonElement>('.review-row input, .review-row button.tab-title, .window-choice input')) {
    control.disabled = blocked;
  }
  undoButton.hidden = !state?.undo;
  undoButton.disabled = blocked || !state?.undo;
  undoLabel.textContent = state?.undo?.kind === 'structure'
    ? `Undo: ${state.undo.label}`
    : state?.undo?.label ?? lastResult?.undoLabel ?? 'Undo last action';
  if (state) {
    if (sortSelect.value === 'custom' && state.settings.siteOrder.length === 0) {
      sortNote.textContent = 'Add a site priority in Options.';
    } else {
      sortNote.textContent = sortSelect.value === 'encounter'
        ? `Sites from the ${state.settings.sortDirection === 'asc' ? 'left' : 'right'}.`
        : `${state.settings.sortDirection === 'asc' ? 'Ascending' : 'Descending'} · ${state.settings.sortPinned ? 'includes pinned tabs' : 'pinned tabs unchanged'}`;
    }
    groupNote.textContent = groupSelect.value === 'group'
      ? `${state.settings.minimumGroupSize}+ tabs per site · ${state.settings.preserveGroups ? 'keep' : 'replace'} existing groups`
      : 'Uses the selected scope.';
  }
  if (stale) summary.textContent = refreshing ? 'Read current tab state…' : 'Tab state changed. Refresh before you act.';
}

function protectionLabels(tab: Browser.tabs.Tab): string[] {
  if (!state) return [];
  const labels: string[] = [];
  if (state.settings.protectPinned && tab.pinned) labels.push('Pinned');
  if (state.settings.protectActive && tab.active) labels.push('Active');
  if (state.settings.protectAudible && tab.audible) labels.push('Audio');
  return labels;
}

function renderDuplicates() {
  if (!state) return;
  const fragment = document.createDocumentFragment();
  for (const group of state.duplicateGroups) {
    const section = document.createElement('section');
    section.className = 'duplicate-group';
    const heading = document.createElement('h3');
    heading.textContent = getSite(group.url) ?? group.title;
    const url = document.createElement('p');
    url.className = 'hint';
    url.title = group.url;
    url.textContent = group.url.length > 140 ? `${group.url.slice(0, 137)}…` : group.url;
    section.append(heading, url);
    for (const tab of group.tabs) {
      const removable = tab.id !== undefined && group.closeIds.includes(tab.id);
      const row = document.createElement('div');
      row.className = 'review-row';
      const titleText = tab.title || getSite(tab.url ?? '') || tab.url || 'Untitled tab';
      if (removable && tab.id !== undefined) {
        const tabId = tab.id;
        if (!duplicateChoices.has(tabId)) duplicateChoices.set(tabId, true);
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `duplicate-${tabId}`;
        checkbox.checked = duplicateChoices.get(tabId) !== false;
        checkbox.setAttribute('aria-label', `Close copy: ${titleText}`);
        checkbox.addEventListener('change', () => {
          duplicateChoices.set(tabId, checkbox.checked);
          updateControls();
        });
        row.append(checkbox);
      } else {
        const marker = document.createElement('span');
        marker.className = 'review-marker';
        marker.setAttribute('aria-hidden', 'true');
        marker.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><path d="m5 12 4 4 10-10"/></svg>';
        row.append(marker);
      }
      const content = document.createElement('div');
      content.className = 'review-content';
      const tabId = tab.id!;
      const title = document.createElement('button');
      title.type = 'button';
      title.id = `tab-title-${tabId}`;
      title.className = 'tab-title';
      title.textContent = titleText;
      title.title = tab.url ?? titleText;
      title.setAttribute('aria-label', `Open tab: ${titleText}`);
      title.addEventListener('click', () => { void focusTab(tabId); });
      const meta = document.createElement('p');
      meta.className = 'hint';
      const protections = protectionLabels(tab);
      meta.textContent = [getSite(tab.url ?? '') ?? 'Page', `Window ${tab.windowId}`, ...protections].join(' · ');
      content.append(title, meta);
      const badge = document.createElement('span');
      badge.className = 'tab-badge';
      badge.dataset.kind = removable ? 'close' : 'keep';
      badge.textContent = removable ? 'Close' : protections.length > 0 ? 'Protected' : 'Keep';
      row.append(content, badge);
      section.append(row);
    }
    fragment.append(section);
  }
  if (state.duplicateGroups.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hint review-help';
    empty.textContent = 'No matching pages in this scope. Complete URLs match by default.';
    fragment.append(empty);
  }
  duplicateList.replaceChildren(fragment);
}

function renderMerge() {
  if (!state) return;
  const sourceInfo = sourceState ?? state;
  const fragment = document.createDocumentFragment();
  for (const id of state.mergeWindowIds) {
    if (!windowChoices.has(id)) windowChoices.set(id, true);
    const label = document.createElement('label');
    label.className = 'window-choice';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `window-${id}`;
    checkbox.checked = windowChoices.get(id) !== false;
    checkbox.addEventListener('change', () => {
      windowChoices.set(id, checkbox.checked);
      updateControls();
    });
    const text = document.createElement('span');
    text.textContent = `Window ${id}`;
    const source = sourceInfo.windows.find((item) => item.id === id);
    if (source) {
      const tabs = sourceInfo.tabs.filter((tab) => tab.windowId === id);
      const hint = document.createElement('span');
      hint.className = 'hint';
      const activeTitle = tabs.find((tab) => tab.active)?.title;
      hint.textContent = [plural(tabs.length, 'tab'), source.state === 'minimized' ? 'Minimized' : '',
        source.type === 'popup' ? 'Popup' : '', activeTitle ?? ''].filter(Boolean).join(' · ');
      text.append(hint);
    }
    label.append(checkbox, text);
    fragment.append(label);
  }
  if (state.mergeWindowIds.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'No eligible source windows.';
    fragment.append(empty);
  }
  mergeList.replaceChildren(fragment);
}

async function refreshState() {
  if (windowId === null) return;
  clearTimeout(refreshTimer);
  pendingRefresh = false;
  const sequence = ++refreshSequence;
  refreshing = true;
  stale = true;
  updateControls();
  try {
    const [next, sources] = await Promise.all([
      sendRequest<ExtensionState>({ type: 'get-state', windowId, scope }),
      mergeReview.open && scope === 'current'
        ? sendRequest<ExtensionState>({ type: 'get-state', windowId, scope: 'all' })
        : Promise.resolve(null),
    ]);
    if (sequence !== refreshSequence) return;
    state = next;
    sourceState = sources ?? (scope === 'all' ? next : null);
    if (!sortChoiceChanged) sortSelect.value = next.settings.sortBy;
    stale = false;
    summary.textContent = `${plural(next.tabs.length, 'tab')} · ${plural(next.windows.length, 'window')}`;
    renderDuplicates();
    renderMerge();
    if (!loadedOnce || readFailed) {
      showFeedback(lastResult?.message ?? 'Ready.',
        lastResult?.warnings.length ? 'warning' : 'neutral', lastResult?.warnings ?? []);
    }
    loadedOnce = true;
    readFailed = false;
  } catch (error) {
    if (sequence !== refreshSequence) return;
    readFailed = true;
    const prefix = lastResult ? `${lastResult.message} ` : '';
    showFeedback(`${prefix}Could not refresh tabs. ${errorMessage(error)}`, 'error', lastResult?.warnings ?? []);
  } finally {
    if (sequence === refreshSequence) {
      refreshing = false;
      updateControls();
      if (!busy && !stale && reviewFocusId && document.activeElement === document.body) {
        document.getElementById(reviewFocusId)?.focus({ preventScroll: true });
        reviewFocusId = '';
      }
    }
  }
}

function scheduleRefresh() {
  stale = true;
  ++refreshSequence;
  updateControls();
  clearTimeout(refreshTimer);
  if (busy) {
    pendingRefresh = true;
    return;
  }
  refreshTimer = setTimeout(() => { void refreshState(); }, 140);
}

async function focusTab(tabId: number) {
  if (busy || refreshing || stale || !state) return;
  busy = true;
  showFeedback('Opening the selected tab…');
  updateControls();
  try {
    const liveTab = await browser.tabs.get(tabId);
    const activatedTab = await browser.tabs.update(tabId, { active: true });
    await browser.windows.update(activatedTab?.windowId ?? liveTab.windowId, { focused: true });
    showFeedback('Tab focused.');
  } catch (error) {
    showFeedback(`Could not open this tab. It may have closed or moved. ${errorMessage(error)}`, 'error');
  } finally {
    await refreshState();
    busy = false;
    updateControls();
    if (pendingRefresh || stale) scheduleRefresh();
  }
}

async function runAction(action: Action) {
  if (busy || refreshing || stale || !state || windowId === null) return;
  const tabIds = action === 'close-duplicates' ? selectedDuplicateIds() : undefined;
  const windowIds = action === 'merge' ? selectedWindowIds() : undefined;
  if ((tabIds && tabIds.length === 0) || (windowIds && windowIds.length === 0)) return;
  busy = true;
  lastResult = null;
  const progress: Record<Action, string> = {
    'close-duplicates': 'Closing the selected duplicate copies…',
    group: 'Grouping eligible tabs by site…',
    sort: 'Sorting tabs in the selected scope…',
    merge: 'Merging the selected source windows…',
    ungroup: 'Removing eligible tab groups…',
    collapse: 'Collapsing eligible groups…',
    expand: 'Expanding eligible groups…',
  };
  showFeedback(progress[action]);
  updateControls();
  try {
    if (action === 'sort') {
      const settings = await sendRequest<Settings>({ type: 'get-settings' });
      const sortBy = sortSelect.value as Settings['sortBy'];
      if (settings.sortBy !== sortBy) {
        await sendRequest<Settings>({ type: 'save-settings', settings: { ...settings, sortBy } });
      }
      sortChoiceChanged = false;
    }
    lastResult = await sendRequest<ActionResult>({ type: 'run-action', windowId, scope, action, tabIds, windowIds });
    showFeedback(lastResult.message, lastResult.warnings.length ? 'warning' : 'neutral', lastResult.warnings);
  } catch (error) {
    showFeedback(`The action did not complete. ${errorMessage(error)}`, 'error');
  } finally {
    await refreshState();
    busy = false;
    updateControls();
    if (pendingRefresh || stale) scheduleRefresh();
  }
}

async function undo() {
  if (busy || refreshing || stale || !state?.undo) return;
  busy = true;
  lastResult = null;
  showFeedback(state.undo.kind === 'close' ? 'Reopening the closed duplicate pages…' : 'Restoring the last tab arrangement…');
  updateControls();
  try {
    lastResult = await sendRequest<ActionResult>({ type: 'undo' });
    showFeedback(lastResult.message, lastResult.warnings.length ? 'warning' : 'neutral', lastResult.warnings);
  } catch (error) {
    showFeedback(`Recovery did not complete. ${errorMessage(error)}`, 'error');
  } finally {
    await refreshState();
    busy = false;
    updateControls();
    if (pendingRefresh || stale) scheduleRefresh();
  }
}

optionsButton.addEventListener('click', async () => {
  try {
    await browser.runtime.openOptionsPage();
  } catch (error) {
    showFeedback(`Could not open Options. ${errorMessage(error)}`, 'error');
  }
});
refreshButton.addEventListener('click', () => { void refreshState(); });
retryButton.addEventListener('click', () => { void (windowId === null ? initialize() : refreshState()); });
for (const input of scopeInputs) {
  input.addEventListener('change', () => {
    if (input.checked) {
      scope = input.value as Scope;
      void refreshState();
    }
  });
}
sortSelect.addEventListener('change', () => { sortChoiceChanged = true; updateControls(); });
groupSelect.addEventListener('change', updateControls);
closeButton.addEventListener('click', () => { void runAction('close-duplicates'); });
sortButton.addEventListener('click', () => { void runAction('sort'); });
groupButton.addEventListener('click', () => { void runAction(groupSelect.value as Action); });
mergeButton.addEventListener('click', () => { void runAction('merge'); });
undoButton.addEventListener('click', () => { void undo(); });
duplicateReview.addEventListener('toggle', () => { if (duplicateReview.open) scheduleRefresh(); });
mergeReview.addEventListener('toggle', () => { if (mergeReview.open) scheduleRefresh(); });

// Browser events invalidate the preview; only explicit clicks send mutation requests.
browser.tabs.onCreated.addListener(scheduleRefresh);
browser.tabs.onRemoved.addListener((id) => { duplicateChoices.delete(id); scheduleRefresh(); });
browser.tabs.onUpdated.addListener(scheduleRefresh);
browser.tabs.onMoved.addListener(scheduleRefresh);
browser.tabs.onAttached.addListener(scheduleRefresh);
browser.tabs.onDetached.addListener(scheduleRefresh);
browser.tabs.onActivated.addListener(scheduleRefresh);
browser.windows.onCreated.addListener(scheduleRefresh);
browser.windows.onRemoved.addListener((id) => { windowChoices.delete(id); scheduleRefresh(); });
browser.tabGroups.onCreated.addListener(scheduleRefresh);
browser.tabGroups.onUpdated.addListener(scheduleRefresh);
browser.tabGroups.onRemoved.addListener(scheduleRefresh);
browser.tabGroups.onMoved.addListener(scheduleRefresh);
browser.storage.onChanged.addListener((_changes, area) => { if (area === 'local') scheduleRefresh(); });

async function initialize() {
  refreshing = true;
  showFeedback('Reading browser tabs…');
  updateControls();
  try {
    const [currentWindow, settings] = await Promise.all([
      browser.windows.getCurrent(),
      sendRequest<Settings>({ type: 'get-settings' }),
    ]);
    if (currentWindow.id === undefined) throw new Error('The current browser window is unavailable.');
    windowId = currentWindow.id;
    scope = settings.scope;
    sortSelect.value = settings.sortBy;
    await refreshState();
  } catch (error) {
    refreshing = false;
    readFailed = true;
    showFeedback(`Could not read browser tabs. ${errorMessage(error)}`, 'error');
    updateControls();
  }
}

void initialize();
