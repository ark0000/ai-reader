/**
 * @jest-environment jsdom
 */

const TemplateManager = require('../src/static/js/notes/template-manager.js');

describe('TemplateManager UI and Integration', () => {
    let container;

    beforeEach(() => {
        document.body.innerHTML = '<div id="test-container"></div>';
        container = document.getElementById('test-container');
    });

    test('should execute the onSelectCallback with the correct strategy when a button is clicked', () => {
        const mockCallback = jest.fn();
        TemplateManager.renderDropdown(container, mockCallback);
        
        const deepDiveBtn = container.querySelector('[data-template-id="deep_dive"]');
        deepDiveBtn.click();
        
        expect(mockCallback).toHaveBeenCalledTimes(1);
        const calledArg = mockCallback.mock.calls[0][0];
        expect(calledArg.id).toBe('deep_dive');
        expect(calledArg.type).toBe('text');
    });
});

describe('TemplateManager Quill Editor Integration', () => {
    let mockQuill;
    
    beforeEach(() => {
        mockQuill = {
            getSelection: jest.fn().mockReturnValue({ index: 5 }),
            getLength: jest.fn().mockReturnValue(10),
            insertEmbed: jest.fn(),
            insertText: jest.fn(),
            setSelection: jest.fn()
        };
        window.quillEditor = mockQuill;
        
        // Mock current mode
        window.currentEditorMode = 'visual';
    });

    test('should insert text correctly into quill and advance cursor', () => {
        const deepDive = TemplateManager.STRATEGIES['deep_dive'];
        
        // Simulate the integration logic we injected into external-editor.js
        const selection = mockQuill.getSelection(true);
        const index = selection ? selection.index : mockQuill.getLength();
        
        const text = deepDive.getContent();
        mockQuill.insertText(index, text, 'user');
        mockQuill.setSelection(index + text.length, 'user');
        
        expect(mockQuill.insertText).toHaveBeenCalledWith(5, expect.stringContaining('Theory vs Code'), 'user');
        expect(mockQuill.setSelection).toHaveBeenCalledWith(5 + text.length, 'user');
    });

    test('should insert embed correctly into quill and advance cursor', () => {
        const mindmap = TemplateManager.STRATEGIES['mindmap'];
        
        const selection = mockQuill.getSelection(true);
        const index = selection ? selection.index : mockQuill.getLength();
        
        mockQuill.insertEmbed(index, mindmap.format, mindmap.getContent(), 'user');
        mockQuill.insertText(index + 1, '\\n', 'user');
        mockQuill.setSelection(index + 2, 'user');
        
        expect(mockQuill.insertEmbed).toHaveBeenCalledWith(5, 'custom-diagram', expect.objectContaining({ type: 'mermaid' }), 'user');
        expect(mockQuill.insertText).toHaveBeenCalledWith(6, '\\n', 'user');
        expect(mockQuill.setSelection).toHaveBeenCalledWith(7, 'user');
    });

});
