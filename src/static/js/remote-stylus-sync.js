class RemoteStylusSync {
    constructor(roomId, isDesktop = false, onReceiveStrokes = null) {
        this.roomId = roomId;
        this.isDesktop = isDesktop;
        this.onReceiveStrokes = onReceiveStrokes;
        this.ws = null;
        this.isConnected = false;
        this.reconnectTimer = null;
        
        this.canvases = [];
        this.currentCanvasIndex = 0;
        this.targetWidth = 900;
        this.targetHeight = 300;
        
        this.init();
    }
    
    init() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        this.ws = new WebSocket(`${protocol}//${window.location.host}/ws/stylus/${this.roomId}`);
        
        this.ws.onopen = () => {
            this.isConnected = true;
            if (window.showToast) window.showToast(this.isDesktop ? 'Tablet connected!' : 'Connected to desktop!');
            
            if (!this.isDesktop) {
                const urlParams = new URLSearchParams(window.location.search);
                const mode = urlParams.get('mode');
                const id = urlParams.get('id');
                
                if (id && (mode === 'fullscreen' || mode === 'B')) {
                    this.ws.send(JSON.stringify({
                        type: 'open-standalone-note',
                        id: id
                    }));
                }
                
                this.ws.send(JSON.stringify({
                    type: 'hello'
                }));
            }
        };
        
        this.ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                
                if (this.isDesktop && msg.type === 'sync-strokes-done') {
                    if (this.onReceiveStrokes) this.onReceiveStrokes(msg.strokes);
                    if (window.showToast) window.showToast('Drawing synced!');
                } 
                else if (!this.isDesktop && msg.type === 'canvas-info') {
                    let oldActiveCanvasId = null;
                    if (this.canvases && this.canvases.length > this.currentCanvasIndex && this.canvases[this.currentCanvasIndex]) {
                        oldActiveCanvasId = this.canvases[this.currentCanvasIndex].id;
                    }
                    this.canvases = msg.canvases || [];
                    
                    // Only jump to a specific canvas if the desktop explicitly requested it,
                    // or if we don't have a valid current position. Otherwise keep where we are.
                    let targetId = msg.activeCanvasId || this.pendingCanvasId;
                    if (targetId) {
                        const idx = this.canvases.findIndex(c => c.id === targetId);
                        this.currentCanvasIndex = idx !== -1 ? idx : 0;
                    } else if (oldActiveCanvasId) {
                        // Keep current position — try to find the same canvas by ID
                        const idx = this.canvases.findIndex(c => c.id === oldActiveCanvasId);
                        this.currentCanvasIndex = idx !== -1 ? idx : 0;
                    } else {
                        this.currentCanvasIndex = 0;
                    }
                    this.pendingCanvasId = null;
                    
                    this.mode = msg.mode || 'editor';
                    this.menuTree = msg.menuTree || {text_notes: [], standalone_notes: []};
                    this.updateNavUI();
                    this.renderHamburgerMenu();
                    
                    if (this.canvases.length > 0) {
                        this.targetWidth = this.canvases[this.currentCanvasIndex].desktopW;
                        this.targetHeight = this.canvases[this.currentCanvasIndex].desktopH;
                    }
                    // Always update canvas size so fullscreen mode fills the screen correctly
                    this.updateTabletCanvasSize();
                }

                else if (this.isDesktop && msg.type === 'switch-canvas') {
                    if (window.TabletSync) {
                        // Bug 6 fix: capture targetId BEFORE async activation to eliminate
                        // race condition where activeFacade changes during the 100ms delay.
                        const canvasNodes = document.querySelectorAll('.ql-stylus-canvas');
                        const targetNode = canvasNodes[msg.index];
                        const targetId = targetNode ? targetNode.dataset.id : null;

                        window.TabletSync.setActiveCanvas(msg.index);

                        if (targetId) {
                            setTimeout(() => {
                                if (!this.isConnected) return; // guard: ws may have closed
                                const strokes = (window.StylusStore && window.StylusStore.get(targetId)) || [];
                                this.ws.send(JSON.stringify({
                                    type: 'load-strokes',
                                    canvasId: targetId,
                                    strokes: strokes
                                }));
                            }, 100);
                        }
                    }
                }
                else if (!this.isDesktop && msg.type === 'load-strokes') {
                    if (window.StylusEngine && window.StylusEngine.activeFacade) {
                        const facade = window.StylusEngine.activeFacade;
                        // Bug 5 fix: only load if canvasId matches or is absent (legacy broadcast)
                        const idMatch = !msg.canvasId || facade.id === msg.canvasId;
                        if (idMatch) {
                            facade.repo.load(msg.strokes);
                            facade.renderAll();
                            if (window.showToast) window.showToast('Strokes loaded!');
                        }
                    }
                }
                else if (this.isDesktop && msg.type === 'request-strokes') {
                    // Tablet is asking for strokes for a specific canvas ID
                    const requestedId = msg.canvasId;
                    const strokes = (window.StylusStore && window.StylusStore.get(requestedId)) || [];
                    this.ws.send(JSON.stringify({
                        type: 'load-strokes',
                        canvasId: requestedId,
                        strokes: strokes
                    }));
                }
            } catch (e) {
                console.error("Invalid sync payload", e);
                if (!this.isDesktop && window.showToast) window.showToast("Error processing sync: " + e.message);
                else if (!this.isDesktop) alert("Error processing sync: " + e.message + "\nStack: " + e.stack);
            }
        };
        
        this.ws.onclose = () => {
            this.isConnected = false;
        };
    }
    
    reconnect() {
        if (this.ws) {
            this.ws.onclose = null;
            this.ws.close();
        }
        if (window.showToast) window.showToast("Reconnecting...");
        this.init();
    }
    
    requestMenuRefresh() {
        if (this.isConnected) {
            this.ws.send(JSON.stringify({ type: 'request-menu-tree' }));
            if (window.showToast) window.showToast('Refreshing menu...');
        } else {
            this.reconnect();
        }
    }
    
    loadCanvasStrokes(canvasId) {
        // Navigate to the canvas by ID, then request its strokes from desktop
        const idx = this.canvases.findIndex(c => c.id === canvasId);
        if (idx !== -1) {
            this.currentCanvasIndex = idx;
            this.updateNavUI();
            this.updateTabletCanvasSize();
            this.renderHamburgerMenu();
        }
        if (this.isConnected) {
            this.ws.send(JSON.stringify({ type: 'request-strokes', canvasId: canvasId }));
            if (window.showToast) window.showToast('Loading strokes...');
        } else {
            this.reconnect();
        }
    }
    
    updateNavUI() {
        const label = document.getElementById('nav-label');
        const btnPrev = document.getElementById('btn-prev');
        const btnNext = document.getElementById('btn-next');
        
        if (!label) return;
        
        if (this.mode === 'fullscreen' || this.mode === 'B') {
            if (btnPrev) btnPrev.style.display = 'none';
            if (btnNext) btnNext.style.display = 'none';
            
            const activeCanvas = this.canvases[this.currentCanvasIndex];
            if (activeCanvas && activeCanvas.title && activeCanvas.title !== `Draw ${this.currentCanvasIndex + 1}`) {
                label.textContent = activeCanvas.title;
            } else {
                label.textContent = "🎨 Full Canvas";
            }
            return;
        }
        
        if (btnPrev) btnPrev.style.display = 'inline-block';
        if (btnNext) btnNext.style.display = 'inline-block';
        
        if (this.canvases.length === 0) {
            label.textContent = "No Draws Found";
            return;
        }
        
        const activeCanvas = this.canvases[this.currentCanvasIndex];
        if (activeCanvas && activeCanvas.title && activeCanvas.title !== `Draw ${this.currentCanvasIndex + 1}`) {
            label.textContent = `${activeCanvas.title} (${this.currentCanvasIndex + 1}/${this.canvases.length})`;
        } else {
            label.textContent = `Draw ${this.currentCanvasIndex + 1} of ${this.canvases.length}`;
        }
    }
    
    switchCanvas(dir) {
        if (this.canvases.length <= 1) return;
        
        if (window.StylusEngine && window.StylusEngine.activeFacade) {
            window.StylusEngine.activeFacade.repo.clear(); 
        }
        
        this.currentCanvasIndex += dir;
        if (this.currentCanvasIndex < 0) this.currentCanvasIndex = this.canvases.length - 1;
        if (this.currentCanvasIndex >= this.canvases.length) this.currentCanvasIndex = 0;
        
        this.targetWidth = this.canvases[this.currentCanvasIndex].desktopW;
        this.targetHeight = this.canvases[this.currentCanvasIndex].desktopH;
        this.updateNavUI();
        this.updateTabletCanvasSize();
        
        if (this.isConnected) {
            this.ws.send(JSON.stringify({
                type: 'switch-canvas',
                index: this.currentCanvasIndex
            }));
        }
    }
    
    switchMenuTab(tab) {
        this.currentMenuTab = tab;
        this.renderHamburgerMenu();
    }
    
    updateTabletCanvasSize() {
        if (this.isDesktop) return;
        const container = document.getElementById('canvas-container');
        if (!container) return;
        
        const isFullscreen = this.mode === 'fullscreen' || this.mode === 'B';
        
        if (isFullscreen) {
            // Close sidebar when entering fullscreen
            const sidebar = document.getElementById('hamburger-sidebar');
            if (sidebar && sidebar.classList.contains('open')) {
                sidebar.classList.remove('open');
            }
            
            container.style.width = '100%';
            container.style.height = 'calc(100vh - 60px)';
            container.style.maxWidth = '';
            container.style.maxHeight = '';
            container.style.margin = '60px 0 0 0';
            container.style.border = 'none';
            container.style.boxShadow = 'none';
            container.style.background = '#fff';
            container.style.display = '';
        } else if (this.targetWidth && this.targetHeight) {
            // Force 1:1 size with desktop so drawing scale matches exactly
            container.style.width = this.targetWidth + 'px';
            container.style.height = this.targetHeight + 'px';
            container.style.margin = '20px auto';
            container.style.maxWidth = '';
            container.style.maxHeight = '';
            container.style.border = '1px solid #ddd';
            container.style.boxShadow = '0 10px 40px rgba(0,0,0,0.1)';
            container.style.background = '#fff';
            container.style.display = 'block';
        }
        
        // Resize canvas to match container
        const cv = document.getElementById('drawing-surface');
        if (cv) {
            cv.style.width = '100%';
            cv.style.height = '100%';
            cv.style.borderRadius = '';
            cv.style.boxShadow = '';
        }
        
        if (window.StylusEngine && window.StylusEngine.activeFacade) {
            const facade = window.StylusEngine.activeFacade;
            if (facade.canvas) {
                facade.canvas.width = container.clientWidth || container.offsetWidth;
                facade.canvas.height = container.clientHeight || container.offsetHeight;
                facade.renderAll();
            }
        }
    }


    
    renderHamburgerMenu() {
        const container = document.getElementById('hamburger-sidebar');
        if (!container) return;
        
        if (!this.currentMenuTab) this.currentMenuTab = 'text';
        
        const activeCanvasId = this.canvases[this.currentCanvasIndex]?.id;

        
        let html = '';
        
        // ── Tab switcher ──────────────────────────────────────────────
        html += `<div style="display:flex; padding:8px 10px 4px; gap:6px;">
            <button onclick="window.RemoteStylusSyncInstance.switchMenuTab('text')"
                style="flex:1;padding:7px 4px;border:none;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;transition:all 0.2s;
                       background:${this.currentMenuTab === 'text' ? 'rgba(255,122,89,0.18)' : 'rgba(255,255,255,0.05)'};
                       color:${this.currentMenuTab === 'text' ? '#ff7a59' : '#888'};">
                📝 Text Notes
            </button>
            <button onclick="window.RemoteStylusSyncInstance.switchMenuTab('canvas')"
                style="flex:1;padding:7px 4px;border:none;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;transition:all 0.2s;
                       background:${this.currentMenuTab === 'canvas' ? 'rgba(255,122,89,0.18)' : 'rgba(255,255,255,0.05)'};
                       color:${this.currentMenuTab === 'canvas' ? '#ff7a59' : '#888'};">
                🎨 Canvas Notes
            </button>
        </div>`;
        
        // ── Refresh header ────────────────────────────────────────────
        html += `<div style="display:flex;align-items:center;justify-content:flex-end;padding:4px 14px 6px;">
            <button onclick="window.RemoteStylusSyncInstance.requestMenuRefresh()"
                style="font-size:11px;padding:3px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);
                       background:transparent;color:#888;cursor:pointer;">↻ Refresh All</button>
        </div>
        <div style="height:1px;background:rgba(255,255,255,0.07);margin:0 10px 6px;"></div>`;
        
        // ── Content ───────────────────────────────────────────────────
        if (this.currentMenuTab === 'text') {
            const notes = this.menuTree?.text_notes || [];
            if (notes.length === 0) {
                html += `<div class="sb-empty">No text notes with drawings.</div>`;
            } else {
                notes.forEach(note => {
                    const noteTitle = note.title.replace(/^📚\s*/, '');
                    const dateStr = note.updatedAt ? new Date(note.updatedAt).toLocaleString() : '';
                    html += `<div class="sb-note-group">
                        <div class="sb-note-header">
                            <span class="sb-note-icon">📝</span>
                            <span class="sb-note-title" title="${noteTitle}">${noteTitle}</span>
                            <span class="sb-note-meta">${dateStr}</span>
                            <div class="sb-note-actions">
                                <button class="sb-action-btn refresh" onclick="event.stopPropagation();window.RemoteStylusSyncInstance.requestMenuRefresh()" title="Refresh">↻</button>
                                <button class="sb-action-btn del" onclick="event.stopPropagation();window.RemoteStylusSyncInstance.deleteNote('${note.id}','${String(noteTitle).replace(/'/g, "\\'")}')" title="Delete note">✕</button>
                            </div>
                        </div>`;
                    
                    if (note.canvases && note.canvases.length > 0) {
                        note.canvases.forEach((canvasObj) => {
                            const canvasId = typeof canvasObj === 'string' ? canvasObj : canvasObj.id;
                            const canvasName = (typeof canvasObj === 'object' && canvasObj.title) ? canvasObj.title : 'Draw';
                            const isActive = activeCanvasId === canvasId;
                            html += `<div class="sb-draw-item ${isActive ? 'active' : ''}"
                                onclick="document.getElementById('hamburger-sidebar').classList.remove('open');RemoteStylusSync.jumpToCanvas('${canvasId}','${note.id}')">
                                <div class="sb-draw-dot"></div>
                                <span class="sb-draw-name">${canvasName}</span>
                                <div class="sb-draw-actions">
                                    <button class="sb-action-btn refresh" onclick="event.stopPropagation();window.RemoteStylusSyncInstance.loadCanvasStrokes('${canvasId}')" title="Sync strokes">↻</button>
                                    <button class="sb-action-btn del" onclick="event.stopPropagation();window.RemoteStylusSyncInstance.deleteCanvas('${canvasId}','${String(canvasName).replace(/'/g, "\\'")}')" title="Delete draw">✕</button>
                                </div>
                            </div>`;
                        });
                    } else {
                        html += `<div style="padding:4px 28px 6px;font-size:11px;color:#555;font-style:italic;">No drawings in this note</div>`;
                    }
                    html += `</div><div class="sb-divider"></div>`;
                });
            }
        } else {
            const notes = this.menuTree?.standalone_notes || [];
            if (notes.length === 0) {
                html += `<div class="sb-empty">No canvas notes saved.</div>`;
            } else {
                notes.forEach(note => {
                    const isActive = (this.mode === 'fullscreen' || this.mode === 'B') && String(this.activeId) === String(note.id);
                    const dateStr = note.updatedAt ? new Date(note.updatedAt).toLocaleString() : '';
                    html += `<div class="sb-standalone-item ${isActive ? 'active' : ''}"
                        onclick="document.getElementById('hamburger-sidebar').classList.remove('open');RemoteStylusSync.jumpToStandaloneCanvas('${note.id}')">
                        <span style="font-size:16px;">🎨</span>
                        <div style="flex:1;min-width:0;">
                            <div class="sb-standalone-name">${note.title}</div>
                            <div style="font-size:10px;color:#555;margin-top:2px;">${dateStr}</div>
                        </div>
                        <div style="display:flex;gap:4px;">
                            <button class="sb-action-btn del" onclick="event.stopPropagation();window.RemoteStylusSyncInstance.deleteStandaloneCanvas('${note.id}','${String(note.title).replace(/'/g, "\\'")}')" title="Delete">✕</button>
                        </div>
                    </div>
                    <div class="sb-divider"></div>`;
                });
            }
        }
        
        container.innerHTML = html;
    }



    static jumpToStandaloneCanvas(noteId) {
        if (!window.RemoteStylusSyncInstance) return;
        
        const newUrl = new URL(window.location);
        newUrl.searchParams.set('mode', 'fullscreen');
        newUrl.searchParams.set('id', noteId);
        window.history.pushState({}, '', newUrl);

        if (window.RemoteStylusSyncInstance.isConnected) {
            window.RemoteStylusSyncInstance.mode = 'fullscreen';
            window.RemoteStylusSyncInstance.activeId = String(noteId);
            window.RemoteStylusSyncInstance.ws.send(JSON.stringify({
                type: 'open-standalone-note',
                id: noteId
            }));
            if (window.showToast) window.showToast('Opening canvas on desktop...');
        }
    }

    static jumpToCanvas(canvasId, noteId) {
        if (!window.RemoteStylusSyncInstance) return;
        const inst = window.RemoteStylusSyncInstance;
        inst.activeId = String(noteId);
        const idx = inst.canvases.findIndex(c => c.id === canvasId);
        if (idx !== -1) {
            // Canvas is already in the loaded list — navigate and load strokes directly
            inst.currentCanvasIndex = idx;
            inst.targetWidth = inst.canvases[idx].desktopW;
            inst.targetHeight = inst.canvases[idx].desktopH;
            inst.updateNavUI();
            inst.renderHamburgerMenu();
            inst.updateTabletCanvasSize();
            
            if (inst.isConnected) {
                // Tell desktop to activate this canvas
                inst.ws.send(JSON.stringify({ type: 'switch-canvas', index: idx }));
                // Also request the existing strokes so they appear on the tablet
                inst.loadCanvasStrokes(canvasId);
            }
        } else if (noteId) {
            // Canvas is in a different note — ask desktop to open that note
            if (inst.isConnected) {
                inst.pendingCanvasId = canvasId;
                inst.ws.send(JSON.stringify({
                    type: 'open-note',
                    id: noteId,
                    canvasId: canvasId
                }));
                if (window.showToast) window.showToast('Opening note on desktop...');
            }
        } else {
            if (window.showToast) window.showToast("Canvas not found in active document.");
        }
    }
    
    sendDoneBatch() {
        if (!this.isConnected || !window.StylusEngine || !window.StylusEngine.activeFacade) {
            if (window.showToast) window.showToast('Not connected or no drawing active.');
            return;
        }
        
        const facade = window.StylusEngine.activeFacade;
        const currentW = facade.canvas.width;
        const currentH = facade.canvas.height;
        const scaleX = this.targetWidth / currentW;
        const scaleY = this.targetHeight / currentH;
        
        const scaledStrokes = facade.repo.strokes.map(stroke => ({
            ...stroke,
            points: stroke.points.map(p => ({
                x: p.x * scaleX,
                y: p.y * scaleY,
                p: p.p
            }))
        }));
        
        const activeId = this.canvases.length > 0 ? this.canvases[this.currentCanvasIndex].id : 'unknown';
        
        this.ws.send(JSON.stringify({
            type: 'sync-strokes-done',
            canvasId: activeId,
            strokes: scaledStrokes
        }));
        
        if (window.showToast) window.showToast('Sent to desktop!');
    }
    
    _showInlineConfirm(message, onConfirm) {
        const existing = document.getElementById('rs-inline-confirm');
        if (existing) existing.remove();
        
        const overlay = document.createElement('div');
        overlay.id = 'rs-inline-confirm';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:99999;display:flex;align-items:center;justify-content:center;';
        
        const box = document.createElement('div');
        box.style.cssText = 'background:#fff;border-radius:12px;padding:24px;max-width:300px;width:90%;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,0.4);';
        box.innerHTML = `
            <p style="font-family:sans-serif;font-size:15px;color:#333;margin:0 0 16px;">${message}</p>
            <div style="display:flex;gap:10px;justify-content:center;">
                <button id="rs-confirm-yes" style="padding:8px 20px;border-radius:20px;border:none;background:#e53e3e;color:#fff;font-weight:bold;cursor:pointer;">Delete</button>
                <button id="rs-confirm-no" style="padding:8px 20px;border-radius:20px;border:1px solid #ccc;background:transparent;cursor:pointer;">Cancel</button>
            </div>`;
        
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        
        box.querySelector('#rs-confirm-yes').onclick = () => { overlay.remove(); onConfirm(); };
        box.querySelector('#rs-confirm-no').onclick = () => overlay.remove();
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    }
    
    deleteNote(noteId, title) {
        this._showInlineConfirm(
            `Delete text note "${title || noteId}"?\nThis cannot be undone.`,
            () => {
                if (this.isConnected) {
                    this.ws.send(JSON.stringify({ type: 'delete-note', id: noteId, itemType: 'text' }));
                    if (window.showToast) window.showToast('Delete sent to desktop');
                    if (this.menuTree && this.menuTree.text_notes) {
                        this.menuTree.text_notes = this.menuTree.text_notes.filter(n => n.id !== noteId);
                        this.renderHamburgerMenu();
                    }
                } else {
                    if (window.showToast) window.showToast('Not connected — reconnect first');
                }
            }
        );
    }
    
    deleteCanvas(canvasId, title) {
        this._showInlineConfirm(
            `Delete drawing "${title || 'Canvas'}"?\nThis cannot be undone.`,
            () => {
                if (this.isConnected) {
                    this.ws.send(JSON.stringify({ type: 'delete-canvas', id: canvasId, itemType: 'embedded' }));
                    if (window.showToast) window.showToast('Delete sent to desktop');
                } else {
                    if (window.showToast) window.showToast('Not connected — reconnect first');
                }
            }
        );
    }
    
    deleteStandaloneCanvas(noteId, title) {
        this._showInlineConfirm(
            `Delete canvas note "${title || noteId}"?\nThis cannot be undone.`,
            () => {
                if (this.isConnected) {
                    this.ws.send(JSON.stringify({ type: 'delete-standalone-canvas', id: noteId, itemType: 'canvas' }));
                    if (window.showToast) window.showToast('Delete sent to desktop');
                    if (this.menuTree && this.menuTree.standalone_notes) {
                        this.menuTree.standalone_notes = this.menuTree.standalone_notes.filter(n => n.id !== noteId);
                        this.renderHamburgerMenu();
                    }
                } else {
                    if (window.showToast) window.showToast('Not connected — reconnect first');
                }
            }
        );
    }
    
    destroy() {
        if (this.ws) {
            this.ws.onclose = null;
            this.ws.close();
        }
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    }
}
window.RemoteStylusSync = RemoteStylusSync;

