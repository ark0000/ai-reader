/**
 * ai-chat.js - Advanced AI Chat Frontend Logic
 * Refactored using SOLID Principles
 */

// =========================================================================
// 1. Chat State Management (DAG Tree)
// =========================================================================
class ChatState {
  constructor() {
    this.tree = {};
    this.currentLeafId = null;
    this.returnLeafId = null;
  }

  generateId() {
    return Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
  }

  addNode(parentId, role, content) {
    const id = this.generateId();
    const node = { id, parentId, role, content, children: [] };
    this.tree[id] = node;
    if (parentId && this.tree[parentId]) {
      this.tree[parentId].children.push(id);
    }
    return id;
  }

  getActiveThread(leafId) {
    const thread = [];
    let curr = leafId;
    while (curr && this.tree[curr]) {
      thread.push(this.tree[curr]);
      curr = this.tree[curr].parentId;
    }
    return thread.reverse();
  }

  clear() {
    this.tree = {};
    this.currentLeafId = null;
    this.returnLeafId = null;
  }

  undo() {
    if (!this.currentLeafId || !this.tree[this.currentLeafId]) return;
    const currNode = this.tree[this.currentLeafId];
    if (currNode.parentId) {
      const parentNode = this.tree[currNode.parentId];
      if (parentNode && parentNode.parentId) {
        this.currentLeafId = parentNode.parentId;
      } else {
        this.currentLeafId = currNode.parentId;
      }
    } else {
      this.currentLeafId = null; 
    }
  }

  branch(nodeId) {
    this.returnLeafId = this.currentLeafId;
    this.currentLeafId = nodeId;
  }

  closeBranch() {
    if (this.returnLeafId) {
      this.currentLeafId = this.returnLeafId;
      this.returnLeafId = null;
    }
  }
}

// =========================================================================
// 2. Chat UI Controller (DOM Manipulation)
// =========================================================================
class ChatUI {
  constructor(state) {
    this.state = state;
    this.chatWin = document.getElementById('chat-win');
    this.chatInput = document.getElementById('chat-input');
    this.banner = document.getElementById('chat-branch-banner');
  }

  render() {
    if (!this.chatWin) this.chatWin = document.getElementById('chat-win');
    if (!this.chatWin) return;
    
    this.chatWin.innerHTML = '';
    
    if (this.banner) {
      if (this.state.returnLeafId) {
        this.banner.classList.add('chat-branch-banner--active');
      } else {
        this.banner.classList.remove('chat-branch-banner--active');
      }
    }
    
    if (!this.state.currentLeafId) return;
    
    const thread = this.state.getActiveThread(this.state.currentLeafId);
    thread.forEach(node => {
      const el = document.createElement('div');
      el.className = 'msg msg-' + (node.role === 'user' ? 'u' : 'a');
      
      const textDiv = document.createElement('div');
      textDiv.innerHTML = window.sanitizeHTML(window.fmt ? window.fmt(node.content) : node.content);
      el.appendChild(textDiv);
      
      // Add hover actions container
      const actions = document.createElement('div');
      actions.className = 'chat-msg__actions';
      
      if (node.role === 'user') {
        const editBtn = document.createElement('button');
        editBtn.innerHTML = '&#9998; Edit';
        editBtn.className = 'chat-action-btn';
        editBtn.onclick = () => {
          this.populateEdit(node);
          this.state.currentLeafId = node.parentId;
          this.render();
        };
        actions.appendChild(editBtn);
      } else {
        const branchBtn = document.createElement('button');
        branchBtn.innerHTML = '&#8627; Branch';
        branchBtn.className = 'chat-action-btn';
        branchBtn.onclick = () => {
          this.state.branch(node.id);
          this.render();
        };
        actions.appendChild(branchBtn);
      }
      
      // Add branch switcher if multiple children
      if (node.parentId && this.state.tree[node.parentId] && this.state.tree[node.parentId].children.length > 1) {
         const parent = this.state.tree[node.parentId];
         const idx = parent.children.indexOf(node.id);
         const swapSpan = document.createElement('span');
         swapSpan.className = 'chat-msg__branch-swap';
         swapSpan.innerHTML = '< ' + (idx + 1) + ' / ' + parent.children.length + ' >';
         swapSpan.onclick = () => {
            let nextIdx = (idx + 1) % parent.children.length;
            this.state.currentLeafId = parent.children[nextIdx];
            this.render();
         };
         actions.appendChild(swapSpan);
      }
      
      const noteBtn = document.createElement('button');
      noteBtn.innerHTML = '&#128247; Note';
      noteBtn.className = 'chat-action-btn';
      noteBtn.onclick = () => {
         if (!window.notes) window.notes = [];
         const label = node.role === 'user' ? 'AI Chat Prompt' : 'AI Chat Response';
         window.notes.push({q: '<i>' + label + '</i>', txt: window.fmt ? window.fmt(node.content) : node.content, id: Date.now()});
         if (window.renderNotes) window.renderNotes();
         if (window.panel && window.panel.classList.contains('hidden')) {
             if(window.togglePanel) window.togglePanel();
         }
         if (window.switchTab) window.switchTab('notes');
      };
      actions.appendChild(noteBtn);
      
      el.appendChild(actions);
      this.chatWin.appendChild(el);
    });
    
    this.chatWin.scrollTop = this.chatWin.scrollHeight;
  }

