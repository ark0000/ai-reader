/**
 * stylus-engine.js
 * Implements native stylus and freehand drawing capabilities for the Aura External Editor.
 */

(function(window) {
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
        
        beginStroke(tool, color) {
            this.currentStroke = { tool, color, points: [] };
        }
        
        addPoint(x, y, p) {
            if (!this.currentStroke) return;
            const pts = this.currentStroke.points;
            if (pts.length > 0) {
                const last = pts[pts.length - 1];
                const dist = Math.hypot(x - last.x, y - last.y);
                if (dist < 2) return; // Simplification (drop points < 2px)
            }
            this.currentStroke.points.push({ x: Math.round(x), y: Math.round(y), p: Number(p.toFixed(2)) });
        }
        
        endStroke() {
            if (this.currentStroke && this.currentStroke.points.length > 0) {
                this.undoStack.push({ type: 'add', stroke: this.currentStroke });
                this.strokes.push(this.currentStroke);
                this.redoStack = []; 
                if (window.settingsRepo && window.settingsRepo.isTrue('debug_console')) {
                   let totalPts = this.strokes.reduce((acc, s) => acc + s.points.length, 0);
                   console.log(`[StylusEngine] Total points: ${totalPts}`);
                   if (totalPts > 10000) console.warn("Soft cap reached! Consider clearing strokes.");
                }
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
            return {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top,
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
            this.ctx = this.canvas.getContext('2d');
            
            this.repo = new DrawingRepository();
            
            const existingStrokes = container.getAttribute('data-strokes');
            if (existingStrokes) {
                try {
                    this.repo.load(JSON.parse(existingStrokes));
                } catch (e) { console.error("Corrupted strokes JSON", e); }
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
            
            this.resizeObserver = new ResizeObserver(() => this.renderAll());
            this.resizeObserver.observe(this.container);
            
            this.renderAll();
            
            this.keyDownHandler = this._handleKeyDown.bind(this);
            this.container.addEventListener('keydown', this.keyDownHandler);
        }
        
        _onBegin(x, y, p) {
            this.repo.beginStroke(this.currentTool, this.currentColor);
            this.repo.addPoint(x, y, p);
            
            if (this.currentTool === 'eraser') {
                this.strategy = new EraserStrategy(this.ctx, (ex, ey) => {
                    if (this.repo.eraseAt(ex, ey)) {
                        this.renderAll();
                        this._updateBlotData();
                    }
                });
            } else if (this.currentTool === 'highlighter') {
                this.strategy = new HighlighterStrategy(this.ctx, this.currentColor, 8);
            } else {
                this.strategy = new PenStrategy(this.ctx, this.currentColor, 3);
            }
            
            if (this.strategy) this.strategy.begin(x, y, p);
        }
        
        _onMove(x, y, p) {
            this.repo.addPoint(x, y, p);
            if (this.strategy) this.strategy.move(x, y, p);
        }
        
        _onEnd() {
            this.repo.endStroke();
            if (this.strategy) this.strategy.end();
            this.strategy = null;
            this._updateBlotData();
        }
        
        _updateBlotData() {
            this.container.setAttribute('data-strokes', this.repo.serialize());
            if (this.blot && this.blot.updateSVG) {
                this.blot.updateSVG(this.generateSVG());
            }
        }
        
        _handleKeyDown(e) {
            // Scope undo/redo specifically to StylusMode
            if (e.key === 'Escape') {
                e.preventDefault();
                window.StylusEngine.deactivate();
                return;
            }
            if (e.ctrlKey && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                e.stopPropagation(); // prevent global Quill undo
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
        setPenOnly(enabled) { this.adapter.setPenOnly(enabled); }
        
        renderAll() {
            const rect = this.container.getBoundingClientRect();
            if (this.canvas.width !== rect.width || this.canvas.height !== rect.height) {
                this.canvas.width = rect.width;
                this.canvas.height = rect.height;
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
        
        generateSVG() {
            const rect = this.container.getBoundingClientRect();
            // Build simple SVG for export cache
            let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${rect.width} ${rect.height}" width="100%" height="${rect.height}" style="background:#fff">`;
            for (const stroke of this.repo.strokes) {
                if (stroke.points.length === 0) continue;
                const pathData = stroke.points.map((p, i) => `${i===0?'M':'L'} ${p.x} ${p.y}`).join(' ');
                const opacity = stroke.tool === 'highlighter' ? '0.4' : '1.0';
                const width = stroke.tool === 'highlighter' ? '24' : '3';
                svg += `<path d="${pathData}" fill="none" stroke="${stroke.color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}" />`;
            }
            svg += `</svg>`;
            return svg;
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
                
                // Allow it to be focused
                node.setAttribute('tabindex', '0');
                
                // Styling
                node.style.position = 'relative';
                node.style.width = '100%';
                node.style.minHeight = '300px'; 
                node.style.margin = '16px 0';
                node.style.border = '1px solid var(--border)';
                node.style.borderRadius = '8px';
                node.style.background = '#ffffff'; 
                node.style.touchAction = 'none'; // Prevent scroll on canvas
                node.style.overflow = 'hidden';
                node.style.outline = 'none';
                
                if (typeof value === 'object' && value !== null) {
                    node.setAttribute('data-strokes', value.strokes || '[]');
                    node.setAttribute('data-version', value.meta?.version || '1');
                    node.setAttribute('data-svg', value.svg || '');
                } else if (typeof value === 'string') {
                    // Fallback for weird parsing
                    node.setAttribute('data-strokes', '[]');
                }
                
                // Render Canvas
                const canvas = document.createElement('canvas');
                canvas.style.position = 'absolute';
                canvas.style.top = '0';
                canvas.style.left = '0';
                canvas.style.width = '100%';
                canvas.style.height = '100%';
                node.appendChild(canvas);
                
                return node;
            }
            
            static value(node) {
                return {
                    strokes: node.getAttribute('data-strokes') || '[]',
                    svg: node.getAttribute('data-svg') || '',
                    meta: { version: parseInt(node.getAttribute('data-version') || '1') }
                };
            }
            
            updateSVG(svgStr) {
                this.domNode.setAttribute('data-svg', svgStr);
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
        
        init() {
            registerStylusBlot();
            
            // Listen for focus on .ql-stylus-canvas blocks to activate them
            document.addEventListener('focusin', (e) => {
                if (e.target && e.target.classList && e.target.classList.contains('ql-stylus-canvas')) {
                    this.activate(e.target);
                } else if (this.activeFacade && !this.activeFacade.container.contains(e.target) && !e.target.closest('#stylus-toolbar')) {
                    // Clicked away from canvas AND away from toolbar
                    this.deactivate();
                }
            });
            
            document.addEventListener('click', (e) => {
                if (this.activeFacade && !this.activeFacade.container.contains(e.target) && !e.target.closest('#stylus-toolbar')) {
                    this.deactivate();
                }
            });
        },
        
        activate(node) {
            if (this.activeFacade) {
                if (this.activeFacade.container === node) return; // Already active
                this.deactivate();
            }
            
            const blot = window.quillEditor ? window.Quill.find(node) : { updateSVG: () => {} };
            this.activeFacade = new StylusManagerFacade(node, blot);
            node.classList.add('active');
            node.style.boxShadow = '0 0 0 3px var(--accent)';
            
            // Lock Quill
            if (window.quillEditor) window.quillEditor.disable();
            
            // Show Toolbar
            const toolbar = document.getElementById('stylus-toolbar');
            if (toolbar) toolbar.classList.remove('hidden');
        },
        
        deactivate() {
            if (this.activeFacade) {
                this.activeFacade.destroy();
                this.activeFacade.container.classList.remove('active');
                this.activeFacade.container.style.boxShadow = 'none';
                this.activeFacade = null;
            }
            
            // Unlock Quill
            if (window.quillEditor) window.quillEditor.enable();
            
            // Hide Toolbar
            const toolbar = document.getElementById('stylus-toolbar');
            if (toolbar) toolbar.classList.add('hidden');
        },
        
        // Toolbar commands
        setTool(t) { if (this.activeFacade) this.activeFacade.setTool(t); },
        setColor(c) { if (this.activeFacade) this.activeFacade.setColor(c); },
        setPenOnly(b) { if (this.activeFacade) this.activeFacade.setPenOnly(b); },
        undo() { if (this.activeFacade) this.activeFacade.undo(); },
        redo() { if (this.activeFacade) this.activeFacade.redo(); },
        close() { this.deactivate(); }
    };
    
    // Auto-init
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => window.StylusEngine.init());
    } else {
        window.StylusEngine.init();
    }

})(window);
