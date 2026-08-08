window.togglePanel = function() {
  window.panel.classList.toggle('hidden');
  var fab = document.getElementById('fab');
  if (fab) {
    fab.style.display = window.panel.classList.contains('hidden') ? 'flex' : 'none';
  }
  logUI('ai-toggle');
};

window.switchTab = function(name){
  var ids=['chat','notes','tts'];
  document.querySelectorAll('.tab').forEach(function(b,i){
    b.classList.toggle('on',ids[i]===name);
    var pane = document.getElementById('tab-'+ids[i]);
    if(pane) pane.classList.toggle('on',ids[i]===name);
  });
};

window.hidePopup = function(){ window.popup.style.display='none'; };

window.popExplain = function(){hidePopup();askAI('Explain this concept:\n\n"'+selText+'"');};

window.popDict = function(){hidePopup();fetchDict(selText.trim().split(/\s+/)[0]);};

window.popSearch = function(){hidePopup();window.open('https://www.google.com/search?q='+encodeURIComponent(selText),'_blank');};

window.showActionPopup = function(e, label, actionFn) {
  var p = document.getElementById('action-popup');
  if(!p) {
    p = document.createElement('div');
    p.id = 'action-popup';
    p.style.cssText = 'position:fixed;background:var(--bg-panel);border:1px solid var(--border);border-radius:6px;box-shadow:var(--shadow);z-index:9999;display:none;padding:4px;';
    p.innerHTML = '<button class="pb" style="width:100%"></button>';
    document.body.appendChild(p);
  }
  var btn = p.firstChild;
  btn.innerHTML = label;
  btn.onclick = function(ev) {
    ev.stopPropagation();
    p.style.display = 'none';
    actionFn();
  };
  p.style.display = 'block';
  var pw = p.offsetWidth || 150;
  var ph = p.offsetHeight || 40;
  p.style.left = Math.min(e.clientX || 100, window.innerWidth - pw - 10) + 'px';
  p.style.top  = Math.min(e.clientY || 100, window.innerHeight - ph - 10) + 'px';
  setTimeout(function(){
    var hideFn = function(){ p.style.display='none'; document.removeEventListener('click', hideFn); };
    document.addEventListener('click', hideFn);
  }, 10);
};

window.toggleSettings = function(e) {
  if(e) e.stopPropagation();
  var s = document.getElementById('settings-popup');
  var b = document.getElementById('settings-backdrop');
  if(!s) return;
  
  var isHidden = s.style.display === 'none' || s.classList.contains('hidden');
  s.classList.remove('hidden');
  
  if (isHidden) {
    s.style.display = 'block';
    if(b) b.style.display = 'block';
    
    if (window.loadConnections) window.loadConnections();
    
    // Add escape key listener
    if (!window._settingsEscapeFn) {
      window._settingsEscapeFn = function(ev) {
        if (ev.key === 'Escape') {
          window.toggleSettings();
        }
      };
      document.addEventListener('keydown', window._settingsEscapeFn);
    }
    
    // Focus search input
    setTimeout(function() {
      var searchInput = document.getElementById('settings-search');
      if (searchInput) searchInput.focus();
    }, 50);
  } else {
    s.style.display = 'none';
    if(b) b.style.display = 'none';
    
    // Clean up escape listener
    if (window._settingsEscapeFn) {
      document.removeEventListener('keydown', window._settingsEscapeFn);
      window._settingsEscapeFn = null;
    }
  }
};

window.handleSettingsTitleClick = function() {
  window._devClickCount++;
  clearTimeout(window._devClickTimer);
  
  if (window._devClickCount >= 7) {
    document.body.classList.toggle('dev-mode-active');
    window._devClickCount = 0;
    
    // Quick toast feedback
    var isActive = document.body.classList.contains('dev-mode-active');
    var toast = document.createElement('div');
    toast.textContent = isActive ? "Developer Options Unlocked!" : "Developer Options Hidden";
    toast.style.cssText = "position:fixed; bottom:20px; left:50%; transform:translateX(-50%); background:var(--accent); color:#fff; padding:8px 16px; border-radius:20px; z-index:9999; font-size:14px; font-weight:bold; box-shadow:0 4px 12px rgba(0,0,0,0.3); animation:popInDropdown 0.3s ease;";
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.5s';
      setTimeout(() => toast.remove(), 500);
    }, 2000);
    
    // Force re-run of filter to update visible rows
    var searchInput = document.getElementById('settings-search');
    if (searchInput && window.filterSettings) window.filterSettings(searchInput.value);
  } else {
    window._devClickTimer = setTimeout(function() {
      window._devClickCount = 0;
    }, 2000);
  }
};

window.closeToc = function() {
  var s = document.getElementById('toc-popup');
  if (s) { s.classList.remove('open'); s.classList.remove('active'); }
};

window.toggleFullScreen = function() {
  const doc = document.documentElement;
  const fullscreenElement = document.fullscreenElement || document.mozFullScreenElement || document.webkitFullscreenElement || document.msFullscreenElement;

  if (!fullscreenElement) {
    if (doc.requestFullscreen) {
      doc.requestFullscreen().catch(err => console.warn(err));
    } else if (doc.mozRequestFullScreen) { /* Firefox */
      doc.mozRequestFullScreen();
    } else if (doc.webkitRequestFullscreen) { /* Chrome, Safari and Opera */
      doc.webkitRequestFullscreen();
    } else if (doc.msRequestFullscreen) { /* IE/Edge */
      doc.msRequestFullscreen();
    }
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.mozCancelFullScreen) { /* Firefox */
      document.mozCancelFullScreen();
    } else if (document.webkitExitFullscreen) { /* Chrome, Safari and Opera */
      document.webkitExitFullscreen();
    } else if (document.msExitFullscreen) { /* IE/Edge */
      document.msExitFullscreen();
    }
  }
};