  populateEdit(node) {
    if (!this.chatInput) this.chatInput = document.getElementById('chat-input');
    if (this.chatInput) {
      this.chatInput.value = node.content;
      this.chatInput.focus();
      this.chatInput.style.height = 'auto';
      this.chatInput.style.height = this.chatInput.scrollHeight + 'px';
    }
  }

  clearInput() {
    if (!this.chatInput) this.chatInput = document.getElementById('chat-input');
    if (this.chatInput) {
      this.chatInput.value = '';
      this.chatInput.style.height = '';
    }
  }
}

// =========================================================================
// 3. Chat Provider (API Logic)
// =========================================================================
class ChatAPI {
  constructor(state, ui) {
    this.state = state;
    this.ui = ui;
  }

  async sendMessage(prompt) {
    if(!prompt || !prompt.trim()) return;
    
    if(!window.activeConnectionId) {
      alert("Please set up and select an active AI Connection in Settings first.");
      return;
    }
    
    if(window.panel && window.panel.classList.contains('hidden')) {
      if (window.togglePanel) window.togglePanel();
    }
    if (window.switchTab) window.switchTab('chat');
    
    const userNodeId = this.state.addNode(this.state.currentLeafId, 'user', prompt);
    this.state.currentLeafId = userNodeId;
    this.ui.clearInput();
    this.ui.render();
    
    const loadNodeId = this.state.addNode(this.state.currentLeafId, 'assistant', 'Thinking...');
    this.state.currentLeafId = loadNodeId;
    this.ui.render();
    
    try {
      var ragCb = document.getElementById('rag-enabled-cb');
      var isRag = ragCb ? ragCb.checked : false;
  
      const thread = this.state.getActiveThread(userNodeId);
      const systemMsg = { role: 'system', content: window.SYS || 'You are a helpful assistant.' };
      
      let messagesToSend = [systemMsg];
      const recentThread = thread.slice(-20).map(n => ({ role: n.role, content: n.content }));
      messagesToSend = messagesToSend.concat(recentThread);
  
      var payload = {
        connection_id: window.activeConnectionId,
        messages: messagesToSend,
        temperature: 0.7,
        rag_enabled: isRag,
        file_id: window.currentFileId
      };
      
      var r = await fetch('/api/chat', {
        method: 'POST',
        headers: Object.assign({'Content-Type': 'application/json'}, window.authHeaders()),
        body: JSON.stringify(payload)
      });
      
      if(!r.ok) {
        let errText = await r.text();
        try {
          let errJson = JSON.parse(errText);
          if (errJson.detail) errText = errJson.detail;
        } catch (e) {}
        throw new Error(errText);
      }
      
      var d = await r.json();
      if (!d.choices || !d.choices[0] || !d.choices[0].message) {
        throw new Error("Invalid response format from AI provider: " + JSON.stringify(d));
      }
      var ans = d.choices[0].message.content;
      
      this.state.tree[loadNodeId].content = ans;
      this.ui.render();
    } catch(e) {
      this.state.tree[loadNodeId].content = 'Error: ' + e.message;
      this.ui.render();
      console.error(e);
    }
  }
}

