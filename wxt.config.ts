import { defineConfig } from 'wxt';

export default defineConfig({
  manifestVersion: 3,
  manifest: {
    name: 'Tab tidy',
    description: 'Close duplicate tabs, group by site, sort tabs, and merge windows. Only when you ask.',
    minimum_chrome_version: '121',
    permissions: ['tabs', 'tabGroups', 'storage'],
    incognito: 'split',
    action: { default_title: 'Tab tidy' },
    icons: {
      16: 'icon-16.png',
      32: 'icon-32.png',
      48: 'icon-48.png',
      128: 'icon-128.png',
    },
    commands: {
      'close-duplicates': { description: 'Close safe duplicate tabs' },
      group: { description: 'Group tabs by site' },
      sort: { description: 'Sort tabs' },
      merge: { description: 'Merge eligible windows into the current window' },
    },
  },
});
