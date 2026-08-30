class RemoteNotesClient {
    constructor(roomId) {
        this.roomId = roomId;
        this.ws = null;
        this.quill = null;
        this.isReconnecting = false;
        this.docId = null;
        this.offlineQueue = [];
        this.activeCanvasId = null;
        this.isMarkdownMode = false;
        
        // Stroke Batching State
        this.strokeBatch = [];
        this.strokeBatchTimer = null;
        this.isDrawing = false;
        this.currentStrokeId = null;
        this.lastPoint = null;

        this.initUI();
        this.initQuill();
        this.connect();
    }

    initUI() {
        this.statusEl = document.getElementById('connection-status');
        this.notesListEl = document.getElementById('notes-list');
        this.activeNoteTitleEl = document.getElementById('active-note-title');
        this.btnMdSource = document.getElementById('btn-md-source');
        this.btnDraw = document.getElementById('btn-draw');
        this.btnSave = document.getElementById('btn-save');
        if (this.btnSave) {
            this.btnSave.addEventListener('click', () => {
                this.send({ type: 'RPC_COMMAND', command: 'FORCE_SAVE' });
                this.updateStatus('Saving...', 'status-connected');
            });
        }
        if (this.btnDraw) {
            this.btnDraw.addEventListener('click', () => {
                if (window.StylusEngine) window.StylusEngine.insertCanvas();
            });
        }
    }

    initQuill() {
        // Register Custom Blots matching the Desktop editor
        const BlockEmbed = Quill.import('blots/block/embed');
        
        class CustomTableBlot extends BlockEmbed {
            static create(value) {
                let node = super.create();
                node.innerHTML = value.html || '';
                return node;
            }
            static value(node) {
                return { html: node.innerHTML };
            }
        }
        CustomTableBlot.blotName = 'custom-table';
        CustomTableBlot.tagName = 'div';
        CustomTableBlot.className = 'ql-custom-table-container';
        Quill.register(CustomTableBlot, true);

        class CustomDiagramBlot extends BlockEmbed {
            static create(value) {
                let node = super.create();
                node.innerHTML = value.code || '';
                if(value.type === 'mermaid') node.setAttribute('data-diagram-type', 'mermaid');
                return node;
            }
            static value(node) {
                return { 
                    code: node.innerHTML,
                    type: node.getAttribute('data-diagram-type') || 'mermaid'
                };
            }
        }
        CustomDiagramBlot.blotName = 'custom-diagram';
        CustomDiagramBlot.tagName = 'div';
        CustomDiagramBlot.className = 'ql-diagram-container';
        Quill.register(CustomDiagramBlot, true);

        class StylusCanvasBlot extends BlockEmbed {
            static create(value) {
                let node = super.create();
                node.setAttribute('data-id', value.id);
                node.setAttribute('data-title', value.title || 'Draw');
                
                let header = document.createElement('div');
                header.className = 'stylus-embed-header';
                header.innerHTML = `<span>🎨 ${value.title || 'Draw'}</span>`;
                
                let canvas = document.createElement('canvas');
                canvas.className = 'stylus-embed-canvas';
                canvas.width = 800;
                canvas.height = 400;
                
                node.appendChild(header);
                node.appendChild(canvas);
                return node;
            }
            static value(node) {
                return {
                    id: node.getAttribute('data-id'),
                    title: node.getAttribute('data-title')
                };
            }
        }
        StylusCanvasBlot.blotName = 'stylus-canvas';
        StylusCanvasBlot.tagName = 'div';
        StylusCanvasBlot.className = 'stylus-embed-container';
        Quill.register(StylusCanvasBlot, true);

        const toolbarOptions = [
            ['bold', 'italic', 'underline', 'strike'],
            ['blockquote', 'code-block'],
            [{ 'header': 1 }, { 'header': 2 }],
            [{ 'list': 'ordered'}, { 'list': 'bullet' }],
            [{ 'script': 'sub'}, { 'script': 'super' }],
            [{ 'indent': '-1'}, { 'indent': '+1' }],
            [{ 'direction': 'rtl' }],
            [{ 'size': ['small', false, 'large', 'huge'] }],
            [{ 'header': [1, 2, 3, 4, 5, 6, false] }],
            [{ 'color': [] }, { 'background': [] }],
            [{ 'align': [] }],
            ['clean']
        ];
        
        this.quill = new Quill('#quill-editor', {
            theme: 'snow',
            modules: { toolbar: toolbarOptions }
        });

        // Listen for user edits to sync to desktop
        this.quill.on('text-change', (delta, oldDelta, source) => {
            if (source === 'user') {
                this.send({
                    type: 'OT_DELTA',
                    doc_id: this.docId,
                    delta: delta
                });
            }
        });

        // Handle Canvas Interaction
        document.getElementById('quill-editor').addEventListener('pointerdown', (e) => {
            if (e.target && e.target.classList.contains('stylus-embed-canvas')) {
                e.preventDefault();
                this.startDrawing(e, e.target);
            }
        });
    }

    connect() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        this.ws = new WebSocket(`${protocol}//${window.location.host}/ws/stylus/${this.roomId}`);

        this.ws.onopen = () => {
            this.updateStatus('Connected', 'status-connected');
            if (this.docId) {
                this.send({ type: 'SUBSCRIBE', doc_id: this.docId });
            } else {
                this.send({ type: 'SUBSCRIBE' });
            }
            // Flush offline queue
            while (this.offlineQueue.length > 0) {
                this.ws.send(this.offlineQueue.shift());
            }
        };

        this.ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                console.log('TABLET WS RECV:', msg.type, msg.doc_id);
                this.handleMessage(msg);
            } catch (e) {
                console.error("Invalid JSON:", e);
            }
        };

        this.ws.onclose = () => {
            this.updateStatus('Disconnected - Reconnecting...', 'status-disconnected');
            setTimeout(() => this.connect(), 2000);
        };
    }

    send(payload) {
        const data = JSON.stringify(payload);
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(data);
        } else {
            this.offlineQueue.push(data);
        }
    }

    updateStatus(text, className) {
        this.statusEl.textContent = text;
        this.statusEl.className = className;
        this.statusEl.style.opacity = '1';
        setTimeout(() => { this.statusEl.style.opacity = '0'; }, 3000);
    }

    handleMessage(msg) {
        switch (msg.type) {
            case 'LIBRARY_STATE':
                this.renderLibrary(msg.notes, msg.active_doc_id);
                break;
            case 'FULL_STATE':
                if (msg.doc_id === this.docId) {
                    this.quill.setContents(msg.content, 'api');
                    if (this.activeNoteTitleEl) this.activeNoteTitleEl.value = msg.title || "Note";
                    this.renderCanvasStrokes(msg.canvases || {});
                }
                break;
            case 'OT_DELTA':
                if (msg.doc_id === this.docId) {
                    this.quill.updateContents(msg.delta, 'api');
                }
                break;
            case 'NOTE_SWITCHED':
                this.docId = msg.doc_id;
                this.send({ type: 'SUBSCRIBE', doc_id: this.docId });
                break;
            case 'CANVAS_STROKES':
                this.applyRemoteStrokes(msg);
                break;
        }
    }

    renderLibrary(notes, activeDocId) {
        this.docId = activeDocId;
        this.notesListEl.innerHTML = '';
        notes.forEach(note => {
            const el = document.createElement('div');
            el.className = `note-item ${note.id === this.docId ? 'active' : ''}`;
            el.innerHTML = `<div class="note-title">${note.title}</div><div class="note-date">${new Date(note.updated_at * 1000).toLocaleString()}</div>`;
            el.onclick = () => {
                if (this.docId !== note.id) {
                    this.docId = note.id;
                    this.send({ type: 'RPC_COMMAND', command: 'SWITCH_NOTE', doc_id: note.id });
                    this.renderLibrary(notes, note.id); // optimistic ui update
                }
            };
            this.notesListEl.appendChild(el);
        });
        // Removed redundant SUBSCRIBE call that caused an infinite loop
    }

    createNote(type) {
        this.send({
            type: 'RPC_COMMAND',
            command: 'CREATE_NOTE',
            itemType: type
        });
        this.updateStatus('Creating Note...', 'status-connected');
    }

    // --- Drawing Sync Logic (From Scratch implementation) ---
    
    startDrawing(e, canvas) {
        const container = canvas.closest('.stylus-embed-container');
        this.activeCanvasId = container.getAttribute('data-id');
        this.isDrawing = true;
        this.currentStrokeId = 's' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
        this.strokeBatch = [];
        
        // Use global selected stylus tools (fallback to defaults if undefined)
        this.currentToolColor = window.StylusState?.color || '#ff7a59';
        this.currentToolSize = window.StylusState?.size || 3;
        this.currentGlobalCompositeOperation = window.StylusState?.tool === 'eraser' ? 'destination-out' : 'source-over';
        
        canvas.setPointerCapture(e.pointerId);
        
        const pt = this.getCanvasPoint(e, canvas);
        this.lastPoint = pt;
        this.addPointToBatch(pt[0], pt[1]);
        this.drawLocalLine(canvas, pt, pt);

        canvas.onpointermove = (ev) => this.drawMove(ev, canvas);
        canvas.onpointerup = (ev) => this.endDrawing(ev, canvas);
        canvas.onpointercancel = (ev) => this.endDrawing(ev, canvas);
    }

    drawMove(e, canvas) {
        if (!this.isDrawing) return;
        const pt = this.getCanvasPoint(e, canvas);
        this.addPointToBatch(pt[0], pt[1]);
        this.drawLocalLine(canvas, this.lastPoint, pt);
        this.lastPoint = pt;
    }

    endDrawing(e, canvas) {
        if (!this.isDrawing) return;
        this.isDrawing = false;
        canvas.onpointermove = null;
        canvas.onpointerup = null;
        canvas.onpointercancel = null;
        this.flushStrokeBatch(); // ensure everything sends
    }

    getCanvasPoint(e, canvas) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return [(e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY];
    }

    addPointToBatch(x, y) {
        this.strokeBatch.push([x, y]);
        if (!this.strokeBatchTimer) {
            this.strokeBatchTimer = setTimeout(() => this.flushStrokeBatch(), 50); // 50ms batching window
        }
    }

    flushStrokeBatch() {
        if (this.strokeBatch.length > 0 && this.activeCanvasId && this.currentStrokeId) {
            let sendColor = this.currentToolColor;
            let sendSize = this.currentToolSize;
            if (this.currentGlobalCompositeOperation === 'destination-out') {
                sendColor = 'eraser';
                sendSize = 20;
            }
            
            this.send({
                type: 'CANVAS_STROKES',
                doc_id: this.docId,
                canvas_id: this.activeCanvasId,
                stroke_id: this.currentStrokeId,
                color: sendColor,
                size: sendSize,
                points: [...this.strokeBatch]
            });
            this.strokeBatch = [];
        }
        this.strokeBatchTimer = null;
    }

    drawLocalLine(canvas, p1, p2) {
        const ctx = canvas.getContext('2d');
        ctx.beginPath();
        ctx.moveTo(p1[0], p1[1]);
        ctx.lineTo(p2[0], p2[1]);
        
        ctx.globalCompositeOperation = this.currentGlobalCompositeOperation;
        ctx.strokeStyle = this.currentToolColor;
        ctx.lineWidth = this.currentToolSize;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over'; // reset
    }

    renderCanvasStrokes(canvasesObj) {
        Object.keys(canvasesObj).forEach(cId => {
            const canvasNode = document.querySelector(`.stylus-embed-container[data-id="${cId}"] canvas`);
            if (canvasNode) {
                const ctx = canvasNode.getContext('2d');
                ctx.clearRect(0,0, canvasNode.width, canvasNode.height);
                // Draw all strokes
                canvasesObj[cId].forEach(stroke => {
                    if (stroke.points && stroke.points.length > 0) {
                        ctx.beginPath();
                        ctx.moveTo(stroke.points[0][0], stroke.points[0][1]);
                        for(let i=1; i<stroke.points.length; i++) {
                            ctx.lineTo(stroke.points[i][0], stroke.points[i][1]);
                        }
                        
                        if (stroke.color === 'eraser') {
                            ctx.globalCompositeOperation = 'destination-out';
                            ctx.lineWidth = 20;
                        } else {
                            ctx.globalCompositeOperation = 'source-over';
                            ctx.strokeStyle = stroke.color || '#ff7a59';
                            ctx.lineWidth = stroke.size || 3;
                        }
                        
                        ctx.lineCap = 'round';
                        ctx.lineJoin = 'round';
                        ctx.stroke();
                        ctx.globalCompositeOperation = 'source-over';
                    }
                });
            }
        });
    }

    applyRemoteStrokes(msg) {
        if (!window.StylusStore) window.StylusStore = new Map();
        window.StylusStore.set(msg.canvas_id, msg.strokes);
        
        const canvasContainer = document.querySelector(`.ql-stylus-canvas[data-id="${msg.canvas_id}"]`);
        if (canvasContainer) {
            const strokesJson = JSON.stringify(msg.strokes);
            canvasContainer.setAttribute('data-strokes', strokesJson);
            if (window.Quill && this.quill) {
                const blot = Quill.find(canvasContainer);
                if (blot && typeof blot.updateSVG === 'function') {
                    if (window.StylusEngine && window.StylusEngine.activeFacade && window.StylusEngine.activeFacade.id === msg.canvas_id) {
                        window.StylusEngine.activeFacade.repo.load(msg.strokes);
                        window.StylusEngine.activeFacade.renderAll();
                        const newSvg = window.StylusEngine.activeFacade.generateSVG();
                        blot.updateSVG(newSvg, strokesJson);
                    } else {
                        // Re-render passive SVG using the internal StylusEngine logic
                        // Since we dispatched passive-render-update on updateSVG, it will draw itself!
                        blot.updateSVG(canvasContainer.getAttribute('data-svg') || '', strokesJson);
                    }
                }
            }
        }
    }

    // --- Toolbar Actions ---

    bindEvents() {
        if (this.activeNoteTitleEl) {
            this.activeNoteTitleEl.addEventListener('change', (e) => {
                this.send({ type: 'RPC_COMMAND', command: 'RENAME_NOTE', doc_id: this.docId, new_title: e.target.value });
                this.updateStatus('Renamed', 'status-connected');
                // Optimistically update the list
                const listItems = this.notesListEl.querySelectorAll('.note-item');
                listItems.forEach(el => {
                    if (el.classList.contains('active')) {
                        const titleDiv = el.querySelector('.note-title');
                        if (titleDiv) titleDiv.textContent = e.target.value;
                    }
                });
            });
        }

        this.btnSave.onclick = () => {
            this.send({ type: 'RPC_COMMAND', command: 'FORCE_SAVE', doc_id: this.docId });
            this.updateStatus('Saving...', 'status-connected');
        };

        this.btnDraw.onclick = () => {
            // Insert canvas locally, Quill text-change will auto-sync the Delta
            const range = this.quill.getSelection(true) || { index: this.quill.getLength() };
            const id = 'c' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
            this.quill.insertEmbed(range.index, 'stylus-canvas', { id: id, title: 'Tablet Drawing' }, 'user');
            this.quill.setSelection(range.index + 1, 'user');
        };

        this.btnMdSource.onclick = () => {
            this.isMarkdownMode = !this.isMarkdownMode;
            const mdEditor = document.getElementById('markdown-editor');
            const qlEditor = document.getElementById('quill-editor');
            if (this.isMarkdownMode) {
                // VERY basic HTML to Markdown just for show (since turndown isn't loaded)
                mdEditor.value = this.quill.root.innerText;
                mdEditor.style.display = 'block';
                qlEditor.style.display = 'none';
                this.btnMdSource.textContent = '👁️ Visual';
            } else {
                // Switch back
                mdEditor.style.display = 'none';
                qlEditor.style.display = 'block';
                this.btnMdSource.textContent = '📝 Source';
            }
        };

        // Aggressive flush on tab close/hide (Edge case mitigation)
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                this.flushStrokeBatch();
            }
        });
        
        const btnDiagram = document.getElementById('btn-diagram');
        if (btnDiagram) {
            btnDiagram.onclick = () => {
                const range = this.quill.getSelection(true) || { index: this.quill.getLength() };
                const code = `graph TD\nA[Tablet Diagram] --> B[Edit on Desktop]`;
                this.quill.insertEmbed(range.index, 'custom-diagram', { code: code, type: 'mermaid' }, 'user');
                this.quill.setSelection(range.index + 1, 'user');
            };
        }
    }
}

// Export for Node/Jest testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = RemoteNotesClient;
}
