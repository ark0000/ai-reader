const fs = require('fs');
const path = require('path');

describe('AuraNoteDocumentHandler', () => {
  beforeEach(() => {
    // Mock the dependencies
    window.MarkdownDocumentHandler = jest.fn().mockImplementation(() => ({
      setupToolbar: jest.fn(),
      load: jest.fn().mockResolvedValue(true)
    }));
    window.docTitleEl = { textContent: '' };
    window.contentEl = { innerHTML: '' };
    window.registerDocumentHandler = jest.fn();

    // Load the handler file
    eval(fs.readFileSync(
      path.resolve(__dirname, '../src/static/js/auranote-handler.js'), 'utf8'
    ));
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  test('registers itself for json extension', () => {
    expect(window.registerDocumentHandler).toHaveBeenCalledWith('json', expect.any(window.AuraNoteDocumentHandler));
  });

  test('delegates setupToolbar to Markdown handler', () => {
    const handler = new window.AuraNoteDocumentHandler();
    handler.setupToolbar();
    expect(handler.mdHandler.setupToolbar).toHaveBeenCalled();
  });

  test('load parses auranote.json and delegates to Markdown handler', async () => {
    const handler = new window.AuraNoteDocumentHandler();
    const noteData = {
      title: 'Diagram Note',
      raw_text: '```mermaid\ngraph TD;\n```',
      content: 'HTML content'
    };
    
    // Create mock File object
    const file = {
      name: 'diagram.auranote.json',
      text: jest.fn().mockResolvedValue(JSON.stringify(noteData))
    };

    // Replace global File constructor for the test so we can track what is created
    const originalFile = global.File;
    global.File = jest.fn().mockImplementation(function(parts, filename, options) {
      this.parts = parts;
      this.filename = filename;
      this.options = options;
    });

    await handler.load(file);

    expect(window.docTitleEl.textContent).toBe('🌀 Diagram Note');
    expect(handler.mdHandler.load).toHaveBeenCalled();
    
    // Verify the file passed to Markdown handler
    const passedFile = handler.mdHandler.load.mock.calls[0][0];
    expect(passedFile.parts[0]).toBe('```mermaid\ngraph TD;\n```');
    expect(passedFile.filename).toBe('Diagram Note.md');
    expect(passedFile.options.type).toBe('text/markdown');

    global.File = originalFile;
  });

  test('load handles invalid JSON format gracefully', async () => {
    const handler = new window.AuraNoteDocumentHandler();
    const file = {
      text: jest.fn().mockResolvedValue('invalid-json')
    };

    await handler.load(file);

    expect(window.contentEl.innerHTML).toContain('Failed to load AuraNote: Invalid .auranote.json format');
    expect(handler.mdHandler.load).not.toHaveBeenCalled();
  });
});
