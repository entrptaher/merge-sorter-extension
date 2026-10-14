import { browser } from 'wxt/browser';
import { DEFAULT_SETTINGS, validateSettings, type Settings } from '../../utils/model';
import { sendRequest } from '../../utils/client';
import '../../assets/tidy.css';

const main = document.querySelector<HTMLElement>('#options-main')!;
const form = document.querySelector<HTMLFormElement>('#settings-form')!;
const fields = document.querySelector<HTMLFieldSetElement>('#settings-fields')!;
const saveButton = document.querySelector<HTMLButtonElement>('#save-button')!;
const resetButton = document.querySelector<HTMLButtonElement>('#reset-button')!;
const reloadButton = document.querySelector<HTMLButtonElement>('#reload-button')!;
const shortcutsButton = document.querySelector<HTMLButtonElement>('#shortcuts-button')!;
const saveNote = document.querySelector<HTMLElement>('#save-note')!;
const status = document.querySelector<HTMLElement>('#settings-status')!;
const directionNote = document.querySelector<HTMLElement>('#direction-note')!;
const scopeInput = document.querySelector<HTMLSelectElement>('#scope')!;
const sortByInput = document.querySelector<HTMLSelectElement>('#sortBy')!;
const sortDirectionInput = document.querySelector<HTMLSelectElement>('#sortDirection')!;
const keeperInput = document.querySelector<HTMLSelectElement>('#keeper')!;
const siteOrderInput = document.querySelector<HTMLTextAreaElement>('#siteOrder')!;
const excludedSitesInput = document.querySelector<HTMLTextAreaElement>('#excludedSites')!;
const minimumGroupSizeInput = document.querySelector<HTMLInputElement>('#minimumGroupSize')!;
const booleanFields = [
  'sortGroupsByTitle', 'sortPinned', 'preserveGroups', 'collapseNewGroups', 'ignoreHash', 'ignoreQuery',
  'protectPinned', 'protectActive', 'protectAudible', 'mergeMinimized', 'mergePopups',
] as const satisfies readonly (keyof Settings)[];
const checkboxes = Object.fromEntries(booleanFields.map((key) => [key,
  document.querySelector<HTMLInputElement>(`#${key}`)!,
])) as Record<typeof booleanFields[number], HTMLInputElement>;

let savedSettings: Settings | null = null;
let dirty = false;
let busy = false;
let externalChange = false;

const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'An unexpected browser error occurred.';
const readLines = (value: string) => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

function showFeedback(message: string, tone = 'neutral') {
  status.textContent = message;
  status.dataset.tone = tone;
}

function updateControls() {
  fields.disabled = busy || savedSettings === null;
  saveButton.disabled = busy || savedSettings === null || !dirty;
  resetButton.disabled = busy || savedSettings === null;
  reloadButton.disabled = busy;
  main.setAttribute('aria-busy', String(busy));
  saveNote.textContent = busy ? 'Please wait…' : savedSettings === null ? 'Options are unavailable.' : dirty ? 'Unsaved changes' : 'Saved locally';
  const encounter = sortByInput.value === 'encounter';
  sortDirectionInput.options[0]!.textContent = encounter ? 'Left to right (default)' : 'Ascending (default)';
  sortDirectionInput.options[1]!.textContent = encounter ? 'Right to left' : 'Descending';
  directionNote.textContent = encounter
    ? 'Use the order in which sites first appear from the chosen end of the tab strip.'
    : sortByInput.value === 'custom'
      ? 'Ascending follows your site priority. Descending reverses the sort order.'
      : 'Ascending sorts from A to Z. Descending sorts from Z to A.';
}

function fillForm(settings: Settings) {
  scopeInput.value = settings.scope;
  sortByInput.value = settings.sortBy;
  sortDirectionInput.value = settings.sortDirection;
  keeperInput.value = settings.keeper;
  siteOrderInput.value = settings.siteOrder.join('\n');
  excludedSitesInput.value = settings.excludedSites.join('\n');
  minimumGroupSizeInput.value = String(settings.minimumGroupSize);
  for (const key of booleanFields) checkboxes[key].checked = settings[key];
  updateControls();
}