// =========================================================================
// 4. Connection Manager (Settings UI)
// =========================================================================
class ConnectionManager {
  async loadConnections() {
    try {
      console.log("loadConnections started");
      var list = document.getElementById('conn-mgr-list');
      var disp = document.getElementById('active-connection-display');
      
      var r = await fetch('/api/connections', { headers: window.authHeaders() });
      console.log("fetch returned", r.status, r.ok);
      if(r.ok) {
        var conns = await r.json();
        console.log("parsed conns:", conns);
        if(list) list.innerHTML = '';
        if(conns.length === 0) {
          if(list) list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-2);font-size:13px;">No connections added yet.</div>';
          if(disp) disp.textContent = 'None - Add a connection first';
          window.activeConnectionId = null;
        } else {
          var activeFound = false;
          try {
            conns.forEach(c => {
              if(c.is_active) {
                window.activeConnectionId = c.id;
                if(disp) disp.textContent = c.name + ' (' + c.provider_name + ')';
                activeFound = true;
              }
              if(list) {
                var d = document.createElement('div');
                d.style.cssText = 'padding:10px; border-radius:6px; margin-bottom:8px; cursor:pointer; border:1px solid ' + (c.is_active ? 'var(--accent)' : 'transparent') + '; background:' + (c.is_active ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent');
                d.innerHTML = '<div style="font-weight:600; font-size:13px; color:var(--text-1); display:flex; align-items:center; justify-content:space-between;">' + window.escapeHTML(c.name) + (c.is_active ? ' <span style="font-size:10px;color:var(--accent);">&#10003; Active</span>' : '') + '</div><div style="font-size:11px; color:var(--text-2);">' + window.escapeHTML(c.provider_name) + '</div>';
                d.onclick = () => { this.edit(c); };
                list.appendChild(d);
              }
            });
          } catch (innerE) {
            console.error("Error in render loop:", innerE);
            if (list) list.innerHTML = '<div style="color:red">Render Error: ' + innerE.message + '</div>';
          }
          if(!activeFound && disp) disp.textContent = 'None selected';
        }
      } else {
        console.error("Non-OK response:", r.status);
        if(list) list.innerHTML = '<div style="padding:20px;text-align:center;color:#e53e3e;font-size:13px;">Error loading connections: ' + r.status + '</div>';
      }
    } catch(e) {
      console.error('Failed to load connections', e);
      var listEl = document.getElementById('conn-mgr-list');
      if (listEl) listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#e53e3e;font-size:13px;">Failed to load connections: ' + e.message + '</div>';
    }
  }

  async loadProviders() {
    try {
      var r = await fetch('/api/providers', { headers: window.authHeaders() });
      if(r.ok) {
        window.availableProviders = await r.json();
        var sel = document.getElementById('conn-mgr-provider');
        sel.innerHTML = '';
        window.availableProviders.forEach(p => {
          var opt = document.createElement('option');
          opt.value = p.id;
          opt.textContent = p.name + ' (' + p.type + ')';
          sel.appendChild(opt);
        });
      }
    } catch(e) {
      console.error('Failed to load providers', e);
    }
  }

