const TemplateManager = require('../src/static/js/notes/template-manager.js');

describe('TemplateManager', () => {
    test('should return all registered strategies from getAvailableTemplates()', () => {
        const templates = TemplateManager.getAvailableTemplates();
        expect(templates.length).toBeGreaterThan(0);
        expect(templates.some(t => t.id === 'deep_dive')).toBe(true);
        expect(templates.some(t => t.id === 'mindmap')).toBe(true);
    });

    test('should correctly format a text strategy payload', () => {
        const templates = TemplateManager.getAvailableTemplates();
        const deepDive = templates.find(t => t.id === 'deep_dive');
        
        expect(deepDive).toBeDefined();
        expect(deepDive.type).toBe('text');
        
        const content = deepDive.getContent();
        expect(typeof content).toBe('string');
        expect(content).toContain('Theory vs Code');
    });

    test('should correctly format an embed strategy payload', () => {
        const templates = TemplateManager.getAvailableTemplates();
        const mindmap = templates.find(t => t.id === 'mindmap');
        
        expect(mindmap).toBeDefined();
        expect(mindmap.type).toBe('embed');
        expect(mindmap.format).toBe('custom-diagram');
        
        const content = mindmap.getContent();
        expect(typeof content).toBe('object');
        expect(content.code).toContain('mindmap');
        expect(content.type).toBe('mermaid');
    });
});
