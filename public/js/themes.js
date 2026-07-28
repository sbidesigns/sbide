/**
 * SBIDE - Theme Manager
 * Handles theme switching, persistence, and CSS custom property updates
 */

const IDEThemes = (() => {
  // ============================================
  // Available Themes
  // ============================================
  
  const THEMES = {
    // ---------- LIGHT (6) ----------
    unthemed: {
      name: 'Default',
      description: 'Pure white + indigo (corporate clean)',
      isDark: false,
      cssClass: 'theme-unthemed'
    },
    default: {
      name: 'Indigo',
      description: 'Lavender-tinted white + violet (Linear-style)',
      isDark: false,
      cssClass: 'theme-default'
    },
    light: {
      name: 'Paper',
      description: 'Warm cream + amber (Notion warm paper)',
      isDark: false,
      cssClass: 'theme-light'
    },
    lightgrey: {
      name: 'Light Grey',
      description: 'Soft grey + teal (calm professional)',
      isDark: false,
      cssClass: 'theme-lightgrey'
    },
    slate: {
      name: 'Slate',
      description: 'Cool gray monochrome (no color accent)',
      isDark: false,
      cssClass: 'theme-slate'
    },
    azure: {
      name: 'Azure',
      description: 'Microsoft Fluent gray + fluent blue',
      isDark: false,
      cssClass: 'theme-azure'
    },

    // ---------- DARK (6) ----------
    dark: {
      name: 'Dark',
      description: 'Slate-navy + indigo (VS Code Dark+)',
      isDark: true,
      cssClass: 'theme-dark'
    },
    midnight: {
      name: 'Midnight',
      description: 'Tokyo-Night deep purple + violet',
      isDark: true,
      cssClass: 'theme-midnight'
    },
    darkgrey: {
      name: 'Dark Grey',
      description: 'Charcoal + cyan (cool professional dark)',
      isDark: true,
      cssClass: 'theme-darkgrey'
    },
    graphite: {
      name: 'Graphite',
      description: 'Warm dark + amber (JetBrains Darcula)',
      isDark: true,
      cssClass: 'theme-graphite'
    },
    carbon: {
      name: 'Carbon',
      description: 'IBM Carbon pure black + IBM blue',
      isDark: true,
      cssClass: 'theme-carbon'
    },
    black: {
      name: 'Black',
      description: 'Pure black + bright cyan (high-tech terminal)',
      isDark: true,
      cssClass: 'theme-black'
    }
  };

  // Legacy theme ID aliases — kept empty as a safety net. If a saved
  // theme ID isn't in THEMES (e.g. an old experimental name removed in
  // a future cleanup), it falls back to 'unthemed' rather than crashing.
  const THEME_ALIASES = {};

  // Current active theme
  let currentTheme = 'unthemed';

  // ============================================
  // Theme Application
  // ============================================
  
  /**
   * Apply a theme by updating document attributes and classes
   */
  function applyTheme(themeId) {
    // Resolve legacy theme IDs to their current equivalent
    if (themeId && THEME_ALIASES[themeId]) {
      themeId = THEME_ALIASES[themeId];
    }
    const theme = THEMES[themeId];
    if (!theme) {
      console.warn(`Theme "${themeId}" not found, falling back to default`);
      return applyTheme('unthemed');
    }

    const html = document.documentElement;
    
    // Remove all existing theme classes
    Object.values(THEMES).forEach(t => {
      html.classList.remove(t.cssClass);
    });
    
    // Add new theme class
    html.classList.add(theme.cssClass);
    
    // Update data attribute
    html.setAttribute('data-theme', themeId);
    
    // Set data-theme-mode so CSS rules can target all dark (or all light)
    // themes with a single selector: [data-theme-mode="dark"] .X { ... }
    // Without this, dark-theme overrides in styles.css only applied to
    // [data-theme="dark"] and [data-theme="carbon"], making other dark
    // themes (midnight, graphite, darkgrey, black) look broken.
    html.setAttribute('data-theme-mode', theme.isDark ? 'dark' : 'light');
    
    // Update meta theme-color for mobile browsers
    updateMetaThemeColor(theme.isDark);
    
    // Store current theme
    currentTheme = themeId;
    
    // Persist to state
    if (window.IDEState) {
      IDEState.updateSettings({ theme: themeId });
    }
    
    // Dispatch custom event for components to react
    window.dispatchEvent(new CustomEvent('themechange', { 
      detail: { themeId, theme } 
    }));
    
    console.log(`Applied theme: ${theme.name}`);
  }

  /**
   * Update meta theme-color tag for mobile browsers
   */
  function updateMetaThemeColor(isDark) {
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }

    // Read the actual --color-bg-primary from the active theme so the mobile
    // browser chrome matches the page background. Falls back to a sensible default.
    let color = isDark ? '#1a1a2e' : '#ffffff';
    try {
      const computed = getComputedStyle(document.documentElement)
        .getPropertyValue('--color-bg-primary')
        .trim();
      if (computed) color = computed;
    } catch (e) { /* ignore */ }

    meta.content = color;
  }

  // ============================================
  // Theme Initialization
  // ============================================
  
  /**
   * Initialize theme from saved preference or system default
   */
  function init() {
    // Try to get saved theme from state
    let savedTheme = 'unthemed';
    
    if (window.IDEState && IDEState.get('settings')) {
      savedTheme = IDEState.get('settings').theme || 'unthemed';
    }
    
    // Check for system dark mode preference if no saved theme
    if (savedTheme === 'unthemed' && window.matchMedia) {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      if (prefersDark) {
        savedTheme = 'dark';
      }
    }
    
    applyTheme(savedTheme);
    
    // Listen for system theme changes
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)')
        .addEventListener('change', (e) => {
          // Only auto-switch if user hasn't manually set a preference
          const settings = IDEState?.get('settings');
          if (!settings || !settings.theme || settings.theme === 'unthemed') {
            applyTheme(e.matches ? 'dark' : 'unthemed');
          }
        });
    }
  }

  // ============================================
  // Theme Selection UI
  // ============================================
  
  /**
   * Get all available themes as array
   */
  function getAllThemes() {
    return Object.entries(THEMES).map(([id, theme]) => ({
      id,
      ...theme
    }));
  }

  /**
   * Get current theme info
   */
  function getCurrentTheme() {
    return {
      id: currentTheme,
      ...THEMES[currentTheme]
    };
  }

  /**
   * Create theme selector dropdown/popover content
   */
  function createThemeSelector(container) {
    if (!container) return;
    
    container.innerHTML = '';
    
    const header = document.createElement('div');
    header.className = 'theme-selector-header';
    header.textContent = 'Select Theme';
    container.appendChild(header);
    
    const grid = document.createElement('div');
    grid.className = 'theme-grid';
    container.appendChild(grid);
    
    Object.entries(THEMES).forEach(([id, theme]) => {
      const item = document.createElement('button');
      item.className = `theme-option ${id === currentTheme ? 'active' : ''}`;
      item.setAttribute('data-theme-id', id);
      item.setAttribute('aria-label', `Apply ${theme.name} theme`);
      item.setAttribute('title', theme.description);
      
      // Preview swatch
      const swatch = document.createElement('span');
      swatch.className = `theme-swatch ${id}`;
      
      // Label
      const label = document.createElement('span');
      label.className = 'theme-label';
      label.textContent = theme.name;
      
      // Active indicator
      if (id === currentTheme) {
        const check = document.createElement('span');
        check.className = 'theme-active-indicator';
        check.innerHTML = IDEUtils?.Icons?.check || '✓';
        item.appendChild(check);
      }
      
      item.appendChild(swatch);
      item.appendChild(label);
      
      item.addEventListener('click', () => {
        applyTheme(id);
        
        // Update active states
        grid.querySelectorAll('.theme-option').forEach(el => {
          el.classList.toggle('active', el.dataset.themeId === id);
          
          // Update indicator
          let indicator = el.querySelector('.theme-active-indicator');
          if (!indicator && el.dataset.themeId === id) {
            indicator = document.createElement('span');
            indicator.className = 'theme-active-indicator';
            indicator.innerHTML = IDEUtils?.Icons?.check || '✓';
            el.prepend(indicator);
          } else if (indicator && el.dataset.themeId !== id) {
            indicator.remove();
          }
        });
        
        if (IDEUtils) {
          IDEUtils.showToast(`Theme changed to ${theme.name}`, 'success');
        }
      });
      
      grid.appendChild(item);
    });
  }

  // ============================================
  // Font Scale Utilities
  // ============================================
  
  /**
   * Set font scale factor
   */
  function setFontScale(scale) {
    const clampedScale = Math.max(0.8, Math.min(1.4, scale));
    document.documentElement.style.setProperty('--font-scale', clampedScale);
    
    if (window.IDEState) {
      IDEState.updateSettings({ fontScale: clampedScale });
    }
  }

  /**
   * Get current font scale
   */
  function getFontScale() {
    const scale = getComputedStyle(document.documentElement)
      .getPropertyValue('--font-scale');
    return parseFloat(scale) || 1;
  }

  /**
   * Increase font scale
   */
  function increaseFontScale() {
    const current = getFontScale();
    setFontScale(current + 0.1);
  }

  /**
   * Decrease font scale
   */
  function decreaseFontScale() {
    const current = getFontScale();
    setFontScale(current - 0.1);
  }

  /**
   * Reset font scale to default
   */
  function resetFontScale() {
    setFontScale(1);
  }

  // ============================================
  // Public API
  // ============================================
  
  /**
   * Resolve a theme ID (possibly legacy like 'graphite' or 'midnight')
   * to its current equivalent. Returns the input unchanged if no alias.
   */
  function resolveThemeId(themeId) {
    if (!themeId) return 'unthemed';
    return THEME_ALIASES[themeId] || (THEMES[themeId] ? themeId : 'unthemed');
  }
  
  return {
    // Core functions
    applyTheme,
    init,
    getAllThemes,
    getCurrentTheme,
    createThemeSelector,
    resolveThemeId,
    
    // Font utilities
    setFontScale,
    getFontScale,
    increaseFontScale,
    decreaseFontScale,
    resetFontScale,
    
    // Constants
    THEMES,
    THEME_ALIASES
  };
})();

// Export for use in other modules
window.IDEThemes = IDEThemes;