  open() {
    var s = document.getElementById('settings-popup');
    if (s && s.style.display !== 'none' && window.toggleSettings) {
      window.toggleSettings();
    }
    document.getElementById('conn-mgr-modal').style.display = 'flex';
    document.getElementById('conn-mgr-sidebar').style.display = 'flex';
    document.getElementById('conn-mgr-detail').style.display = 'none';
    this.loadProviders();
    this.loadConnections();
  }

  providerChanged() {
    var provId = document.getElementById('conn-mgr-provider').value;
    var prov = window.availableProviders.find(p => p.id === provId);
    var hint = document.getElementById('conn-mgr-key-hint');
    var baseUrlInput = document.getElementById('conn-mgr-baseurl');
    if(prov) {
      if(prov.auth_type === 'none') hint.textContent = '(Not required)';
      else if(prov.auth_type === 'bearer-optional') hint.textContent = '(Optional)';
      else hint.textContent = '(Required)';
      
      if(!baseUrlInput.value) baseUrlInput.placeholder = prov.base_url_template || '';
    }
  }

  showAdd() {
    document.getElementById('conn-mgr-sidebar').style.display = 'none';
    var detail = document.getElementById('conn-mgr-detail');
    detail.style.display = 'flex';
    
    document.getElementById('conn-mgr-title').textContent = 'Add New Connection';
    document.getElementById('conn-mgr-id').value = '';
    document.getElementById('conn-mgr-name').value = '';
    document.getElementById('conn-mgr-baseurl').value = '';
    document.getElementById('conn-mgr-model').value = '';
    document.getElementById('conn-mgr-apikey').value = '';
    document.getElementById('conn-mgr-active').checked = true;
    document.getElementById('conn-mgr-delete-btn').style.display = 'none';
    
    this.providerChanged();
  }

  edit(c) {
    document.getElementById('conn-mgr-sidebar').style.display = 'none';
    var detail = document.getElementById('conn-mgr-detail');
    detail.style.display = 'flex';
    
    document.getElementById('conn-mgr-title').textContent = 'Edit Connection';
    document.getElementById('conn-mgr-id').value = c.id;
    document.getElementById('conn-mgr-provider').value = c.provider_id;
    document.getElementById('conn-mgr-name').value = c.name;
    document.getElementById('conn-mgr-baseurl').value = c.base_url || '';
    document.getElementById('conn-mgr-model').value = c.model || '';
    document.getElementById('conn-mgr-apikey').value = ''; 
    document.getElementById('conn-mgr-apikey').placeholder = c.has_key ? '(Key saved. Enter to overwrite)' : 'Enter API key...';
    document.getElementById('conn-mgr-active').checked = c.is_active;
    document.getElementById('conn-mgr-delete-btn').style.display = 'block';
    
    this.providerChanged();
  }

  async save() {
    var id = document.getElementById('conn-mgr-id').value;
    var payload = {
      provider_id: document.getElementById('conn-mgr-provider').value,
      name: document.getElementById('conn-mgr-name').value.trim(),
      base_url: document.getElementById('conn-mgr-baseurl').value.trim(),
      model: document.getElementById('conn-mgr-model').value.trim(),
      is_active: document.getElementById('conn-mgr-active').checked
    };
    
    var key = document.getElementById('conn-mgr-apikey').value.trim();
    if(key) payload.api_key = key;
    
    if(!payload.name) {
      alert("Please enter a Display Name.");
      return;
    }
    
    var url = id ? '/api/connections/' + id : '/api/connections';
    var method = id ? 'PUT' : 'POST';
    
    try {
      var r = await fetch(url, {
        method: method,
        headers: Object.assign({'Content-Type': 'application/json'}, window.authHeaders()),
        body: JSON.stringify(payload)
      });
      
      if(r.ok) {
        document.getElementById('conn-mgr-sidebar').style.display = 'flex';
        document.getElementById('conn-mgr-detail').style.display = 'none';
        this.loadConnections();
      } else {
        alert("Failed to save connection: " + (await r.text()));
      }
    } catch(e) {
      alert("Error: " + e.message);
    }
  }

