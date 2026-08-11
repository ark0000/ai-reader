/**
 * Font Engine (Typography & Layout)
 * Handles font family, size, line-spacing, and layout width.
 * Single Responsibility Principle (SRP): Only manages layout/fonts, not colors/themes.
 */
window.ReadingExperience.Font = (function(Events) {
  const root = document.documentElement;
  
  // State
  const state = {
    family: 'system-ui',
    sizePx: 18,
    widthMax: 'max-content'
  };

  function init() {
    // Font Family
    const fontSel = document.getElementById('font-sel');
    if (fontSel) {
      fontSel.addEventListener('change', function(e) {
        state.family = e.target.value;
        root.style.setProperty('--reader-font', state.family);
        Events.emit('font:changed', state);
      });
      state.family = fontSel.value;
      root.style.setProperty('--reader-font', state.family);
    }

    // Font Size
    const szRange = document.getElementById('sz-range');
    if (szRange) {
      szRange.addEventListener('input', function(e) {
        state.sizePx = parseInt(e.target.value, 10);
        root.style.setProperty('--reader-size', state.sizePx + 'px');
        document.querySelectorAll('.md-content').forEach(function(el){
          el.style.fontSize = state.sizePx + 'px';
        });
        Events.emit('font:changed', state);
      });
      state.sizePx = parseInt(szRange.value, 10);
      root.style.setProperty('--reader-size', state.sizePx + 'px');
      document.querySelectorAll('.md-content').forEach(function(el){
        el.style.fontSize = state.sizePx + 'px';
      });
    }

    // Layout Width
    const widthSel = document.getElementById('width-sel');
    if (widthSel) {
      widthSel.addEventListener('change', function(e) {
        state.widthMax = e.target.value;
        root.style.setProperty('--reader-width', state.widthMax);
        
        // Update specific layout nodes dynamically
        document.querySelectorAll('.md-content, .pdf-status, .epub-viewer').forEach(function(el){
          el.style.maxWidth = state.widthMax;
        });

        Events.emit('layout:changed', state);
      });
      state.widthMax = widthSel.value;
    }
    
    Events.emit('font:changed', state);
    Events.emit('layout:changed', state);
  }

  function disableFontForPdf(isDisabled) {
    const controls = document.getElementById('font-size-controls');
    if (controls) {
      controls.style.display = isDisabled ? 'none' : 'inline-flex';
    }
  }

  return {
    init,
    disableFontForPdf,
    getState: () => ({ ...state })
  };
})(window.ReadingExperience.Events);
