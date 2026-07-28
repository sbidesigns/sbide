/**
 * SBIDE - Keyboard Shortcuts Manager
 * Global keyboard shortcut system with command palette support
 */

const ShortcutsManager = (() => {
  // State
  let shortcuts = [];
  let isPaletteOpen = false;
  let paletteEl = null;
  
  // ============================================
  // Initialization
  // ============================================
  
  function init() {
    registerDefaults();
    bindGlobalListener();
    createPalette();
    
    // Register in module system
    if (window.IDEState) {
      IDEState.set({ shortcutsEnabled: true });
    }
  }
  
  // ============================================
  // Default Shortcuts
  // ============================================
  
  function registerDefaults() {
    // File operations
    register('ctrl+s', 'Save File', () => triggerSave(), 'file');
    register('ctrl+shift+s', 'Save As', () => triggerSaveAs(), 'file');
    register('ctrl+n', 'New File', () => triggerNewFile(), 'file');
    register('ctrl+o', 'Open File', () => triggerOpenFile(), 'file');
    
    // Edit operations
    register('ctrl+z', 'Undo', () => triggerUndo(), 'edit');
    register('ctrl+y / ctrl+shift+z', 'Redo', () => triggerRedo(), 'edit');
    register('ctrl+f', 'Find', () => triggerFind(), 'edit');
    register('ctrl+h', 'Replace', () => triggerReplace(), 'edit');
    register('ctrl+d', 'Duplicate Line', () => triggerDuplicateLine(), 'edit');
    register('ctrl+/', 'Toggle Comment', () => triggerComment(), 'edit');
    register('ctrl+a', 'Select All', () => triggerSelectAll(), 'edit');
    
    // View operations
    register('ctrl+b', 'Toggle Sidebar', () => triggerToggleSidebar(), 'view');
    register('ctrl+j', 'Toggle Panel', () => triggerTogglePanel(), 'view');
    register('ctrl+= / ctrl+-', 'Zoom In/Out', null, 'view'); // Handled natively
    register('ctrl+0', 'Reset Zoom', null, 'view'); // Handled natively
    register('f11', 'Toggle Fullscreen', () => triggerFullscreen(), 'view');
    register('escape', 'Close Modal/Palette', () => triggerEscape(), 'view');
    
    // AI/Chat operations
    register('ctrl+enter', 'Send Message', () => triggerSendMessage(), 'ai');
    register('ctrl+shift+enter', 'New Chat', () => triggerNewChat(), 'ai');
    
    // Palette
    register('ctrl+shift+p', 'Command Palette', togglePalette, 'system');
    
    // Settings
    register('ctrl+,', 'Settings', () => triggerSettings(), 'system');
  }
  
  // ============================================
  // Registration API
  // ============================================
  
  function register(keyCombo, description, handler, category = 'custom') {
    shortcuts.push({
      key: keyCombo.toLowerCase(),
      description,
      handler,
      category,
      enabled: true
    });
  }
  
  function unregister(keyCombo) {
    shortcuts = shortcuts.filter(s => s.key !== keyCombo.toLowerCase());
  }
  
  // ============================================
  // Event Handling
  // ============================================
  
  function bindGlobalListener() {
    document.addEventListener('keydown', handleKeyDown);
  }
  
  function handleKeyDown(e) {
    const key = formatKeyEvent(e);
    const matching = shortcuts.find(s => 
      s.enabled && 
      s.handler && 
      parseKeyCombo(s.key) === key &&
      !isInputFocused(e)
    );
    
    if (matching) {
      e.preventDefault();
      e.stopPropagation();
      
      if (matching.handler) {
        matching.handler();
      }
      
      // Show toast feedback
      if (window.IDEUtils && matching.description !== 'Command Palette') {
        IDEUtils.showToast(matching.description, 'info', 800);
      }
    }
  }
  
  function formatKeyEvent(e) {
    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push('ctrl');
    if (e.shiftKey) parts.push('shift');
    if (e.altKey) parts.push('alt');
    
    let key = e.key.toLowerCase();
    
    // Normalize special keys
    const specialKeys = {
      'arrowup': 'up',
      'arrowdown': 'down',
      'arrowleft': 'left',
      'arrowright': 'right',
      ' ': 'space',
      'escape': 'escape',
      'enter': 'enter',
      'tab': 'tab',
      'backspace': 'backspace',
      'delete': 'delete'
    };
    
    if (specialKeys[key]) {
      key = specialKeys[key];
    } else if (key.length === 1 && !e.shiftKey) {
      key = key; // Already lowercase
    } else if (key.length === 1 && e.shiftKey) {
      // For shifted characters, use the actual character
      key = e.key.toLowerCase();
    }
    
    parts.push(key);
    return parts.join('+');
  }
  
  function parseKeyCombo(combo) {
    return combo.toLowerCase().replace(/ /g, '+');
  }
  
  function isInputFocused(e) {
    const tag = e.target.tagName;
    return (
      tag === 'INPUT' || 
      tag === 'TEXTAREA' || 
      tag === 'SELECT' ||
      e.target.isContentEditable ||
      e.target.classList.contains('cm-content') // CodeMirror editor
    ) && !e.ctrlKey && !e.metaKey; // Allow Ctrl combos in inputs
  }
  
  // ============================================
  // Command Palette
  // ============================================
  
  function createPalette() {
    paletteEl = document.createElement('div');
    paletteEl.id = 'command-palette';
    paletteEl.className = 'command-palette';
    paletteEl.innerHTML = `
      <div class="palette-backdrop"></div>
      <div class="palette-container">
        <div class="palette-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input type="text" class="palette-input" placeholder="Type a command..." autocomplete="off">
          <kbd class="palette-hint">ESC</kbd>
        </div>
        <div class="palette-results"></div>
        <div class="palette-footer">
          <span>↑↓ Navigate</span>
          <span>Enter Execute</span>
          <span>Esc Close</span>
        </div>
      </div>
    `;
    
    document.body.appendChild(paletteEl);
    
    // Bind events
    const input = paletteEl.querySelector('.palette-input');
    const backdrop = paletteEl.querySelector('.palette-backdrop');
    
    backdrop.addEventListener('click', closePalette);
    input.addEventListener('input', filterPaletteResults);
    input.addEventListener('keydown', handlePaletteNav);
  }
  
  function togglePalette() {
    if (isPaletteOpen) {
      closePalette();
    } else {
      openPalette();
    }
  }
  
  function openPalette() {
    isPaletteOpen = true;
    paletteEl.classList.add('active');
    
    const input = paletteEl.querySelector('.palette-input');
    input.value = '';
    input.focus();
    
    renderPaletteResults(shortcuts.filter(s => s.handler));
  }
  
  function closePalette() {
    isPaletteOpen = false;
    paletteEl?.classList.remove('active');
  }
  
  function filterPaletteResults(e) {
    const query = e.target.value.toLowerCase().trim();
    
    let filtered = shortcuts;
    
    if (query) {
      filtered = shortcuts.filter(s =>
        s.description.toLowerCase().includes(query) ||
        s.key.includes(query) ||
        s.category.toLowerCase().includes(query)
      );
    }
    
    renderPaletteResults(filtered.filter(s => s.handler));
  }
  
  function renderPaletteResults(items) {
    const resultsEl = paletteEl.querySelector('.palette-results');
    
    if (items.length === 0) {
      resultsEl.innerHTML = '<div class="palette-empty">No commands found</div>';
      return;
    }
    
    // Group by category
    const grouped = {};
    items.forEach(item => {
      if (!grouped[item.category]) grouped[item.category] = [];
      grouped[item.category].push(item);
    });
    
    let html = '';
    for (const [category, items] of Object.entries(grouped)) {
      html += `<div class="palette-group"><div class="palette-group-title">${category}</div>`;
      items.forEach(item => {
        html += `
          <button class="palette-item" data-key="${item.key}">
            <span class="palette-item-desc">${item.description}</span>
            <kbd class="palette-item-key">${formatKeyDisplay(item.key)}</kbd>
          </button>
        `;
      });
      html += '</div>';
    }
    
    resultsEl.innerHTML = html;
    
    // Bind click events
    resultsEl.querySelectorAll('.palette-item').forEach((el, idx) => {
      el.addEventListener('click', () => {
        const shortcut = items.find(s => s.key === el.dataset.key);
        if (shortcut?.handler) {
          shortcut.handler();
        }
        closePalette();
      });
    });
  }
  
  function handlePaletteNav(e) {
    const items = paletteEl.querySelectorAll('.palette-item:not([style*="display: none"])');
    const current = paletteEl.querySelector('.palette-item.selected');
    let idx = Array.from(items).indexOf(current);
    
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      idx = Math.min(idx + 1, items.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      idx = Math.max(idx - 1, 0);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (current) current.click();
      return;
    } else if (e.key === 'Escape') {
      closePalette();
      return;
    } else {
      return; // Don't update selection for typing
    }
    
    current?.classList.remove('selected');
    items[idx]?.classList.add('selected');
    items[idx]?.scrollIntoView({ block: 'nearest' });
  }
  
  function formatKeyDisplay(key) {
    return key.split('+').map(k => 
      k.charAt(0).toUpperCase() + k.slice(1)
    ).join(' + ');
  }
  
  // ============================================
  // Trigger Functions (dispatch to modules)
  // ============================================
  
  function triggerSave() {
    // Dispatch custom event that components can listen to
    document.dispatchEvent(new CustomEvent('ide:save'));
    if (window.FileTreeComponent) FileTreeComponent.saveCurrentFile?.();
  }
  
  function triggerSaveAs() {
    document.dispatchEvent(new CustomEvent('ide:save-as'));
  }
  
  function triggerNewFile() {
    if (window.FileTreeComponent) FileTreeComponent.createNewFile?.();
  }
  
  function triggerOpenFile() {
    if (window.FileTreeComponent) FileTreeComponent.openFileDialog?.();
  }
  
  function triggerUndo() {
    document.execCommand('undo');
  }
  
  function triggerRedo() {
    document.execCommand('redo');
  }
  
  function triggerFind() {
    if (window.CodeEditorComponent) CodeEditorComponent.openFind?.();
  }
  
  function triggerReplace() {
    if (window.CodeEditorComponent) CodeEditorComponent.openReplace?.();
  }
  
  function triggerDuplicateLine() {
    document.dispatchEvent(new CustomEvent('ide:duplicate-line'));
  }
  
  function triggerComment() {
    document.dispatchEvent(new CustomEvent('ide:toggle-comment'));
  }
  
  function triggerSelectAll() {
    document.dispatchEvent(new CustomEvent('ide:select-all'));
  }
  
  function triggerToggleSidebar() {
    document.dispatchEvent(new CustomEvent('ide:toggle-sidebar'));
    const sidebar = document.querySelector('.sidebar');
    sidebar?.classList.toggle('collapsed');
  }
  
  function triggerTogglePanel() {
    document.dispatchEvent(new CustomEvent('ide:toggle-panel'));
  }
  
  function triggerFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }
  
  function triggerEscape() {
    // Close any open modals
    document.querySelectorAll('.modal.active').forEach(m => m.classList.remove('active'));
    closePalette();
  }
  
  function triggerSendMessage() {
    const sendBtn = document.querySelector('#chat-send-btn');
    sendBtn?.click();
  }
  
  function triggerNewChat() {
    document.dispatchEvent(new CustomEvent('ide:new-chat'));
    if (window.ChatWindowComponent) ChatWindowComponent.clearChat?.();
  }
  
  function triggerSettings() {
    if (window.SettingsPanelComponent) SettingsPanelComponent.open?.();
  }
  
  // ============================================
  // Public API
  // ============================================
  
  return {
    init,
    register,
    unregister,
    togglePalette,
    getShortcuts: () => [...shortcuts],
    isOpen: () => isPaletteOpen
  };
})();

// Auto-initialize when DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', ShortcutsManager.init);
} else {
  ShortcutsManager.init();
}

// Export globally
window.ShortcutsManager = ShortcutsManager;
