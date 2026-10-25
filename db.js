/* Date Night Decider v3.1.2 remediation · IndexedDB bootstrap */
'use strict';
let db = null;
let useMemoryFallback = typeof window.Dexie !== 'function';
let storageFallbackReason = '';

function renderStorageWarning(reason) {
  const banner = document.getElementById('storageWarningBanner');
  if (!banner) return;
  if (!useMemoryFallback) {
    banner.hidden = true;
    banner.textContent = '';
    return;
  }
  const explanation = reason || storageFallbackReason || 'IndexedDB is unavailable or the database library did not load.';
  banner.hidden = false;
  banner.textContent = `Storage warning: ${explanation} This session is using temporary in-memory data. Custom cards, scrapbook entries, and preferences may be lost when you close or reload the app. Export a JSON backup when persistent storage is available.`;
}

function enterMemoryFallback(reason) {
  useMemoryFallback = true;
  storageFallbackReason = String(reason || 'Persistent storage is unavailable.');
  console.warn('Date Night Decider is using temporary in-memory storage:', storageFallbackReason);
  renderStorageWarning(storageFallbackReason);
}

if (useMemoryFallback) {
  enterMemoryFallback('Dexie did not load.');
} else {
  try {
    db = new window.Dexie('DateNightDatabase');
    db.version(2).stores({
      settings: 'key',
      customDeck: '++id, id',
      deletedBuiltins: 'id',
      categories: 'id',
      history: '++id, date, syncId',
      unlocks: 'id'
    });
  } catch (err) {
    enterMemoryFallback('IndexedDB could not be opened.');
  }
}