  async test() {
    var payload = {
      provider_id: document.getElementById('conn-mgr-provider').value,
      name: document.getElementById('conn-mgr-name').value.trim() || 'test',
      base_url: document.getElementById('conn-mgr-baseurl').value.trim(),
      model: document.getElementById('conn-mgr-model').value.trim(),
      is_active: false
    };
    
    var key = document.getElementById('conn-mgr-apikey').value.trim();
    if(key) payload.api_key = key;
    
    var btn = document.querySelector('button[onclick="window.connMgrSave()"]').nextElementSibling; // Just a visual hack for the old button if needed, otherwise we can pass it
    if (btn && btn.textContent.includes('Test')) {
       var oldText = btn.textContent;
       btn.textContent = "Testing...";
       btn.disabled = true;
    }
    
    try {
      var r = await fetch('/api/connections/test', {
        method: 'POST',
        headers: Object.assign({'Content-Type': 'application/json'}, window.authHeaders()),
        body: JSON.stringify(payload)
      });
      var data = await r.json();
      if (data.status === "success") {
        alert("✅ Connection successful!");
      } else {
        alert("❌ Test failed: " + (data.message || data.detail || JSON.stringify(data)));
      }
    } catch(e) {
      alert("❌ Test failed: " + e.message);
    } finally {
      if (btn && btn.textContent.includes('Testing')) {
         btn.textContent = oldText;
         btn.disabled = false;
      }
    }
  }

  async delete() {
    var id = document.getElementById('conn-mgr-id').value;
    if(!id) return;
    if(!confirm("Are you sure you want to delete this connection?")) return;
    
    try {
      var r = await fetch('/api/connections/' + id, {
        method: 'DELETE',
        headers: window.authHeaders()
      });
      
      if(r.ok) {
        document.getElementById('conn-mgr-sidebar').style.display = 'flex';
        document.getElementById('conn-mgr-detail').style.display = 'none';
        this.loadConnections();
      } else {
        alert("Failed to delete connection");
      }
    } catch(e) {
      alert("Error: " + e.message);
    }
  }
}


// =========================================================================
// 5. System Instantiation & Legacy Facade (Backward Compatibility)
// =========================================================================

window.chatState = new ChatState();
window.chatUI = new ChatUI(window.chatState);
window.chatAPI = new ChatAPI(window.chatState, window.chatUI);
window.connMgr = new ConnectionManager();

// Exposed global functions to avoid changing HTML onClick handlers
window.loadConnections = () => window.connMgr.loadConnections();
window.askAI = (prompt) => window.chatAPI.sendMessage(prompt);
window.clearChat = () => { 
  if (!window.chatState.currentLeafId) return; // nothing to clear
  if (confirm('Clear the entire chat history?')) {
    window.chatState.clear(); 
    window.chatUI.render(); 
  }
};
window.undoLast = () => { window.chatState.undo(); window.chatUI.render(); };
window.branchChat = (id) => { window.chatState.branch(id); window.chatUI.render(); };
window.closeBranch = () => { window.chatState.closeBranch(); window.chatUI.render(); };

// Export chat to clipboard as plain text
window.exportChat = () => {
  if (!window.chatState.currentLeafId) {
    alert('No chat history to export.');
    return;
  }
  const thread = window.chatState.getActiveThread(window.chatState.currentLeafId);
  const text = thread.map(n => {
    const label = n.role === 'user' ? '🧑 You' : '✦ AI';
    return label + ':\n' + n.content;
  }).join('\n\n---\n\n');
  
  navigator.clipboard.writeText(text).then(() => {
    // Show a brief toast
    const toast = document.createElement('div');
    toast.textContent = '✅ Chat copied to clipboard!';
    toast.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--accent);color:#fff;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.5s'; setTimeout(() => toast.remove(), 500); }, 2000);
  }).catch(() => {
    // Fallback: open in a new window
    const w = window.open('', '_blank');
    if (w) { w.document.write('<pre>' + text.replace(/</g,'&lt;') + '</pre>'); }
  });
}

