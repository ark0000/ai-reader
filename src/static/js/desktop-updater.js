/**
 * desktop-updater.js
 * Frontend client for AuraReader Desktop Auto-Updater.
 * Handles background version checks, changelog modal, 1-click update execution, and app restarts.
 */

(function() {
  const DesktopUpdater = {
    currentVersion: 'v1.0.0',
    latestInfo: null,
    isUpdating: false,

    init: function() {
      // Setup UI listeners and auto-check on startup
      const autoCheckPref = window.safeStorage ? window.safeStorage.getItem('aura-auto-update') : localStorage.getItem('aura-auto-update');
      const shouldAutoCheck = autoCheckPref === null || autoCheckPref === 'true';

      if (shouldAutoCheck) {
        // Wait 3 seconds after page load for smoother startup
        setTimeout(() => {
          this.checkUpdates(false);
        }, 3000);
      }

      this.injectStyles();
    },

    injectStyles: function() {
      if (document.getElementById('updater-injected-style')) return;
      const style = document.createElement('style');
      style.id = 'updater-injected-style';
      style.innerHTML = `
        .updater-badge-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: 20px;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          background: linear-gradient(135deg, rgba(245, 158, 11, 0.2), rgba(239, 68, 68, 0.2));
          border: 1px solid rgba(245, 158, 11, 0.4);
          color: #fbbf24;
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
          width: 100%;
          height: 6px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 3px;
          overflow: hidden;
          position: relative;
        }
        .updater-progress-bar-inner {
          height: 100%;
          width: 30%;
          background: linear-gradient(90deg, #3b82f6, #8b5cf6, #ec4899);
          border-radius: 3px;
          position: absolute;
          animation: progressIndeterminate 1.5s infinite ease-in-out;
        }
        @keyframes progressIndeterminate {
          0% { left: -30%; width: 30%; }
          50% { width: 60%; }
          100% { left: 100%; width: 30%; }
        }
      `;
      document.head.appendChild(style);
    },

    checkUpdates: async function(manual = false) {
      const statusLabel = document.getElementById('updater-status-label');
      const checkBtn = document.getElementById('updater-check-btn');

      if (statusLabel) statusLabel.textContent = 'Checking for updates...';
      if (checkBtn) {
        checkBtn.disabled = true;
        checkBtn.innerHTML = '&#8987; Checking...';
      }

      try {
        const res = await fetch(`/api/updater/check?force=${manual ? 'true' : 'false'}`);
        if (!res.ok) throw new Error('Update server unreachable');
        const data = await res.json();
        this.latestInfo = data;
        this.currentVersion = data.current_version || this.currentVersion;

        // Update settings UI
        const curVerEl = document.getElementById('updater-current-version');
        if (curVerEl) curVerEl.textContent = this.currentVersion;

        if (data.has_update) {
          if (statusLabel) {
            statusLabel.innerHTML = `<span style="color:#fbbf24; font-weight:600; cursor:pointer; text-decoration:underline; text-decoration-style:dotted;" onclick="window.DesktopUpdater.openUpdateModal()">Update Available: ${data.latest_version} ℹ️</span>`;
          }
          this.showUpdateBadge(data);
          if (manual) {
            this.openUpdateModal(data);
          }
        } else {
          if (statusLabel) {
            statusLabel.innerHTML = `<span style="color:#10b981; font-weight:600; cursor:pointer; text-decoration:underline; text-decoration-style:dotted;" onclick="window.DesktopUpdater.openUpdateModal()">&#10003; Up to date (${this.currentVersion}) ℹ️</span>`;
          }
          this.showUpdateBadge(data);
          if (manual && window.showToast) {
            window.showToast(`AuraReader is up to date (${this.currentVersion})`, 'success');
          }
        }
      } catch (err) {
        console.warn('[Updater] Check failed:', err);
        if (statusLabel) {
          statusLabel.innerHTML = `<span style="color:var(--text-3);">Check failed (offline)</span>`;
        }
      } finally {
        if (checkBtn) {
          checkBtn.disabled = false;
          checkBtn.innerHTML = '&#8635; Check for Updates';
        }
      }
    },

    showUpdateBadge: function(data) {
      let badge = document.getElementById('topbar-update-badge');
      if (!badge) {
        badge = document.createElement('button');
        badge.id = 'topbar-update-badge';
        
        const topBar = document.getElementById('top-bar') || document.querySelector('.app-header');
        if (topBar) {
          const group = topBar.querySelector('.toolbar-group:last-child') || topBar;
          group.prepend(badge);
        }
      }
      
      badge.onclick = () => this.openUpdateModal(this.latestInfo || data);
      
      if (data.has_update) {
        badge.className = 'updater-badge-btn';
        badge.style.background = 'linear-gradient(135deg, rgba(245, 158, 11, 0.2), rgba(239, 68, 68, 0.2))';
        badge.style.border = '1px solid rgba(245, 158, 11, 0.4)';
        badge.style.color = '#fbbf24';
        badge.style.animation = 'pulseGlow 2s infinite ease-in-out';
        badge.innerHTML = `<span>&#10024;</span> Update to ${data.latest_version}`;
      } else {
        badge.className = 'updater-badge-btn';
        badge.style.background = 'linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(5, 150, 105, 0.15))';
        badge.style.border = '1px solid rgba(16, 185, 129, 0.4)';
        badge.style.color = '#34d399';
        badge.style.animation = 'none';
        badge.style.boxShadow = 'none';
        badge.innerHTML = `<span>&#10003;</span> Up to date`;
      }
    },

    openUpdateModal: function(data) {
      if (!data) data = this.latestInfo;
      if (!data) return;

      let modal = document.getElementById('updater-modal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'updater-modal';
        modal.style.cssText = 'display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.7); z-index:99999; align-items:center; justify-content:center; backdrop-filter:blur(10px); animation:fadeIn 0.2s ease-out both;';
        document.body.appendChild(modal);
      }

      // Render release notes markdown or formatted text
      let notesHtml = data.release_notes ? data.release_notes.replace(/\n/g, '<br>') : 'Bug fixes, performance improvements, and UI enhancements.';
      if (typeof marked !== 'undefined' && data.release_notes) {
        try { notesHtml = marked.parse(data.release_notes); } catch(e) {}
      }

      modal.innerHTML = `
        <div style="background:var(--bg-panel, #1e293b); border:1px solid var(--border, rgba(255,255,255,0.1)); border-radius:14px; width:92%; max-width:540px; max-height:85vh; display:flex; flex-direction:column; box-shadow:0 20px 50px rgba(0,0,0,0.6); overflow:hidden; color:var(--text-1, #fff);">
          
          <!-- Header -->
          <div style="padding:18px 24px; border-bottom:1px solid var(--border, rgba(255,255,255,0.1)); display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.03);">
            <div style="display:flex; align-items:center; gap:10px;">
              <span style="font-size:24px;">${data.has_update ? '🚀' : '✅'}</span>
              <div>
                <h3 style="margin:0; font-size:17px; font-weight:700; color:var(--text-1, #fff);">${data.has_update ? 'New Update Available' : 'App is Up to Date'}</h3>
                <span style="font-size:12px; color:var(--text-2, #94a3b8);">${data.current_version} &rarr; <strong style="color:var(--accent, #60a5fa);">${data.latest_version}</strong></span>
              </div>
            </div>
            <button class="tb-btn" style="border:none; background:transparent; font-size:24px; color:var(--text-2); cursor:pointer; padding:0 6px;" onclick="document.getElementById('updater-modal').style.display='none'">&times;</button>
          </div>

          <!-- Body -->
          <div style="padding:20px 24px; flex:1; overflow-y:auto; font-size:13.5px; line-height:1.6;">
            <div style="margin-bottom:14px; display:flex; justify-content:space-between; align-items:center;">
              <span style="font-weight:600; color:var(--accent, #60a5fa); font-size:15px;">${data.release_name || data.latest_version}</span>
              <span style="font-size:11.5px; color:var(--text-3, #64748b);">${data.published_at ? new Date(data.published_at).toLocaleDateString() : ''}</span>
            </div>
            
            <div style="background:var(--bg-body, rgba(0,0,0,0.3)); border:1px solid var(--border, rgba(255,255,255,0.08)); border-radius:8px; padding:14px; max-height:220px; overflow-y:auto; font-size:13px; color:var(--text-2, #cbd5e1); margin-bottom:16px;">
              ${notesHtml}
            </div>

            <div id="updater-modal-progress" style="display:none; margin-bottom:16px;">
              <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:6px; color:var(--text-2);">
                <span id="updater-progress-status">Downloading & applying update...</span>
                <span>Please wait</span>
              </div>
              <div class="updater-progress-bar">
                <div class="updater-progress-bar-inner"></div>
              </div>
            </div>

            <div id="updater-modal-msg" style="display:none; padding:10px 14px; border-radius:8px; font-size:13px; margin-bottom:14px;"></div>
          </div>

          <!-- Footer Actions -->
          <div style="padding:14px 24px; border-top:1px solid var(--border, rgba(255,255,255,0.1)); display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.02);">
            <a href="${data.release_url}" target="_blank" rel="noopener noreferrer" style="font-size:12px; color:var(--text-3, #94a3b8); text-decoration:none;">🌐 View Release on GitHub</a>
            <div style="display:flex; gap:10px;">
              <button class="tb-btn" style="padding:8px 16px; border-radius:8px; border:1px solid var(--border, rgba(255,255,255,0.15)); background:transparent; color:var(--text-1);" onclick="document.getElementById('updater-modal').style.display='none'">${data.has_update ? 'Later' : 'Close'}</button>
              <button id="updater-apply-btn" class="tb-btn" style="padding:8px 20px; border-radius:8px; background:linear-gradient(135deg, #3b82f6, #8b5cf6); color:#fff; font-weight:600; border:none; cursor:pointer;" onclick="DesktopUpdater.applyUpdate()">${data.has_update ? '⚡ 1-Click Update Now' : '🔄 Force Reinstall'}</button>
            </div>
          </div>

        </div>
      `;

      modal.style.display = 'flex';
    },

    applyUpdate: async function() {
      if (this.isUpdating) return;
      this.isUpdating = true;

      const progressBox = document.getElementById('updater-modal-progress');
      const applyBtn = document.getElementById('updater-apply-btn');
      const msgBox = document.getElementById('updater-modal-msg');
      const statusText = document.getElementById('updater-progress-status');

      if (progressBox) progressBox.style.display = 'block';
      if (applyBtn) {
        applyBtn.disabled = true;
        applyBtn.textContent = 'Updating...';
        applyBtn.style.opacity = '0.6';
      }
      if (msgBox) msgBox.style.display = 'none';

      try {
        if (statusText) statusText.textContent = 'Downloading and applying latest update...';
        
        const res = await fetch('/api/updater/apply', { method: 'POST' });
        const result = await res.json();

        if (progressBox) progressBox.style.display = 'none';

        if (result.status === 'success') {
          if (msgBox) {
            msgBox.style.display = 'block';
            msgBox.style.background = 'rgba(16, 185, 129, 0.15)';
            msgBox.style.border = '1px solid rgba(16, 185, 129, 0.4)';
            msgBox.style.color = '#34d399';
            msgBox.innerHTML = `&#10003; <strong>${result.message}</strong><br><span style="font-size:12px;">Shutdown AuraReader and manually open it again to complete the upgrade.</span>`;
          }

          if (applyBtn) {
            applyBtn.disabled = false;
            applyBtn.style.opacity = '1';
            applyBtn.style.background = 'linear-gradient(135deg, #ef4444, #b91c1c)';
            applyBtn.textContent = '🛑 Shutdown App Now';
            applyBtn.onclick = () => this.restartApp();
          }
        } else if (result.status === 'manual' && result.download_url) {
          if (msgBox) {
            msgBox.style.display = 'block';
            msgBox.style.background = 'rgba(245, 158, 11, 0.15)';
            msgBox.style.border = '1px solid rgba(245, 158, 11, 0.4)';
            msgBox.style.color = '#fbbf24';
            msgBox.innerHTML = `⚠ <strong>${result.message}</strong>`;
          }
          if (applyBtn) {
            applyBtn.disabled = false;
            applyBtn.style.opacity = '1';
            applyBtn.textContent = 'Download from GitHub';
            applyBtn.onclick = () => window.open(result.download_url, '_blank');
          }
        } else {
          throw new Error(result.message || 'Update failed');
        }
      } catch (err) {
        if (progressBox) progressBox.style.display = 'none';
        if (msgBox) {
          msgBox.style.display = 'block';
          msgBox.style.background = 'rgba(239, 68, 68, 0.15)';
          msgBox.style.border = '1px solid rgba(239, 68, 68, 0.4)';
          msgBox.style.color = '#f87171';
          msgBox.innerHTML = `&#10007; <strong>Update failed:</strong> ${err.message}`;
        }
        if (applyBtn) {
          applyBtn.disabled = false;
          applyBtn.style.opacity = '1';
          applyBtn.textContent = 'Retry Update';
          applyBtn.onclick = () => this.applyUpdate();
        }
      } finally {
        this.isUpdating = false;
      }
    },

    restartApp: async function() {
      const applyBtn = document.getElementById('updater-apply-btn');
      if (applyBtn) applyBtn.textContent = 'Shutting down...';

      try {
        await fetch('/api/updater/restart', { method: 'POST' });
      } catch(e) {}

      setTimeout(() => {
        document.body.innerHTML = '<div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; background:#0f172a; color:#fff; font-family:sans-serif; text-align:center;"><h2>App Shut Down Successfully</h2><p style="color:#94a3b8; margin-top:10px;">The updater has finished applying your files.</p><p style="color:#94a3b8;">You may now close this browser tab and manually launch AuraReader again.</p></div>';
      }, 1000);
    }
  };

  // Expose globally and auto-initialize
  window.DesktopUpdater = DesktopUpdater;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => DesktopUpdater.init());
  } else {
    DesktopUpdater.init();
  }
})();
