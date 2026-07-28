/**
 * SBIDE - Code Editor Component
 * Handles file viewing, editing, and preview modes with tab management
 */

const CodeEditorComponent = (() => {
  // ============================================
  // State
  // ============================================
  
  let container = null;
  let tabsContainer = null;
  let editorContainer = null;
  
  // Open tabs (array of file objects)
  let openTabs = [];
  let activeTabPath = null;
  
  // Current mode: 'view' | 'edit' | 'preview'
  let currentMode = 'view';
  
  // Current file content
  let currentContent = '';
  let originalContent = ''; // For tracking changes
  
  // Auto-save debounce
  let autoSaveTimeout = null;
  const AUTO_SAVE_DELAY = 1000; // ms
  
  // LocalStorage session restore keys
  const LS_CONTENT_KEY = 'sbide_editor_content';
  const LS_TIMESTAMP_KEY = 'sbide_editor_timestamp';
  const LS_SESSION_KEY = 'sbide_editor_session_id';
  let currentSessionId = generateSessionId();
  let lsSaveTimeout = null;
  const LS_SAVE_DELAY = 500; // Aggressive debounce for localStorage
  
  /**
   * Generate a unique session ID for this page load
   * Used to detect refresh vs new tab
   */
  function generateSessionId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  }
  
  /**
   * Save current editor content to localStorage for session restore
   * Always saves, regardless of file tabs or autoSave setting
   */
  function saveToLocalStorage(content) {
    clearTimeout(lsSaveTimeout);
    lsSaveTimeout = setTimeout(() => {
      try {
        localStorage.setItem(LS_CONTENT_KEY, content);
        localStorage.setItem(LS_TIMESTAMP_KEY, Date.now().toString());
        localStorage.setItem(LS_SESSION_KEY, currentSessionId);
      } catch (e) {
        // Quota exceeded or storage unavailable - silent fail
        console.warn('[SBIDE] Could not save to localStorage:', e.message);
      }
    }, LS_SAVE_DELAY);
  }
  
  /**
   * Restore content from localStorage if available
   * @returns {{ content: string, timestamp: number } | null}
   */
  function restoreFromLocalStorage() {
    try {
      const content = localStorage.getItem(LS_CONTENT_KEY);
      const timestamp = localStorage.getItem(LS_TIMESTAMP_KEY);
      const sessionId = localStorage.getItem(LS_SESSION_KEY);
      
      if (content && timestamp) {
        return { 
          content, 
          timestamp: parseInt(timestamp, 10),
          isCurrentSession: sessionId === currentSessionId
        };
      }
    } catch (e) {
      // Storage unavailable
    }
    return null;
  }
  
  /**
   * Clear saved session data
   */
  function clearLocalStorageSession() {
    try {
      localStorage.removeItem(LS_CONTENT_KEY);
      localStorage.removeItem(LS_TIMESTAMP_KEY);
      localStorage.removeItem(LS_SESSION_KEY);
    } catch (e) {}
  }
  
  // Editor preferences (ported from v1 IDE)
  let editorPrefs = { wordWrap: true, lineNumbers: true, autoSave: false, soundEffects: false };
  
  // Load editor prefs from state on first opportunity
  function refreshEditorPrefs() {
    if (window.IDEState) {
      const s = IDEState.get('settings');
      if (s) {
        editorPrefs.wordWrap = s.wordWrap ?? true;
        editorPrefs.lineNumbers = s.lineNumbers ?? true;
        editorPrefs.autoSave = s.autoSave ?? false;
        editorPrefs.soundEffects = s.soundEffects ?? false;
      }
    }
  }
  
  // Listen for settings changes (dispatched by settings-panel.js)
  document.addEventListener('ide:settings-applied', (e) => {
    const prev = editorPrefs;
    refreshEditorPrefs();
    // Re-render edit mode if wrap or line-numbers changed and we're currently editing
    if ((prev.wordWrap !== editorPrefs.wordWrap || prev.lineNumbers !== editorPrefs.lineNumbers)
        && currentMode === 'edit') {
      displayContent(currentContent);
    }
  });
  
  // Initial fetch
  refreshEditorPrefs();
  
  // Callbacks
  let onContentChange = null;
  let onFileSave = null;

  // ============================================
  // Initialization
  // ============================================
  
  /**
   * Initialize code editor component
   * @param {HTMLElement} element - Main container for the editor
   * @param {Object} options - Configuration options
   */
  function init(element, options = {}) {
    if (!element) {
      console.error('CodeEditor: Container element required');
      return;
    }
    
    container = element;
    onContentChange = options.onContentChange || null;
    onFileSave = options.onFileSave || null;
    
    // Find or create sub-containers
    tabsContainer = container.querySelector('.editor-tabs') || createTabsContainer();
    editorContainer = container.querySelector('.editor-content') || createEditorContainer();
    
    // Setup event listeners
    setupEventListeners();
    
    // Subscribe to state changes
    if (window.IDEState) {
      IDEState.subscribe((state, prevState) => {
        // Handle active file changes
        if (state.activeFile !== prevState.activeFile && state.activeFile) {
          openFile(state.activeFile);
        }
        
        // Handle editor panel toggle
        if (state.editorPanelOpen !== prevState.editorPanelOpen) {
          togglePanel(state.editorPanelOpen);
        }
        
        // Handle file content updates from external sources
        if (state.fileContent !== prevState.fileContent && state.fileContent !== currentContent) {
          if (!isEditing()) {
            displayContent(state.fileContent);
          }
        }
      });
    }
    
    // Check for saved session and restore
    const savedSession = restoreFromLocalStorage();
    if (savedSession && savedSession.content) {
      // Restore the saved content
      currentContent = savedSession.content;
      originalContent = savedSession.content;
      
      // Show restored content in view mode
      renderTabs();
      setEditorVisibility(true);
      displayContent(savedSession.content);
      
      // Show subtle restore notification
      showRestoreNotification(savedSession.timestamp);
    } else {
      // Fresh start
      renderTabs();
      showWelcomeScreen();
    }
  }

  /**
   * Create tabs container if not in DOM
   */
  function createTabsContainer() {
    const div = document.createElement('div');
    div.className = 'editor-tabs';
    container.prepend(div);
    return div;
  }

  /**
   * Create editor content area if not in DOM
   */
  function createEditorContainer() {
    const div = document.createElement('div');
    div.className = 'editor-content';
    container.appendChild(div);
    return div;
  }

  /**
   * Setup global event listeners
   */
  function setupEventListeners() {
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Ctrl/Cmd + S to save
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (currentMode === 'edit') {
          saveCurrentFile();
        }
      }
      
      // Ctrl/Cmd + W to close tab
      if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
        e.preventDefault();
        if (activeTabPath) {
          closeTab(activeTabPath);
        }
      }
      
      // Escape to exit edit mode
      if (e.key === 'Escape' && currentMode === 'edit') {
        exitEditMode();
      }
    });
    
    // Tab bar click for closing tabs
    if (tabsContainer) {
      tabsContainer.addEventListener('click', (e) => {
        const closeBtn = e.target.closest('.tab-close');
        if (closeBtn) {
          e.stopPropagation();
          const tab = closeBtn.closest('.editor-tab');
          if (tab) {
            closeTab(tab.dataset.path);
          }
        }
      });
    }
  }

  // ============================================
  // Tab Management
  // ============================================
  
  /**
   * Open a file in a new or existing tab
   */
  async function openFile(file) {
    if (!file || !file.path) return;
    
    // Check if already open
    const existingTab = openTabs.find(t => t.path === file.path);
    if (existingTab) {
      activateTab(file.path);
      return;
    }
    
    // Add to tabs
    openTabs.push({ ...file });
    
    // Activate this tab
    activateTab(file.path);
    
    // Load content
    await loadFileContent(file);
    
    // Re-render tabs
    renderTabs();
  }

  /**
   * Activate a specific tab by path
   */
  function activateTab(path) {
    activeTabPath = path;
    
    // Update state
    const tab = openTabs.find(t => t.path === path);
    if (tab && window.IDEState) {
      IDEState.setActiveFile(tab);
    }
    
    // Update visual
    updateTabVisuals();
    
    // Load content if not loaded
    if (tab && !tab.contentLoaded) {
      loadFileContent(tab);
    }
  }

  /**
   * Close a tab
   */
  function closeTab(path) {
    const index = openTabs.findIndex(t => t.path === path);
    if (index === -1) return;
    
    // Check for unsaved changes
    const tab = openTabs[index];
    if (tab.hasChanges) {
      const shouldClose = confirm('You have unsaved changes. Close anyway?');
      if (!shouldClose) return;
    }
    
    // Remove tab
    openTabs.splice(index, 1);
    
    // If closed tab was active, activate adjacent tab
    if (path === activeTabPath) {
      if (openTabs.length > 0) {
        const newIndex = Math.min(index, openTabs.length - 1);
        activateTab(openTabs[newIndex].path);
      } else {
        activeTabPath = null;
        // No tabs left -> show the empty state (#editor-no-file)
        showWelcomeScreen();
      }
    }
    
    renderTabs();
  }

  /**
   * Close all tabs except active
   */
  function closeOtherTabs(keepPath) {
    openTabs = openTabs.filter(t => t.path === keepPath);
    activeTabPath = keepPath;
    renderTabs();
    activateTab(keepPath);
  }

  /**
   * Render all tabs
   */
  function renderTabs() {
    if (!tabsContainer) return;
    
    tabsContainer.innerHTML = '';
    
    if (openTabs.length === 0) {
      tabsContainer.classList.add('hidden');
      return;
    }
    
    tabsContainer.classList.remove('hidden');
    
    openTabs.forEach(tab => {
      const tabEl = document.createElement('div');
      tabEl.className = `editor-tab ${tab.path === activeTabPath ? 'active' : ''} ${tab.hasChanges ? 'has-changes' : ''}`;
      tabEl.dataset.path = tab.path;
      
      // Icon
      const icon = document.createElement('span');
      icon.className = 'tab-icon';
      icon.innerHTML = IDEUtils?.getFileIcon?.(tab.name) || IDEUtils?.Icons?.file || '';
      tabEl.appendChild(icon);
      
      // Name
      const name = document.createElement('span');
      name.className = 'tab-name';
      name.textContent = tab.name;
      name.title = tab.path;
      tabEl.appendChild(name);
      
      // Change indicator
      if (tab.hasChanges) {
        const dot = document.createElement('span');
        dot.className = 'change-indicator';
        dot.setAttribute('aria-label', 'Unsaved changes');
        tabEl.appendChild(dot);
      }
      
      // Close button
      const closeBtn = document.createElement('button');
      closeBtn.className = 'tab-close icon-btn';
      closeBtn.setAttribute('aria-label', `Close ${tab.name}`);
      closeBtn.innerHTML = IDEUtils?.Icons?.x || '';
      tabEl.appendChild(closeBtn);
      
      // Click to activate
      tabEl.addEventListener('click', (e) => {
        if (!e.target.closest('.tab-close')) {
          activateTab(tab.path);
        }
      });
      
      // Context menu for "close others"
      tabEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        closeOtherTabs(tab.path);
      });
      
      tabsContainer.appendChild(tabEl);
    });
  }

  /**
   * Update tab visual states without full re-render
   */
  function updateTabVisuals() {
    if (!tabsContainer) return;
    
    tabsContainer.querySelectorAll('.editor-tab').forEach(tabEl => {
      const isActive = tabEl.dataset.path === activeTabPath;
      const tabData = openTabs.find(t => t.path === tabEl.dataset.path);
      
      tabEl.classList.toggle('active', isActive);
      tabEl.classList.toggle('has-changes', tabData?.hasChanges || false);
    });
  }

  // ============================================
  // Content Loading & Display
  // ============================================
  
  /**
   * Load file content from storage
   */
  async function loadFileContent(file) {
    if (!file || !file.project) return;
    
    try {
      const content = await IDEStorage.Files.readContent(file.project, file.path);
      currentContent = content || '';
      originalContent = currentContent;
      
      // Mark as loaded
      const tab = openTabs.find(t => t.path === file.path);
      if (tab) {
        tab.contentLoaded = true;
        tab.hasChanges = false;
      }
      
      // Update state
      if (window.IDEState) {
        IDEState.setFileContent(currentContent);
      }
      
      // Display based on mode
      displayContent(currentContent);

      // Show #editor-active now that a file is open
      setEditorVisibility(true);

    } catch (error) {
      console.error('Failed to load file:', error);
      showErrorState('Failed to load file content');
    }
  }

  /**
   * Display content in appropriate view
   */
  function displayContent(content) {
    if (!editorContainer) return;
    
    currentContent = content || '';
    
    switch (currentMode) {
      case 'view':
        renderViewMode(content);
        break;
      case 'edit':
        renderEditMode(content);
        break;
      case 'preview':
        renderPreviewMode(content);
        break;
      default:
        renderViewMode(content);
    }
  }

  /**
   * Show a subtle notification that content was restored from previous session
   */
  function showRestoreNotification(timestamp) {
    if (!container) return;
    
    const timeAgo = formatTimeAgo(timestamp);
    
    // Create notification element
    const notification = document.createElement('div');
    notification.className = 'session-restore-notification';
    notification.innerHTML = `
      <span class="restore-icon">${IDEUtils?.Icons?.info || 'ℹ'}</span>
      <span class="restore-text">Restored from ${timeAgo}</span>
      <button class="restore-dismiss" title="Dismiss">×</button>
    `;
    
    // Insert at top of container
    container.prepend(notification);
    
    // Auto-dismiss after 4 seconds
    const dismissTimeout = setTimeout(() => {
      notification.classList.add('fade-out');
      setTimeout(() => notification.remove(), 300);
    }, 4000);
    
    // Manual dismiss
    notification.querySelector('.restore-dismiss').addEventListener('click', () => {
      clearTimeout(dismissTimeout);
      notification.classList.add('fade-out');
      setTimeout(() => notification.remove(), 300);
    });
  }
  
  /**
   * Format timestamp as relative time ago
   */
  function formatTimeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  }
  
  /**
   * Show welcome/empty state.
   *
   * The HTML defines `#editor-no-file` as the empty state (icon + hint text).
   * We toggle that element's visibility instead of rendering our own welcome
   * screen, so the empty state stays consistent with the rest of the layout.
   */
  function showWelcomeScreen() {
    // Clear any rendered content (in case we're transitioning from a file view)
    if (editorContainer) {
      editorContainer.innerHTML = '';
    }
    // Show #editor-no-file, hide #editor-active
    setEditorVisibility(false);
  }

  /**
   * Toggle visibility of #editor-no-file vs #editor-active.
   * @param {boolean} fileActive - true when a file is open, false otherwise.
   */
  function setEditorVisibility(fileActive) {
    const root = container || document;
    const noFileEl = root.querySelector('#editor-no-file');
    const activeEl = root.querySelector('#editor-active');
    if (noFileEl) {
      noFileEl.classList.toggle('hidden', fileActive);
    }
    if (activeEl) {
      activeEl.classList.toggle('hidden', !fileActive);
    }
  }

  /**
   * Show error state
   */
  function showErrorState(message) {
    if (!editorContainer) return;
    
    editorContainer.innerHTML = `
      <div class="error-state">
        <span class="error-icon">${IDEUtils?.Icons?.error || ''}</span>
        <p>${IDEUtils?.escapeHtml(message) || message}</p>
        <button class="btn btn-outline btn-sm" onclick="this.closest('.editor-content').querySelector('.retry-btn')?.click()">
          Retry
        </button>
      </div>
    `;
  }

  // ============================================
  // View Modes
  // ============================================
  
  /**
   * Render read-only view with syntax highlighting
   */
  function renderViewMode(content) {
    if (!editorContainer) return;
    
    const activeFile = getActiveTab();
    const language = activeFile ? IDEUtils.detectLanguage(activeFile.name) : 'plaintext';
    
    editorContainer.innerHTML = `
      <div class="view-mode">
        <div class="view-header">
          <span class="view-mode-label">View Mode</span>
          <div class="view-actions">
            <button class="btn btn-sm btn-outline" data-action="edit" title="Edit (E)">
              ${IDEUtils?.Icons?.edit || ''} Edit
            </button>
            ${canPreview(activeFile) ? `
              <button class="btn btn-sm btn-outline" data-action="preview" title="Preview (P)">
                ${IDEUtils?.Icons?.eye || ''} Preview
              </button>
            ` : ''}
          </div>
        </div>
        <pre class="code-view"><code class="language-${language}">${IDEUtils?.escapeHtml(content) || ''}</code></pre>
      </div>
    `;
    
    // Apply syntax highlighting
    if (window.hljs) {
      editorContainer.querySelectorAll('pre code').forEach(block => {
        hljs.highlightElement(block);
      });
    }
    
    // Wire up action buttons
    wireUpViewActions();
  }

  /**
   * Render editable mode with textarea
   */
  function renderEditMode(content) {
    if (!editorContainer) return;
    
    refreshEditorPrefs();
    const activeFile = getActiveTab();
    const language = activeFile ? IDEUtils.detectLanguage(activeFile.name) : 'plaintext';
    
    const wrapAttr = editorPrefs.wordWrap ? 'wrap="soft"' : 'wrap="off"';
    const gutterHtml = editorPrefs.lineNumbers
      ? `<div class="code-editor-gutter" aria-hidden="true">${renderLineNumbers(content)}</div>`
      : '';
    const editorLayoutClass = editorPrefs.lineNumbers ? 'with-gutter' : 'no-gutter';
    const overflowClass = editorPrefs.wordWrap ? 'wrap-on' : 'wrap-off';
    
    editorContainer.innerHTML = `
      <div class="edit-mode ${editorLayoutClass} ${overflowClass}">
        <div class="edit-header">
          <span class="edit-mode-label">Edit Mode</span>
          <span class="edit-language">${language}</span>
          <div class="edit-actions">
            <button class="btn btn-sm btn-primary" data-action="save" title="Save (Ctrl+S)">
              ${IDEUtils?.Icons?.save || ''} Save
            </button>
            <button class="btn btn-sm btn-outline" data-action="cancel" title="Cancel (Esc)">
              ${IDEUtils?.Icons?.x || ''} Cancel
            </button>
          </div>
        </div>
        <div class="edit-body">
          ${gutterHtml}
          <textarea
            class="code-editor-textarea"
            spellcheck="false"
            autocomplete="off"
            autocapitalize="off"
            aria-label="Code editor"
            placeholder="Start typing..."
            ${wrapAttr}
          >${IDEUtils?.escapeHtml(content) || ''}</textarea>
        </div>
        <div class="edit-status">
          <span class="line-info">Line 1, Column 1</span>
          <span class="char-count">${content.length} characters</span>
        </div>
      </div>
    `;
    
    const textarea = editorContainer.querySelector('.code-editor-textarea');
    if (textarea) {
      // Auto-resize handling
      textarea.addEventListener('input', () => handleEditInput(textarea));
      
      // Track cursor position
      textarea.addEventListener('click', () => updateCursorPosition(textarea));
      textarea.addEventListener('keyup', () => updateCursorPosition(textarea));
      
      // Sync gutter scroll with textarea
      if (editorPrefs.lineNumbers) {
        const gutter = editorContainer.querySelector('.code-editor-gutter');
        if (gutter) {
          textarea.addEventListener('scroll', () => {
            gutter.scrollTop = textarea.scrollTop;
          });
        }
      }
      
      // Focus textarea
      textarea.focus();
      
      // Font-family / font-size / line-height are set in CSS on
      // .edit-mode .code-editor-textarea so they stay in sync with the
      // gutter (same font-size + line-height = pixel-perfect alignment).
    }
    
    // Wire up action buttons
    wireUpEditActions();
  }
  
  /**
   * Render line numbers HTML for the given content
   */
  function renderLineNumbers(content) {
    const lineCount = (content || '').split('\n').length;
    let html = '';
    for (let i = 1; i <= lineCount; i++) {
      html += `<div class="gutter-line">${i}</div>`;
    }
    return html;
  }
  
  /**
   * Refresh the line-numbers gutter for the current edit content
   */
  function refreshGutter(content) {
    if (!editorContainer) return;
    const gutter = editorContainer.querySelector('.code-editor-gutter');
    if (gutter) {
      gutter.innerHTML = renderLineNumbers(content);
    }
  }

  /**
   * Render preview mode for HTML/Markdown
   */
  function renderPreviewMode(content) {
    if (!editorContainer) return;
    
    const activeFile = getActiveTab();
    const isHtml = activeFile && /\.(html?|htm)$/.test(activeFile.name.toLowerCase());
    
    editorContainer.innerHTML = `
      <div class="preview-mode">
        <div class="preview-header">
          <span class="preview-mode-label">Preview</span>
          <div class="preview-actions">
            <button class="btn btn-sm btn-outline" data-action="view" title="Back to View">
              ${IDEUtils?.Icons?.eye || ''} View Code
            </button>
            <button class="btn btn-sm btn-outline" data-action="open-new" title="Open in New Tab">
              ${IDEUtils?.Icons?.externalLink || ''} Open New
            </button>
          </div>
        </div>
        <iframe class="preview-frame" sandbox="allow-scripts allow-same-origin"></iframe>
      </div>
    `;
    
    const iframe = editorContainer.querySelector('.preview-frame');
    if (iframe) {
      if (isHtml) {
        // Render HTML directly
        iframe.srcdoc = content;
      } else {
        // For markdown, render simple preview (basic conversion)
        const htmlContent = markdownToHtml(content);
        iframe.srcdoc = htmlContent;
      }
    }
    
    // Wire up actions
    wireUpPreviewActions();
  }

  // ============================================
  // Edit Handling
  // ============================================
  
  /**
   * Handle input in edit mode
   */
  function handleEditInput(textarea) {
    const newContent = textarea.value;
    currentContent = newContent;
    
    // Update character count
    const charCount = editorContainer.querySelector('.char-count');
    if (charCount) {
      charCount.textContent = `${newContent.length} characters`;
    }
    
    // Refresh gutter if line numbers are enabled
    if (editorPrefs.lineNumbers) {
      refreshGutter(newContent);
    }
    
    // Mark tab as having changes
    const hasChanges = newContent !== originalContent;
    const tab = openTabs.find(t => t.path === activeTabPath);
    if (tab) {
      tab.hasChanges = hasChanges;
    }
    updateTabVisuals();
    
    // Notify of content change
    if (onContentChange) {
      onContentChange(newContent);
    }
    
    // Always save to localStorage for session restore (independent of file system)
    saveToLocalStorage(newContent);
    
    // Debounced auto-save: actually persist the file when autoSave is enabled
    clearTimeout(autoSaveTimeout);
    autoSaveTimeout = setTimeout(() => {
      if (editorPrefs.autoSave && hasChanges && activeTabPath) {
        // Save silently (no toast, no mode switch) so the user can keep typing
        silentSave().catch(err => console.error('Auto-save failed:', err));
      }
    }, AUTO_SAVE_DELAY);
  }
  
  /**
   * Silent save used by auto-save. Persists without showing a success toast
   * or switching out of edit mode, so the user can continue editing.
   */
  async function silentSave() {
    if (!activeTabPath) return;
    const tab = openTabs.find(t => t.path === activeTabPath);
    if (!tab || !tab.project) return;
    
    await IDEStorage.Files.writeContent(tab.project, tab.path, currentContent);
    originalContent = currentContent;
    tab.hasChanges = false;
    tab.content = currentContent;
    updateTabVisuals();
    
    if (window.IDEState) {
      IDEState.setLastSaved(Date.now());
    }
    
    if (IDEUtils && IDEUtils.playSound) {
      IDEUtils.playSound('save');
    }
    
    // Notify callback (e.g. version browser may want to know)
    if (onFileSave) {
      onFileSave(tab, currentContent);
    }
  }

  /**
   * Update cursor position display
   */
  function updateCursorPosition(textarea) {
    const text = textarea.value.substring(0, textarea.selectionStart);
    const lines = text.split('\n');
    const line = lines.length;
    const column = lines[lines.length - 1].length + 1;
    
    const lineInfo = editorContainer.querySelector('.line-info');
    if (lineInfo) {
      lineInfo.textContent = `Line ${line}, Column ${column}`;
    }
  }

  /**
   * Enter edit mode
   */
  function enterEditMode() {
    currentMode = 'edit';
    displayContent(currentContent);
  }

  /**
   * Exit edit mode (cancel changes)
   */
  function exitEditMode() {
    currentMode = 'view';
    
    // Revert to original content
    const tab = openTabs.find(t => t.path === activeTabPath);
    if (tab) {
      tab.hasChanges = false;
    }
    updateTabVisuals();
    
    displayContent(originalContent);
  }

  /**
   * Check if currently editing
   */
  function isEditing() {
    return currentMode === 'edit';
  }

  /**
   * Check if file can be previewed
   */
  function canPreview(file) {
    if (!file || !file.name) return false;
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    return ['.html', '.htm', '.md', '.markdown'].includes(ext);
  }

  // ============================================
  // Save Operations
  // ============================================
  
  /**
   * Save current file
   */
  async function saveCurrentFile() {
    if (!activeTabPath) return;
    
    const tab = openTabs.find(t => t.path === activeTabPath);
    if (!tab || !tab.project) return;
    
    try {
      await IDEStorage.Files.writeContent(tab.project, tab.path, currentContent);
      
      // Update state
      originalContent = currentContent;
      tab.hasChanges = false;
      tab.content = currentContent;
      updateTabVisuals();
      
      // Update last saved timestamp
      if (window.IDEState) {
        IDEState.setLastSaved(Date.now());
      }
      
      // Notify callback
      if (onFileSave) {
        onFileSave(tab, currentContent);
      }
      
      // Play save sound if sound effects are enabled
      if (IDEUtils && IDEUtils.playSound) {
        IDEUtils.playSound('save');
      }
      
      // Show success toast
      if (IDEUtils) {
        IDEUtils.showToast(`Saved ${tab.name}`, 'success');
      }
      
      // Switch back to view mode
      currentMode = 'view';
      displayContent(currentContent);
      
    } catch (error) {
      console.error('Failed to save file:', error);
      if (IDEUtils) {
        IDEUtils.showToast(`Failed to save: ${error.message}`, 'error');
      }
    }
  }

  // ============================================
  // Action Button Wiring
  // ============================================
  
  function wireUpViewActions() {
    if (!editorContainer) return;
    
    editorContainer.querySelector('[data-action="edit"]')?.addEventListener('click', enterEditMode);
    editorContainer.querySelector('[data-action="preview"]')?.addEventListener('click', () => {
      currentMode = 'preview';
      displayContent(currentContent);
    });
  }

  function wireUpEditActions() {
    if (!editorContainer) return;
    
    editorContainer.querySelector('[data-action="save"]')?.addEventListener('click', saveCurrentFile);
    editorContainer.querySelector('[data-action="cancel"]')?.addEventListener('click', exitEditMode);
  }

  function wireUpPreviewActions() {
    if (!editorContainer) return;
    
    editorContainer.querySelector('[data-action="view"]')?.addEventListener('click', () => {
      currentMode = 'view';
      displayContent(currentContent);
    });
    editorContainer.querySelector('[data-action="open-new"]')?.addEventListener('click', openPreviewInNew);
  }

  /**
   * Open preview in new browser tab
   */
  function openPreviewInNew() {
    const blob = new Blob([currentContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  }

  // ============================================
  // Panel Toggle
  // ============================================
  
  function togglePanel(show) {
    if (container) {
      container.classList.toggle('hidden', !show);
    }
  }

  // ============================================
  // Utilities
  // ============================================
  
  /**
   * Get currently active tab data
   */
  function getActiveTab() {
    return openTabs.find(t => t.path === activeTabPath) || null;
  }

  /**
   * Simple markdown to HTML converter (basic)
   */
  function markdownToHtml(md) {
    if (!md) return '';
    
    let html = md
      // Headers
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^# (.*$)/gim, '<h1>$1</h1>')
      // Bold/Italic
      .replace(/\*\*\*(.*?)\*\*\*/gim, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/gim, '<em>$1</em>')
      // Code blocks
      .replace(/```(\w+)?\n([\s\S]*?)```/gim, '<pre><code class="$1">$2</code></pre>')
      .replace(/`(.*?)`/gim, '<code>$1</code>')
      // Links
      .replace(/\[([^\]]+)\]\(([^)]+)\)/gim, '<a href="$2">$1</a>')
      // Line breaks
      .replace(/\n/gim, '<br>');
    
    return `<!DOCTYPE html><html><head><style>
      body { font-family: system-ui; padding: 20px; max-width: 800px; margin: 0 auto; }
      pre { background: #f4f4f4; padding: 12px; border-radius: 6px; overflow-x: auto; }
      code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; }
      a { color: #0066cc; }
    </style></head><body>${html}</body></html>`;
  }

  // ============================================

  // ============================================
  // Find & Replace
  // ============================================
  
  let findReplaceEl = null;
  
  function openFind() {
    if (!editorContainer || currentMode !== 'edit') {
      if (window.IDEUtils) IDEUtils.showToast('Open a file in edit mode first', 'warning');
      return;
    }
    
    if (findReplaceEl) {
      closeFindReplace();
    }
    
    findReplaceEl = document.createElement('div');
    findReplaceEl.className = 'find-replace-bar';
    findReplaceEl.innerHTML = \`
      <div class="fr-input-group">
        <label>Find</label>
        <input type="text" class="fr-find-input input" placeholder="Search...">
        <span class="fr-count">0/0</span>
      </div>
      <div class="fr-input-group fr-replace-group">
        <label>Replace</label>
        <input type="text" class="fr-replace-input input" placeholder="Replace...">
      </div>
      <div class="fr-actions">
        <button class="btn btn-ghost btn-xs fr-btn" data-action="fr-prev" title="Previous (Shift+Enter)">▲</button>
        <button class="btn btn-ghost btn-xs fr-btn" data-action="fr-next" title="Next (Enter)">▼</button>
        <button class="btn btn-outline btn-xs fr-btn" data-action="fr-replace" title="Replace">Replace</button>
        <button class="btn btn-outline btn-xs fr-btn" data-action="fr-replace-all" title="Replace All">All</button>
        <button class="btn btn-ghost btn-xs fr-btn" data-action="fr-close" title="Close (Esc)">✕</button>
      </div>
    \`;
    
    editorContainer.insertBefore(findReplaceEl, editorContainer.firstChild);
    
    const findInput = findReplaceEl.querySelector('.fr-find-input');
    findInput.focus();
    
    // Bind events
    bindFindReplaceEvents();
  }
  
  function openReplace() {
    openFind();
    findReplaceEl?.classList.add('show-replace');
  }
  
  function closeFindReplace() {
    if (findReplaceEl) {
      findReplaceEl.remove();
      findReplaceEl = null;
    }
  }
  
  let currentMatchIndex = -1;
  let currentMatches = [];
  
  function bindFindReplaceEvents() {
    const findInput = findReplaceEl.querySelector('.fr-find-input');
    const replaceInput = findReplaceEl.querySelector('.fr-replace-input');
    const countEl = findReplaceEl.querySelector('.fr-count');
    
    // Search on input
    findInput.addEventListener('input', () => performFind());
    
    // Keyboard navigation
    findInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          navigateMatches(-1);
        } else {
          navigateMatches(1);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeFindReplace();
      }
    });
    
    // Button actions
    findReplaceEl.querySelector('[data-action="fr-prev"]')?.addEventListener('click', () => navigateMatches(-1));
    findReplaceEl.querySelector('[data-action="fr-next"]')?.addEventListener('click', () => navigateMatches(1));
    findReplaceEl.querySelector('[data-action="fr-replace"]')?.addEventListener('click', () => replaceCurrent());
    findReplaceEl.querySelector('[data-action="fr-replace-all"]')?.addEventListener('click', () => replaceAll());
    findReplaceEl.querySelector('[data-action="fr-close"]')?.addEventListener('click', closeFindReplace);
  }
  
  function performFind() {
    const textarea = editorContainer?.querySelector('.code-editor-textarea');
    const findInput = findReplaceEl?.querySelector('.fr-find-input');
    const countEl = findReplaceEl?.querySelector('.fr-count');
    
    if (!textarea || !findInput) return;
    
    const query = findInput.value;
    const text = textarea.value;
    
    currentMatches = [];
    currentMatchIndex = -1;
    
    if (query) {
      // Find all matches (case-insensitive)
      const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      let match;
      while ((match = regex.exec(text)) !== null) {
        currentMatches.push({ index: match.index, length: match[0].length, text: match[0] });
      }
      
      if (currentMatches.length > 0) {
        currentMatchIndex = 0;
        highlightMatch(textarea);
      }
    }
    
    // Update count
    if (countEl) {
      countEl.textContent = currentMatches.length > 0 
        ? \`\${currentMatchIndex + 1}/\${currentMatches.length}\` 
        : '0/0';
    }
  }
  
  function navigateMatches(direction) {
    if (currentMatches.length === 0) return;
    
    const textarea = editorContainer?.querySelector('.code-editor-textarea');
    if (!textarea) return;
    
    currentMatchIndex += direction;
    if (currentMatchIndex < 0) currentMatchIndex = currentMatches.length - 1;
    if (currentMatchIndex >= currentMatches.length) currentMatchIndex = 0;
    
    highlightMatch(textarea);
    
    // Update count
    const countEl = findReplaceEl?.querySelector('.fr-count');
    if (countEl) {
      countEl.textContent = \`\${currentMatchIndex + 1}/\${currentMatches.length}\`;
    }
  }
  
  function highlightMatch(textarea) {
    const match = currentMatches[currentMatchIndex];
    if (!match) return;
    
    textarea.focus();
    textarea.setSelectionRange(match.index, match.index + match.length);
    
    // Scroll to selection
    const lineNum = textarea.value.substring(0, match.index).split('\n').length;
    const lineHeight = parseInt(getComputedStyle(textarea).lineHeight) || 20;
    textarea.scrollTop = Math.max(0, (lineNum - 10) * lineHeight);
  }
  
  function replaceCurrent() {
    const textarea = editorContainer?.querySelector('.code-editor-textarea');
    const replaceInput = findReplaceEl?.querySelector('.fr-replace-input');
    
    if (!textarea || !replaceInput || currentMatches.length === 0) return;
    
    const match = currentMatches[currentMatchIndex];
    const newText = textarea.value.substring(0, match.index) + 
                    replaceInput.value + 
                    textarea.value.substring(match.index + match.length);
    
    textarea.value = newText;
    handleEditInput(textarea); // Trigger change handler
    
    // Re-find to update matches
    performFind();
  }
  
  function replaceAll() {
    const textarea = editorContainer?.querySelector('.code-editor-textarea');
    const findInput = findReplaceEl?.querySelector('.fr-find-input');
    const replaceInput = findReplaceEl?.querySelector('.fr-replace-input');
    
    if (!textarea || !findInput) return;
    
    const query = findInput.value;
    if (!query) return;
    
    const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    const newText = textarea.value.replace(regex, replaceInput.value);
    
    if (newText !== textarea.value) {
      textarea.value = newText;
      handleEditInput(textarea);
      if (window.IDEUtils) IDEUtils.showToast(\`Replaced \${currentMatches.length} occurrences\`, 'success');
    }
    
    performFind(); // Re-find (should be 0 now)
  }


  // Public API
  // ============================================
  
  return {
    init,
    openFile,
    closeTab,
    closeOtherTabs,
    saveCurrentFile,
    enterEditMode,
    exitEditMode,
    refresh: async () => {
      const activeFile = getActiveTab();
      if (activeFile) {
        await loadFileContent(activeFile);
      }
    },
    
    getState: () => ({
      openTabs: [...openTabs],
      activeTabPath,
      currentMode,
      hasChanges: openTabs.some(t => t.hasChanges)
    }),
    
    getActiveTab
  };
})();

// Export for use in other modules
window.CodeEditorComponent = CodeEditorComponent;
