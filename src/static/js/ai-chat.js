window.loadConnections = async function() {
  try {
    var r = await fetch('/api/connections', { headers: window.authHeaders() });
    if(r.ok) {
      var conns = await r.json();
      var list = document.getElementById('conn-mgr-list');
      var disp = document.getElementById('active-connection-display');
      
      list.innerHTML = '';
      if(conns.length === 0) {
        list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-2);font-size:13px;">No connections added yet.</div>';
        disp.textContent = 'None - Add a connection first';
        window.activeConnectionId = null;
      } else {
        var activeFound = false;
        conns.forEach(function(c) {
          if(c.is_active) {
            window.activeConnectionId = c.id;
            disp.textContent = c.name + ' (' + c.provider_name + ')';
            activeFound = true;
          }
          var d = document.createElement('div');
          d.style.cssText = 'padding:10px; border-radius:6px; margin-bottom:8px; cursor:pointer; border:1px solid ' + (c.is_active ? 'var(--accent)' : 'transparent') + '; background:' + (c.is_active ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent');
          d.innerHTML = '<div style="font-weight:600; font-size:13px; color:var(--text-1); display:flex; align-items:center; justify-content:space-between;">' + window.escapeHTML(c.name) + (c.is_active ? ' <span style="font-size:10px;color:var(--accent);">&#10003; Active</span>' : '') + '</div><div style="font-size:11px; color:var(--text-2);">' + window.escapeHTML(c.provider_name) + '</div>';
          d.onclick = function() { connMgrEdit(c); };
          list.appendChild(d);
        });
        
        if(!activeFound) disp.textContent = 'None selected';
      }
    }
  } catch(e) {
    console.error('Failed to load connections', e);
  }
};

window.loadProviders = async function() {
  try {
    var r = await fetch('/api/providers', { headers: window.authHeaders() });
    if(r.ok) {
      window.availableProviders = await r.json();
      var sel = document.getElementById('conn-mgr-provider');
      sel.innerHTML = '';
      window.availableProviders.forEach(function(p) {
        var opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name + ' (' + p.type + ')';
        sel.appendChild(opt);
      });
    }
  } catch(e) {
    console.error('Failed to load providers', e);
  }
};

window.openConnectionManager = function() {
  var s = document.getElementById('settings-popup');
  if (s && s.style.display !== 'none' && window.toggleSettings) {
    window.toggleSettings();
  }

  document.getElementById('conn-mgr-modal').style.display = 'flex';
  document.getElementById('conn-mgr-sidebar').style.display = 'flex';
  document.getElementById('conn-mgr-detail').style.display = 'none';
  loadProviders();
  loadConnections();
};

window.connMgrProviderChanged = function() {
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
};

window.connMgrShowAdd = function() {
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
  
  connMgrProviderChanged();
};

window.connMgrEdit = function(c) {
  document.getElementById('conn-mgr-sidebar').style.display = 'none';
  var detail = document.getElementById('conn-mgr-detail');
  detail.style.display = 'flex';
  
  document.getElementById('conn-mgr-title').textContent = 'Edit Connection';
  document.getElementById('conn-mgr-id').value = c.id;
  document.getElementById('conn-mgr-provider').value = c.provider_id;
  document.getElementById('conn-mgr-name').value = c.name;
  document.getElementById('conn-mgr-baseurl').value = c.base_url || '';
  document.getElementById('conn-mgr-model').value = c.model || '';
  document.getElementById('conn-mgr-apikey').value = ''; // Don't show existing key
  document.getElementById('conn-mgr-apikey').placeholder = c.has_key ? '(Key saved. Enter to overwrite)' : 'Enter API key...';
  document.getElementById('conn-mgr-active').checked = c.is_active;
  document.getElementById('conn-mgr-delete-btn').style.display = 'block';
  
  connMgrProviderChanged();
};

window.connMgrSave = async function() {
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
      loadConnections();
    } else {
      alert("Failed to save connection: " + (await r.text()));
    }
  } catch(e) {
    alert("Error: " + e.message);
  }
};

window.connMgrTest = async function() {
  var payload = {
    provider_id: document.getElementById('conn-mgr-provider').value,
    name: document.getElementById('conn-mgr-name').value.trim() || 'test',
    base_url: document.getElementById('conn-mgr-baseurl').value.trim(),
    model: document.getElementById('conn-mgr-model').value.trim(),
    is_active: false
  };
  
  var key = document.getElementById('conn-mgr-apikey').value.trim();
  if(key) payload.api_key = key;
  
  var btn = document.querySelector('button[onclick="connMgrTest()"]');
  var oldText = btn.textContent;
  btn.textContent = "Testing...";
  btn.disabled = true;
  
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
    btn.textContent = oldText;
    btn.disabled = false;
  }
};

window.connMgrDelete = async function() {
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
      loadConnections();
    } else {
      alert("Failed to delete connection");
    }
  } catch(e) {
    alert("Error: " + e.message);
  }
};

window.askAI = async function(prompt) {
  if(!prompt||!prompt.trim()) return;
  
  if(!window.activeConnectionId) {
    alert("Please set up and select an active AI Connection in Settings first.");
    return;
  }
  
  if(window.panel.classList.contains('hidden')) togglePanel();
  switchTab('chat');
  addMsg(prompt,'u'); 
  if(window.chatInput) {
    window.chatInput.value='';
    window.chatInput.style.height='';
  }
  
  var load = addMsg('Thinking...','a');
  try {
    var ragCb = document.getElementById('rag-enabled-cb');
    var isRag = ragCb ? ragCb.checked : false;

    var payload = {
      connection_id: window.activeConnectionId,
      messages: [
        { role: 'system', content: window.SYS || 'You are a helpful assistant.' },
        { role: 'user', content: prompt }
      ],
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
    load.innerHTML = window.sanitizeHTML(window.fmt ? window.fmt(ans) : ans);
  } catch(e) {
    load.className = 'msg msg-s';
    load.textContent = 'Error: ' + e.message;
    console.error(e);
  }
};

window.addMsg = function(txt,type){
  var el=document.createElement('div');
  el.className='msg msg-'+type;el.innerHTML=window.sanitizeHTML(fmt(txt));
  window.chatWin.appendChild(el);window.chatWin.scrollTop=window.chatWin.scrollHeight;return el;
};

window.fmt = function(t){
  return t.replace(/```([\s\S]*?)```/g,'<pre style="margin:4px 0;background:rgba(0,0,0,.3);padding:7px;border-radius:5px;overflow:auto"><code>$1<\/code><\/pre>')
    .replace(/\*\*(.*?)\*\*/g,'<strong>$1<\/strong>')
    .replace(/`([^`]+)`/g,'<code style="background:rgba(99,179,237,.14);color:#63b3ed;padding:.1em .35em;border-radius:3px;font-size:.87em">$1<\/code>')
    .replace(/\n/g,'<br>');
};

window.authHeaders = function() { 
  var token = localStorage.getItem('token');
  if (token) {
    return { 'Authorization': 'Bearer ' + token };
  }
  return {}; 
};

