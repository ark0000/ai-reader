/**
 * desktop-updater.js
 * Frontend client for AuraReader Desktop Auto-Updater.
 * Handles background version checks, changelog modal, 1-click update execution,
 * app restarts, and the snapshot/rollback history panel.
 */

(function() {
  const DesktopUpdater = {
    currentVersion: 'v1.0.0',
    latestInfo: null,
    isUpdating: false,

    init: async function() {
      try {
        const lvRes = await fetch('/api/updater/local-version');
        if (lvRes.ok) {
          const lvData = await lvRes.json();
          this.currentVersion = lvData.version;
          const curVerEl = document.getElementById('updater-current-version');
          if (curVerEl) curVerEl.textContent = this.currentVersion;
        }
      } catch (e) {
        console.warn('Failed to load local version fast:', e);
      }

      const autoCheckPref = window.safeStorage ? window.safeStorage.getItem('aura-auto-update') : localStorage.getItem('aura-auto-update');
      const shouldAutoCheck = autoCheckPref === null || autoCheckPref === 'true';
      if (shouldAutoCheck) {
        setTimeout(() => { this.checkUpdates(false); }, 3000);
      }
      this.injectStyles();
    },

    injectStyles: function() {
      if (document.getElementById('updater-injected-style')) return;
      const style = document.createElement('style');
      style.id = 'updater-injected-style';
      style.innerHTML = `
        .updater-badge-btn {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 600;
          cursor: pointer; transition: all 0.2s ease;
          background: linear-gradient(135deg, rgba(245, 158, 11, 0.2), rgba(239, 68, 68, 0.2));
          border: 1px solid rgba(245, 158, 11, 0.4); color: #fbbf24;
          animation: pulseGlow 2s infinite ease-in-out;
        }
        .updater-badge-btn:hover {
          background: linear-gradient(135deg, rgba(245, 158, 11, 0.35), rgba(239, 68, 68, 0.35));
          transform: translateY(-1px);
        }
        @keyframes pulseGlow {
          0%, 100% { box-shadow: 0 0 8px rgba(245, 158, 11, 0.2); }
          50% { box-shadow: 0 0 16px rgba(245, 158, 11, 0.5); }
        }
        .updater-progress-bar {
          width: 100%; height: 6px; background: rgba(255,255,255,0.1);
          border-radius: 3px; overflow: hidden; position: relative;
        }
        .updater-progress-bar-inner {
          height: 100%; width: 30%;
          background: linear-gradient(90deg, #3b82f6, #8b5cf6, #ec4899);
          border-radius: 3px; position: absolute;
          animation: progressIndeterminate 1.5s infinite ease-in-out;
        }
        @keyframes progressIndeterminate {
          0% { left: -30%; width: 30%; } 50% { width: 60%; } 100% { left: 100%; width: 30%; }
        }
        /* ── Snapshot/rollback panel ── */
        .snap-card {
          display: flex; align-items: center; gap: 12px; padding: 10px 12px;
          background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08);
          border-radius: 8px; margin-bottom: 7px; transition: background 0.15s;
        }
        .snap-card:hover { background: rgba(255,255,255,0.06); }
        .snap-card-meta { flex: 1; min-width: 0; }
        .snap-card-ver { font-size: 12.5px; font-weight: 600; color: var(--accent, #60a5fa); }
        .snap-card-date { font-size: 11px; color: var(--text-3, #64748b); }
        .snap-card-id { font-size: 11px; font-family: monospace; color: var(--text-3, #64748b); }
        .snap-restore-btn {
          padding: 5px 11px; border-radius: 6px; font-size: 12px; font-weight: 600;
          background: linear-gradient(135deg,#3b82f6,#8b5cf6); color:#fff; border:none;
          cursor:pointer; white-space:nowrap; transition: opacity 0.15s;
        }
        .snap-restore-btn:hover { opacity: 0.85; }
        .snap-delete-btn {
          padding: 5px 9px; border-radius: 6px; font-size: 12px;
          background: transparent; color: #f87171;
          border: 1px solid rgba(239,68,68,0.3); cursor: pointer;
        }
        .snap-delete-btn:hover { background: rgba(239,68,68,0.1); }
        .snap-accordion-header {
          display: flex; align-items: center; gap: 8px; cursor: pointer;
          padding: 10px 0 6px; user-select: none;
          border-top: 1px solid var(--border, rgba(255,255,255,0.08)); margin-top: 10px;
        }
        .snap-accordion-header:hover { opacity: 0.85; }
        .snap-accordion-body { overflow: hidden; transition: max-height 0.3s ease; }
      `;
      document.head.appendChild(style);
    },

    checkUpdates: async function(manual = false) {
      const statusLabel = document.getElementById('updater-status-label');
      const checkBtn = document.getElementById('updater-check-btn');
      if (statusLabel) statusLabel.textContent = 'Checking for updates...';
      if (checkBtn) { checkBtn.disabled = true; checkBtn.innerHTML = '&#8987; Checking...'; }

      try {
        const res = await fetch(`/api/updater/check?force=${manual ? 'true' : 'false'}`);
        if (!res.ok) throw new Error('Update server unreachable');
        const data = await res.json();
        this.latestInfo = data;
        this.currentVersion = data.current_version || this.currentVersion;
        const curVerEl = document.getElementById('updater-current-version');
        if (curVerEl) curVerEl.textContent = this.currentVersion;

        if (data.has_update) {
          if (statusLabel) statusLabel.innerHTML = `<span style="color:#fbbf24;font-weight:600;cursor:pointer;text-decoration:underline;text-decoration-style:dotted;" onclick="window.DesktopUpdater.openUpdateModal()">Update Available: ${data.latest_version} ℹ️</span>`;
          this.showUpdateBadge(data);
          if (manual) this.openUpdateModal(data);
        } else {
          if (statusLabel) statusLabel.innerHTML = `<span style="color:#10b981;font-weight:600;cursor:pointer;text-decoration:underline;text-decoration-style:dotted;" onclick="window.DesktopUpdater.openUpdateModal()">&#10003; Up to date (${this.currentVersion}) ℹ️</span>`;
          this.showUpdateBadge(data);
          if (manual && window.showToast) window.showToast(`AuraReader is up to date (${this.currentVersion})`, 'success');
        }
      } catch (err) {
        console.warn('[Updater] Check failed:', err);
        if (statusLabel) statusLabel.innerHTML = `<span style="color:var(--text-3);">Check failed (offline)</span>`;
      } finally {
        if (checkBtn) { checkBtn.disabled = false; checkBtn.innerHTML = '&#8635; Check for Updates'; }
      }
    },

    showUpdateBadge: function(data) {
      let badge = document.getElementById('topbar-update-badge');
      if (!data.has_update) { if (badge) badge.remove(); return; }
      if (!badge) {
        badge = document.createElement('button');
        badge.id = 'topbar-update-badge';
        const topBar = document.getElementById('top-bar') || document.querySelector('.app-header');
        if (topBar) { const group = topBar.querySelector('.toolbar-group:last-child') || topBar; group.prepend(badge); }
      }
      badge.onclick = () => this.openUpdateModal(this.latestInfo || data);
      badge.className = 'updater-badge-btn';
      badge.style.cssText = 'background:linear-gradient(135deg,rgba(245,158,11,.2),rgba(239,68,68,.2));border:1px solid rgba(245,158,11,.4);color:#fbbf24;animation:pulseGlow 2s infinite ease-in-out;';
      badge.innerHTML = `<span>&#10024;</span> Update to ${data.latest_version}`;
    },

    openUpdateModal: function(data) {
      if (!data) data = this.latestInfo;
      if (!data) return;
      let modal = document.getElementById('updater-modal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'updater-modal';
        modal.style.cssText = 'display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.7);z-index:99999;align-items:center;justify-content:center;backdrop-filter:blur(10px);animation:fadeIn 0.2s ease-out both;';
        document.body.appendChild(modal);
      }

      let notesHtml = data.release_notes ? data.release_notes.replace(/\n/g, '<br>') : 'Bug fixes, performance improvements, and UI enhancements.';
      if (typeof marked !== 'undefined' && data.release_notes) { try { notesHtml = marked.parse(data.release_notes); } catch(e) {} }

      modal.innerHTML = `
        <div style="background:var(--bg-panel,#1e293b);border:1px solid var(--border,rgba(255,255,255,.1));border-radius:14px;width:92%;max-width:560px;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 20px 50px rgba(0,0,0,.6);overflow:hidden;color:var(--text-1,#fff);">
          <div style="padding:18px 24px;border-bottom:1px solid var(--border,rgba(255,255,255,.1));display:flex;justify-content:space-between;align-items:center;background:rgba(255,255,255,.03);">
            <div style="display:flex;align-items:center;gap:10px;">
              <span style="font-size:24px;">${data.has_update ? '🚀' : '✅'}</span>
              <div>
                <h3 style="margin:0;font-size:17px;font-weight:700;color:var(--text-1,#fff);">${data.has_update ? 'New Update Available' : 'App is Up to Date'}</h3>
                <span style="font-size:12px;color:var(--text-2,#94a3b8);">${data.current_version} &rarr; <strong style="color:var(--accent,#60a5fa);">${data.latest_version}</strong></span>
              </div>
            </div>
            <button class="tb-btn" style="border:none;background:transparent;font-size:24px;color:var(--text-2);cursor:pointer;padding:0 6px;" onclick="document.getElementById('updater-modal').style.display='none'">&times;</button>
          </div>

          <div style="padding:20px 24px;flex:1;overflow-y:auto;font-size:13.5px;line-height:1.6;">
            <div style="margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;">
              <span style="font-weight:600;color:var(--accent,#60a5fa);font-size:15px;">${data.release_name || data.latest_version}</span>
              <span style="font-size:11.5px;color:var(--text-3,#64748b);">${data.published_at ? new Date(data.published_at).toLocaleDateString() : ''}</span>
            </div>
            <div style="background:var(--bg-body,rgba(0,0,0,.3));border:1px solid var(--border,rgba(255,255,255,.08));border-radius:8px;padding:14px;max-height:180px;overflow-y:auto;font-size:13px;color:var(--text-2,#cbd5e1);margin-bottom:16px;">${notesHtml}</div>

            <div id="updater-modal-progress" style="display:none;margin-bottom:16px;">
              <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px;color:var(--text-2);">
                <span id="updater-progress-status">Downloading &amp; applying update...</span><span>Please wait</span>
              </div>
              <div class="updater-progress-bar"><div class="updater-progress-bar-inner"></div></div>
            </div>
            <div id="updater-modal-msg" style="display:none;padding:10px 14px;border-radius:8px;font-size:13px;margin-bottom:14px;"></div>

            <!-- Rollback History accordion -->
            <div id="snap-accordion">
              <div class="snap-accordion-header" onclick="window.DesktopUpdater.toggleSnapshotPanel()">
                <span id="snap-arrow" style="transition:transform 0.2s;display:inline-block;">▶</span>
                <span style="font-size:13px;font-weight:600;color:var(--text-1);">🕐 Rollback History</span>
                <span style="font-size:11px;color:var(--text-3);margin-left:auto;">Last 5 snapshots</span>
                <button onclick="event.stopPropagation();window.DesktopUpdater.createManualSnapshot()"
                  style="padding:3px 9px;border-radius:6px;font-size:11px;font-weight:600;border:1px solid rgba(99,102,241,.4);background:rgba(99,102,241,.15);color:#a5b4fc;cursor:pointer;margin-left:8px;">
                  + Save Now
                </button>
              </div>
              <div class="snap-accordion-body" id="snap-body" style="max-height:0px;">
                <div id="snap-list" style="padding-top:8px;">
                  <div style="color:var(--text-3);font-size:12px;text-align:center;padding:12px;">Loading rollback history...</div>
                </div>
              </div>
            </div>
          </div>

          <div style="padding:14px 24px;border-top:1px solid var(--border,rgba(255,255,255,.1));display:flex;justify-content:space-between;align-items:center;background:rgba(255,255,255,.02);">
            <a href="${data.release_url}" target="_blank" rel="noopener noreferrer" style="font-size:12px;color:var(--text-3,#94a3b8);text-decoration:none;">🌐 View Release on GitHub</a>
            <div style="display:flex;gap:10px;">
              <button class="tb-btn" style="padding:8px 16px;border-radius:8px;border:1px solid var(--border,rgba(255,255,255,.15));background:transparent;color:var(--text-1);" onclick="document.getElementById('updater-modal').style.display='none'">${data.has_update ? 'Later' : 'Close'}</button>
              <button id="updater-apply-btn" class="tb-btn" style="padding:8px 20px;border-radius:8px;background:linear-gradient(135deg,#3b82f6,#8b5cf6);color:#fff;font-weight:600;border:none;cursor:pointer;" onclick="DesktopUpdater.applyUpdate()">${data.has_update ? '⚡ 1-Click Update Now' : '🔄 Force Reinstall'}</button>
            </div>
          </div>
        </div>`;

      modal.style.display = 'flex';
      setTimeout(() => this.loadSnapshots(), 100);
    },

    // ── Snapshot / Rollback panel ─────────────────────────────────────────────

    toggleSnapshotPanel: function() {
      const body = document.getElementById('snap-body');
      const arrow = document.getElementById('snap-arrow');
      if (!body) return;
      const isOpen = body.style.maxHeight !== '0px' && body.style.maxHeight !== '';
      if (isOpen) {
        body.style.maxHeight = '0px';
        if (arrow) arrow.style.transform = 'rotate(0deg)';
      } else {
        body.style.maxHeight = '400px';
        if (arrow) arrow.style.transform = 'rotate(90deg)';
        this.loadSnapshots();
      }
    },

    loadSnapshots: async function() {
      const list = document.getElementById('snap-list');
      if (!list) return;
      try {
        const res = await fetch('/api/updater/snapshots');
        if (!res.ok) throw new Error('Could not load snapshots');
        const data = await res.json();
        const snaps = data.snapshots || [];

        if (snaps.length === 0) {
          list.innerHTML = `<div style="color:var(--text-3);font-size:12px;text-align:center;padding:12px 0;">
            No rollback snapshots yet.<br><span style="font-size:11px;">A snapshot is automatically saved before each update.</span>
          </div>`;
          return;
        }

        list.innerHTML = snaps.map((s, i) => {
          const date = new Date(s.created_at).toLocaleString();
          const sizeStr = s.size_kb > 1024 ? `${(s.size_kb/1024).toFixed(1)} MB` : `${s.size_kb} KB`;
          const isMeta = s.reason === 'pre-update';
          const rBg = isMeta ? 'rgba(245,158,11,.15)' : 'rgba(99,102,241,.15)';
          const rColor = isMeta ? '#fbbf24' : '#a5b4fc';
          const rBorder = isMeta ? 'rgba(245,158,11,.3)' : 'rgba(99,102,241,.3)';
          return `
            <div class="snap-card" id="snap-${s.id}">
              <div style="font-size:22px;">${i === 0 ? '⭐' : '📦'}</div>
              <div class="snap-card-meta">
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">
                  <span class="snap-card-ver">v${s.version}</span>
                  <span style="font-size:10px;padding:2px 7px;border-radius:10px;font-weight:600;background:${rBg};color:${rColor};border:1px solid ${rBorder};">${s.reason}</span>
                  ${i === 0 ? '<span style="font-size:10px;padding:2px 7px;border-radius:10px;font-weight:600;background:rgba(16,185,129,.15);color:#34d399;border:1px solid rgba(16,185,129,.3);">latest</span>' : ''}
                </div>
                <div class="snap-card-date">${date} &bull; ${sizeStr} &bull; ${s.files_count} files</div>
                <div class="snap-card-id">${s.id}</div>
              </div>
              <div style="display:flex;flex-direction:column;gap:5px;">
                <button class="snap-restore-btn" onclick="window.DesktopUpdater.confirmRestore('${s.id}','${s.version}','${date.replace(/'/g,"&#39;")}')">↩ Restore</button>
                <button class="snap-delete-btn" onclick="window.DesktopUpdater.confirmDelete('${s.id}')">🗑</button>
              </div>
            </div>`;
        }).join('');

        // Auto-expand accordion if snapshots exist
        const body = document.getElementById('snap-body');
        const arrow = document.getElementById('snap-arrow');
        if (body && body.style.maxHeight === '0px') {
          body.style.maxHeight = '400px';
          if (arrow) arrow.style.transform = 'rotate(90deg)';
        }
      } catch (e) {
        if (list) list.innerHTML = `<div style="color:#f87171;font-size:12px;padding:8px;">Failed to load snapshots: ${e.message}</div>`;
      }
    },

    createManualSnapshot: async function() {
      const list = document.getElementById('snap-list');
      if (list) list.innerHTML = `<div style="color:var(--text-3);font-size:12px;text-align:center;padding:12px;">Creating snapshot...</div>`;
      try {
        const res = await fetch('/api/updater/snapshots/create?reason=manual', { method: 'POST' });
        const d = await res.json();
        if (window.showToast) window.showToast(d.status === 'created' ? `✅ Snapshot saved: ${d.id}` : `❌ Snapshot failed: ${d.message || 'error'}`, d.status === 'created' ? 'success' : 'error');
        this.loadSnapshots();
      } catch (e) {
        if (window.showToast) window.showToast(`❌ Snapshot error: ${e.message}`, 'error');
        this.loadSnapshots();
      }
    },

    confirmRestore: function(snapId, version, date) {
      if (window.confirm(`Restore to snapshot from ${date} (version: ${version})?\n\nThis will overwrite current application files.\nThe server must be restarted after restoring.\n\nProceed?`)) {
        this.doRestore(snapId);
      }
    },

    doRestore: async function(snapId) {
      const card = document.getElementById(`snap-${snapId}`);
      if (card) { const btn = card.querySelector('.snap-restore-btn'); if (btn) { btn.disabled = true; btn.textContent = 'Restoring...'; } }
      try {
        const res = await fetch(`/api/updater/snapshots/${snapId}/restore`, { method: 'POST' });
        const d = await res.json();
        if (d.status === 'restored') {
          const msgBox = document.getElementById('updater-modal-msg');
          if (msgBox) {
            msgBox.style.cssText = 'display:block;padding:10px 14px;border-radius:8px;background:rgba(16,185,129,.12);border:1px solid rgba(16,185,129,.4);color:#34d399;font-size:13px;margin-bottom:14px;';
            msgBox.innerHTML = `✅ <strong>Restore complete!</strong> ${d.files_restored} files restored.<br>
              <span style="font-size:12px;color:var(--text-2);">Please restart the server to apply all changes.</span><br>
              <button onclick="window.DesktopUpdater.restartApp()" style="margin-top:8px;padding:6px 14px;border-radius:6px;background:linear-gradient(135deg,#ef4444,#b91c1c);color:#fff;border:none;font-weight:600;cursor:pointer;font-size:12px;">🛑 Restart Now</button>`;
          }
          if (window.showToast) window.showToast(`↩ Restored to ${snapId}`, 'success');
        } else {
          throw new Error(d.message || 'Restore failed');
        }
      } catch (e) {
        if (window.showToast) window.showToast(`❌ Restore failed: ${e.message}`, 'error');
        if (card) { const btn = card.querySelector('.snap-restore-btn'); if (btn) { btn.disabled = false; btn.textContent = '↩ Restore'; } }
      }
    },

    confirmDelete: function(snapId) {
      if (!window.confirm(`Delete snapshot ${snapId}?\nThis cannot be undone.`)) return;
      fetch(`/api/updater/snapshots/${snapId}`, { method: 'DELETE' })
        .then(r => r.json())
        .then(() => { if (window.showToast) window.showToast('🗑 Snapshot deleted', 'success'); this.loadSnapshots(); })
        .catch(e => { if (window.showToast) window.showToast(`❌ Delete failed: ${e.message}`, 'error'); });
    },

    applyUpdate: async function() {
      if (this.isUpdating) return;
      this.isUpdating = true;
      const progressBox = document.getElementById('updater-modal-progress');
      const applyBtn = document.getElementById('updater-apply-btn');
      const msgBox = document.getElementById('updater-modal-msg');
      const statusText = document.getElementById('updater-progress-status');

      if (progressBox) progressBox.style.display = 'block';
      if (applyBtn) { applyBtn.disabled = true; applyBtn.textContent = 'Updating...'; applyBtn.style.opacity = '0.6'; }
      if (msgBox) msgBox.style.display = 'none';

      try {
        if (statusText) statusText.textContent = 'Creating pre-update snapshot & downloading latest update...';
        const res = await fetch('/api/updater/apply', { method: 'POST' });
        const result = await res.json();
        if (progressBox) progressBox.style.display = 'none';

        if (result.status === 'success') {
          if (msgBox) {
            msgBox.style.cssText = 'display:block;padding:10px 14px;border-radius:8px;background:rgba(16,185,129,.15);border:1px solid rgba(16,185,129,.4);color:#34d399;font-size:13px;margin-bottom:14px;';
            msgBox.innerHTML = `&#10003; <strong>${result.message}</strong><br><span style="font-size:12px;">A rollback snapshot was saved automatically. Shutdown AuraReader and reopen to complete the upgrade.</span>`;
          }
          if (applyBtn) {
            applyBtn.disabled = false; applyBtn.style.opacity = '1';
            applyBtn.style.background = 'linear-gradient(135deg,#ef4444,#b91c1c)';
            applyBtn.textContent = '🛑 Shutdown App Now';
            applyBtn.onclick = () => this.restartApp();
          }
          setTimeout(() => this.loadSnapshots(), 500);
        } else if (result.status === 'manual' && result.download_url) {
          if (msgBox) {
            msgBox.style.cssText = 'display:block;padding:10px 14px;border-radius:8px;background:rgba(245,158,11,.15);border:1px solid rgba(245,158,11,.4);color:#fbbf24;font-size:13px;margin-bottom:14px;';
            msgBox.innerHTML = `⚠ <strong>${result.message}</strong>`;
          }
          if (applyBtn) { applyBtn.disabled = false; applyBtn.style.opacity = '1'; applyBtn.textContent = 'Download from GitHub'; applyBtn.onclick = () => window.open(result.download_url, '_blank'); }
        } else {
          throw new Error(result.message || 'Update failed');
        }
      } catch (err) {
        if (progressBox) progressBox.style.display = 'none';
        if (msgBox) {
          msgBox.style.cssText = 'display:block;padding:10px 14px;border-radius:8px;background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.4);color:#f87171;font-size:13px;margin-bottom:14px;';
          msgBox.innerHTML = `&#10007; <strong>Update failed:</strong> ${err.message}`;
        }
        if (applyBtn) { applyBtn.disabled = false; applyBtn.style.opacity = '1'; applyBtn.textContent = 'Retry Update'; applyBtn.onclick = () => this.applyUpdate(); }
      } finally {
        this.isUpdating = false;
      }
    },

    restartApp: async function() {
      const applyBtn = document.getElementById('updater-apply-btn');
      if (applyBtn) applyBtn.textContent = 'Shutting down...';
      try { await fetch('/api/updater/restart', { method: 'POST' }); } catch(e) {}
      setTimeout(() => {
        document.body.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#0f172a;color:#fff;font-family:sans-serif;text-align:center;"><h2>App Shut Down Successfully</h2><p style="color:#94a3b8;margin-top:10px;">The updater has finished applying your files.</p><p style="color:#94a3b8;">You may now close this browser tab and manually launch AuraReader again.</p></div>';
      }, 1000);
    }
  };

  window.DesktopUpdater = DesktopUpdater;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => DesktopUpdater.init());
  } else {
    DesktopUpdater.init();
  }
})();
