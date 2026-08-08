/**
 * Reading Themes & Font Presets
 * Implements a Strategy Pattern to decouple 10 curated reading themes
 * from the core ThemeEngine.
 */

window.ReadingThemes = {
  activeThemeId: null,

  themes: [
    {
      id: "deep-forest",
      name: "Deep Forest Focus",
      recommendedFor: "Long study, concentration, night",
      icon: "🌲",
      cssVars: {
        "--bg-body": "#064E3B",
        "--bg-pane": "#0A5E48",
        "--bg-toolbar": "#043F32",
        "--text-1": "#ECFDF5",
        "--text-2": "#A7F3D0",
        "--accent": "#10B981",
        "--border": "#065F46",
        "--reader-font": "'Atkinson Hyperlegible', Inter, sans-serif",
        "--reader-size": "17px",
        "--reader-lh": "1.55"
      }
    },
    {
      id: "warm-paper",
      name: "Warm Paper Study",
      recommendedFor: "General reading, evening, novels",
      icon: "📜",
      cssVars: {
        "--bg-body": "#F4ECD8",
        "--bg-pane": "#EFE6D0",
        "--bg-toolbar": "#E9DFCD",
        "--text-1": "#3B3024",
        "--text-2": "#6B4F35",
        "--accent": "#B88E5E",
        "--border": "#DBCFB6",
        "--reader-font": "'Source Serif 4', Georgia, serif",
        "--reader-size": "18px",
        "--reader-lh": "1.6"
      }
    },
    {
      id: "soft-morning",
      name: "Soft Morning Light",
      recommendedFor: "Morning reading and alertness",
      icon: "☀️",
      cssVars: {
        "--bg-body": "#FAFAF7",
        "--bg-pane": "#F3F3F0",
        "--bg-toolbar": "#EBEBE7",
        "--text-1": "#202124",
        "--text-2": "#174EA6",
        "--accent": "#1A73E8",
        "--border": "#DADCE0",
        "--reader-font": "'Roboto', 'Noto Sans', sans-serif",
        "--reader-size": "16px",
        "--reader-lh": "1.5"
      }
    },
    {
      id: "exam-contrast",
      name: "Exam Contrast",
      recommendedFor: "Revision, textbooks, technical PDFs",
      icon: "📝",
      cssVars: {
        "--bg-body": "#FFFFFF",
        "--bg-pane": "#F8F9FA",
        "--bg-toolbar": "#F1F3F4",
        "--text-1": "#111827",
        "--text-2": "#374151",
        "--accent": "#2563EB",
        "--border": "#E5E7EB",
        "--reader-font": "Arial, Helvetica, Inter, sans-serif",
        "--reader-size": "16px",
        "--reader-lh": "1.45"
      }
    },
    {
      id: "midnight-oled",
      name: "Midnight OLED",
      recommendedFor: "Dark rooms and OLED screens",
      icon: "🌙",
      cssVars: {
        "--bg-body": "#0B0F0E",
        "--bg-pane": "#000000",
        "--bg-toolbar": "#050706",
        "--text-1": "#DDEBE5",
        "--text-2": "#A0B5AC",
        "--accent": "#14B8A6",
        "--border": "#1A2622",
        "--reader-font": "'IBM Plex Sans', Roboto, sans-serif",
        "--reader-size": "17px",
        "--reader-lh": "1.55"
      }
    },
    {
      id: "solarized",
      name: "Solarized Concentration",
      recommendedFor: "Coding, research, long sessions",
      icon: "💻",
      cssVars: {
        "--bg-body": "#002B36",
        "--bg-pane": "#073642",
        "--bg-toolbar": "#001D24",
        "--text-1": "#839496",
        "--text-2": "#93A1A1",
        "--accent": "#268BD2",
        "--border": "#073642",
        "--reader-font": "'Source Sans 3', 'JetBrains Mono', sans-serif",
        "--reader-size": "16px",
        "--reader-lh": "1.55"
      }
    },
    {
      id: "blue-evening",
      name: "Blue Evening Calm",
      recommendedFor: "Evening reading and low brightness",
      icon: "🔵",
      cssVars: {
        "--bg-body": "#182235",
        "--bg-pane": "#1F2B42",
        "--bg-toolbar": "#101826",
        "--text-1": "#DCE7F5",
        "--text-2": "#91C8FF",
        "--accent": "#3B82F6",
        "--border": "#283854",
        "--reader-font": "'Lexend', 'Open Sans', sans-serif",
        "--reader-size": "17px",
        "--reader-lh": "1.6"
      }
    },
    {
      id: "amber-night",
      name: "Amber Night",
      recommendedFor: "Late-night reading with warm appearance",
      icon: "🟠",
      cssVars: {
        "--bg-body": "#24170D",
        "--bg-pane": "#2C1D11",
        "--bg-toolbar": "#1A1009",
        "--text-1": "#F8D9A7",
        "--text-2": "#F6B35B",
        "--accent": "#D97706",
        "--border": "#3D2A19",
        "--reader-font": "'Charis SIL', 'Source Serif 4', serif",
        "--reader-size": "18px",
        "--reader-lh": "1.6"
      }
    },
    {
      id: "reseda-relaxed",
      name: "Reseda Relaxed",
      recommendedFor: "Calm reading and casual browsing",
      icon: "🌿",
      cssVars: {
        "--bg-body": "#EEF2E8",
        "--bg-pane": "#E5EBE0",
        "--bg-toolbar": "#DDE3D6",
        "--text-1": "#26352A",
        "--text-2": "#31543A",
        "--accent": "#4CAF50",
        "--border": "#C7D4BF",
        "--reader-font": "'Nunito Sans', Lato, sans-serif",
        "--reader-size": "17px",
        "--reader-lh": "1.55"
      }
    },
    {
      id: "lavender-quiet",
      name: "Lavender Quiet",
      recommendedFor: "Reflective reading and low-stress mood",
      icon: "💜",
      cssVars: {
        "--bg-body": "#242033",
        "--bg-pane": "#2D2940",
        "--bg-toolbar": "#1B1726",
        "--text-1": "#EEE9FF",
        "--text-2": "#C4B5FD",
        "--accent": "#8B5CF6",
        "--border": "#3B3554",
        "--reader-font": "'Alegreya Sans', Merriweather, sans-serif",
        "--reader-size": "17px",
        "--reader-lh": "1.6"
      }
    }
  ],

  init: function() {
    this.renderThemeGrid();
    this.setupSurpriseMixer();

    // Check if we have a saved reading theme
    if (window.safeStorage) {
      const savedThemeId = window.safeStorage.getItem('aura-reading-theme');
      if (savedThemeId) {
        if (savedThemeId === 'custom') {
          this.applyCustomTheme(JSON.parse(window.safeStorage.getItem('aura-reading-theme-custom') || '{}'));
        } else {
          this.applyTheme(savedThemeId);
        }
      }
    }
  },

  applyTheme: function(id) {
    if (!id) return;
    const theme = this.themes.find(t => t.id === id);
    if (!theme) return;
    
    this.activeThemeId = id;
    if (window.safeStorage) {
      window.safeStorage.setItem('aura-reading-theme', id);
    }
    
    this.updateGridSelection(id);
    this.showThemeDetails(theme);

    if (!theme.cssVars['--bg-input']) {
      theme.cssVars['--bg-input'] = this.adjustColor(theme.cssVars['--bg-pane'], 10);
    }

    if (window.ThemeEngine && window.ThemeEngine.applyDynamicTheme) {
      window.ThemeEngine.applyDynamicTheme(theme.cssVars, true);
    } else {
      // Fallback if ThemeEngine method isn't ready
      for (const [key, value] of Object.entries(theme.cssVars)) {
        document.documentElement.style.setProperty(key, value);
      }
      document.body.classList.remove('th-dark', 'th-sepia', 'th-night');
      document.body.classList.add('th-custom-reading');
    }
    
    // Update toolbar font selector if it exists
    const fontSel = document.getElementById('font-sel');
    if (fontSel) {
       // Look for a matching option, or add one if missing
       const fontVal = theme.cssVars['--reader-font'];
       let found = false;
       for (let i=0; i<fontSel.options.length; i++) {
           if (fontSel.options[i].value === fontVal) {
               fontSel.selectedIndex = i;
               found = true; break;
           }
       }
       if (!found) {
           const opt = document.createElement('option');
           opt.value = fontVal;
           opt.textContent = fontVal.split(',')[0].replace(/'/g, '');
           fontSel.appendChild(opt);
           fontSel.value = fontVal;
       }
    }
  },

  applyCustomTheme: function(colors) {
    if (!colors.bg || !colors.text) return;
    
    this.activeThemeId = 'custom';
    if (window.safeStorage) {
      window.safeStorage.setItem('aura-reading-theme', 'custom');
      window.safeStorage.setItem('aura-reading-theme-custom', JSON.stringify(colors));
    }
    
    this.updateGridSelection('custom');
    
    const cssVars = {
      "--bg-body": colors.bg,
      "--bg-pane": colors.panel || this.adjustColor(colors.bg, 10),
      "--bg-toolbar": this.adjustColor(colors.bg, -10),
      "--bg-input": this.adjustColor(colors.bg, 15),
      "--text-1": colors.text,
      "--text-2": this.adjustColor(colors.text, -20),
      "--accent": colors.accent || "#8B5CF6",
      "--border": this.adjustColor(colors.bg, 20)
    };
    
    if (colors.font) {
        cssVars["--reader-font"] = colors.font;
    } else {
        const customFontSel = document.getElementById('custom-theme-font');
        if (customFontSel) {
            cssVars["--reader-font"] = customFontSel.value;
        }
    }
    
    if (colors.glass) {
        // Implement glassmorphism using the panel color
        const hex = cssVars["--bg-pane"];
        let r = parseInt(hex.substring(1,3), 16) || 0;
        let g = parseInt(hex.substring(3,5), 16) || 0;
        let b = parseInt(hex.substring(5,7), 16) || 0;
        cssVars["--bg-pane"] = `rgba(${r}, ${g}, ${b}, 0.65)`;
        
        // Add class to body to apply backdrop filters
        document.body.classList.add('glass-theme-active');
    } else {
        document.body.classList.remove('glass-theme-active');
    }
    
    const customTheme = {
      name: "Custom Surprise Mix",
      recommendedFor: "Your generated palette",
      cssVars: cssVars
    };
    this.showThemeDetails(customTheme);

    if (window.ThemeEngine && window.ThemeEngine.applyDynamicTheme) {
      window.ThemeEngine.applyDynamicTheme(cssVars, true);
    }
  },

  adjustColor: function(hex, percent) {
    // Basic brightness adjustment for hex colors
    let r = parseInt(hex.substring(1,3), 16);
    let g = parseInt(hex.substring(3,5), 16);
    let b = parseInt(hex.substring(5,7), 16);

    r = parseInt(r * (100 + percent) / 100);
    g = parseInt(g * (100 + percent) / 100);
    b = parseInt(b * (100 + percent) / 100);

    r = (r<255)?r:255;  
    g = (g<255)?g:255;  
    b = (b<255)?b:255;
    r = Math.max(0, r);
    g = Math.max(0, g);
    b = Math.max(0, b);

    const rs = r.toString(16).padStart(2, '0');
    const gs = g.toString(16).padStart(2, '0');
    const bs = b.toString(16).padStart(2, '0');
    return "#" + rs + gs + bs;
  },

  renderThemeGrid: function() {
    const container = document.getElementById('reading-theme-grid');
    if (!container) return;
    
    container.innerHTML = '';
    
    this.themes.forEach(theme => {
      const card = document.createElement('div');
      card.className = 'theme-grid-card';
      card.id = `theme-card-${theme.id}`;
      card.onclick = () => {
          // Close modal after selection on small screens or immediately if desired
          this.applyTheme(theme.id);
      };
      
      const swatch = document.createElement('div');
      swatch.className = 'theme-swatch';
      swatch.style.background = `linear-gradient(135deg, ${theme.cssVars['--bg-body']} 50%, ${theme.cssVars['--text-1']} 50%)`;
      swatch.innerHTML = `<span>${theme.icon}</span>`;
      
      const name = document.createElement('div');
      name.className = 'theme-name';
      
      const nameParts = theme.name.split(' ');
      if (nameParts.length > 2) {
         name.innerHTML = `${nameParts[0]}<br>${nameParts.slice(1).join(' ')}`;
      } else {
         name.textContent = theme.name;
      }
      
      card.appendChild(swatch);
      card.appendChild(name);
      container.appendChild(card);
    });
  },

  updateGridSelection: function(id) {
    document.querySelectorAll('.theme-grid-card').forEach(c => c.classList.remove('active'));
    if (id !== 'custom') {
      const activeCard = document.getElementById(`theme-card-${id}`);
      if (activeCard) activeCard.classList.add('active');
    }
  },

  showThemeDetails: function(theme) {
    const detailEl = document.getElementById('reading-theme-detail');
    if (!detailEl) return;
    
    detailEl.style.display = 'block';
    
    const fontInfo = theme.cssVars['--reader-font'] ? `Font: ${theme.cssVars['--reader-font'].split(',')[0].replace(/'/g, '')} ${theme.cssVars['--reader-size'] || ''}` : 'Font: Custom';
    
    detailEl.innerHTML = `
      <div style="font-weight: 600; color: var(--text-1);">${theme.name} <span style="float: right; color: var(--accent);">✓</span></div>
      <div style="font-size: 0.8rem; color: var(--text-2); margin-top: 4px;">${theme.icon || '🎲'} ${theme.recommendedFor}</div>
      <div style="font-size: 0.75rem; color: var(--text-2); margin-top: 4px;">${fontInfo}</div>
    `;
  },

  setupSurpriseMixer: function() {
    const btn = document.getElementById('btn-surprise-mix');
    if (!btn) return;
    
    btn.onclick = () => {
      const themes = [
          { bg: "#140A23", text: "#00FFC8" }, // Neon Cyberpunk
          { bg: "#050F1E", text: "#96DCFF" }, // Deep Ocean
          { bg: "#230F0A", text: "#FFC896" }, // Sunset Ember
          { bg: "#0F190F", text: "#B4FFB4" }, // Forest Moss
          { bg: "#190514", text: "#FF96DC" }, // Velvet Night
          { bg: "#1E190F", text: "#FFDC64" }  // Golden Hour
      ];
      
      const randomTheme = themes[Math.floor(Math.random() * themes.length)];
      
      const bgPicker = document.getElementById('custom-theme-bg');
      const textPicker = document.getElementById('custom-theme-text');
      if (bgPicker) bgPicker.value = randomTheme.bg;
      if (textPicker) textPicker.value = randomTheme.text;
      
      this.applyCustomTheme(randomTheme);
    };
    
    // Also bind custom color pickers
    const bgPicker = document.getElementById('custom-theme-bg');
    const panelPicker = document.getElementById('custom-theme-panel');
    const textPicker = document.getElementById('custom-theme-text');
    const accentPicker = document.getElementById('custom-theme-accent');
    const fontPicker = document.getElementById('custom-theme-font');
    const glassToggle = document.getElementById('custom-theme-glass');
    
    const applyFromPickers = () => {
        if (bgPicker && textPicker) {
            this.applyCustomTheme({ 
              bg: bgPicker.value, 
              panel: panelPicker ? panelPicker.value : '',
              text: textPicker.value,
              accent: accentPicker ? accentPicker.value : '',
              font: fontPicker ? fontPicker.value : '',
              glass: glassToggle ? glassToggle.checked : false
            });
        }
    };
    
    if (bgPicker) bgPicker.onchange = applyFromPickers;
    if (panelPicker) panelPicker.onchange = applyFromPickers;
    if (textPicker) textPicker.onchange = applyFromPickers;
    if (accentPicker) accentPicker.onchange = applyFromPickers;
    if (fontPicker) fontPicker.onchange = applyFromPickers;
    if (glassToggle) glassToggle.onchange = applyFromPickers;
  }
};

document.addEventListener('DOMContentLoaded', () => {
  window.ReadingThemes.init();
});
