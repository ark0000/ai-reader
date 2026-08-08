const fs = require('fs');
const path = require('path');

describe('Font Engine', () => {
  beforeEach(() => {
    // 1. Setup a simple DOM
    document.body.innerHTML = `
      <select id="font-sel">
        <option value="system-ui">System</option>
        <option value="serif">Serif</option>
      </select>
      
      <input type="range" id="sz-range" value="18" />
      
      <select id="width-sel">
        <option value="800px">800px</option>
        <option value="max-content">Max</option>
      </select>
      
      <div id="font-size-controls"></div>
      
      <div class="md-content"></div>
      <div class="pdf-status"></div>
    `;

    // 2. Setup mock ReadingExperience Events bus
    window.ReadingExperience = {
      Events: {
        emit: jest.fn(),
        on: jest.fn()
      }
    };

    // 3. Load font-engine.js
    const jsPath = path.resolve(__dirname, '../src/static/js/font-engine.js');
    const scriptContent = fs.readFileSync(jsPath, 'utf8');
    eval(scriptContent);
    
    // Initialize
    window.ReadingExperience.Font.init();
  });

  test('Initialization creates window.ReadingExperience.Font', () => {
    expect(window.ReadingExperience.Font).toBeDefined();
    expect(typeof window.ReadingExperience.Font.init).toBe('function');
  });

  test('Changing font size updates state and CSS variable', () => {
    const szRange = document.getElementById('sz-range');
    
    // Change font size
    szRange.value = "24";
    szRange.dispatchEvent(new Event('input'));
    
    // Check CSS var
    expect(document.documentElement.style.getPropertyValue('--reader-size')).toBe('24px');
    
    // Event should be emitted
    expect(window.ReadingExperience.Events.emit).toHaveBeenCalledWith('font:changed', expect.objectContaining({ sizePx: 24 }));
  });

  test('disableFontForPdf hides the font controls', () => {
    const Font = window.ReadingExperience.Font;
    const controls = document.getElementById('font-size-controls');
    
    Font.disableFontForPdf(true);
    expect(controls.style.display).toBe('none');
    
    Font.disableFontForPdf(false);
    expect(controls.style.display).toBe('inline-flex');
  });
});
