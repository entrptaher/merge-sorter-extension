import type { Browser } from 'wxt/browser';

export type Scope = 'current' | 'all';
export type Action = 'close-duplicates' | 'group' | 'sort' | 'merge' | 'ungroup' | 'collapse' | 'expand';

export interface Settings {
  scope: Scope;
  sortBy: 'site' | 'title' | 'url' | 'custom' | 'encounter';
  sortDirection: 'asc' | 'desc';
  siteOrder: string[];
  sortGroupsByTitle: boolean;
  sortPinned: boolean;
  preserveGroups: boolean;
  minimumGroupSize: number;
  collapseNewGroups: boolean;
  ignoreHash: boolean;
  ignoreQuery: boolean;
  keeper: 'recent' | 'oldest';
  protectPinned: boolean;
  protectActive: boolean;
  protectAudible: boolean;
  excludedSites: string[];
  mergeMinimized: boolean;
  mergePopups: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  scope: 'current',
  sortBy: 'site',
  sortDirection: 'asc',
  siteOrder: [],
  sortGroupsByTitle: false,
  sortPinned: false,
  preserveGroups: true,
  minimumGroupSize: 2,
  collapseNewGroups: false,
  ignoreHash: false,
  ignoreQuery: false,
  keeper: 'recent',
  protectPinned: true,
  protectActive: true,
  protectAudible: true,
  excludedSites: [],
  mergeMinimized: false,
  mergePopups: false,
};

export type DuplicateGroup = {
  key: string;
  title: string;
  url: string;
  tabs: Browser.tabs.Tab[];
  closeIds: number[];
  keepIds: number[];
};

export type ExtensionState = {
  tabs: Browser.tabs.Tab[];
  windows: Browser.windows.Window[];
  groups: Browser.tabGroups.TabGroup[];
  currentWindowId: number;
  settings: Settings;
  duplicateGroups: DuplicateGroup[];
  mergeWindowIds: number[];
  undo: { label: string; kind: 'structure' | 'close' } | null;
};

export type ActionResult = { message: string; changed: number; warnings: string[]; undoLabel: string | null };

export type Message =
  | { type: 'get-state'; windowId: number; scope: Scope }
  | { type: 'run-action'; windowId: number; scope: Scope; action: Action; tabIds?: number[]; windowIds?: number[] }
  | { type: 'undo' }
  | { type: 'get-settings' }
  | { type: 'save-settings'; settings: Settings }
  | { type: 'reset-settings' };

export type Response<T> = { ok: true; data: T } | { ok: false; error: string };

export function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

export function isId(input: unknown): input is number {
  return typeof input === 'number' && Number.isSafeInteger(input) && input >= 0;
}

function webUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null;
  } catch {
    return null;
  }
}

function hostname(url: URL): string {
  return url.hostname.toLowerCase().replace(/\.$/, '');
}

export function getSite(url: string | undefined): string | null {
  const parsed = webUrl(url);
  return parsed ? hostname(parsed).replace(/^www\./, '') : null;
}

