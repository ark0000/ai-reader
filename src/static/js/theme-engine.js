/**
 * Theme Engine
 * Handles theme switching, brightness adjustments, and font manipulation.
 * Preserves body classes that aren't theme-related (e.g. utility classes).
 * Now completely decoupled from specific document handlers (SOLID compliant).
 */

window.ThemeEngine = (function() {
  var root = document.documentElement;
  var debounceTimer = null;

  function debounce(func, wait) {
    return function() {
      var context = this, args = arguments;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function() {
        func.apply(context, args);
      }, wait);
    };
  }

  function init() {
    // Font selector
    var fontSel = document.getElementById('font-sel');
    if (fontSel) {
      fontSel.addEventListener('change', function(e) {
        var dp = document.getElementById('doc-pane'); if (dp) dp.style.setProperty('--reader-font', e.target.value); else root.style.setProperty('--reader-font', e.target.value);
      });
    }

    // Font size (Debounced)
    var szRange = document.getElementById('sz-range');
    if (szRange) {
      szRange.addEventListener('input', debounce(function(e) {
        var val = e.target.value + 'px';
        var dp = document.getElementById('doc-pane'); 
        if (dp) dp.style.setProperty('--reader-size', val); 
        else root.style.setProperty('--reader-size', val);
        document.querySelectorAll('.md-content').forEach(function(el){
          el.style.fontSize = val;
        });
      }, 50));
    }

    // Brightness (Debounced)
    var brightRange = document.getElementById('bright-range');
    var autoBrightCb = document.getElementById('auto-bright-cb');
    
    if (brightRange) {
      brightRange.addEventListener('input', debounce(function(e) {
        if (autoBrightCb && autoBrightCb.checked) {
          // Manual override turns off auto
          autoBrightCb.checked = false;
        }
        var val = e.target.value / 100;
        var dp = document.getElementById('doc-pane'); if (dp) dp.style.setProperty('--reader-brightness', val); else root.style.setProperty('--reader-brightness', val);
        
        // Train AI
        if (window.BrightnessManager) window.BrightnessManager.recordManualOverride(val);
      }, 50));
    }
    
    if (autoBrightCb) {
      autoBrightCb.addEventListener('change', function(e) {
        if (e.target.checked && window.BrightnessManager) {
          window.BrightnessManager.enableAuto(function(brightness) {
             if (brightRange) brightRange.value = brightness * 100;
             var dp = document.getElementById('doc-pane'); if (dp) dp.style.setProperty('--reader-brightness', brightness); else root.style.setProperty('--reader-brightness', brightness);
          });
        } else if (window.BrightnessManager) {
          window.BrightnessManager.disableAuto();
        }
      });
    }

    // Width selector
    var widthSel = document.getElementById('width-sel');
    if (widthSel) {
      widthSel.addEventListener('change', function(e) {
        var val = e.target.value;
        var dp = document.getElementById('doc-pane'); if (dp) dp.style.setProperty('--reader-width', val); else root.style.setProperty('--reader-width', val);
        document.querySelectorAll('.md-content, .pdf-status, .epub-viewer').forEach(function(el){
          el.style.maxWidth = val;
        });

        // Delegate to active handler instead of hardcoding PDF/EPUB checks
        const handler = window.getActiveHandler && window.getActiveHandler();
        if (handler && handler.layout && handler.layout.fitWidth) {
          handler.layout.fitWidth(val);
        }
      });
    }
  }

  /**
   * Apply theme by stripping only theme-related classes (th-*, dark)
   * and adding the correct ones. All other body classes are preserved.
   */
  function applyTheme(themeName) {
    // Clear inline color variables set by dynamic themes
    var root = document.documentElement;
    var dp = document.getElementById('doc-pane');
    
    ['--bg-body', '--bg-pane', '--bg-toolbar', '--bg-input', '--text-1', '--text-2', '--accent', '--border'].forEach(function(v) {
      root.style.removeProperty(v);
      if (dp) dp.style.removeProperty(v);
    });

    // Strip only theme classes
    var body = document.body;
    var classes = Array.from(body.classList);
    classes.forEach(function(cls) {
      if (cls.startsWith('th-') || cls === 'dark') {
        body.classList.remove(cls);
      }
    });

    if (dp) {
      var dpClasses = Array.from(dp.classList);
      dpClasses.forEach(function(cls) {
        if (cls.startsWith('th-') || cls === 'dark') {
          dp.classList.remove(cls);
        }
      });
    }

    // Add the new theme class
    if (themeName === 'light') {
      body.classList.add('th-light');
    } else {
      body.classList.add('th-' + themeName);
    }

    var isDark = (themeName === 'dark' || themeName === 'night');
    // Dark/night need the .dark utility class for prose inversion
    if (isDark) {
      body.classList.add('dark');
    }
    
    // Trigger Font Quality update if not preferring reduced motion
    if (window.updateFontFilters && (!window.matchMedia || !window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
        setTimeout(window.updateFontFilters, 50); // slight delay to allow background color to render
    }

    // Delegate theme injection to the active document handler
    const handler = window.getActiveHandler && window.getActiveHandler();
    if (handler && handler.theme && handler.theme.apply) {
      handler.theme.apply(null, isDark);
    }
  }

  function setTheme(t) {
    document.querySelectorAll('.theme-btn').forEach(function(b) {
      b.classList.remove('active');
    });
    var el = document.getElementById('th-' + t);
    if (el) el.classList.add('active');
    
    // Explicit user action to change main theme SHOULD reset reading themes
    if (window.safeStorage) {
        window.safeStorage.removeItem('aura-reading-theme');
        window.safeStorage.removeItem('aura-reading-theme-custom');
    }
    if (window.ReadingThemes && window.ReadingThemes.renderThemeGrid) {
        window.ReadingThemes.activeThemeId = null;
        window.ReadingThemes.renderThemeGrid();
    }
    
    applyTheme(t);
  }

  function applyDynamicTheme(cssVars, isCustomReadingTheme) {
    var dp = document.getElementById('doc-pane');
    if (!dp) return;
    
    var isDark = false;
    if (isCustomReadingTheme) {
      var dpClasses = Array.from(dp.classList);
      dpClasses.forEach(function(cls) {
        if (cls.startsWith('th-') || cls === 'dark') {
          dp.classList.remove(cls);
        }
      });
      
      // Calculate luminance to decide if document needs inversion
      var bg = cssVars['--bg-body'] || '#ffffff';
      if (bg.startsWith('#') && bg.length >= 7) {
         var r = parseInt(bg.substr(1,2), 16);
         var g = parseInt(bg.substr(3,2), 16);
         var b = parseInt(bg.substr(5,2), 16);
         var luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
         isDark = luma < 128;
      }
      
      dp.classList.add(isDark ? 'th-custom-dark' : 'th-custom-light');
      if (isDark) dp.classList.add('dark'); // Add dark utility class for prose locally
      dp.classList.add('th-custom-reading');
    }
    for (var key in cssVars) {
      if (cssVars.hasOwnProperty(key)) {
        dp.style.setProperty(key, cssVars[key]);
      }
    }
    
    // Delegate theme injection to active document handler
    const handler = window.getActiveHandler && window.getActiveHandler();
    if (handler && handler.theme && handler.theme.apply) {
      handler.theme.apply(cssVars, isDark);
    }
  }

  return {
    init: init,
    setTheme: setTheme,
    applyTheme: applyTheme,
    applyDynamicTheme: applyDynamicTheme
  };
})();

// Initialize when DOM is ready
document.addEventListener("DOMContentLoaded", function() {
  window.ThemeEngine.init();

  // Expose global methods for backward compatibility with inline HTML onclick attributes
  window.setTheme = window.ThemeEngine.setTheme;
  window.applyTheme = window.ThemeEngine.applyTheme;
});
