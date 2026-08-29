/**
 * test_stylus_engine.test.js
 * Unit tests for PointerEventAdapter, DrawingRepository, etc.
 */

const fs = require('fs');
const path = require('path');

describe('StylusEngine', () => {
    
    beforeEach(() => {
        // Mock DOM & Pointer Events
        window.PointerEvent = class PointerEvent extends window.Event {
            constructor(type, props) {
                super(type, props);
                this.pointerId = props.pointerId || 1;
                this.pointerType = props.pointerType || 'mouse';
                this.clientX = props.clientX || 0;
                this.clientY = props.clientY || 0;
                this.pressure = props.pressure;
            }
        };
        
        window.showToast = jest.fn();
        
        // Mock Quill
        window.Quill = {
            import: jest.fn().mockReturnValue(class BlockEmbed {
                static create() {
                    const div = document.createElement('div');
                    return div;
                }
            }),
            register: jest.fn(),
            find: jest.fn()
        };
        
        // ResizeObserver
        window.ResizeObserver = class ResizeObserver {
            observe() {}
            unobserve() {}
            disconnect() {}
        };
        
        // Load stylus-engine.js
        const code = fs.readFileSync(path.join(__dirname, '../src/static/js/stylus-engine.js'), 'utf8');
        eval(code);
    });

    afterEach(() => {
        jest.clearAllMocks();
        delete window.PointerEvent;
        delete window.StylusEngine;
        delete window.Quill;
    });

    describe('PointerEventAdapter & Rendering', () => {
        it('registers stylus-canvas blot', () => {
            expect(window.Quill.register).toHaveBeenCalled();
        });
        
        it('activates and deactivates Facade correctly', () => {
            const container = document.createElement('div');
            container.classList.add('ql-stylus-canvas');
            document.body.appendChild(container);
            
            // Mock canvas context
            const canvas = document.createElement('canvas');
            canvas.getContext = () => ({
                clearRect: jest.fn(),
                beginPath: jest.fn(),
                moveTo: jest.fn(),
                lineTo: jest.fn(),
                stroke: jest.fn()
            });
            container.appendChild(canvas);
            
            // Toolbar
            const toolbar = document.createElement('div');
            toolbar.id = 'stylus-toolbar';
            toolbar.classList.add('hidden');
            document.body.appendChild(toolbar);
            
            window.StylusEngine.activate(container);
            
            expect(window.StylusEngine.activeFacade).not.toBeNull();
            expect(toolbar.classList.contains('hidden')).toBe(false);
            
            window.StylusEngine.deactivate();
            
            expect(window.StylusEngine.activeFacade).toBeNull();
            expect(toolbar.classList.contains('hidden')).toBe(true);
        });
    });
});