function readForm(): Settings {
  return {
    scope: scopeInput.value as Settings['scope'],
    sortBy: sortByInput.value as Settings['sortBy'],
    sortDirection: sortDirectionInput.value as Settings['sortDirection'],
    siteOrder: readLines(siteOrderInput.value),
    sortGroupsByTitle: checkboxes.sortGroupsByTitle.checked,
    sortPinned: checkboxes.sortPinned.checked,
    preserveGroups: checkboxes.preserveGroups.checked,
    minimumGroupSize: Number(minimumGroupSizeInput.value),
    collapseNewGroups: checkboxes.collapseNewGroups.checked,
    ignoreHash: checkboxes.ignoreHash.checked,
    ignoreQuery: checkboxes.ignoreQuery.checked,
    keeper: keeperInput.value as Settings['keeper'],
    protectPinned: checkboxes.protectPinned.checked,
    protectActive: checkboxes.protectActive.checked,
    protectAudible: checkboxes.protectAudible.checked,
    excludedSites: readLines(excludedSitesInput.value),
    mergeMinimized: checkboxes.mergeMinimized.checked,
    mergePopups: checkboxes.mergePopups.checked,
  };
}

async function loadSettings() {
  if (busy) return;
  busy = true;
  showFeedback('Read saved options…');
  updateControls();
  try {
    savedSettings = await sendRequest<Settings>({ type: 'get-settings' });
    dirty = false;
    externalChange = false;
    fillForm(savedSettings);
    reloadButton.hidden = true;
    showFeedback('Options are saved in this browser.');
  } catch (error) {
    reloadButton.hidden = false;
    showFeedback(`Could not read saved options. ${errorMessage(error)} Use Reload to try again.`, 'error');
  } finally {
    busy = false;
    updateControls();
  }
}

function handleFormChange() {
  dirty = savedSettings === null || Object.entries(readForm()).some(([key, value]) =>
    JSON.stringify(value) !== JSON.stringify(savedSettings![key as keyof Settings]));
  if (!externalChange) showFeedback(dirty ? 'Changes are not saved yet.' : 'Options are saved in this browser.');
  updateControls();
}
form.addEventListener('input', handleFormChange);
form.addEventListener('change', handleFormChange);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy || !savedSettings || !form.reportValidity()) return;
  let settings: Settings;
  try {
    settings = validateSettings(readForm());
  } catch (error) {
    showFeedback(`Options were not saved. ${errorMessage(error)}`, 'error');
    return;
  }
  busy = true;
  showFeedback('Saving options…');
  updateControls();
  try {
    savedSettings = await sendRequest<Settings>({ type: 'save-settings', settings });
    dirty = false;
    externalChange = false;
    reloadButton.hidden = true;
    fillForm(savedSettings);
    showFeedback('Options saved.');
  } catch (error) {
    showFeedback(`Options were not saved. ${errorMessage(error)} Your changes remain in the form.`, 'error');
  } finally {
    busy = false;
    updateControls();
  }
});

resetButton.addEventListener('click', async () => {
  if (busy || !savedSettings) return;
  busy = true;
  showFeedback('Restoring and saving defaults…');
  updateControls();
  try {
    savedSettings = await sendRequest<Settings>({ type: 'reset-settings' });
    dirty = false;
    externalChange = false;
    reloadButton.hidden = true;
    fillForm(savedSettings);
    showFeedback('Defaults restored and saved.');
  } catch (error) {
    showFeedback(`Defaults were not restored. ${errorMessage(error)} Your current form remains unchanged.`, 'error');
  } finally {
    busy = false;
    updateControls();
  }
});

reloadButton.addEventListener('click', () => { void loadSettings(); });
shortcutsButton.addEventListener('click', async () => {
  shortcutsButton.disabled = true;
  try {
    await browser.tabs.create({ url: 'chrome://extensions/shortcuts' });
  } catch (error) {
    showFeedback(`Could not open browser shortcuts. ${errorMessage(error)}`, 'error');
  } finally {
    shortcutsButton.disabled = false;
  }
});
browser.storage.onChanged.addListener((_changes, area) => {
  if (area !== 'local' || busy) return;
  if (dirty) {
    externalChange = true;
    reloadButton.hidden = false;
    showFeedback('Options changed elsewhere. Save to use this form, or reload the saved options.', 'warning');
  } else {
    void loadSettings();
  }
});

fillForm(DEFAULT_SETTINGS);
void loadSettings();
