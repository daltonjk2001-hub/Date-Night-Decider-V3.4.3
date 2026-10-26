/* Date Night Decider 3.4.3-hotfix1 · deterministic startup loader */
'use strict';
(function () {
  const vendors = [
    { name: 'Dexie', local: './vendor/dexie.min.js', ready: () => typeof window.Dexie === 'function' },
    { name: 'PeerJS', local: './vendor/peerjs.min.js', ready: () => typeof window.Peer === 'function' }
  ];

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = () => resolve();
      s.onerror = () => { s.remove(); reject(new Error('Unable to load ' + src)); };
      document.head.appendChild(s);
    });
  }

  async function loadVendor(vendor) {
    if (vendor.ready()) return true;
    try {
      await loadScript(vendor.local);
      if (vendor.ready()) return true;
    } catch (err) {
      console.warn(vendor.name + ' local file could not be loaded.', err);
    }
    return vendor.ready();
  }

  async function boot() {
    await Promise.all(vendors.map(loadVendor));
    for (const file of ['./db.js?v=3.4.3-hotfix1', './store.js?v=3.4.3-hotfix1', './p2p.js?v=3.4.3-hotfix1', './ui.js?v=3.4.3-hotfix1', './app.js?v=3.4.3-hotfix1']) {
      try {
        await loadScript(file);
      } catch (error) {
        console.error('Required module failed to load: ' + file, error);
        const banner = document.getElementById('storageWarningBanner');
        if (banner) {
          banner.hidden = false;
          banner.className = 'storage-warning-banner storage-failure-alert';
          banner.textContent = 'Storage Error: A required application module failed to load. Please check your network and reload.';
        }
      }
    }
  }

  boot().catch(error => {
    console.error('Application startup failed:', error);
    const banner = document.getElementById('storageWarningBanner');
    if (banner) {
      banner.hidden = false;
      banner.className = 'storage-warning-banner storage-failure-alert';
      banner.textContent = 'Application startup failed. Please reload.';
    }
  });
})();
