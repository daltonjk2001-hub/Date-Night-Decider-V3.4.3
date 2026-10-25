/* Date Night Decider 3.1.2 · deterministic startup loader */
'use strict';
(function () {
  const vendors = [
    { name: 'Dexie', local: './vendor/dexie.min.js', cdn: 'https://cdn.jsdelivr.net/npm/dexie@3.2.4/dist/dexie.min.js', ready: () => typeof window.Dexie === 'function' },
    { name: 'PeerJS', local: './vendor/peerjs.min.js', cdn: 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js', ready: () => typeof window.Peer === 'function' }
  ];
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = false;
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
    } catch (_) { /* no local asset shipped: try pinned CDN fallback */ }
    try { await loadScript(vendor.cdn); }
    catch (error) { console.warn(vendor.name + ' could not be loaded from local file or CDN.', error); }
    return vendor.ready();
  }
  async function boot() {
    await Promise.all(vendors.map(loadVendor));
    for (const file of ['./db.js?v=3.1.2-remediation2', './store.js?v=3.1.2-remediation2', './p2p.js?v=3.1.2-remediation2', './ui.js?v=3.1.2-remediation2']) {
      try { await loadScript(file); }
      catch (error) {
        console.error('Required module failed to load: ' + file, error);
        const banner = document.getElementById('storageWarningBanner');
        if (banner) { banner.hidden = false; banner.textContent = 'A required app module could not load. Check your published files and reload.'; }
      }
    }
    await loadScript('./app.js?v=3.1.2-remediation2');
  }
  boot().catch(error => {
    console.error('Application startup failed:', error);
    const banner = document.getElementById('storageWarningBanner');
    if (banner) { banner.hidden = false; banner.textContent = 'The app could not start. Check your connection and reload.'; }
  });
})();
