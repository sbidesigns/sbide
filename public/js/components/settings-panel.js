/**
 * SBIDE - Settings Panel Component
 * Manages theme selection, font size, and application settings
 */

const SettingsPanelComponent = (() => {
  // ============================================
  // State
  // ============================================
  
  let isOpen = false;
  let modal = null;
  
  // Available themes with preview colors.
  // MUST stay in sync with /js/themes.js THEMES registry and /css/themes.css
  // palettes — these preview swatches show the user what they'll get.
  const themes = [
    // ---------- LIGHT (6) ----------
    { id: 'unthemed',  name: 'Default',    preview: { bg: '#ffffff', accent: '#4f46e5', border: '#e5e7eb' }, dark: false },
    { id: 'default',   name: 'Indigo',     preview: { bg: '#fafafe', accent: '#7c3aed', border: '#d9d6f5' }, dark: false },
    { id: 'light',     name: 'Paper',      preview: { bg: '#faf6f0', accent: '#b45309', border: '#e0d4bc' }, dark: false },
    { id: 'lightgrey', name: 'Light Grey', preview: { bg: '#f3f4f6', accent: '#0d9488', border: '#d1d5db' }, dark: false },
    { id: 'slate',     name: 'Slate',      preview: { bg: '#f8fafc', accent: '#334155', border: '#cbd5e1' }, dark: false },
    { id: 'azure',     name: 'Azure',      preview: { bg: '#faf9f8', accent: '#0078d4', border: '#d2d0ce' }, dark: false },
    // ---------- DARK (6) ----------
    { id: 'dark',      name: 'Dark',       preview: { bg: '#0f172a', accent: '#818cf8', border: '#334155' }, dark: true  },
    { id: 'midnight',  name: 'Midnight',   preview: { bg: '#1a1b26', accent: '#bb9af7', border: '#2d3149' }, dark: true  },
    { id: 'darkgrey',  name: 'Dark Grey',  preview: { bg: '#2d2d2d', accent: '#06b6d4', border: '#4a4a4a' }, dark: true  },
    { id: 'graphite',  name: 'Graphite',   preview: { bg: '#1c1a17', accent: '#d97706', border: '#3a342c' }, dark: true  },
    { id: 'carbon',    name: 'Carbon',     preview: { bg: '#161616', accent: '#0f62fe', border: '#393939' }, dark: true  },
    { id: 'black',     name: 'Black',      preview: { bg: '#000000', accent: '#22d3ee', border: '#262626' }, dark: true  }
  ];
  
  // Font scale options
  const fontScales = [
    { value: 0.875, label: 'XS', description: 'Extra Small' },
    { value: 0.9375, label: 'SM', description: 'Small' },
    { value: 1, label: 'MD', description: 'Medium (Default)' },
    { value: 1.0625, label: 'LG', description: 'Large' },
    { value: 1.125, label: 'XL', description: 'Extra Large' },
    { value: 1.25, label: 'XXL', description: 'Very Large' }
  ];

  // ============================================
  // Initialization
  // ============================================
  
  function init() {
    // Listen for open settings events
    document.addEventListener('click', (e) => {
      if (e.target.closest('#settings-btn')) {
        open();
      }
    });
    
    // Load saved settings
    loadSettings();
    
    // Subscribe to state changes
    if (window.IDEState) {
      IDEState.subscribe((state) => {
        if (state.settings) {
          syncUIWithSettings(state.settings);
        }
      });
    }
  }

  // ============================================
  // Modal Management
  // ============================================
  
  function open() {
    if (isOpen) return;
    isOpen = true;
    
    renderModal();
  }
  
  function close() {
    if (!isOpen) return;
    isOpen = false;
    
    if (modal) {
      modal.remove();
      modal = null;
    }
  }

  /**
   * Render the settings modal
   */
  function renderModal() {
    modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'settings-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'settings-modal-title');
    
    const currentSettings = getSettings();
    // Resolve legacy theme IDs (graphite, midnight, etc.) to their current
    // equivalent so the picker highlights the correct active theme.
    const activeThemeId = window.IDEThemes
      ? IDEThemes.resolveThemeId(currentSettings.theme)
      : currentSettings.theme;
    
    modal.innerHTML = `
      <div class="modal modal-lg">
        <div class="modal-header">
          <h2 class="modal-title" id="settings-modal-title">Settings</h2>
          <button class="icon-btn settings-close-btn" aria-label="Close settings">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        
        <div class="modal-body">
          <!-- Theme Section -->
          <section class="settings-section">
            <h3 class="settings-section-title">Theme</h3>
            <p class="settings-section-description">Choose your preferred color scheme</p>
            
            <div class="theme-grid" role="radiogroup" aria-label="Theme selection">
              ${themes.map(theme => `
                <button 
                  class="theme-option ${activeThemeId === theme.id ? 'active' : ''}"
                  data-theme-id="${theme.id}"
                  role="radio"
                  aria-checked="${activeThemeId === theme.id}"
                  title="${theme.name}"
                >
                  <span 
                    class="theme-preview" 
                    style="
                      background-color: ${theme.preview.bg}; 
                      border-color: ${theme.preview.border};
                      ${theme.dark ? 'color: #f1f5f9;' : ''}
                    "
                  >
                    <span class="theme-preview-accent" style="background-color: ${theme.preview.accent}"></span>
                  </span>
                  <span class="theme-name">${theme.name}</span>
                  ${activeThemeId === theme.id ? '<span class="theme-check">✓</span>' : ''}
                </button>
              `).join('')}
            </div>
          </section>
          
          <!-- Font Size Section -->
          <section class="settings-section">
            <h3 class="settings-section-title">Font Size</h3>
            <p class="settings-section-description">Adjust text size throughout the interface</p>
            
            <div class="font-scale-options" role="radiogroup" aria-label="Font size selection">
              ${fontScales.map(scale => `
                <button 
                  class="font-scale-option ${Math.abs(currentSettings.fontScale - scale.value) < 0.01 ? 'active' : ''}"
                  data-font-scale="${scale.value}"
                  role="radio"
                  aria-checked="${Math.abs(currentSettings.fontScale - scale.value) < 0.01}"
                  title="${scale.label} - ${scale.description}"
                >
                  <span class="font-scale-label">${scale.label}</span>
                  <span class="font-scale-desc">${scale.description}</span>
                </button>
              `).join('')}
            </div>
            
            <div class="font-scale-preview">
              <p style="font-size: calc(1rem * ${currentSettings.fontScale})">Preview text at current size</p>
            </div>
          </section>
          
          <!-- Toggles Section -->
          <section class="settings-section">
            <h3 class="settings-section-title">Preferences</h3>
            
            <div class="settings-toggles">
              <label class="toggle-item">
                <div class="toggle-info">
                  <span class="toggle-label">Auto ZIP Backup</span>
                  <span class="toggle-description">Automatically create ZIP archives when saving versions</span>
                </div>
                <input type="checkbox" class="toggle-input" id="setting-zip-backup" ${currentSettings.autoCreateZipBackup ? 'checked' : ''} />
                <span class="toggle-switch"></span>
              </label>
              
              <label class="toggle-item">
                <div class="toggle-info">
                  <span class="toggle-label">Notifications</span>
                  <span class="toggle-description">Show desktop notifications for AI responses</span>
                </div>
                <input type="checkbox" class="toggle-input" id="setting-notifications" ${currentSettings.showNotifications ? 'checked' : ''} />
                <span class="toggle-switch"></span>
              </label>
              
              <label class="toggle-item">
                <div class="toggle-info">
                  <span class="toggle-label">Auto-checkpoint</span>
                  <span class="toggle-description">Create automatic checkpoints after each AI response</span>
                </div>
                <input type="checkbox" class="toggle-input" id="setting-auto-checkpoint" ${currentSettings.autoCheckpoint ? 'checked' : ''} />
                <span class="toggle-switch"></span>
              </label>
              
              <label class="toggle-item">
                <div class="toggle-info">
                  <span class="toggle-label">Sound effects</span>
                  <span class="toggle-description">Play subtle audio cues for saves, errors, and AI responses</span>
                </div>
                <input type="checkbox" class="toggle-input" id="setting-sound-effects" ${currentSettings.soundEffects ? 'checked' : ''} />
                <span class="toggle-switch"></span>
              </label>
            </div>
          </section>
          
          <!-- Editor Section (ported from v1 IDE) -->
          <section class="settings-section">
            <h3 class="settings-section-title">Editor</h3>
            <p class="settings-section-description">Configure code editor behavior</p>
            
            <div class="settings-toggles">
              <label class="toggle-item">
                <div class="toggle-info">
                  <span class="toggle-label">Word Wrap</span>
                  <span class="toggle-description">Soft-wrap long lines in the editor instead of horizontal scrolling</span>
                </div>
                <input type="checkbox" class="toggle-input" id="setting-word-wrap" ${currentSettings.wordWrap ? 'checked' : ''} />
                <span class="toggle-switch"></span>
              </label>
              
              <label class="toggle-item">
                <div class="toggle-info">
                  <span class="toggle-label">Line Numbers</span>
                  <span class="toggle-description">Show a line-number gutter alongside the editor</span>
                </div>
                <input type="checkbox" class="toggle-input" id="setting-line-numbers" ${currentSettings.lineNumbers ? 'checked' : ''} />
                <span class="toggle-switch"></span>
              </label>
              
              <label class="toggle-item">
                <div class="toggle-info">
                  <span class="toggle-label">Auto-save</span>
                  <span class="toggle-description">Automatically persist file changes after a brief idle period</span>
                </div>
                <input type="checkbox" class="toggle-input" id="setting-auto-save" ${currentSettings.autoSave ? 'checked' : ''} />
                <span class="toggle-switch"></span>
              </label>
            </div>
          </section>
          
          <!-- AI / System Prompt Section -->
          <section class="settings-section">
            <h3 class="settings-section-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -2px; margin-right: 6px;">
                <path d="M12 2a10 10 0 1 0 10 10H12V2z"/><path d="M12 2a10 10 0 0 1 10 10"/><circle cx="12" cy="12" r="4"/><path d="M12 8v4"/>
              </svg>
              System Prompt
            </h3>
            <p class="settings-section-description">Set the master system prompt that defines AI behavior for all sessions. This acts as the base instruction layer.</p>
            
            <div class="system-prompt-editor">
              <div class="system-prompt-header">
                <label for="system-prompt-textarea" class="system-prompt-label">Global Master Prompt</label>
                <div class="system-prompt-actions">
                  <button type="button" class="btn btn-xs btn-outline reset-prompt-btn" title="Reset to default prompt">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
                    </svg>
                    Reset
                  </button>
                  <button type="button" class="btn btn-xs btn-outline expand-prompt-btn" title="Expand to full screen">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
                    </svg>
                    Expand
                  </button>
                </div>
              </div>
              <textarea 
                id="system-prompt-textarea" 
                class="system-prompt-textarea"
                placeholder="Enter your system prompt here...\n\nThis prompt will be prepended to all AI conversations as the system instruction.\nExample: 'You are an expert coding assistant...'"
                rows="8"
                spellcheck="true"
              >${escapeHtml(currentSettings.systemPrompt || '')}</textarea>
              <div class="system-prompt-footer">
                <span class="prompt-char-count"><span id="prompt-char-count">0</span> characters</span>
                <span class="prompt-hint">Variables: {{project}}, {{file}}, {{language}}</span>
              </div>
            </div>
            
            <div class="system-prompt-presets">
              <span class="presets-label">Quick Templates:</span>
              <div class="presets-list">
                <button type="button" class="preset-btn" data-prompt="coding-assistant">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
                  Coding Assistant
                </button>
                <button type="button" class="preset-btn" data-prompt="code-reviewer">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                  Code Reviewer
                </button>
                <button type="button" class="preset-btn" data-prompt="documentation">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>
                  Documentation
                </button>
                <button type="button" class="preset-btn" data-prompt="debugger">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
                  Debugger
                </button>
              </div>
            </div>
          </section>
          
          <!-- Keyboard Shortcuts Reference -->
          <section class="settings-section">
            <h3 class="settings-section-title">Keyboard Shortcuts</h3>
            <div class="shortcuts-list">
              <div class="shortcut-item">
                <kbd>Ctrl</kbd> + <kbd>S</kbd>
                <span>Save file</span>
              </div>
              <div class="shortcut-item">
                <kbd>Ctrl</kbd> + <kbd>F</kbd>
                <span>Find in file</span>
              </div>
              <div class="shortcut-item">
                <kbd>Ctrl</kbd> + <kbd>N</kbd>
                <span>New file</span>
              </div>
              <div class="shortcut-item">
                <kbd>Ctrl</kbd> + <kbd>/</kbd>
                <span>Cycle theme</span>
              </div>
              <div class="shortcut-item">
                <kbd>Escape</kbd>
                <span>Close dialog/panel</span>
              </div>
            </div>
          </section>
        </div>
        
        <div class="modal-footer">
          <button class="btn btn-outline reset-settings-btn">Reset to Defaults</button>
          <button class="btn btn-primary save-settings-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            Save Settings
          </button>
        </div>
      </div>
    `;
    
    // Wire up event listeners
    wireUpModalEvents(modal);
    
    document.body.appendChild(modal);
    
    // Focus trap management
    modal.querySelector('.settings-close-btn').focus();
  }
  
  /**
   * Wire up all modal event listeners
   */
  function wireUpModalEvents(modalEl) {
    // Close button
    modalEl.querySelector('.settings-close-btn').addEventListener('click', close);
    
    // Click outside to close
    modalEl.addEventListener('click', (e) => {
      if (e.target === modalEl) close();
    });
    
    // Escape key
    modalEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });
    
    // Theme selection
    modalEl.querySelectorAll('.theme-option').forEach(btn => {
      btn.addEventListener('click', () => {
        selectTheme(btn.dataset.themeId);
      });
    });
    
    // Font scale selection
    modalEl.querySelectorAll('.font-scale-option').forEach(btn => {
      btn.addEventListener('click', () => {
        setFontScale(parseFloat(btn.dataset.fontScale));
      });
    });
    
    // Toggle switches
    modalEl.querySelectorAll('.toggle-input').forEach(toggle => {
      toggle.addEventListener('change', () => {
        updateToggleSetting(toggle.id, toggle.checked);
      });
    });
    
    // System prompt textarea
    const promptTextarea = modalEl.querySelector('#system-prompt-textarea');
    if (promptTextarea) {
      const charCount = modalEl.querySelector('#prompt-char-count');
      
      // Update character count on input
      promptTextarea.addEventListener('input', () => {
        if (charCount) charCount.textContent = promptTextarea.value.length;
        modal.dataset.systemPrompt = promptTextarea.value;
      });
      
      // Initialize character count
      if (charCount) charCount.textContent = promptTextarea.value.length;
      
      // Reset button
      modalEl.querySelector('.reset-prompt-btn')?.addEventListener('click', () => {
        promptTextarea.value = getDefaultSystemPrompt();
        if (charCount) charCount.textContent = promptTextarea.value.length;
        modal.dataset.systemPrompt = promptTextarea.value;
        if (IDEUtils) IDEUtils.showToast('System prompt reset to default', 'info');
      });
      
      // Expand button
      modalEl.querySelector('.expand-prompt-btn')?.addEventListener('click', () => {
        openExpandedPromptEditor(promptTextarea.value, (newValue) => {
          promptTextarea.value = newValue;
          if (charCount) charCount.textContent = promptTextarea.value.length;
          modal.dataset.systemPrompt = newValue;
        });
      });
      
      // Preset buttons
      modalEl.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const preset = getPresetPrompt(btn.dataset.prompt);
          if (preset) {
            promptTextarea.value = preset;
            if (charCount) charCount.textContent = promptTextarea.value.length;
            modal.dataset.systemPrompt = preset;
            if (IDEUtils) IDEUtils.showToast(`Applied "${btn.textContent.trim()}" template`, 'success');
          }
        });
      });
    }
    
    // Save button
    modalEl.querySelector('.save-settings-btn').addEventListener('click', () => {
      saveSettings();
      close();
      if (IDEUtils) IDEUtils.showToast('Settings saved', 'success');
    });
    
    // Reset button
    modalEl.querySelector('.reset-settings-btn').addEventListener('click', () => {
      if (confirm('Reset all settings to defaults?')) {
        resetToDefaults();
        renderModal(); // Re-render with defaults
        if (IDEUtils) IDEUtils.showToast('Settings reset to defaults', 'info');
      }
    });
  }

  // ============================================
  // Settings Operations
  // ============================================
  
  /**
   * Get current settings from state or defaults
   */
  function getSettings() {
    return {
      theme: IDEState?.get('settings')?.theme || 'default',
      fontScale: IDEState?.get('settings')?.fontScale || 1,
      autoCreateZipBackup: IDEState?.get('settings')?.autoCreateZipBackup ?? true,
      showNotifications: IDEState?.get('settings')?.showNotifications ?? true,
      autoCheckpoint: IDEState?.get('settings')?.autoCheckpoint ?? true,
      // Editor preferences (ported from v1 IDE)
      wordWrap: IDEState?.get('settings')?.wordWrap ?? true,
      lineNumbers: IDEState?.get('settings')?.lineNumbers ?? true,
      autoSave: IDEState?.get('settings')?.autoSave ?? false,
      soundEffects: IDEState?.get('settings')?.soundEffects ?? false,
      systemPrompt: IDEState?.get('settings')?.systemPrompt || ''
    };
  }
  
  /**
   * Select a theme
   */
  function selectTheme(themeId) {
    // Update UI
    modal.querySelectorAll('.theme-option').forEach(btn => {
      const isActive = btn.dataset.themeId === themeId;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-checked', isActive);
      
      // Update checkmark
      let check = btn.querySelector('.theme-check');
      if (isActive && !check) {
        check = document.createElement('span');
        check.className = 'theme-check';
        check.textContent = '✓';
        btn.appendChild(check);
      } else if (!isActive && check) {
        check.remove();
      }
    });
    
    // Apply theme through the central IDEThemes module so that:
    //   - the data-theme attribute is set
    //   - the theme-X CSS class is added (used by per-theme overrides in styles.css)
    //   - the meta theme-color is updated for mobile browsers
    //   - the choice is persisted to IDEState
    //   - the 'themechange' event fires for other components
    if (window.IDEThemes) {
      IDEThemes.applyTheme(themeId);
    } else {
      // Fallback: direct attribute only (legacy path)
      document.documentElement.setAttribute('data-theme', themeId);
    }
    
    // Store pending change
    modal.dataset.pendingTheme = themeId;
  }
  
  /**
   * Set font scale
   */
  function setFontScale(scale) {
    // Update UI
    modal.querySelectorAll('.font-scale-option').forEach(btn => {
      const isActive = Math.abs(parseFloat(btn.dataset.fontScale) - scale) < 0.01;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-checked', isActive);
    });
    
    // Apply immediately for preview
    document.documentElement.style.setProperty('--font-scale', scale);
    
    // Update preview text
    const preview = modal.querySelector('.font-scale-preview p');
    if (preview) {
      preview.style.fontSize = `calc(1rem * ${scale})`;
    }
    
    // Store pending change
    modal.dataset.pendingFontScale = scale;
  }
  
  /**
   * Update toggle setting
   */
  function updateToggleSetting(settingId, value) {
    // Just store it - will be saved on "Save Settings"
    modal.dataset[settingId] = value;
  }
  
  /**
   * Save all settings
   */
  function saveSettings() {
    const prev = getSettings();
    const settings = {
      theme: modal?.dataset.pendingTheme || prev.theme,
      fontScale: parseFloat(modal?.dataset.pendingFontScale || prev.fontScale),
      autoCreateZipBackup: modal?.dataset['setting-zip-backup'] === null ? prev.autoCreateZipBackup
                          : modal?.dataset['setting-zip-backup'] === 'true',
      showNotifications: modal?.dataset['setting-notifications'] === null ? prev.showNotifications
                          : modal?.dataset['setting-notifications'] === 'true',
      autoCheckpoint: modal?.dataset['setting-auto-checkpoint'] === null ? prev.autoCheckpoint
                          : modal?.dataset['setting-auto-checkpoint'] === 'true',
      wordWrap: modal?.dataset['setting-word-wrap'] === null ? prev.wordWrap
                  : modal?.dataset['setting-word-wrap'] === 'true',
      lineNumbers: modal?.dataset['setting-line-numbers'] === null ? prev.lineNumbers
                    : modal?.dataset['setting-line-numbers'] === 'true',
      autoSave: modal?.dataset['setting-auto-save'] === null ? prev.autoSave
                  : modal?.dataset['setting-auto-save'] === 'true',
      soundEffects: modal?.dataset['setting-sound-effects'] === null ? prev.soundEffects
                      : modal?.dataset['setting-sound-effects'] === 'true',
      systemPrompt: modal?.dataset.systemPrompt !== undefined 
                    ? modal.dataset.systemPrompt 
                    : prev.systemPrompt || ''
    };
    
    // Persist to storage
    try {
      localStorage.setItem('ide-settings', JSON.stringify(settings));
    } catch (e) {
      console.error('Failed to save settings:', e);
    }
    
    // Update state
    if (window.IDEState) {
      IDEState.set({ settings });
    }
    
    // Apply settings
    applySettings(settings);
    
    // Notify other components that editor-affecting settings may have changed
    document.dispatchEvent(new CustomEvent('ide:settings-applied', { detail: { settings, prev } }));
  }
  
  /**
   * Load settings from storage
   */
  function loadSettings() {
    try {
      const stored = localStorage.getItem('ide-settings');
      if (stored) {
        const settings = JSON.parse(stored);
        applySettings(settings);
        
        if (window.IDEState) {
          IDEState.set({ settings });
        }
      }
    } catch (e) {
      console.error('Failed to load settings:', e);
    }
  }
  
  /**
   * Reset to default settings
   */
  function resetToDefaults() {
    const defaults = {
      theme: 'default',
      fontScale: 1,
      autoCreateZipBackup: false,
      showNotifications: true,
      autoCheckpoint: true,
      wordWrap: true,
      lineNumbers: true,
      autoSave: false,
      soundEffects: false,
      systemPrompt: ''
    };
    
    try {
      localStorage.setItem('ide-settings', JSON.stringify(defaults));
    } catch (e) {
      console.error('Failed to reset settings:', e);
    }
    
    applySettings(defaults);
    
    if (window.IDEState) {
      IDEState.set({ settings: defaults });
    }
    
    document.dispatchEvent(new CustomEvent('ide:settings-applied', { detail: { settings: defaults, prev: {} } }));
  }
  
  /**
   * Apply settings to the DOM
   */
  function applySettings(settings) {
    // Theme
    if (settings.theme) {
      document.documentElement.setAttribute('data-theme', settings.theme);
    }
    
    // Font scale
    if (settings.fontScale) {
      document.documentElement.style.setProperty('--font-scale', settings.fontScale);
    }
  }
  
  /**
   * Escape HTML entities for safe insertion into DOM
   */
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
  
  /**
   * Get default system prompt
   */
  function getDefaultSystemPrompt() {
    return `You are a helpful AI coding assistant integrated into an IDE environment.

Your capabilities include:
- Writing and editing code across multiple programming languages
- Explaining complex code concepts clearly
- Debugging issues and suggesting fixes
- Refactoring code for better performance and readability
- Generating documentation and comments
- Following best practices and design patterns

Guidelines:
- Be concise but thorough in your explanations
- When providing code, include brief comments for complex logic
- Ask clarifying questions when requirements are ambiguous
- Suggest improvements proactively when you notice potential issues
- Format code responses in proper markdown code blocks`;
  }
  
  /**
   * Get preset prompt by name
   */
  function getPresetPrompt(presetName) {
    const presets = {
      'coding-assistant': `You are an expert coding assistant specializing in modern web development.

Core Expertise:
- JavaScript/TypeScript (ES6+, Node.js, React, Vue, Angular)
- Python (Django, Flask, FastAPI, data science)
- HTML/CSS (responsive design, CSS Grid, Flexbox, Tailwind)
- SQL & NoSQL databases
- Git workflows and DevOps practices

Behavior:
- Write clean, production-ready code with proper error handling
- Include JSDoc/TSDoc for functions and classes
- Suggest optimizations for performance and maintainability
- Follow language-specific conventions and idioms
- When unsure about requirements, ask before implementing`,
      
      'code-reviewer': `You are a senior code reviewer with 15+ years of experience.

Review Focus Areas:
- Code correctness and potential bugs
- Security vulnerabilities (OWASP top 10)
- Performance bottlenecks and optimization opportunities
- Code organization and architecture patterns
- Naming conventions and code readability
- Error handling edge cases

Output Format:
1. Summary of findings (critical/warning/info)
2. Detailed issues with line references
3. Specific code suggestions with before/after examples
4. Overall assessment and recommendations

Be thorough but constructive. Acknowledge good patterns alongside areas for improvement.`,
      
      'documentation': `You are a technical writer specializing in API and code documentation.

Documentation Standards:
- Write clear, concise prose suitable for developers
- Include practical examples for all APIs and functions
- Use consistent formatting and structure
- Provide both quick-start guides and detailed reference
- Document edge cases and error conditions

Output Types:
- JSDoc/TSDoc comments for code
- README files with installation/usage sections
- API reference documentation
- Architecture decision records (ADRs)
- Change logs and migration guides

Focus on accuracy and completeness. If behavior is unclear from code alone, note it as needing verification.`,
      
      'debugger': `You are an expert debugging assistant with deep knowledge of common failure patterns.

Debugging Approach:
1. Analyze symptoms and reproduce steps
2. Identify potential root causes (ranked by likelihood)
3. Suggest diagnostic logging or breakpoints
4. Propose targeted fixes with explanations
5. Recommend prevention strategies

Common Issue Categories:
- Race conditions and async timing issues
- Memory leaks and resource management
- Null/undefined reference errors
- Type coercion surprises
- Network timeout and error handling
- Environment-specific behaviors

When analyzing bugs:
- Consider the full call stack and execution context
- Check for related code that might be affected
- Suggest unit tests to prevent regression
- Explain WHY the bug occurs, not just HOW to fix`
    };
    return presets[presetName] || null;
  }
  
  /**
   * Open expanded prompt editor modal
   */
  function openExpandedPromptEditor(initialValue, onSave) {
    const expandedModal = document.createElement('div');
    expandedModal.className = 'modal-overlay';
    expandedModal.id = 'expanded-prompt-modal';
    
    expandedModal.innerHTML = `
      <div class="modal modal-lg expanded-prompt-modal">
        <div class="modal-header">
          <h2 class="modal-title">System Prompt Editor</h2>
          <button class="icon-btn expanded-close-btn" aria-label="Close editor">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="modal-body">
          <textarea id="expanded-prompt-textarea" class="expanded-prompt-textarea" rows="20" spellcheck="true">${escapeHtml(initialValue)}</textarea>
        </div>
        <div class="modal-footer">
          <span class="expanded-char-count"><span id="expanded-char-count">${initialValue.length}</span> characters</span>
          <div>
            <button class="btn btn-outline expanded-cancel-btn">Cancel</button>
            <button class="btn btn-primary expanded-save-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              Apply Changes
            </button>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(expandedModal);
    
    const textarea = expandedModal.querySelector('#expanded-prompt-textarea');
    const charCount = expandedModal.querySelector('#expanded-char-count');
    
    textarea.addEventListener('input', () => {
      charCount.textContent = textarea.value.length;
    });
    
    textarea.focus();
    
    // Close button
    expandedModal.querySelector('.expanded-close-btn').addEventListener('click', () => {
      expandedModal.remove();
    });
    
    // Cancel button
    expandedModal.querySelector('.expanded-cancel-btn').addEventListener('click', () => {
      expandedModal.remove();
    });
    
    // Save button
    expandedModal.querySelector('.expanded-save-btn').addEventListener('click', () => {
      onSave(textarea.value);
      expandedModal.remove();
      if (IDEUtils) IDEUtils.showToast('System prompt updated', 'success');
    });
    
    // Click outside to close
    expandedModal.addEventListener('click', (e) => {
      if (e.target === expandedModal) expandedModal.remove();
    });
    
    // Escape key
    expandedModal.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') expandedModal.remove();
    });
  }

  /**
   * Sync UI with current settings
   */
  function syncUIWithSettings(settings) {
    // This is called when state changes externally
    applySettings(settings);
  }

  // ============================================
  // Public API
  // ============================================
  
  return {
    init,
    open,
    close,
    getSettings,
    saveSettings,
    resetToDefaults,
    
    // Expose for external use
    themes,
    fontScales
  };
})();

// Export for use in other modules
window.SettingsPanelComponent = SettingsPanelComponent;
