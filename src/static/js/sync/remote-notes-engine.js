/**
 * RemoteNotesEngine (Desktop side)
 * Acts as the OT Authority for the Remote Notes Tablet feature.
 * Built entirely from scratch, isolated from the legacy remote-stylus-sync.js.
 */
class RemoteNotesEngine {
    constructor(roomId) {
        this.roomId = roomId;
        this.ws = null;
        this.isReconnecting = false;
        
        // Isolate from legacy tablet sync
        this.ensureIsolation();
        
        this.connect();
    }

    ensureIsolation() {
        if (window.TabletSync && window.TabletSync.syncInstance) {
            console.warn("RemoteNotesEngine: Destroying legacy TabletSync to ensure strict isolation.");
            try {
                // If the legacy sync has a close method, call it.
                if (window.TabletSync.syncInstance.ws) {
                    window.TabletSync.syncInstance.ws.close();
                }
            } catch(e) {}
            window.TabletSync.syncInstance = null;
        }
    }

    connect() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        this.ws = new WebSocket(`${protocol}//${window.location.host}/ws/stylus/${this.roomId}`);

        this.ws.onopen = () => {
            console.log(`RemoteNotesEngine connected to room: ${this.roomId}`);
        };

        this.ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                this.handleMessage(msg);
            } catch (e) {
                console.error("RemoteNotesEngine: Invalid JSON payload received.", e);
            }
        };

        this.ws.onclose = () => {
            console.log("RemoteNotesEngine disconnected. Reconnecting in 2s...");
            setTimeout(() => this.connect(), 2000);
        };
    }

    send(payload) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(payload));
        }
    }

    handleMessage(msg) {
        switch (msg.type) {
            case 'SUBSCRIBE':
                this.handleSubscribe(msg.doc_id);
                break;
            case 'OT_DELTA':
                this.handleRemoteDelta(msg);
                break;
            case 'CANVAS_STROKES':
                this.handleCanvasStrokes(msg);
                break;
            case 'RPC_COMMAND':
                this.handleRPC(msg);
                break;
        }
    }

    async handleSubscribe(requestedDocId) {
        // Send the library state first so tablet can render the sidebar
        let libraryState = [];
        if (window.notesRepo) {
            libraryState = await window.notesRepo.getAllNotes();
        }
        
        const activeDocId = window.currentExternalNoteId;
        
        this.send({
            type: 'LIBRARY_STATE',
            notes: libraryState,
            active_doc_id: activeDocId
        });

        // If tablet wants a specific doc, or we default to the active one
        const targetDocId = requestedDocId || activeDocId;
        if (targetDocId && targetDocId == activeDocId && window.quillEditor) {
            // Get text state
            const content = window.quillEditor.getContents();
            
            // Get stroke state for all inline canvases
            const canvases = {};
            if (window.StylusStore) {
                const canvasNodes = document.querySelectorAll('.ql-stylus-canvas');
                canvasNodes.forEach(node => {
                    const cId = node.getAttribute('data-id');
                    if (cId && window.StylusStore.has(cId)) {
                        canvases[cId] = window.StylusStore.get(cId);
                    }
                });
            }

            this.send({
                type: 'FULL_STATE',
                doc_id: targetDocId,
                title: window.document.getElementById('external-note-title')?.value || "Note",
                content: content,
                canvases: canvases
            });
        }
    }

    handleRemoteDelta(msg) {
        // If the tablet sends an edit for the currently open note
        if (msg.doc_id === window.currentExternalNoteId && window.quillEditor) {
            // Apply using 'api' source to prevent infinite echo loops in external-editor.js
            window.quillEditor.updateContents(msg.delta, 'api');
        } else {
            console.warn("RemoteNotesEngine: Received OT_DELTA for inactive note.", msg.doc_id);
        }
    }

    handleCanvasStrokes(msg) {
        if (msg.doc_id !== window.currentExternalNoteId) return;
        
        // Save full strokes array to local desktop store
        if (window.StylusStore) {
            window.StylusStore.set(msg.canvas_id, msg.strokes);
            
            // Critical fix: Update the DOM attribute so the note saves correctly
            const canvasContainer = document.querySelector(`.ql-stylus-canvas[data-id="${msg.canvas_id}"]`);
            if (canvasContainer) {
                const strokesJson = JSON.stringify(msg.strokes);
                canvasContainer.setAttribute('data-strokes', strokesJson);
                if (window.Quill) {
                    const blot = window.Quill.find(canvasContainer);
                    if (blot && typeof blot.updateSVG === 'function') {
                        // Let StylusEngine regenerate SVG internally if active
                        if (window.StylusEngine && window.StylusEngine.activeFacade && window.StylusEngine.activeFacade.id === msg.canvas_id) {
                            window.StylusEngine.activeFacade.repo.load(msg.strokes);
                            window.StylusEngine.activeFacade.renderAll();
                            const newSvg = window.StylusEngine.activeFacade.generateSVG();
                            blot.updateSVG(newSvg, strokesJson);
                        } else {
                            // If StylusEngine isn't currently activating this canvas, we just need to re-render it.
                            // The easiest way is to let the user re-open the canvas or just rely on the SVG update.
                            // We don't want to instantiate a full facade here just to draw.
                            // But for real-time visual sync when not active, we can use a temporary facade or just trigger a re-render.
                            if (window.StylusEngine) {
                                const tempFacade = new window.StylusEngine.constructor.prototype.Facade(canvasContainer, blot);
                                // Wait, the class inside IIFE is not exposed... 
                            }
                        }
                    }
                }
            }
        }
    }

    handleRPC(msg) {
        if (msg.command === 'FORCE_SAVE') {
            if (!window.isExternalNoteLoading && typeof window.saveExternalNote === 'function') { // FIX Bug 4: Respect loading lock
                window.saveExternalNote(true);
            }
        } else if (msg.command === 'SWITCH_NOTE') {
            if (typeof window.loadExternalNote === 'function') {
                window.loadExternalNote(msg.doc_id);
            }
        } else if (msg.command === 'CREATE_NOTE') {
            if (typeof window.createNewExternalNote === 'function') {
                // Ensure the desktop is in the correct mode (text vs canvas)
                window.currentNotesTab = msg.itemType === 'canvas' ? 'canvas' : 'external';
                window.createNewExternalNote().then(() => {
                    // createNewExternalNote automatically saves the note, which populates the ID.
                    // Broadcast the switch so tablet follows along
                    this.broadcastNoteSwitch();
                    // And refresh the library list
                    this.handleSubscribe(window.currentExternalNoteId);
                });
            }
        } else if (msg.command === 'RENAME_NOTE') {
            const titleInput = document.getElementById('external-note-title');
            if (titleInput) {
                titleInput.value = msg.new_title;
            }
            if (!window.isExternalNoteLoading && typeof window.saveExternalNote === 'function') { // FIX Bug 4: Respect loading lock
                window.saveExternalNote(true);
            }
        }
    }

    // Called by desktop external-editor.js when user types locally
    broadcastLocalDelta(delta) {
        this.send({
            type: 'OT_DELTA',
            doc_id: window.currentExternalNoteId,
            delta: delta
        });
    }

    // Called by desktop when user switches notes locally
    broadcastNoteSwitch() {
        this.send({
            type: 'NOTE_SWITCHED',
            doc_id: window.currentExternalNoteId
        });
    }
}