window.TabletSync = {
    syncInstance: null,
    activeId: null,
    mode: null,
    
    connectTabletA() {
        if (!window.StylusEngine) return;
        
        if (window.StylusEngine.activeFacade) {
            this.activeId = window.StylusEngine.activeFacade.id;
        } else {
            this.activeId = null;
        }
        
        this.mode = 'A';
        this._initDesktopSync();
    },
    
    connectTabletB(canvasId) {
        this.activeId = canvasId;
        this.mode = 'B';
        this._initDesktopSync();
    },
    
    _initDesktopSync() {
        // Bug 7 fix: remove the stale listener before creating new instance
        // so reconnects don't accumulate duplicate message handlers.
        if (this._desktopMsgListener && this.syncInstance && this.syncInstance.ws) {
            this.syncInstance.ws.removeEventListener('message', this._desktopMsgListener);
            this._desktopMsgListener = null;
        }
        if (this.syncInstance) this.syncInstance.destroy();
        
        const roomId = 'desktop-session-' + Math.floor(Math.random() * 10000);
        
        this.syncInstance = new RemoteStylusSync(roomId, true, (strokes) => {});
        window.RemoteStylusSyncInstance = this.syncInstance; 
        
        const broadcastCanvasInfo = (retryCount = 0) => {
            const isStandaloneHtml = !!document.getElementById('canvas-container');
            const isFullscreen = isStandaloneHtml || window.currentNotesTab === 'canvas';
            const mode = isFullscreen ? 'fullscreen' : 'editor';
            let canvasNodes = [];
            if (isStandaloneHtml) {
                canvasNodes = [document.getElementById('canvas-container')];
            } else if (isFullscreen) {
                const container = document.getElementById('pure-canvas-container');
                if (container) canvasNodes = [container];
            } else {
                const allNodes = Array.from(document.querySelectorAll('.ql-stylus-canvas'));
                canvasNodes = allNodes.filter(n => n.id !== 'pure-canvas-container');
            }
            
            let activeCanvasId = this.pendingCanvasId;
            if (!activeCanvasId && window.StylusEngine && window.StylusEngine.activeFacade) {
                activeCanvasId = window.StylusEngine.activeFacade.container.dataset.id;
            }
            
            // Use a consistent fixed canvas size — take from the first canvas node, or use a sane default
            // This prevents the tablet canvas from jumping sizes when navigating between draws
            let sharedW = 900, sharedH = 300;
            if (canvasNodes.length > 0) {
                const firstRect = canvasNodes[0].getBoundingClientRect();
                if (firstRect.width > 0) sharedW = Math.round(firstRect.width);
                if (firstRect.height > 0) sharedH = Math.round(firstRect.height);
            }
            
            const canvases = canvasNodes.map((node, index) => {
                const id = node.dataset.id;
                const title = node.dataset.title || `Draw ${index + 1}`;
                return {
                    id: id,
                    title: title,
                    desktopW: sharedW,
                    desktopH: sharedH,
                    index: index
                };
            });
            
            if (window.notesRepo) {
                window.notesRepo.getAllNotes().then(allNotes => {
                    const text_notes = [];
                    const standalone_notes = [];
                    allNotes.forEach(n => {
                        if (n.isCanvasNote || n.itemType === 'canvas') {
                            standalone_notes.push({ id: n.id, title: n.title || 'Untitled Canvas', updatedAt: n.updatedAt });
                        } else {
                            const canvasesIds = [];
                            const htmlContent = n.content || n.html || '';
                            if (htmlContent) {
                                try {
                                    const parser = new DOMParser();
                                    const doc = parser.parseFromString(htmlContent, 'text/html');
                                    const nodes = doc.querySelectorAll('.ql-stylus-canvas');
                                    nodes.forEach((node, index) => {
                                        const dataId = node.getAttribute('data-id');
                                        const dataTitle = node.getAttribute('data-title');
                                        if (dataId) {
                                            canvasesIds.push({
                                                id: dataId,
                                                title: dataTitle || `Draw ${index + 1}`
                                            });
                                        }
                                    });
                                } catch (e) {
                                    console.warn("Error parsing note HTML for canvases", e);
                                }
                            }
                            
                            // If this is the actively editing note, override its canvases with the LIVE DOM canvases!
                            if (window.currentExternalNoteId && n.id === window.currentExternalNoteId) {
                                canvasesIds.length = 0; // Clear the saved ones
                                canvases.forEach(c => canvasesIds.push({ id: c.id, title: c.title }));
                            }
                            
                            text_notes.push({ id: n.id, title: n.title || 'Untitled Note', updatedAt: n.updatedAt, canvases: canvasesIds });
                        }
                    });
                    this.syncInstance.ws.send(JSON.stringify({
                        type: 'canvas-info',
                        mode: mode,
                        activeCanvasId: activeCanvasId,
                        canvases: canvases,
                        menuTree: { text_notes, standalone_notes }
                    }));
                    this.pendingCanvasId = null;
                }).catch(err => {
                    // Bug 8 fix: retry with exponential backoff instead of sending empty menuTree immediately
                    console.error('Failed to get menu tree from notesRepo', err);
                    const MAX_RETRIES = 3;
                    if ((retryCount || 0) < MAX_RETRIES) {
                        const delay = Math.pow(2, retryCount || 0) * 300; // 300ms, 600ms, 1200ms
                        console.warn(`broadcastCanvasInfo: retrying in ${delay}ms (attempt ${(retryCount || 0) + 1}/${MAX_RETRIES})`);
                        if (window.showToast) window.showToast('Loading notes...');
                        setTimeout(() => broadcastCanvasInfo((retryCount || 0) + 1), delay);
                    } else {
                        console.error('broadcastCanvasInfo: giving up after 3 retries, sending empty menuTree');
                        this.syncInstance.ws.send(JSON.stringify({
                            type: 'canvas-info',
                            mode: mode,
                            activeCanvasId: this.pendingCanvasId,
                            canvases: canvases,
                            menuTree: {text_notes: [], standalone_notes: []}
                        }));
                        this.pendingCanvasId = null;
                    }
                });
            } else {
                // Bug 8 fix: notesRepo not ready — retry instead of sending empty data
                const MAX_RETRIES = 3;
                if ((retryCount || 0) < MAX_RETRIES) {
                    const delay = 300 * ((retryCount || 0) + 1); // 300ms, 600ms, 900ms
                    console.warn(`broadcastCanvasInfo: notesRepo not ready, retrying in ${delay}ms`);
                    setTimeout(() => broadcastCanvasInfo((retryCount || 0) + 1), delay);
                } else {
                    this.syncInstance.ws.send(JSON.stringify({
                        type: 'canvas-info',
                        mode: mode,
                        activeCanvasId: this.pendingCanvasId,
                        canvases: canvases,
                        menuTree: {text_notes: [], standalone_notes: []}
                    }));
                    this.pendingCanvasId = null;
                }
            }
        };
        this.broadcastCanvasInfo = broadcastCanvasInfo;

        // Bug 7 fix: store as named reference on TabletSync so it can be removed on reconnect.
        this._desktopMsgListener = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'hello') {
                    if (window.showToast) window.showToast('Tablet connected!');
                    broadcastCanvasInfo();
                }
                else if (msg.type === 'sync-strokes-done') {
                    const canvasId = msg.canvasId;
                    if (window.StylusStore) {
                        window.StylusStore.set(canvasId, msg.strokes);
                    }
                    if (window.StylusEngine) {
                        const facade = window.StylusEngine.getFacadeForId(canvasId);
                        if (facade) facade.loadAndRender(msg.strokes);
                    }
                    const passiveNode = document.querySelector(`.ql-stylus-canvas[data-id="${canvasId}"]`);
                    if (passiveNode) {
                        passiveNode.removeAttribute('data-svg');
                        passiveNode.setAttribute('data-strokes', JSON.stringify(msg.strokes));
                        passiveNode.dispatchEvent(new window.CustomEvent('passive-render-update'));
                    }
                    
                    if (window.showToast) window.showToast('Drawing received from tablet ✅');
                    if (typeof saveExternalNote === 'function') saveExternalNote(true);
                }
                else if (msg.type === 'request-menu-tree') {
                    broadcastCanvasInfo();
                }
                else if (msg.type === 'delete-note') {
                    if (typeof deleteExternalNote === 'function') {
                        const prevTab = window.currentNotesTab;
                        window.currentNotesTab = 'text';
                        deleteExternalNote(msg.id);
                        window.currentNotesTab = prevTab;
                        if (window.showToast) window.showToast('Text note deleted via tablet');
                    }
                }
                else if (msg.type === 'delete-standalone-canvas') {
                    if (typeof deleteExternalNote === 'function') {
                        const prevTab = window.currentNotesTab;
                        window.currentNotesTab = 'canvas';
                        deleteExternalNote(msg.id);
                        window.currentNotesTab = prevTab;
                        if (window.showToast) window.showToast('Canvas note deleted via tablet');
                    }
                }
                else if (msg.type === 'rename-canvas') {
                    const canvasNode = document.querySelector(`.ql-stylus-canvas[data-id="${msg.canvasId}"]`);
                    if (canvasNode) {
                        canvasNode.dataset.title = msg.title;
                        const titleBar = Array.from(canvasNode.children).find(c => c.tagName === 'DIV' && c.style.position === 'absolute');
                        if (titleBar) {
                            const titleSpans = titleBar.querySelectorAll('span');
                            if (titleSpans.length >= 2) titleSpans[1].textContent = msg.title;
                        }
                        if (typeof saveExternalNote === 'function') saveExternalNote(true);
                        if (window.showToast) window.showToast('Drawing renamed via tablet');
                    }
                }
                else if (msg.type === 'delete-canvas') {
                    if (window.StylusStore) {
                        window.StylusStore.delete(msg.id);
                    }
                    const canvasNode = document.querySelector(`.ql-stylus-canvas[data-id="${msg.id}"]`);
                    if (canvasNode) {
                        canvasNode.remove();
                        if (typeof saveExternalNote === 'function') saveExternalNote(true);
                        if (window.showToast) window.showToast('Drawing deleted via tablet');
                    }
                }
                else if (msg.type === 'open-note') {
                    if (typeof loadExternalNote === 'function') {
                        if (typeof window.switchNotesTab === 'function') window.switchNotesTab('text');
                        else window.currentNotesTab = 'text';
                        
                        if (window.showToast) window.showToast('Opening note on desktop...');
                        const loadPromise = loadExternalNote(msg.id);
                        if (loadPromise && loadPromise.then) {
                            loadPromise.then(() => {
                                if (msg.canvasId) {
                                    setTimeout(() => {
                                        const canvasNodes = Array.from(document.querySelectorAll('.ql-stylus-canvas'));
                                        const idx = canvasNodes.findIndex(n => n.dataset.id === msg.canvasId);
                                        if (idx !== -1 && window.TabletSync) {
                                            window.TabletSync.setActiveCanvas(idx);
                                        }
                                        broadcastCanvasInfo();
                                        // Send the existing strokes for this canvas to the tablet
                                        const strokes = (window.StylusStore && window.StylusStore.get(msg.canvasId)) || [];
                                        this.ws.send(JSON.stringify({
                                            type: 'load-strokes',
                                            canvasId: msg.canvasId,
                                            strokes: strokes
                                        }));
                                    }, 200);
                                } else {
                                    setTimeout(() => broadcastCanvasInfo(), 100);
                                }
                            });
                        } else {
                            setTimeout(() => broadcastCanvasInfo(), 500);
                        }
                    }
                }
                else if (msg.type === 'open-standalone-note') {
                    if (typeof loadExternalNote === 'function') {
                        if (typeof window.switchNotesTab === 'function') window.switchNotesTab('canvas');
                        else window.currentNotesTab = 'canvas';
                        
                        const loadPromise = loadExternalNote(msg.id);
                        if (window.showToast) window.showToast('Opening canvas on desktop...');
                        
                        const onLoaded = () => {
                            broadcastCanvasInfo();
                            if (window.currentNotesTab === 'canvas' && window.StylusStore) {
                                const strokes = window.StylusStore.get(msg.id) || [];
                                if (window.RemoteStylusSyncInstance && window.RemoteStylusSyncInstance.ws) {
                                    window.RemoteStylusSyncInstance.ws.send(JSON.stringify({
                                        type: 'load-strokes',
                                        canvasId: msg.id,
                                        strokes: strokes
                                    }));
                                }
                            }
                        };
                        
                        if (loadPromise && loadPromise.then) {
                            loadPromise.then(() => {
                                setTimeout(onLoaded, 100);
                            });
                        } else {
                            setTimeout(onLoaded, 500);
                        }
                    }
                }
            } catch (e) {
                console.error("Desktop Sync Error", e);
            }
        };
        this.syncInstance.ws.addEventListener('message', this._desktopMsgListener);
        
        fetch('/api/system/local-ip')
            .then(res => res.json())
            .then(data => {
                const ip = data.ip || window.location.hostname;
                const port = window.location.port ? ':' + window.location.port : '';
                const protocol = window.location.protocol;
                const tabletUrl = `${protocol}//${ip}${port}/remote-stylus?roomId=${roomId}&mode=${this.mode}&id=${this.activeId}`;
                this._showQRCodeModal(tabletUrl);
            })
            .catch(() => {
                const tabletUrl = `${window.location.origin}/remote-stylus?roomId=${roomId}&mode=${this.mode}&id=${this.activeId}`;
                this._showQRCodeModal(tabletUrl);
            });
    },
    
    setActiveCanvas(index) {
        const canvasNodes = document.querySelectorAll('.ql-stylus-canvas');
        if (index >= 0 && index < canvasNodes.length) {
            const targetNode = canvasNodes[index];
            if (window.StylusEngine) {
                window.StylusEngine.activate(targetNode);
                targetNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    },
    
    sendDimensions() {
        if (!this.syncInstance || !this.syncInstance.ws || !this.activeId) return;
        const facade = window.StylusEngine && window.StylusEngine.getFacadeForId(this.activeId);
        if (facade && facade.canvas) {
            this.syncInstance.ws.send(JSON.stringify({
                type: 'canvas-info',
                width: facade.canvas.width,
                height: facade.canvas.height
            }));
        } else {
            this.syncInstance.ws.send(JSON.stringify({
                type: 'canvas-info',
                width: 900,
                height: 300
            }));
        }
    },
    
    _showQRCodeModal(url) {
        const existing = document.getElementById('tablet-qr-modal');
        if (existing) existing.remove();
        
        const modal = document.createElement('div');
        modal.id = 'tablet-qr-modal';
        modal.style.position = 'fixed';
        modal.style.top = '0'; modal.style.left = '0';
        modal.style.width = '100%'; modal.style.height = '100%';
        modal.style.background = 'rgba(0,0,0,0.7)';
        modal.style.zIndex = '100000';
        modal.style.display = 'flex';
        modal.style.alignItems = 'center';
        modal.style.justifyContent = 'center';
        
        const content = document.createElement('div');
        content.style.background = 'var(--bg-panel, #fff)';
        content.style.padding = '30px';
        content.style.borderRadius = '12px';
        content.style.textAlign = 'center';
        content.style.boxShadow = '0 10px 30px rgba(0,0,0,0.5)';
        content.style.maxWidth = '300px';
        
        const title = document.createElement('h3');
        title.textContent = 'Connect Tablet';
        title.style.marginTop = '0';
        title.style.color = 'var(--text-1, #000)';
        
        const qr = document.createElement('img');
        qr.src = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent(url);
        qr.style.width = '200px';
        qr.style.height = '200px';
        qr.style.marginBottom = '15px';
        
        const text = document.createElement('p');
        text.textContent = 'Scan this QR code with your tablet or phone to start drawing.';
        text.style.fontSize = '14px';
        text.style.color = 'var(--text-2, #666)';
        text.style.marginBottom = '10px';
        
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.textContent = 'Or click here to open directly';
        link.style.display = 'block';
        link.style.fontSize = '13px';
        link.style.color = 'var(--accent, #007bff)';
        link.style.textDecoration = 'underline';
        link.style.marginBottom = '20px';
        
        const closeBtn = document.createElement('button');
        closeBtn.textContent = 'Close';
        closeBtn.style.padding = '8px 16px';
        closeBtn.style.background = 'var(--accent, #007bff)';
        closeBtn.style.color = '#fff';
        closeBtn.style.border = 'none';
        closeBtn.style.borderRadius = '20px';
        closeBtn.style.cursor = 'pointer';
        closeBtn.onclick = () => modal.remove();
        
        content.appendChild(title);
        content.appendChild(qr);
        content.appendChild(text);
        content.appendChild(link);
        content.appendChild(closeBtn);
        modal.appendChild(content);
        
        document.body.appendChild(modal);
    }
};
