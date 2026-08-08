const fs = require('fs');
const path = require('path');

describe('Theme Engine', () => {
  beforeEach(() => {
    // 1. Setup a simple DOM in the global document provided by jest-environment-jsdom
    document.body.innerHTML = `
      <div id="ai-panel"></div>
      <div id="ai-hdr"></div>
      
      <!-- Custom Theme Inputs -->
      <input type="color" id="custom-theme-bg" value="#ffffff" />
      <input type="color" id="custom-theme-panel" value="#f0f0f0" />
      <input type="color" id="custom-theme-text" value="#000000" />
      <input type="color" id="custom-theme-accent" value="#ff0000" />
      <input type="checkbox" id="custom-theme-glass" />
      <button id="btn-surprise-mix"></button>
      
      <select id="theme-select">
        <option value="light">Light</option>
        <option value="deep-forest">Deep Forest</option>
        <option value="custom">Custom</option>
      </select>
    `;

    // 2. Setup mock ReadingExperience Events bus
    window.ReadingExperience = {
      Events: {
        emit: jest.fn(),
        on: jest.fn()
      }
    };

    // 3. Load theme-engine.js using eval to run it in the global context
    const jsPath = path.resolve(__dirname, '../src/static/js/theme-engine.js');
    const scriptContent = fs.readFileSync(jsPath, 'utf8');
    
    // Evaluate the IIFE in the current global context
    eval(scriptContent);
    
    // Manually call init since DOMContentLoaded already fired for JSDOM
    window.ReadingExperience.Theme.init();
  });

  test('Initialization creates window.ReadingExperience.Theme', () => {
    expect(window.ReadingExperience.Theme).toBeDefined();
    expect(typeof window.ReadingExperience.Theme.init).toBe('function');
  });

  test('Applying a curated theme sets CSS variables', () => {
    const Theme = window.ReadingExperience.Theme;
    
    // Apply Deep Forest theme
    Theme.applyCuratedTheme('deep-forest');
    
    // Verify root CSS variables were updated
    const rootStyle = document.documentElement.style;
    
    // Deep Forest has specific colors we expect
    expect(rootStyle.getPropertyValue('--bg-body')).toBe('#064E3B');
    expect(rootStyle.getPropertyValue('--text-1')).toBe('#ECFDF5');
    
    // Test dynamic variables (color-mix)
    const panelBg = rootStyle.getPropertyValue('--bg-panel');
    expect(panelBg).toContain('color-mix(in srgb, #0A5E48 50%, transparent)');
  });

  test('Surprise Mix generates custom colors', () => {
    // Click the surprise mix button
    const btn = document.getElementById('btn-surprise-mix');
    btn.click();
    
    const rootStyle = document.documentElement.style;
    const bgBody = rootStyle.getPropertyValue('--bg-body');
    const text1 = rootStyle.getPropertyValue('--text-1');
    
    // The colors are random, but they should be valid hex codes
    expect(bgBody).toMatch(/^#[0-9a-f]{6}$/i);
    expect(text1).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