export function normalizeHostname(input: string): string {
  const value = input.trim();
  if (!value || value.length > 2048 || /[\s*\\]/.test(value)) throw new Error('Enter a hostname without spaces or wildcards.');
  const isUrl = /^https?:\/\//i.test(value);
  if (!isUrl && /[/?#@]/.test(value)) throw new Error('Enter a hostname, such as example.com.');
  const parsed = webUrl(isUrl ? value : `https://${value}`);
  if (!parsed || parsed.username || parsed.password || parsed.port) throw new Error('Enter a hostname without credentials or a port.');
  const host = hostname(parsed);
  if (!host || host.length > 253 || (!/^\[[0-9a-f:]+\]$/i.test(host) && host.split('.').some(
    (label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label),
  ))) throw new Error(`Invalid hostname: ${value}`);
  return host;
}

export function validateSettings(input: unknown): Settings {
  if (!isRecord(input)) throw new Error('Settings must be an object.');
  if (Object.keys(input).some((key) => !Object.hasOwn(DEFAULT_SETTINGS, key))) throw new Error('Unknown settings field.');
  const enums = {
    scope: ['current', 'all'],
    sortBy: ['site', 'title', 'url', 'custom', 'encounter'],
    sortDirection: ['asc', 'desc'],
    keeper: ['recent', 'oldest'],
  };
  for (const [key, values] of Object.entries(enums)) {
    if (typeof input[key] !== 'string' || !values.includes(input[key] as string)) throw new Error(`Invalid setting: ${key}`);
  }
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (typeof DEFAULT_SETTINGS[key as keyof Settings] === 'boolean' && typeof input[key] !== 'boolean') {
      throw new Error(`Invalid setting: ${key}`);
    }
  }
  if (typeof input.minimumGroupSize !== 'number' || !Number.isInteger(input.minimumGroupSize)
    || input.minimumGroupSize < 2 || input.minimumGroupSize > 20) {
    throw new Error('Minimum group size must be a whole number from 2 to 20.');
  }
  const lists: Record<string, string[]> = {};
  for (const key of ['siteOrder', 'excludedSites']) {
    const value = input[key];
    if (!Array.isArray(value) || value.length > 500 || value.some((host) => typeof host !== 'string')) {
      throw new Error(`${key} must contain at most 500 hostnames.`);
    }
    lists[key] = [...new Set(value.map((host: string) => {
      const normalized = normalizeHostname(host);
      return key === 'siteOrder' ? normalized.replace(/^www\./, '') : normalized;
    }))];
  }
  return { ...input, ...lists } as unknown as Settings;
}

export function validateMessage(input: unknown): Message {
  if (!isRecord(input) || typeof input.type !== 'string') throw new Error('Invalid request.');
  let request = input;
  const fields: Record<string, string[]> = {
    'get-state': ['type', 'windowId', 'scope'],
    'run-action': ['type', 'windowId', 'scope', 'action', 'tabIds', 'windowIds'],
    undo: ['type'],
    'get-settings': ['type'],
    'save-settings': ['type', 'settings'],
    'reset-settings': ['type'],
  };
  const allowed = Object.hasOwn(fields, input.type) ? fields[input.type] : undefined;
  if (!allowed || Object.keys(request).some((key) => !allowed.includes(key))) throw new Error('Unknown request or field.');
  if (request.type === 'get-state' || request.type === 'run-action') {
    if (!isId(request.windowId) || (request.scope !== 'current' && request.scope !== 'all')) throw new Error('Invalid window or scope.');
  }
  if (request.type === 'run-action') {
    if (!['close-duplicates', 'group', 'sort', 'merge', 'ungroup', 'collapse', 'expand'].includes(request.action as string)) {
      throw new Error('Invalid action.');
    }
    for (const field of ['tabIds', 'windowIds']) {
      const ids = request[field];
      if (ids === undefined) continue;
      if (!Array.isArray(ids) || ids.length > 20000 || !ids.every(isId)) {
        throw new Error(`Invalid ${field}.`);
      }
      request = { ...request, [field]: [...new Set(ids)] };
    }
    if (request.tabIds !== undefined && request.action !== 'close-duplicates') throw new Error('Tab selection is only valid for duplicate closure.');
    if (request.windowIds !== undefined && request.action !== 'merge') throw new Error('Window selection is only valid for a merge.');
  }
  if (request.type === 'save-settings') return { type: 'save-settings', settings: validateSettings(request.settings) };
  return request as Message;
}

export function isExcluded(tab: Browser.tabs.Tab, settings: Settings): boolean {
  return [tab.url, tab.pendingUrl].some((url) => {
    const parsed = webUrl(url);
    if (!parsed) return false;
    const host = hostname(parsed);
    return settings.excludedSites.some((excluded) => host === excluded || host.endsWith(`.${excluded}`));
  });
}

export function isSiteTab(tab: Browser.tabs.Tab, settings: Settings): boolean {
  return isId(tab.id) && tab.status !== 'loading' && !tab.pendingUrl && getSite(tab.url) !== null && !isExcluded(tab, settings);
}

export function duplicateKey(tab: Browser.tabs.Tab, settings: Settings): string | null {
  if (!isSiteTab(tab, settings)) return null;
  let url = tab.url!;
  if (settings.ignoreHash) url = url.split('#', 1)[0]!;
  if (settings.ignoreQuery) {
    const hash = url.indexOf('#');
    const query = url.indexOf('?');
    if (query >= 0 && (hash < 0 || query < hash)) url = url.slice(0, query) + (hash < 0 ? '' : url.slice(hash));
  }
  return JSON.stringify([tab.incognito, url]);
}

export function isProtected(tab: Browser.tabs.Tab, settings: Settings): boolean {
  return (settings.protectPinned && tab.pinned) || (settings.protectActive && tab.active) || (settings.protectAudible && !!tab.audible);
}

export function tabOrder(a: Browser.tabs.Tab, b: Browser.tabs.Tab): number {
  return a.windowId - b.windowId || a.index - b.index || (a.id ?? -1) - (b.id ?? -1);
}

export function buildDuplicateGroups(tabs: Browser.tabs.Tab[], settings: Settings): DuplicateGroup[] {
  const matches = new Map<string, Browser.tabs.Tab[]>();
  for (const tab of [...tabs].sort(tabOrder)) {
    const key = duplicateKey(tab, settings);
    if (key !== null) matches.set(key, [...(matches.get(key) ?? []), tab]);
  }
  const result: DuplicateGroup[] = [];
  for (const [key, copies] of matches) {
    if (copies.length < 2) continue;
    const protectedCopies = copies.filter((tab) => isProtected(tab, settings));
    const keeper = [...copies].sort((a, b) => {
      const accessed = (a.lastAccessed ?? 0) - (b.lastAccessed ?? 0);
      return (settings.keeper === 'recent' ? -accessed : accessed) || tabOrder(a, b);
    })[0]!;
    const first = copies[0]!;
    const keepIds = (protectedCopies.length ? protectedCopies : [keeper]).map((tab) => tab.id!);
    result.push({
      key, title: first.title || getSite(first.url) || first.url!, url: first.url!, tabs: copies,
      keepIds, closeIds: copies.filter((tab) => !keepIds.includes(tab.id!)).map((tab) => tab.id!),
    });
  }
  return result;
}

export type SiteGroupPlan = { windowId: number; site: string; tabIds: number[] };

export function planSiteGroups(tabs: Browser.tabs.Tab[], settings: Settings): SiteGroupPlan[] {
  const sites = new Map<string, SiteGroupPlan>();
  for (const tab of [...tabs].sort(tabOrder)) {
    if (!isSiteTab(tab, settings) || tab.pinned || (settings.preserveGroups && tab.groupId >= 0)) continue;
    const site = getSite(tab.url)!;
    const key = JSON.stringify([tab.windowId, site]);
    const group = sites.get(key) ?? { windowId: tab.windowId, site, tabIds: [] };
    group.tabIds.push(tab.id!);
    sites.set(key, group);
  }
  return [...sites.values()].filter((group) => group.tabIds.length >= settings.minimumGroupSize);
}

export type SortBlock = { tabs: [Browser.tabs.Tab, ...Browser.tabs.Tab[]]; groupId: number; fixed: boolean };

export function sortComparator(tabs: Browser.tabs.Tab[], settings: Settings): (a: Browser.tabs.Tab, b: Browser.tabs.Tab) => number {
  const ordered = [...tabs].sort(tabOrder);
  const encountered = [...new Set((settings.sortDirection === 'desc' ? ordered.reverse() : ordered).map((tab) => getSite(tab.url) ?? ''))];
  const direction = settings.sortBy === 'encounter' || settings.sortDirection === 'asc' ? 1 : -1;
  const text = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
  const rank = (site: string) => {
    if (settings.sortBy === 'encounter') return encountered.indexOf(site);
    const index = settings.siteOrder.findIndex((host) => site === host || site.endsWith(`.${host}`));
    return index < 0 ? settings.siteOrder.length : index;
  };
  return (a, b) => {
    const siteA = getSite(a.url) ?? '';
    const siteB = getSite(b.url) ?? '';
    let result: number;
    if (settings.sortBy === 'title') result = text(a.title ?? '', b.title ?? '');
    else if (settings.sortBy === 'url') result = text(a.url ?? '', b.url ?? '');
    else if (settings.sortBy === 'custom' || settings.sortBy === 'encounter') result = rank(siteA) - rank(siteB) || text(siteA, siteB);
    else result = text(siteA, siteB);
    return direction * result || tabOrder(a, b);
  };
}

export function planSort(tabs: Browser.tabs.Tab[], groups: Browser.tabGroups.TabGroup[], settings: Settings): SortBlock[] {
  const ordered = [...tabs].sort((a, b) => a.index - b.index);
  const compare = sortComparator(ordered, settings);
  const blocks: SortBlock[] = [];
  for (const tab of ordered) {
    const previous = blocks.at(-1);
    if (tab.groupId >= 0 && previous?.groupId === tab.groupId) previous.tabs.push(tab);
    else blocks.push({ tabs: [tab], groupId: tab.groupId, fixed: false });
  }
  for (const block of blocks) {
    block.fixed = block.tabs.some((tab) => !isId(tab.id) || isExcluded(tab, settings) || (tab.pinned && !settings.sortPinned));
    if (!block.fixed) block.tabs.sort(compare);
  }
  const result: SortBlock[] = [];
  let run: SortBlock[] = [];
  const flush = () => {
    run.sort((a, b) => compare(a.tabs[0], b.tabs[0]));
    if (settings.sortGroupsByTitle) {
      const sortedGroups = run.filter((block) => block.groupId >= 0).sort((a, b) => {
        const titleA = groups.find((group) => group.id === a.groupId)?.title ?? '';
        const titleB = groups.find((group) => group.id === b.groupId)?.title ?? '';
        return (settings.sortDirection === 'asc' ? 1 : -1) * titleA.localeCompare(titleB, 'en', { numeric: true, sensitivity: 'base' })
          || compare(a.tabs[0], b.tabs[0]);
      });
      let index = 0;
      run = run.map((block) => block.groupId >= 0 ? sortedGroups[index++]! : block);
    }
    result.push(...run);
    run = [];
  };
  for (const block of blocks) {
    if (block.fixed) {
      flush();
      result.push(block);
    } else {
      if (run.length && run[0]!.tabs[0].pinned !== block.tabs[0].pinned) flush();
      run.push(block);
    }
  }
  flush();
  return result;
}