// =========================================================================
// AI Panel Resize Logic
// =========================================================================
document.addEventListener('DOMContentLoaded', () => {
  const panel = document.getElementById('ai-panel');
  if (panel) {
    const resizer = document.createElement('div');
    resizer.className = 'panel-resizer';
    panel.appendChild(resizer);
    
    let isResizing = false;
    resizer.addEventListener('mousedown', (e) => {
      isResizing = true;
      document.body.style.cursor = 'ew-resize';
      panel.style.transition = 'none'; // disable animation during drag
      e.preventDefault();
    });
    
    window.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      let newWidth = window.innerWidth - e.clientX;
      if (newWidth < 300) newWidth = 300;
      if (newWidth > 900) newWidth = 900;
      panel.style.width = newWidth + 'px';
    });
    
    window.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        document.body.style.cursor = '';
        panel.style.transition = '';
        localStorage.setItem('aura-ai-panel-width', parseInt(panel.style.width, 10));
      }
    });
    
    const savedWidth = localStorage.getItem('aura-ai-panel-width');
    if (savedWidth) {
      panel.style.width = savedWidth + 'px';
    }
  }
});

// Connection Manager Facades
window.openConnectionManager = () => window.connMgr.open();
window.connMgrProviderChanged = () => window.connMgr.providerChanged();
window.connMgrShowAdd = () => window.connMgr.showAdd();
window.connMgrSave = () => window.connMgr.save();
window.connMgrTest = () => window.connMgr.test();
window.connMgrDelete = () => window.connMgr.delete();


window.fmt = function(t){
    const start = performance.now();
    let result = t;
    if (typeof marked !== 'undefined') {
      if (typeof markedKatex !== 'undefined' && !window.markedKatexInitialized) {
        marked.use(markedKatex({ throwOnError: false }));
        window.markedKatexInitialized = true;
      }
      result = marked.parse(t);
    } else {
      result = t.replace(/`([\s\S]*?)`/g,'<pre style="margin:4px 0;background:rgba(0,0,0,.3);padding:7px;border-radius:5px;overflow:auto"><code><\/code><\/pre>')
        .replace(/\*\*(.*?)\*\*/g,'<strong><\/strong>')
        .replace(/([^]+)/g,'<code style="background:rgba(99,179,237,.14);color:#63b3ed;padding:.1em .35em;border-radius:3px;font-size:.87em"><\/code>')
        .replace(/\n/g,'<br>');
    }
    const end = performance.now();
    if (window.AuraPerf && window.AuraPerf.recordFormatTime) {
      window.AuraPerf.recordFormatTime(end - start);
    }
    return result;
};

window.authHeaders = function() { 
  var token = localStorage.getItem('token');
  if (token) {
    return { 'Authorization': 'Bearer ' + token };
  }
  return {}; 
};

window.addEventListener('AI_EXPLAIN', (e) => {
  const data = e.detail;
  if (window.switchTab && window.togglePanel) {
    const panel = document.getElementById('ai-panel');
    if (panel && panel.classList.contains('hidden')) window.togglePanel();
    window.switchTab('chat');
    var input = document.getElementById('chat-input');
    if (input) {
      if (data.type === 'code') {
        input.value = "Explain this code:\n\n```\n" + data.text + "\n```";
      } else {
        input.value = "Explain this concept: \"" + data.text + "\"";
      }
      setTimeout(() => {
        input.focus();
      }, 100);
    }
  }
});

// AI Chat Brightness Controller
(function initAiBrightness() {
  const aiBrightnessSlider = document.getElementById('ai-brightness-slider');
  const chatWin = document.getElementById('chat-win');
  
  if (aiBrightnessSlider && chatWin) {
    aiBrightnessSlider.addEventListener('input', (e) => {
      const brightness = e.target.value;
      chatWin.style.filter = `brightness(${brightness})`;
    });
  }
})();


