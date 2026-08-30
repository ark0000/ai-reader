/**
 * stylus-engine.js
 * Implements native stylus and freehand drawing capabilities for the Aura External Editor.
 */

(function(window) {
    // Global stroke storage, independent of Quill DOM
    window.StylusStore = window.StylusStore || new Map();

    // Check for PointerEvent support
    const HAS_POINTER_EVENTS = window.PointerEvent !== undefined;

    // --- 1. Strategies ---
    class DrawingStrategy {
        constructor(ctx) { this.ctx = ctx; }
        begin(x, y, p) {}
        move(x, y, p) {}
        end() {}
    }

    class PenStrategy extends DrawingStrategy {
        constructor(ctx, color, baseWidth) {
            super(ctx);
            this.color = color;
            this.baseWidth = baseWidth;
            this.lastX = 0;
            this.lastY = 0;
        }
        begin(x, y, p) {
            this.ctx.globalCompositeOperation = 'source-over';
            this.ctx.lineCap = 'round';
            this.ctx.lineJoin = 'round';
            this.ctx.strokeStyle = this.color;
            this.ctx.beginPath();
            this.ctx.moveTo(x, y);
            this.lastX = x;
            this.lastY = y;
            this.ctx.lineWidth = this.baseWidth * p;
            this.ctx.lineTo(x, y);
            this.ctx.stroke();
        }
        move(x, y, p) {
            this.ctx.lineWidth = this.baseWidth * p;
            this.ctx.lineTo(x, y);
            this.ctx.stroke();
            this.ctx.beginPath();
            this.ctx.moveTo(x, y);
            this.lastX = x;
            this.lastY = y;
        }
        end() {}
    }

    class HighlighterStrategy extends DrawingStrategy {
        constructor(ctx, color, baseWidth) {
            super(ctx);
            this.color = color;
            this.baseWidth = baseWidth * 3; // Thicker
            this.lastX = 0;
            this.lastY = 0;
        }
        begin(x, y, p) {
            this.ctx.globalCompositeOperation = 'multiply';
            this.ctx.lineCap = 'round';
            this.ctx.lineJoin = 'round';
            this.ctx.strokeStyle = this.color;
            this.ctx.lineWidth = this.baseWidth;
            this.ctx.beginPath();
            this.ctx.moveTo(x, y);
            this.lastX = x;
            this.lastY = y;
            this.ctx.lineTo(x, y);
            this.ctx.stroke();
        }
        move(x, y, p) {
            this.ctx.lineWidth = this.baseWidth;
            this.ctx.lineTo(x, y);
            this.ctx.stroke();
            this.ctx.beginPath();
            this.ctx.moveTo(x, y);
            this.lastX = x;
            this.lastY = y;
        }
        end() {}
    }
    
    class EraserStrategy extends DrawingStrategy {
       constructor(ctx, onErase) {
           super(ctx);
           this.onErase = onErase;
       }
       begin(x, y, p) { this.onErase(x, y); }
       move(x, y, p) { this.onErase(x, y); }
       end() {}
    }

    // --- 2. Repository ---
    class DrawingRepository {
        constructor() {
            this.strokes = [];
            this.undoStack = [];
            this.redoStack = [];
            this.currentStroke = null;
        }
        
        beginStroke(tool, color, size) {
            this.currentStroke = { tool, color, size: size || 3, points: [] };
        }
        
        addPoint(x, y, p) {
            if (!this.currentStroke) return;
            const pts = this.currentStroke.points;
            if (pts.length > 0) {
                const last = pts[pts.length - 1];
                const dist = Math.hypot(x - last.x, y - last.y);
                if (dist < 2) return; // Simplification
            }
            this.currentStroke.points.push({ x: Math.round(x), y: Math.round(y), p: Number(p.toFixed(2)) });
        }
        
        endStroke() {
            if (this.currentStroke && this.currentStroke.points.length > 0) {
                this.undoStack.push({ type: 'add', stroke: this.currentStroke });
                this.strokes.push(this.currentStroke);
                this.redoStack = []; 
            }
            this.currentStroke = null;
        }
        
        eraseAt(x, y) {
            const ERASER_RADIUS = 20;
            const toRemove = [];
            for (let i = this.strokes.length - 1; i >= 0; i--) {
                const stroke = this.strokes[i];
                for (const pt of stroke.points) {
                    if (Math.hypot(pt.x - x, pt.y - y) < ERASER_RADIUS) {
                        toRemove.push(i);
                        break;
                    }
                }
            }
            if (toRemove.length > 0) {
                const removedStrokes = [];
                toRemove.forEach(idx => {
                    removedStrokes.push({ idx, stroke: this.strokes[idx] });
                    this.strokes.splice(idx, 1);
                });
                this.undoStack.push({ type: 'erase', removed: removedStrokes });
                this.redoStack = [];
                return true;
            }
            return false;
        }
        
        undo() {
            if (this.undoStack.length === 0) return false;
            const action = this.undoStack.pop();
            if (action.type === 'add') {
                this.strokes.pop();
                this.redoStack.push(action);
            } else if (action.type === 'erase') {
                action.removed.slice().reverse().forEach(r => {
                    this.strokes.splice(r.idx, 0, r.stroke);
                });
                this.redoStack.push(action);
            }
            return true;
        }
        
        redo() {
            if (this.redoStack.length === 0) return false;
            const action = this.redoStack.pop();
            if (action.type === 'add') {
                this.strokes.push(action.stroke);
                this.undoStack.push(action);
            } else if (action.type === 'erase') {
                action.removed.forEach(r => {
                    this.strokes.splice(this.strokes.indexOf(r.stroke), 1);
                });
                this.undoStack.push(action);
            }
            return true;
        }
        
        load(strokesArray) {
            this.strokes = strokesArray || [];
            this.undoStack = [];
            this.redoStack = [];
        }
        
        serialize() {
            return JSON.stringify(this.strokes);
        }
        
        clear() {
            this.strokes = [];
            this.undoStack = [];
            this.redoStack = [];
        }
    }

    // --- 3. Adapter ---
    class PointerEventAdapter {
        constructor(canvas, onBegin, onMove, onEnd) {
            this.canvas = canvas;
            this.onBegin = onBegin;
            this.onMove = onMove;
            this.onEnd = onEnd;
            this.penOnly = false;
            
            this.handlers = {
                pointerdown: this._handleDown.bind(this),
                pointermove: this._handleMove.bind(this),
                pointerup: this._handleUp.bind(this),
                pointercancel: this._handleUp.bind(this), // Same as up
            };
            
            if (HAS_POINTER_EVENTS) {
                this.canvas.addEventListener('pointerdown', this.handlers.pointerdown);
                this.canvas.addEventListener('pointermove', this.handlers.pointermove);
                this.canvas.addEventListener('pointerup', this.handlers.pointerup);
                this.canvas.addEventListener('pointercancel', this.handlers.pointercancel);
            }
        }
        
        setPenOnly(enabled) {
            this.penOnly = enabled;
        }
        
        _getCoords(e) {
            const rect = this.canvas.getBoundingClientRect();
            // Fallback for pressure (Mouse usually sends 0.5)
            // Clamp to 0.1 minimum to fix Android zero-pressure bug
            let p = e.pressure !== undefined ? e.pressure : 0.5;
            if (p === 0 && e.pointerType !== 'mouse') p = 0.5; // fallback
            
            // Calculate scale factors to handle when CSS size differs from the internal buffer size
            // This is critical for the remote tablet in editor mode, where the canvas is scaled to fit the screen
            const scaleX = rect.width > 0 ? this.canvas.width / rect.width : 1;
            const scaleY = rect.height > 0 ? this.canvas.height / rect.height : 1;
            
            return {
                x: (e.clientX - rect.left) * scaleX,
                y: (e.clientY - rect.top) * scaleY,
                p: Math.max(0.1, p) 
            };
        }
        
        _handleDown(e) {
            if (this.penOnly && e.pointerType !== 'pen') {
                if (window.showToast) window.showToast('Pen-only mode is active — use your stylus to draw.');
                return;
            }
            this.canvas.setPointerCapture(e.pointerId);
            const { x, y, p } = this._getCoords(e);
            this.onBegin(x, y, p);
            e.preventDefault();
        }
        
        _handleMove(e) {
            if (this.penOnly && e.pointerType !== 'pen') return;
            if (!this.canvas.hasPointerCapture(e.pointerId)) return;
            const { x, y, p } = this._getCoords(e);
            this.onMove(x, y, p);
            e.preventDefault();
        }
        
        _handleUp(e) {
            if (this.canvas.hasPointerCapture(e.pointerId)) {
                this.canvas.releasePointerCapture(e.pointerId);
                this.onEnd();
            }
            e.preventDefault();
        }
        
        destroy() {
            if (HAS_POINTER_EVENTS) {
                this.canvas.removeEventListener('pointerdown', this.handlers.pointerdown);
                this.canvas.removeEventListener('pointermove', this.handlers.pointermove);
                this.canvas.removeEventListener('pointerup', this.handlers.pointerup);
                this.canvas.removeEventListener('pointercancel', this.handlers.pointercancel);
            }
        }
    }

    // --- 4. Facade ---
    class StylusManagerFacade {
        constructor(container, blot) {
            this.container = container;
            this.blot = blot;
            this.canvas = container.querySelector('canvas');
            
            // Fix canvas size to match tablet coordinate space (800x400)
            if (this.canvas.width !== 800 || this.canvas.height !== 400) {
                this.canvas.width = 800;
                this.canvas.height = 400;
            }
            
            this.ctx = this.canvas.getContext('2d');
            
            this.id = container.dataset.id || ('c' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5));
            container.dataset.id = this.id;
            
            this.repo = new DrawingRepository();
            
            const existingStrokes = window.StylusStore.get(this.id);
            if (existingStrokes) {
                this.repo.load(JSON.parse(JSON.stringify(existingStrokes)));
            } else {
                window.StylusStore.set(this.id, []);
            }
            
            this.currentTool = 'pen';
            this.currentColor = '#000000';
            this.strategy = null;
            
            this.adapter = new PointerEventAdapter(
                this.canvas,
                this._onBegin.bind(this),
                this._onMove.bind(this),
                this._onEnd.bind(this)
            );
            
            this.resizeObserver = new ResizeObserver(entries => {
                const rect = entries[0].contentRect;
                if (rect.width > 0 && rect.height > 0) {
                    if (this.canvas.width !== rect.width || this.canvas.height !== rect.height) {
                        this.canvas.width = rect.width;
                        this.canvas.height = rect.height;
                    }
                    this.renderAll();
                    const evt = new CustomEvent('stylus-canvas-activated', {
                        detail: { id: this.id, width: this.canvas.width, height: this.canvas.height }
                    });
                    document.dispatchEvent(evt);
                }
            });
            this.resizeObserver.observe(this.container);
            
            this.keyDownHandler = this._handleKeyDown.bind(this);
            this.container.addEventListener('keydown', this.keyDownHandler);
        }
        
        _onBegin(x, y, p) {
            if (this.currentTool !== 'eraser') {
                this.repo.beginStroke(this.currentTool, this.currentColor, this.currentSize || 3);
                this.repo.addPoint(x, y, p);
            }
            
            if (this.currentTool === 'eraser') {
                this.strategy = new EraserStrategy(this.ctx, (ex, ey) => {
                    if (this.repo.eraseAt(ex, ey)) {
                        this.renderAll();
                        this._updateBlotData();
                    }
                });
            } else if (this.currentTool === 'highlighter') {
                const hlSize = this.currentSize ? this.currentSize * 3 : 8;
                this.strategy = new HighlighterStrategy(this.ctx, this.currentColor, hlSize);
            } else {
                const penSize = this.currentSize || 3;
                this.strategy = new PenStrategy(this.ctx, this.currentColor, penSize);
            }
            
            if (this.strategy) this.strategy.begin(x, y, p);
        }
        
        _onMove(x, y, p) {
            if (this.currentTool !== 'eraser') {
                this.repo.addPoint(x, y, p);
            }
            if (this.strategy) this.strategy.move(x, y, p);
        }
        
        _onEnd() {
            if (this.currentTool !== 'eraser') {
                this.repo.endStroke();
            }
            if (this.strategy) this.strategy.end();
            this.strategy = null;
            this._updateBlotData();
        }
        
        _updateBlotData() {
            const strokesJson = this.repo.serialize();
            window.StylusStore.set(this.id, JSON.parse(strokesJson));
            const svgStr = this.generateSVG();
            this.container.setAttribute('data-svg', svgStr);
            this.container.setAttribute('data-strokes', strokesJson);
            if (this.blot && typeof this.blot.updateSVG === 'function') {
                this.blot.updateSVG(svgStr, strokesJson);
            }
            
            // Broadcast the strokes over the WebSocket (supports both Desktop and Tablet environments)
            const payload = {
                type: 'CANVAS_STROKES',
                doc_id: window.currentExternalNoteId || (window.RemoteNotesApp && window.RemoteNotesApp.docId),
                canvas_id: this.id,
                strokes: this.repo.strokes
            };
            
            if (window.RemoteNotesEngineInstance && window.RemoteNotesEngineInstance.ws && window.RemoteNotesEngineInstance.ws.readyState === 1) {
                window.RemoteNotesEngineInstance.send(payload);
            } else if (window.RemoteNotesApp && window.RemoteNotesApp.ws && window.RemoteNotesApp.ws.readyState === 1) {
                window.RemoteNotesApp.send(payload);
            }
        }
        
        generateSVG() {
            const w = 800;
            const h = 400;
            let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" height="auto" style="background:transparent">`;
            
            this.repo.strokes.forEach(stroke => {
                if (stroke.points.length < 2) return;
                const tool = stroke.tool;
                const storedSize = stroke.size || 3;
                const width = tool === 'eraser' ? 0 : (tool === 'highlighter' ? storedSize * 3 : storedSize);
                const opacity = tool === 'highlighter' ? 0.4 : 1.0;
                
                let pathData = `M ${stroke.points[0].x} ${stroke.points[0].y}`;
                for (let i = 1; i < stroke.points.length; i++) {
                    pathData += ` L ${stroke.points[i].x} ${stroke.points[i].y}`;
                }
                
                svg += `<path d="${pathData}" fill="none" stroke="${stroke.color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}" />`;
            });
            
            svg += `</svg>`;
            return svg;
        }
        
        loadAndRender(strokes) {
            this.repo.load(strokes);
            this.renderAll();
            this._updateBlotData();
        }
        
        _handleKeyDown(e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                window.StylusEngine.deactivate();
                return;
            }
            if (e.ctrlKey && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                e.stopPropagation();
                if (e.shiftKey) this.redo();
                else this.undo();
            } else if (e.ctrlKey && e.key.toLowerCase() === 'y') {
                e.preventDefault();
                e.stopPropagation();
                this.redo();
            }
        }
        
        undo() {
            if (this.repo.undo()) { this.renderAll(); this._updateBlotData(); }
        }
        
        redo() {
            if (this.repo.redo()) { this.renderAll(); this._updateBlotData(); }
        }
        
        setTool(tool) { this.currentTool = tool; }
        setColor(color) { this.currentColor = color; }
        setSize(size) { this.currentSize = parseFloat(size); }
        setPenOnly(enabled) { this.adapter.setPenOnly(enabled); }
        
        renderAll() {
            // Keep fixed 800x400 internal coordinate space
            if (this.canvas.width !== 800 || this.canvas.height !== 400) {
                this.canvas.width = 800;
                this.canvas.height = 400;
            }
            
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.ctx.lineCap = 'round';
            this.ctx.lineJoin = 'round';
            
            for (const stroke of this.repo.strokes) {
                if (stroke.points.length === 0) continue;
                this.ctx.beginPath();
                this.ctx.strokeStyle = stroke.color;
                
                if (stroke.tool === 'highlighter') {
                    this.ctx.globalCompositeOperation = 'multiply';
                    this.ctx.lineWidth = 24;
                } else {
                    this.ctx.globalCompositeOperation = 'source-over';
                    this.ctx.lineWidth = 3;
                }
                
                const pts = stroke.points;
                this.ctx.moveTo(pts[0].x, pts[0].y);
                
                if (pts.length === 1) {
                    this.ctx.lineWidth = (stroke.tool === 'highlighter' ? 24 : 3) * pts[0].p;
                    this.ctx.lineTo(pts[0].x, pts[0].y);
                } else {
                    for (let i = 1; i < pts.length; i++) {
                        this.ctx.lineWidth = (stroke.tool === 'highlighter' ? 24 : 3) * pts[i].p;
                        this.ctx.lineTo(pts[i].x, pts[i].y);
                        this.ctx.stroke();
                        this.ctx.beginPath();
                        this.ctx.moveTo(pts[i].x, pts[i].y);
                    }
                }
                this.ctx.stroke();
            }
        }

        destroy() {
            this.adapter.destroy();
            this.resizeObserver.disconnect();
            this.container.removeEventListener('keydown', this.keyDownHandler);
        }
    }

    // --- 5. Quill Blot ---
    function registerStylusBlot() {
        if (!window.Quill) return;
        const BlockEmbed = Quill.import('blots/block/embed');
        
        class StylusCanvasBlot extends BlockEmbed {
            static create(value) {
                const node = super.create();
                node.setAttribute('contenteditable', 'false');
                node.classList.add('ql-stylus-canvas');
                
                node.setAttribute('tabindex', '0');
                
                node.style.position = 'relative';
                node.style.width = '100%';
                node.style.minHeight = '300px'; 
                node.style.margin = '16px 0';
                node.style.border = '1px solid var(--border)';
                node.style.borderRadius = '8px';
                node.style.background = '#ffffff'; 
                node.style.touchAction = 'none';
                node.style.overflow = 'hidden';
                node.style.outline = 'none';
                
                let initData = {
                    id: 'c' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
                    title: 'Draw',
                    svg: '',
                    strokes: ''
                };
                
                if (typeof value === 'object' && value !== null) {
                    if (value instanceof HTMLElement) {
                        if (value.dataset.id) initData.id = value.dataset.id;
                        if (value.dataset.title) initData.title = value.dataset.title;
                        if (value.hasAttribute('data-svg')) initData.svg = value.getAttribute('data-svg');
                        if (value.hasAttribute('data-strokes')) initData.strokes = value.getAttribute('data-strokes');
                    } else if (value.id) {
                        initData.id = value.id;
                        if (value.title) initData.title = value.title;
                        if (value.svg) initData.svg = value.svg;
                        if (value.strokes) initData.strokes = value.strokes;
                    }
                }
                
                node.dataset.id = initData.id;
                if (initData.title !== 'Draw') {
                    node.dataset.title = initData.title;
                }
                
                const canvas = document.createElement('canvas');
                canvas.width = 800;
                canvas.height = 400;
                canvas.style.width = '100%';
                canvas.style.height = 'auto';
                canvas.style.aspectRatio = '2 / 1';
                canvas.style.display = 'block';
                
                // --- Title bar ---
                const titleBar = document.createElement('div');
                titleBar.style.cssText = [
                    'background:#1e1e1e', // Dark background to match UI
                    'padding:6px 12px', 'display:flex', 'align-items:center', 'gap:8px',
                    'border-bottom:1px solid #333'
                ].join(';');
                
                const titleIcon = document.createElement('span');
                titleIcon.textContent = '✏️';
                titleIcon.style.fontSize = '12px';
                
                const titleText = document.createElement('span');
                titleText.style.cssText = 'font-size:13px;font-weight:600;color:#ff7a59;font-family:sans-serif;flex:1;';
                titleText.textContent = initData.title || 'Draw';
                
                const editBtn = document.createElement('button');
                editBtn.innerHTML = '&#9998;';
                editBtn.title = 'Rename drawing';
                editBtn.style.cssText = [
                    'background:none', 'border:none', 'cursor:pointer',
                    'font-size:14px', 'color:#aaa', 'padding:4px',
                    'line-height:1', 'transition:color 0.2s', 'display:flex', 'align-items:center', 'justify-content:center'
                ].join(';');
                editBtn.addEventListener('mouseenter', () => editBtn.style.color = '#fff');
                editBtn.addEventListener('mouseleave', () => editBtn.style.color = '#aaa');
                editBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    const cur = node.dataset.title || titleText.textContent;
                    // Inline rename overlay
                    const ov = document.createElement('div');
                    ov.classList.add('stylus-rename-modal');
                    ov.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.6);z-index:9999999;display:flex;align-items:center;justify-content:center;';
                    
                    const dialog = document.createElement('div');
                    dialog.style.cssText = 'background:#252525;padding:20px;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.5);display:flex;flex-direction:column;gap:12px;min-width:300px;border:1px solid #333;';
                    
                    const h = document.createElement('h3');
                    h.textContent = 'Rename Drawing';
                    h.style.cssText = 'margin:0;color:#fff;font-size:16px;';
                    
                    const inp = document.createElement('input');
                    inp.type = 'text';
                    inp.value = cur;
                    inp.style.cssText = 'background:#1e1e1e;border:1px solid #444;color:#fff;padding:8px;border-radius:4px;outline:none;font-size:14px;';
                    inp.addEventListener('focus', () => inp.style.borderColor = '#ff7a59');
                    inp.addEventListener('blur', () => inp.style.borderColor = '#444');
                    
                    const btnRow = document.createElement('div');
                    btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:4px;';
                    
                    const cancel = document.createElement('button');
                    cancel.textContent = 'Cancel';
                    cancel.style.cssText = 'background:transparent;border:1px solid #555;color:#ddd;padding:6px 12px;border-radius:4px;cursor:pointer;';
                    
                    const save = document.createElement('button');
                    save.textContent = 'Save';
                    save.style.cssText = 'background:#ff7a59;border:none;color:#fff;padding:6px 16px;border-radius:4px;cursor:pointer;font-weight:bold;';
                    
                    const cleanup = () => { if(document.body.contains(ov)) document.body.removeChild(ov); };
                    const apply = () => {
                        const nT = inp.value.trim();
                        if (nT) {
                            node.dataset.title = nT;
                            titleText.textContent = nT;
                            if (window.StylusEngine && window.StylusEngine.activeFacade && window.StylusEngine.activeFacade.id === node.dataset.id) {
                                window.StylusEngine.activeFacade.title = nT;
                            }
                            if (window.quillEditor) {
                                const pos = window.quillEditor.getIndex(Quill.find(node));
                                if (pos !== null) {
                                    // Hack to force Quill to emit change so auto-save catches rename
                                    window.quillEditor.formatText(pos, 1, 'api');
                                }
                            }
                        }
                        cleanup();
                    };
                    
                    cancel.addEventListener('click', cleanup);
                    save.addEventListener('click', apply);
                    inp.addEventListener('keydown', (e2) => {
                        if (e2.key === 'Enter') apply();
                        if (e2.key === 'Escape') cleanup();
                    });
                    
                    btnRow.appendChild(cancel);
                    btnRow.appendChild(save);
                    dialog.appendChild(h);
                    dialog.appendChild(inp);
                    dialog.appendChild(btnRow);
                    ov.appendChild(dialog);
                    document.body.appendChild(ov);
                    
                    inp.focus();
                    inp.select();
                });
                
                titleBar.appendChild(titleIcon);
                titleBar.appendChild(titleText);
                titleBar.appendChild(editBtn);
                
                node.appendChild(titleBar);
                node.appendChild(canvas);
                
                const renderPassive = () => {
                    const id = node.dataset.id;
                    if (!window.StylusStore || !window.StylusStore.has(id)) return;
                    const strokes = window.StylusStore.get(id);
                    const ctx = canvas.getContext('2d');
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    ctx.lineCap = 'round';
                    ctx.lineJoin = 'round';
                    
                    let hasStrokes = false;
                    for (const stroke of strokes) {
                        if (stroke.points.length === 0) continue;
                        hasStrokes = true;
                        ctx.beginPath();
                        ctx.strokeStyle = stroke.color;
                        if (stroke.tool === 'highlighter') {
                            ctx.globalCompositeOperation = 'multiply';
                            ctx.lineWidth = 24;
                        } else {
                            ctx.globalCompositeOperation = 'source-over';
                            ctx.lineWidth = 3;
                        }
                        
                        const pts = stroke.points;
                        ctx.moveTo(pts[0].x, pts[0].y);
                        if (pts.length === 1) {
                            ctx.lineWidth = (stroke.tool === 'highlighter' ? 24 : 3) * pts[0].p;
                            ctx.lineTo(pts[0].x, pts[0].y);
                        } else {
                            for (let i = 1; i < pts.length; i++) {
                                ctx.lineWidth = (stroke.tool === 'highlighter' ? 24 : 3) * pts[i].p;
                                ctx.lineTo(pts[i].x, pts[i].y);
                                ctx.stroke();
                                ctx.beginPath();
                                ctx.moveTo(pts[i].x, pts[i].y);
                            }
                        }
                        ctx.stroke();
                    }
                    
                    // Generate simple SVG on load so it exports properly
                    if (hasStrokes && !node.getAttribute('data-svg')) {
                        let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvas.width} ${canvas.height}" width="100%" height="auto" style="background:transparent">`;
                        strokes.forEach(stroke => {
                            if (stroke.points.length < 2) return;
                            const width = stroke.tool === 'pen' ? 3 : (stroke.tool === 'marker' ? 12 : 20);
                            const opacity = stroke.tool === 'highlighter' ? 0.4 : 1.0;
                            let pathData = `M ${stroke.points[0].x} ${stroke.points[0].y}`;
                            for (let i = 1; i < stroke.points.length; i++) {
                                pathData += ` L ${stroke.points[i].x} ${stroke.points[i].y}`;
                            }
                            svg += `<path d="${pathData}" fill="none" stroke="${stroke.color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}" />`;
                        });
                        svg += `</svg>`;
                        node.setAttribute('data-svg', svg);
                    }
                };
                
                if (initData.strokes) {
                    try {
                        const parsedStrokes = JSON.parse(initData.strokes);
                        if (!window.StylusStore) window.StylusStore = new Map();
                        window.StylusStore.set(node.dataset.id, parsedStrokes);
                    } catch(e) {}
                }
                
                const resizeObserver = new ResizeObserver(entries => {
                    renderPassive();
                });
                resizeObserver.observe(node);
                
                setTimeout(renderPassive, 100);
                node.addEventListener('passive-render-update', renderPassive);
                
                node.setAttribute('data-svg', initData.svg || '');
                if (initData.strokes) node.setAttribute('data-strokes', initData.strokes);
                return node;
            }
            
            static value(node) {
                return {
                    id: node.dataset.id,
                    title: node.dataset.title || '',
                    svg: node.getAttribute('data-svg') || '',
                    strokes: node.getAttribute('data-strokes') || ''
                };
            }
            
            updateSVG(svgStr, strokesStr) {
                this.domNode.setAttribute('data-svg', svgStr);
                if (strokesStr) this.domNode.setAttribute('data-strokes', strokesStr);
                this.domNode.dispatchEvent(new Event('passive-render-update'));
            }
        }
        
        StylusCanvasBlot.blotName = 'stylus-canvas';
        StylusCanvasBlot.tagName = 'div';
        StylusCanvasBlot.className = 'ql-stylus-canvas';
        
        Quill.register(StylusCanvasBlot, true);
    }

    // --- 6. Global Engine ---
    window.StylusEngine = {
        isSupported: HAS_POINTER_EVENTS,
        activeFacade: null,
        
        getFacadeForId(id) {
            if (this.activeFacade && this.activeFacade.id === id) {
                return this.activeFacade;
            }
            return null;
        },

        init() {
            if (window.Quill) {
                registerStylusBlot();
            }
            
            document.addEventListener('focusin', (e) => {
                if (e.target && e.target.classList && e.target.classList.contains('ql-stylus-canvas')) {
                    this.activate(e.target);
                } else if (this.activeFacade && !this.activeFacade.container.contains(e.target)
                    && !e.target.closest('#stylus-toolbar')
                    && !e.target.closest('#tablet-toolbar')
                    && !e.target.closest('#top-nav')
                    && !e.target.closest('.stylus-rename-modal')
                    && !e.target.closest('#hamburger-btn')
                    && !e.target.closest('#hamburger-sidebar')
                    && !e.target.closest('#tablet-sync-btn')
                    && !e.target.closest('#tablet-qr-modal')) {
                    this.deactivate();
                }
            });
            
            document.addEventListener('click', (e) => {
                if (this.activeFacade && !this.activeFacade.container.contains(e.target)
                    && !e.target.closest('#stylus-toolbar')
                    && !e.target.closest('#tablet-toolbar')
                    && !e.target.closest('#top-nav')
                    && !e.target.closest('.stylus-rename-modal')
                    && !e.target.closest('#hamburger-btn')
                    && !e.target.closest('#hamburger-sidebar')
                    && !e.target.closest('#tablet-sync-btn')
                    && !e.target.closest('#tablet-qr-modal')) {
                    this.deactivate();
                }
            });
        },
        
        insertCanvas() {
            if (!window.quillEditor) return;
            
            // Create a custom modal prompt because native prompt() fails in some WebView environments
            const overlay = document.createElement('div');
            overlay.style.position = 'fixed';
            overlay.style.top = '0'; overlay.style.left = '0';
            overlay.style.width = '100vw'; overlay.style.height = '100vh';
            overlay.style.backgroundColor = 'rgba(0,0,0,0.6)';
            overlay.style.zIndex = '9999999';
            overlay.style.display = 'flex';
            overlay.style.alignItems = 'center';
            overlay.style.justifyContent = 'center';
            
            const modal = document.createElement('div');
            modal.style.background = 'var(--bg-panel)';
            modal.style.border = '1px solid var(--border)';
            modal.style.borderRadius = '12px';
            modal.style.padding = '20px';
            modal.style.width = '300px';
            modal.style.boxShadow = '0 10px 30px rgba(0,0,0,0.5)';
            
            const title = document.createElement('h3');
            title.textContent = 'Name your drawing';
            title.style.marginTop = '0';
            title.style.color = 'var(--text-1)';
            title.style.fontSize = '16px';
            
            const input = document.createElement('input');
            input.type = 'text';
            input.placeholder = 'e.g., Architecture Diagram';
            input.style.width = '100%';
            input.style.padding = '8px';
            input.style.marginTop = '10px';
            input.style.marginBottom = '20px';
            input.style.background = 'var(--bg-body)';
            input.style.border = '1px solid var(--border)';
            input.style.color = 'var(--text-1)';
            input.style.borderRadius = '6px';
            
            const btnRow = document.createElement('div');
            btnRow.style.display = 'flex';
            btnRow.style.justifyContent = 'flex-end';
            btnRow.style.gap = '10px';
            
            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = 'Cancel';
            cancelBtn.style.padding = '6px 12px';
            cancelBtn.style.background = 'transparent';
            cancelBtn.style.color = 'var(--text-1)';
            cancelBtn.style.border = '1px solid var(--border)';
            cancelBtn.style.borderRadius = '6px';
            cancelBtn.style.cursor = 'pointer';
            
            const saveBtn = document.createElement('button');
            saveBtn.textContent = 'Insert';
            saveBtn.style.padding = '6px 12px';
            saveBtn.style.background = 'var(--accent)';
            saveBtn.style.color = '#fff';
            saveBtn.style.border = 'none';
            saveBtn.style.borderRadius = '6px';
            saveBtn.style.cursor = 'pointer';
            
            btnRow.appendChild(cancelBtn);
            btnRow.appendChild(saveBtn);
            modal.appendChild(title);
            modal.appendChild(input);
            modal.appendChild(btnRow);
            overlay.appendChild(modal);
            document.body.appendChild(overlay);
            
            input.focus();
            
            const cleanup = () => {
                if (document.body.contains(overlay)) {
                    document.body.removeChild(overlay);
                }
            };
            
            const submit = () => {
                cleanup();
                const drawTitle = input.value.trim() || "Draw";
                const range = window.quillEditor.getSelection(true) || { index: window.quillEditor.getLength() };
                const id = 'c' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
                window.StylusStore.set(id, []); 
                window.quillEditor.insertEmbed(range.index, 'stylus-canvas', { id: id, title: drawTitle }, 'user');
                window.quillEditor.setSelection(range.index + 1, 'user');
                
                setTimeout(() => {
                    const node = document.querySelector(`.ql-stylus-canvas[data-id="${id}"]`);
                    if (node) this.activate(node);
                }, 50);
            };
            
            saveBtn.addEventListener('click', submit);
            cancelBtn.addEventListener('click', cleanup);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') submit();
                if (e.key === 'Escape') cleanup();
            });
        },

        activate(node) {
            if (this.activeFacade) {
                if (this.activeFacade.container === node && this.activeFacade.id === node.dataset.id) return; 
                this.deactivate();
            }
            
            const blot = window.quillEditor ? (window.Quill ? window.Quill.find(node) : null) : null;
            this.activeFacade = new StylusManagerFacade(node, blot);
            node.classList.add('active');
            node.style.boxShadow = '0 0 0 3px var(--accent)';
            
            if (window.quillEditor) window.quillEditor.disable();
            
            const toolbar = document.getElementById('stylus-toolbar');
            if (toolbar) {
                toolbar.style.display = 'flex';
                toolbar.classList.remove('hidden');
            }
            
            if (window.TabletSync && typeof window.TabletSync.broadcastCanvasInfo === 'function') {
                window.TabletSync.broadcastCanvasInfo();
            }
        },
        
        deactivate() {
            if (this.activeFacade) {
                this.activeFacade.destroy();
                this.activeFacade.container.classList.remove('active');
                this.activeFacade.container.style.boxShadow = 'none';
                this.activeFacade = null;
            }
            
            if (window.quillEditor) window.quillEditor.enable();
            
            const toolbar = document.getElementById('stylus-toolbar');
            if (toolbar) {
                toolbar.style.display = 'none';
                toolbar.classList.add('hidden');
            }
            
            if (window.TabletSync && typeof window.TabletSync.broadcastCanvasInfo === 'function') {
                window.TabletSync.broadcastCanvasInfo();
            }
        },
        
        setTool(t) { if (this.activeFacade) this.activeFacade.setTool(t); },
        setColor(c) { if (this.activeFacade) this.activeFacade.setColor(c); },
        setSize(s) { if (this.activeFacade) this.activeFacade.setSize(s); },
        setPenOnly(b) { if (this.activeFacade) this.activeFacade.setPenOnly(b); },
        undo() { if (this.activeFacade) this.activeFacade.undo(); },
        redo() { if (this.activeFacade) this.activeFacade.redo(); },
        close() { this.deactivate(); },
        
        exportPNG() {
            if (!this.activeFacade || !this.activeFacade.canvas) {
                if (window.showToast) window.showToast('No active canvas to export.');
                return;
            }
            const canvas = this.activeFacade.canvas;
            
            // Create a temporary canvas to draw a white background, otherwise PNG is transparent
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = canvas.width;
            tempCanvas.height = canvas.height;
            const ctx = tempCanvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
            ctx.drawImage(canvas, 0, 0);
            
            const dataUrl = tempCanvas.toDataURL('image/png');
            const titleInput = document.getElementById('external-note-title');
            const title = (titleInput && titleInput.value.trim()) || 'Untitled Canvas';
            
            const a = document.createElement('a');
            a.href = dataUrl;
            a.download = title + '.png';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }
    };
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => window.StylusEngine.init());
    } else {
        window.StylusEngine.init();
    }

})(window);
