/**
 * SBIDE - Main Application Bootstrap
 * Initializes all components and wires up cross-component communication
 */

(function() {
  'use strict';
  
  // ============================================
  // App State
  // ============================================
  
  const AppState = {
    initialized: false,
    initializing: false,
    error: null,
    
    // Component references (set during init)
    sidebar: null,
    fileTree: null,
    codeEditor: null,
    chatWindow: null
  };

  // ============================================
  // Initialization
  // ============================================
  
  /**
   * Main initialization function - called when DOM is ready
   */
  async function initialize() {
    if (AppState.initialized || AppState.initializing) return;
    AppState.initializing = true;
    
    console.log('🚀 Initializing SBIDE...');
    
    try {
      // Show loading state or hide error
      const errorEl = document.getElementById('init-error-message');
      if (errorEl) errorEl.classList.add('hidden');
      
      // Step 1: Initialize storage (IndexedDB)
      console.log('📦 Initializing storage...');
      await IDEStorage.init();
      /* storage fallback warning — non-blocking */
      if (window.IDEStorage && IDEStorage.isFallbackMode && IDEStorage.isFallbackMode()) {
        console.warn('⚠️ Storage running in fallback (in-memory) mode — data will not persist across reloads.');
        if (window.IDEUtils && IDEUtils.showToast) {
          IDEUtils.showToast('Storage unavailable — running in temporary mode. Data won\'t persist.', 'warning', 6000);
        }
      }
      console.log('✅ Storage initialized');
      
      // Step 2: Initialize state from persistence (MUST be before themes!)
      console.log('💾 Hydrating state...');
      const savedState = IDEState.getState();
      console.log('✅ State hydrated', { 
        hasProject: !!savedState.currentProject, 
        theme: savedState.settings?.theme 
      });
      
      // Step 3: Initialize themes (AFTER state is loaded)
      console.log('🎨 Initializing themes...');
      if (window.IDEThemes) {
        IDEThemes.init();
      }
      console.log('✅ Themes initialized');
      
      // Step 4: Initialize components in order
      await initializeComponents();
      
      // Step 5: Setup global event handlers
      setupGlobalHandlers();
      
      // Step 6: Load initial data
      await loadInitialData();
      
      // Mark as initialized
      AppState.initialized = true;
      AppState.initializing = false;
      
      console.log('✨ SBIDE ready!');
      
      // Dispatch ready event
      window.dispatchEvent(new CustomEvent('ide-ready'));
      
    } catch (error) {
      console.error('❌ Initialization failed:', error);
      AppState.error = error;
      AppState.initializing = false;
      
      showInitError(error.message || 'Failed to initialize application');
    }
  }

  /**
   * Initialize all UI components
   */
  async function initializeComponents() {
    // Get DOM references (using ACTUAL element IDs from HTML)
    const appContainer = document.getElementById('app');
    const sidebarContainer = document.getElementById('sidebar');
    const editorContainer = document.getElementById('editor-panel');
    const chatContainer = document.getElementById('chat-area');
    
    if (!appContainer) {
      throw new Error('App container not found');
    }
    
    // Initialize Sidebar
    console.log('📂 Initializing sidebar...');
    if (sidebarContainer && window.SidebarComponent) {
      AppState.sidebar = SidebarComponent;
      SidebarComponent.init(sidebarContainer, {
        onFileSelect: handleFileSelectFromSidebar,
        onProjectChange: handleProjectChange
      });
    }
    console.log('✅ Sidebar initialized');
    
    // Initialize Code Editor
    console.log('📝 Initializing code editor...');
    if (editorContainer && window.CodeEditorComponent) {
      AppState.codeEditor = CodeEditorComponent;
      CodeEditorComponent.init(editorContainer, {
        onContentChange: handleEditorContentChange,
        onFileSave: handleFileSave
      });
    }
    console.log('✅ Code editor initialized');
    
    // Initialize Chat Window
    console.log('💬 Initializing chat window...');
    if (chatContainer && window.ChatWindowComponent) {
      AppState.chatWindow = ChatWindowComponent;
      ChatWindowComponent.init(chatContainer, {
        onSendMessage: handleSendMessage,
        onToolAction: handleToolAction
      });
    }
    console.log('✅ Chat window initialized');
    
    // Store file tree reference for easy access
    if (window.FileTreeComponent) {
      AppState.fileTree = FileTreeComponent;
    }
    
    // Initialize LLM Manager
    console.log('🤖 Initializing LLM Manager...');
    if (window.LLMManagerComponent) {
      AppState.llmManager = LLMManagerComponent;
      LLMManagerComponent.init({
        onProviderChange: handleProviderChange
      });
    }
    console.log('✅ LLM Manager initialized');
  }

  /**
   * Setup global event handlers using CORRECT element IDs from HTML
   */
  function setupGlobalHandlers() {
    // Header buttons - using actual IDs from HTML
    setupHeaderButtons();
    
    // Keyboard shortcuts
    setupKeyboardShortcuts();
    
    // Window events
    setupWindowEvents();
    
    // Context menu handler
    setupContextMenuHandler();
  }

  /**
   * Setup header action buttons with CORRECT IDs
   */
  function setupHeaderButtons() {
    // Settings button (id="settings-btn") - use SidebarComponent
    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => {
        // Use SidebarComponent if available, otherwise fallback
        if (window.SidebarComponent) {
          SidebarComponent.toggleSettings(true);
        } else {
          const settingsModal = document.getElementById('settings-modal');
          if (settingsModal) {
            settingsModal.classList.remove('hidden');
          }
        }
      });
    }
    
    // Theme cycle button (id="theme-cycle-btn")
    const themeBtn = document.getElementById('theme-cycle-btn');
    if (themeBtn && window.IDEThemes) {
      themeBtn.addEventListener('click', () => {
        const current = IDEThemes.getCurrentTheme();
        const themes = Object.keys(IDEThemes.THEMES);
        const currentIndex = themes.indexOf(current.id);
        const nextIndex = (currentIndex + 1) % themes.length;
        IDEThemes.applyTheme(themes[nextIndex]);
        
        if (IDEUtils) {
          IDEUtils.showToast(`Theme: ${IDEThemes.THEMES[themes[nextIndex]].name}`, 'info', 2000);
        }
      });
    }
    
    // Editor panel toggle (id="editor-panel-toggle")
    const editorToggleBtn = document.getElementById('editor-panel-toggle');
    if (editorToggleBtn) {
      editorToggleBtn.addEventListener('click', () => {
        if (window.IDEState) {
          IDEState.setEditorPanelOpen(!IDEState.get('editorPanelOpen'));
        }
      });
    }

    // ============================================
    // Mobile bottom-nav buttons (Files / Chat / Editor / Settings)
    // Wire up click handlers so the buttons actually do something.
    // On mobile (<768px), only one panel can comfortably fit at a time,
    // so each button hides the others and shows its target.
    // ============================================
    const mobileNav = document.getElementById('mobile-nav');
    
    // Create backdrop overlay for sidebar mode (tapping outside closes it)
    let mobileBackdrop = null;
    function getMobileBackdrop() {
      if (!mobileBackdrop) {
        mobileBackdrop = document.createElement('div');
        mobileBackdrop.className = 'mobile-overlay';
        mobileBackdrop.setAttribute('aria-hidden', 'true');
        mobileBackdrop.addEventListener('click', () => {
          // When backdrop is tapped, switch back to chat view
          const chatBtn = mobileNav?.querySelector('.mobile-nav-btn[data-panel="chat"]');
          if (chatBtn) chatBtn.click();
        });
        document.body.appendChild(mobileBackdrop);
      }
      return mobileBackdrop;
    }

    function showMobileBackdrop() {
      const backdrop = getMobileBackdrop();
      backdrop.classList.remove('hidden');
      // Force reflow then add visible
      void backdrop.offsetWidth;
    }

    function hideMobileBackdrop() {
      if (mobileBackdrop) {
        mobileBackdrop.classList.add('hidden');
      }
    }

    // Debounce tracker to prevent rapid-fire button presses
    let lastMobileNavClick = 0;
    const MOBILE_NAV_DEBOUNCE_MS = 150;

    if (mobileNav) {
      const mobileBtns = mobileNav.querySelectorAll('.mobile-nav-btn');
      
      mobileBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
          // Prevent default for touch devices to avoid any ghost clicks
          // e.preventDefault();
          
          if (btn.disabled) return;
          
          // Debounce: ignore rapid repeated clicks
          const now = Date.now();
          if (now - lastMobileNavClick < MOBILE_NAV_DEBOUNCE_MS) return;
          lastMobileNavClick = now;

          const panel = btn.dataset.panel;
          if (!panel) return;

          // Update active state on the nav buttons
          // Special case: settings is a momentary action — don't keep it active
          const isMomentaryAction = panel === 'settings';
          mobileBtns.forEach(b => {
            if (isMomentaryAction) {
              b.classList.remove('active');
              // Restore previous active state after a delay
              requestAnimationFrame(() => {
                const chatBtn = mobileNav.querySelector('.mobile-nav-btn[data-panel="chat"]');
                if (chatBtn) chatBtn.classList.add('active');
              });
            } else {
              b.classList.toggle('active', b === btn);
            }
          });

          const sidebarEl = document.getElementById('sidebar');
          const chatEl = document.getElementById('chat-area');
          const editorEl = document.getElementById('editor-panel');

          switch (panel) {
            case 'sidebar': {
              // Show sidebar, hide chat + editor on mobile
              if (sidebarEl) sidebarEl.classList.remove('hidden');
              if (chatEl) chatEl.classList.add('hidden');
              if (editorEl) editorEl.classList.add('hidden');
              if (AppState?.sidebar) AppState.sidebar.showSidebar();
              if (window.IDEState) IDEState.setSidebarOpen(true);
              // Show backdrop so user can tap to close sidebar
              showMobileBackdrop();
              break;
            }
            case 'chat': {
              // Show chat, hide sidebar + editor on mobile
              if (sidebarEl) {
                sidebarEl.classList.add('hidden');
                // Also close the sidebar slide-out
                if (AppState?.sidebar) AppState.sidebar.hideSidebar?.();
              }
              if (chatEl) chatEl.classList.remove('hidden');
              if (editorEl) editorEl.classList.add('hidden');
              if (window.IDEState) IDEState.setEditorPanelOpen(false);
              hideMobileBackdrop();
              break;
            }
            case 'editor': {
              // Show editor, hide sidebar + chat on mobile
              if (sidebarEl) {
                sidebarEl.classList.add('hidden');
                if (AppState?.sidebar) AppState.sidebar.hideSidebar?.();
              }
              if (chatEl) chatEl.classList.add('hidden');
              if (editorEl) editorEl.classList.remove('hidden');
              if (window.IDEState) IDEState.setEditorPanelOpen(true);
              hideMobileBackdrop();
              break;
            }
            case 'settings': {
              // Open the settings modal — this is momentary, don't change panels
              if (AppState?.sidebar && typeof AppState.sidebar.toggleSettings === 'function') {
                AppState.sidebar.toggleSettings(true);
                
                // Watch for settings modal close to restore proper active state
                const settingsModal = document.getElementById('settings-modal');
                if (settingsModal) {
                  const observer = new MutationObserver((mutations) => {
                    mutations.forEach((mutation) => {
                      if (mutation.attributeName === 'class') {
                        if (settingsModal.classList.contains('hidden')) {
                          // Modal closed — ensure chat button is active again
                          const chatBtn = mobileNav.querySelector('.mobile-nav-btn[data-panel="chat"]');
                          mobileBtns.forEach(b => b.classList.remove('active'));
                          if (chatBtn) chatBtn.classList.add('active');
                          observer.disconnect();
                        }
                      }
                    });
                  });
                  observer.observe(settingsModal, { attributes: true });
                  
                  // Auto-disconnect after 10 seconds (safety net)
                  setTimeout(() => observer.disconnect(), 10000);
                }
              }
              break;
            }
          }
        });

        // Prevent touch-hold context menu on nav buttons
        btn.addEventListener('contextmenu', (e) => e.preventDefault());
      });

      // Keep mobile-nav button active state in sync with editor panel visibility
      if (window.IDEState) {
        IDEState.subscribe((state, prevState) => {
          if (state.editorPanelOpen !== prevState.editorPanelOpen) {
            const editorBtn = mobileNav.querySelector('.mobile-nav-btn[data-panel="editor"]');
            const chatBtn = mobileNav.querySelector('.mobile-nav-btn[data-panel="chat"]');
            // Only update active state if we're on mobile (mobile-nav is visible)
            const isMobile = window.matchMedia('(max-width: 767px)').matches;
            if (!isMobile) return;
            if (editorBtn && chatBtn) {
              editorBtn.classList.toggle('active', state.editorPanelOpen);
              chatBtn.classList.toggle('active', !state.editorPanelOpen);
            }
          }
        });
      }

      // Handle sidebar close from within sidebar component (e.g., X button)
      // and sync mobile nav state
      const sidebarObserver = new MutationObserver((mutations) => {
        const sidebarEl = document.getElementById('sidebar');
        if (!sidebarEl) return;
        
        mutations.forEach((mutation) => {
          if (mutation.attributeName === 'class') {
            const isOpen = sidebarEl.classList.contains('open') && !sidebarEl.classList.contains('hidden');
            const sidebarBtn = mobileNav.querySelector('.mobile-nav-btn[data-panel="sidebar"]');
            
            if (!isOpen && sidebarBtn?.classList.contains('active')) {
              // Sidebar was closed externally — switch to chat
              const chatBtn = mobileNav.querySelector('.mobile-nav-btn[data-panel="chat"]');
              mobileBtns.forEach(b => b.classList.remove('active'));
              if (chatBtn) chatBtn.classList.add('active');
              hideMobileBackdrop();
            }
          }
        });
      });

      const sidebarEl = document.getElementById('sidebar');
      if (sidebarEl) {
        sidebarObserver.observe(sidebarEl, { attributes: true });
      }
    }
    
    // ============================================
    // Chat Toolbar Toggles: Web Search & Diff Patch Mode
    // These are momentary/per-message toggles that modify how the next
    // message is processed. State is stored in window.__ideToolbarState
    // (initialized by boot.js, read by api.js).
    // ============================================
    
    // Ensure toolbar state exists (boot.js should have created it)
    if (!window.__ideToolbarState) {
      window.__ideToolbarState = {
        webSearchEnabled: false,
        diffPatchMode: false
      };
    }
    
    // Web Search Toggle Button
    const webSearchBtn = document.getElementById('web-search-btn');
    if (webSearchBtn) {
      webSearchBtn.addEventListener('click', () => {
        const isNowActive = !window.__ideToolbarState.webSearchEnabled;
        window.__ideToolbarState.webSearchEnabled = isNowActive;
        
        // Update button visual state
        webSearchBtn.classList.toggle('active', isNowActive);
        webSearchBtn.setAttribute('aria-pressed', String(isNowActive));
        
        // Update context indicator visibility
        const contextIndicator = document.getElementById('context-indicator');
        if (contextIndicator) {
          contextIndicator.classList.toggle('hidden', !isNowActive);
          if (isNowActive) {
            contextIndicator.style.color = 'var(--color-primary, #6366f1)';
          }
        }
        
        // Dispatch event so other components can react
        window.dispatchEvent(new CustomEvent('toolbar:websearch-toggle', { 
          detail: { enabled: isNowActive } 
        }));
        
        // Show brief toast feedback
        if (window.AppState?.showToast) {
          window.AppState.showToast(
            isNowActive ? '🔍 Web search enabled — AI will search the internet' : 'Web search disabled',
            'info',
            2000
          );
        }
      });
    }
    
    // Diff Patch Mode Toggle Button
    const diffPatchBtn = document.getElementById('diff-patch-btn');
    if (diffPatchBtn) {
      diffPatchBtn.addEventListener('click', () => {
        const isNowActive = !window.__ideToolbarState.diffPatchMode;
        window.__ideToolbarState.diffPatchMode = isNowActive;
        
        // Update button visual state
        diffPatchBtn.classList.toggle('active', isNowActive);
        diffPatchBtn.setAttribute('aria-pressed', String(isNowActive));
        
        // Dispatch event so other components can react
        window.dispatchEvent(new CustomEvent('toolbar:diffpatch-toggle', { 
          detail: { enabled: isNowActive } 
        }));
        
        // Show brief toast feedback
        if (window.AppState?.showToast) {
          window.AppState.showToast(
            isNowActive ? '📝 Diff patch mode enabled — responses use unified diff format' : 'Diff patch mode disabled',
            'info',
            2000
          );
        }
      });
    }
    
    // Auto-disable Web Search after each message is sent (momentary action)
    // Listen for send events from chat component
    window.addEventListener('chat:message-sent', () => {
      if (window.__ideToolbarState.webSearchEnabled) {
        window.__ideToolbarState.webSearchEnabled = false;
        if (webSearchBtn) {
          webSearchBtn.classList.remove('active');
          webSearchBtn.setAttribute('aria-pressed', 'false');
        }
        const contextIndicator = document.getElementById('context-indicator');
        if (contextIndicator) contextIndicator.classList.add('hidden');
      }
      
      // Note: Diff Patch Mode persists until explicitly toggled off
      // because it's a mode preference, not a one-shot action
    });
    
    // Persist/restore toolbar state from localStorage
    try {
      const savedDiffPatch = localStorage.getItem('sbide-diff-patch-mode');
      if (savedDiffPatch === 'true') {
        window.__ideToolbarState.diffPatchMode = true;
        if (diffPatchBtn) {
          diffPatchBtn.classList.add('active');
          diffPatchBtn.setAttribute('aria-pressed', 'true');
        }
      }
    } catch (e) {
      // localStorage unavailable, ignore
    }
    
    // Save diff patch state on change
    window.addEventListener('toolbar:diffpatch-toggle', (e) => {
      try {
        localStorage.setItem('sbide-diff-patch-mode', String(e.detail.enabled));
      } catch (e) {
        // ignore
      }
    });

    // Download current file button (id="download-file-btn").
    // Despite its old name, this button lives inside the editor header and is
    // labelled "Download file" — it should download the currently active file,
    // not the whole project. Project export is still available via the
    // header's export icon and the project context menu.
    const exportBtn = document.getElementById('download-file-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', handleDownloadCurrentFile);
    }
    
    // View mode toggles (id="btn-view-chat", id="btn-view-editor", id="btn-view-preview")
    const viewChatBtn = document.getElementById('btn-view-chat');
    const viewEditorBtn = document.getElementById('btn-view-editor');
    const viewPreviewBtn = document.getElementById('btn-view-preview');
    
    // Helper to deactivate all view buttons
    function deactivateAllViewButtons() {
      [viewChatBtn, viewEditorBtn, viewPreviewBtn].forEach(btn => {
        if (btn) {
          btn.classList.remove('active');
          btn.setAttribute('aria-selected', 'false');
        }
      });
    }
    
    // --- Independent visibility toggles (Issue #3 fix) ---
    // Chat and Editor buttons toggle their respective panels on/off
    // independently. Both can be visible at once (split view), and
    // either can be the sole visible panel (filling the full width).
    // Preview is a *mode* of the editor: clicking it shows the editor
    // and switches it to preview mode.

    function syncViewToggleStates() {
      const chat = document.getElementById('chat-area');
      const editor = document.getElementById('editor-panel');
      const chatVisible = chat ? !chat.classList.contains('hidden') : false;
      const editorVisible = editor ? !editor.classList.contains('hidden') : false;

      if (viewChatBtn) {
        viewChatBtn.classList.toggle('active', chatVisible);
        viewChatBtn.setAttribute('aria-selected', String(chatVisible));
        viewChatBtn.setAttribute('aria-pressed', String(chatVisible));
      }
      if (viewEditorBtn) {
        viewEditorBtn.classList.toggle('active', editorVisible);
        viewEditorBtn.setAttribute('aria-selected', String(editorVisible));
        viewEditorBtn.setAttribute('aria-pressed', String(editorVisible));
      }
      // Preview button active state is handled separately when entering
      // preview mode; default to inactive on sync.
      if (viewPreviewBtn && !window.__idePreviewActive) {
        viewPreviewBtn.classList.remove('active');
        viewPreviewBtn.setAttribute('aria-selected', 'false');
        viewPreviewBtn.setAttribute('aria-pressed', 'false');
      }
    }

    function ensureAtLeastOneVisible() {
      const chat = document.getElementById('chat-area');
      const editor = document.getElementById('editor-panel');
      const chatHidden = chat ? chat.classList.contains('hidden') : true;
      const editorHidden = editor ? editor.classList.contains('hidden') : true;
      if (chatHidden && editorHidden) {
        // Re-show chat as a sane default so the user isn't staring at empty space.
        // Direct class toggle is safe here because no state change accompanies it
        // (so no subscriber fires to interrupt the transition).
        chat?.classList.remove('hidden');
        if (window.IDEState) IDEState.setEditorPanelOpen(false);
      }
    }

    // Chat button: toggle chat-area visibility
    if (viewChatBtn) {
      viewChatBtn.addEventListener('click', () => {
        const chat = document.getElementById('chat-area');
        if (!chat) return;
        const willShow = chat.classList.contains('hidden');
        chat.classList.toggle('hidden', !willShow);
        // If hiding chat would leave nothing visible, force editor open.
        // Only update state — the subscriber applies the class change so
        // the editor's CSS transition isn't interrupted by a redundant
        // direct classList.toggle.
        if (!willShow) {
          const editor = document.getElementById('editor-panel');
          if (editor && editor.classList.contains('hidden')) {
            if (window.IDEState) IDEState.setEditorPanelOpen(true);
          }
        }
        syncViewToggleStates();
      });
    }

    // Editor button: toggle editor-panel visibility
    //
    // We DO NOT toggle the .hidden class directly here. The state subscriber
    // (registered below) is the single source of truth that applies the class
    // change. Doing it in both places caused the browser to see two rapid
    // class mutations on the same element, which interrupted the CSS
    // transition and made the editor panel snap open/closed without animating
    // (the chat toggle, by contrast, only touches the class once and animates
    // correctly).
    if (viewEditorBtn) {
      viewEditorBtn.addEventListener('click', () => {
        const editor = document.getElementById('editor-panel');
        if (!editor) return;
        const willShow = editor.classList.contains('hidden');
        // Update state — the subscriber will toggle .hidden and animate.
        if (window.IDEState) IDEState.setEditorPanelOpen(willShow);
        // If hiding editor would leave nothing visible, force chat open.
        if (!willShow) {
          const chat = document.getElementById('chat-area');
          if (chat && chat.classList.contains('hidden')) {
            chat.classList.remove('hidden');
          }
        }
        // Exiting preview mode if we're toggling the editor
        if (!willShow && window.__idePreviewActive) {
          window.__idePreviewActive = false;
        }
        syncViewToggleStates();
      });
    }

    // Preview button: switch editor into preview mode (don't hide chat)
    if (viewPreviewBtn) {
      viewPreviewBtn.addEventListener('click', () => {
        const activeFile = window.IDEState?.get('activeFile');

        let canPreviewFile = false;
        if (activeFile) {
          const name = activeFile.name || activeFile.path || '';
          canPreviewFile = /\.(html?|md|markdown)$/i.test(name);
        }

        if (!canPreviewFile && !activeFile) {
          if (window.IDEUtils) {
            IDEUtils.showToast('Open an HTML or Markdown file to preview', 'info', 3000);
          }
          return;
        }

        if (!canPreviewFile && activeFile) {
          if (window.IDEUtils) {
            IDEUtils.showToast('Only HTML and Markdown files can be previewed', 'warning', 3000);
          }
          return;
        }

        // Make sure editor is visible
        const editor = document.getElementById('editor-panel');
        if (editor && editor.classList.contains('hidden')) {
          editor.classList.remove('hidden');
          if (window.IDEState) IDEState.setEditorPanelOpen(true);
        }

        // Toggle preview mode
        window.__idePreviewActive = true;
        if (viewPreviewBtn) {
          viewPreviewBtn.classList.add('active');
          viewPreviewBtn.setAttribute('aria-selected', 'true');
          viewPreviewBtn.setAttribute('aria-pressed', 'true');
        }

        // Trigger preview mode in code editor
        if (window.CodeEditorComponent && AppState.codeEditor) {
          const previewAction = document.querySelector('[data-action="preview"]');
          if (previewAction) {
            previewAction.click();
          } else if (typeof CodeEditorComponent.setMode === 'function') {
            CodeEditorComponent.setMode('preview');
          }
        }
        syncViewToggleStates();
      });
    }

    // Keep toggle buttons in sync when other code changes panel visibility
    if (window.IDEState) {
      IDEState.subscribe((state, prevState) => {
        if (state.editorPanelOpen !== prevState.editorPanelOpen) {
          const editor = document.getElementById('editor-panel');
          if (editor) {
            editor.classList.toggle('hidden', !state.editorPanelOpen);
          }
          syncViewToggleStates();
        }
      });
    }
    // Initial sync after init
    setTimeout(syncViewToggleStates, 0);
    
    // Refresh files button (id="refresh-files-btn") - in sidebar panel
    const refreshBtn = document.getElementById('refresh-files-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', handleRefreshFiles);
    }
    
    // Save file button (id="save-file-btn")
    const saveFileBtn = document.getElementById('save-file-btn');
    if (saveFileBtn) {
      saveFileBtn.addEventListener('click', async () => {
        if (AppState.codeEditor) {
          await AppState.codeEditor.saveCurrentFile();
        }
      });
    }
    
    // Close settings modal button
    const closeSettingsBtn = document.getElementById('close-settings-btn');
    if (closeSettingsBtn) {
      closeSettingsBtn.addEventListener('click', () => {
        document.getElementById('settings-modal')?.classList.add('hidden');
      });
    }
    
    // Close settings modal on overlay click
    const settingsModal = document.getElementById('settings-modal');
    if (settingsModal) {
      settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
          settingsModal.classList.add('hidden');
        }
      });
    }
    
    // LLM Provider Switcher Button (id="llm-provider-btn")
    const llmProviderBtn = document.getElementById('llm-provider-btn');
    if (llmProviderBtn && window.LLMManagerComponent) {
      llmProviderBtn.addEventListener('click', () => {
        LLMManagerComponent.showSwitcherModal();
      });
    }
    
    // Context Window Indicator (id="context-window-indicator")
    const contextIndicator = document.getElementById('context-window-indicator');
    if (contextIndicator && window.LLMManagerComponent) {
      contextIndicator.addEventListener('click', () => {
        LLMManagerComponent.showSwitcherModal();
      });
      // Initial update
      updateContextWindowIndicator();
    }
    
    // Listen for context updates
    window.addEventListener('llm:contextUpdate', updateContextWindowIndicator);
    
    // Listen for provider changes
    window.addEventListener('llm:providerChanged', updateProviderBadge);
    
    // Listen for rate limits
    window.addEventListener('llm:rateLimit', handleRateLimitEvent);
  }

  /**
   * Setup keyboard shortcuts
   */
  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Don't trigger when typing in inputs
      if (e.target.matches('input, textarea, [contenteditable]')) {
        if (e.key === 'Escape') {
          // Close any open modal
          const openModal = document.querySelector('.modal-overlay:not(.hidden)');
          if (openModal) {
            openModal.classList.add('hidden');
          }
          
          // Close settings modal
          document.getElementById('settings-modal')?.classList.add('hidden');
        }
        return;
      }
      
      // Ctrl/Cmd + B - Toggle sidebar
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        toggleSidebarVisibility();
      }
      
      // Ctrl/Cmd + P - Quick open file
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault();
        showQuickOpen();
      }
      
      // Ctrl/Cmd + S - Save file
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (AppState.codeEditor) {
          AppState.codeEditor.saveCurrentFile();
        }
      }
      
      // F1 - Help
      if (e.key === 'F1') {
        e.preventDefault();
        showHelp();
      }
    });
  }

  /**
   * Setup window events
   */
  function setupWindowEvents() {
    // Handle visibility change
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        console.log('Page hidden');
      } else {
        console.log('Page visible');
      }
    });
    
    // Handle beforeunload (warn about unsaved changes)
    window.addEventListener('beforeunload', (e) => {
      const editorState = AppState.codeEditor?.getState?.();
      if (editorState?.hasChanges) {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
      }
    });
    
    // Handle online/offline
    window.addEventListener('online', () => {
      if (IDEUtils) IDEUtils.showToast('Connection restored', 'success');
    });
    
    window.addEventListener('offline', () => {
      if (IDEUtils) IDEUtils.showToast('You are offline. Some features may be limited.', 'warning');
    });

    // ─────────────────────────────────────────────────────
    // Offline Kit integration: surface a one-line status
    // summary when the kit comes online. The kit also mounts
    // its own bottom-right badge (clickable to open settings)
    // — this toast is the additional first-run cue.
    // ─────────────────────────────────────────────────────
    window.addEventListener('offlinekit:ready', (e) => {
      const status = e.detail || {};
      const parts = [];
      if (status.storage === 'opfs') parts.push('OPFS storage');
      else if (status.storage === 'filesystem') parts.push('Disk folder connected');
      else if (status.storage === 'memory') parts.push('Memory-only storage');

      if (status.llm?.type === 'ollama') parts.push(`Ollama: ${status.llm.model || 'ready'}`);
      else if (status.llm?.type === 'webllm') parts.push('WebLLM ready (loads on first chat)');
      else if (status.llm?.type === 'cloud') parts.push(`Cloud LLM: ${status.llm.model || 'configured'}`);
      else if (status.webLLMSupported) parts.push('Local LLM available (click badge → settings)');

      if (parts.length === 0) return;
      const msg = `Offline Kit ready · ${parts.join(' · ')}`;
      if (window.IDEUtils && IDEUtils.showToast) {
        IDEUtils.showToast(msg, 'info', 5000);
      }
      console.log('[App]', msg, status);
    });
  }

  /**
   * Setup context menu handler
   */
  function setupContextMenuHandler() {
    window.addEventListener('filecontextmenu', async (event) => {
      const { event: mouseEvent, item } = event.detail;
      
      // Create custom context menu
      const menu = document.createElement('div');
      menu.className = 'context-menu';
      menu.innerHTML = `
        <div class="context-menu-item" data-action="open">Open</div>
        ${item.type === 'file' ? `
          <div class="context-menu-item" data-action="edit">Edit</div>
          <div class="context-menu-item" data-action="copy-path">Copy Path</div>
          <div class="context-menu-divider"></div>
          <div class="context-menu-item danger" data-action="delete">Delete</div>
        ` : `
          <div class="context-menu-item" data-action="new-file">New File</div>
          <div class="context-menu-item" data-action="new-folder">New Folder</div>
          <div class="context-menu-divider"></div>
          <div class="context-menu-item danger" data-action="delete">Delete</div>
        `}
      `;
      
      // Position menu
      menu.style.left = mouseEvent.pageX + 'px';
      menu.style.top = mouseEvent.pageY + 'px';
      document.body.appendChild(menu);
      
      // Handle clicks
      menu.querySelectorAll('.context-menu-item').forEach(itemEl => {
        itemEl.addEventListener('click', () => {
          const action = itemEl.dataset.action;
          handleContextAction(action, item);
          menu.remove();
        });
      });
      
      // Close on click outside
      setTimeout(() => {
        document.addEventListener('click', function closeMenu(e) {
          if (!menu.contains(e.target)) {
            menu.remove();
            document.removeEventListener('click', closeMenu);
          }
        });
      }, 0);
    });
  }

  // ============================================
  // Initial Data Loading
  // ============================================
  
  /**
   * Load initial data after components are ready
   */
  async function loadInitialData() {
    const savedState = IDEState.getState();
    
    // If there's a current project, load its data
    if (savedState.currentProject) {
      console.log('Loading project:', savedState.currentProject.name);
      
      if (AppState.sidebar) {
        await AppState.sidebar.loadProjectData(savedState.currentProject);
      }
    } else {
      // Try to get most recent project
      try {
        const projects = await IDEStorage.Projects.getAll();
        if (projects.length > 0) {
          console.log('Auto-loading most recent project:', projects[0].name);
          if (window.IDEState) {
            IDEState.setCurrentProject(projects[0]);
          }
          if (AppState.sidebar) {
            await AppState.sidebar.loadProjectData(projects[0]);
          }
        }
      } catch (error) {
        console.warn('Could not load projects:', error);
      }
    }
    
    // Note: populateProjectsList() is called internally by loadProjectData() above
    // No need to call it separately here
  }

  // ============================================
  // Event Handlers - Cross-Component Communication
  // ============================================
  
  /**
   * Handle file selection from sidebar/file tree
   */
  function handleFileSelectFromSidebar(file) {
    console.log('File selected:', file.path);
    // Code editor handles this internally via state subscription
  }

  /**
   * Handle project change
   */
  function handleProjectChange(project) {
    console.log('Project changed:', project?.name);
  }

  /**
   * Handle content changes in editor
   */
  function handleEditorContentChange(content) {
    // Could trigger auto-save preview, validation, etc.
  }

  /**
   * Handle file save from editor
   */
  function handleFileSave(file, content) {
    console.log('File saved:', file.path);
    
    // Update file tree to reflect changes
    if (AppState.fileTree) {
      AppState.fileTree.refresh();
    }
  }

  /**
   * Handle send message from chat
   */
  async function handleSendMessage(message, callbacks) {
    const project = IDEState?.get('currentProject');
    const messages = IDEState?.get('messages') || [];
    
    // Use API client for streaming
    return IDEAPI.sendMessageStream({
      message,
      messages: messages.filter(m => !m.isStreaming),
      projectName: project?.name || null,
      projectState: IDEState?.get('projectState') || {},
      ...callbacks
    });
  }

  /**
   * Handle tool actions from AI
   */
  function handleToolAction(action) {
    console.log('Tool action:', action);
    
    switch (action.type) {
      case 'call':
        console.log(`AI called tool: ${action.tool}`, action.args);
        break;
        
      case 'result':
        console.log(`Tool result: ${action.success ? 'success' : 'failed'}`);
        
        // If a file was modified, refresh the tree
        if (action.tool?.includes('file') || action.tool?.includes('write')) {
          if (AppState.fileTree) {
            AppState.fileTree.refresh();
          }
        }
        break;
    }
  }

  // ============================================
  // Action Handlers
  // ============================================
  
  /**
   * Toggle sidebar visibility.
   * (Restored from v1: delegates to SidebarComponent to avoid class-state
   * desync between the DOM and the component's internal isOpen/isCollapsed.)
   */
  function toggleSidebarVisibility(forceState) {
    if (AppState.sidebar) {
      if (typeof forceState === 'boolean') {
        if (forceState) {
          AppState.sidebar.showSidebar();
        } else {
          AppState.sidebar.hideSidebar();
        }
      } else {
        AppState.sidebar.toggleCollapse();
      }
    }
  }

  /**
   * Download the currently active file in the editor as a single-file download
   * (not a ZIP). Reads the latest content from storage so unsaved edits are
   * not lost. If no file is active, falls back to a toast prompt.
   */
  async function handleDownloadCurrentFile() {
    const activeFile = IDEState?.get('activeFile');
    if (!activeFile || !activeFile.path) {
      if (IDEUtils) IDEUtils.showToast('Open a file first to download it', 'info');
      return;
    }
    
    const project = IDEState?.get('currentProject');
    if (!project) {
      if (IDEUtils) IDEUtils.showToast('No project selected', 'warning');
      return;
    }
    
    try {
      // Read the latest content from storage (respects any saved edits).
      // Fall back to activeFile.content if storage read fails.
      let content = activeFile.content;
      try {
        const stored = await IDEStorage.Files.readContent(project.name, activeFile.path);
        if (stored != null) content = stored;
      } catch (e) {
        console.warn('Could not read file from storage, using in-memory copy:', e);
      }
      
      // Pick a sensible MIME type from the file extension
      const ext = (activeFile.name.split('.').pop() || '').toLowerCase();
      const mimeMap = {
        html: 'text/html', htm: 'text/html',
        css: 'text/css', js: 'text/javascript', mjs: 'text/javascript',
        ts: 'text/typescript', tsx: 'text/typescript', jsx: 'text/javascript',
        json: 'application/json', md: 'text/markdown',
        txt: 'text/plain', svg: 'image/svg+xml', xml: 'application/xml',
        yaml: 'text/yaml', yml: 'text/yaml'
      };
      const mime = mimeMap[ext] || 'text/plain';
      
      const blob = new Blob([content || ''], { type: mime + ';charset=utf-8' });
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = url;
      link.download = activeFile.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Revoke on next tick so the download has time to start
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      
      if (IDEUtils) IDEUtils.showToast(`Downloaded ${activeFile.name}`, 'success');
    } catch (error) {
      console.error('File download failed:', error);
      if (IDEUtils) IDEUtils.showToast('Download failed: ' + (error.message || 'unknown error'), 'error');
    }
  }

  /**
   * Export the entire current project as a ZIP archive (all files).
   * Used by the project-level export action — NOT by the per-file
   * download-file-btn in the editor header (which calls
   * handleDownloadCurrentFile above).
   */
  async function handleExportProject() {
    const project = IDEState?.get('currentProject');
    if (!project) {
      if (IDEUtils) IDEUtils.showToast('No project selected', 'warning');
      return;
    }
    
    try {
      if (IDEUtils) IDEUtils.showToast('Preparing export...', 'info');
      
      const files = await IDEStorage.Files.exportAsObject(project.name);
      
      if (window.JSZip) {
        const zip = new JSZip();
        
        Object.entries(files).forEach(([path, content]) => {
          zip.file(path, content);
        });
        
        const blob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(blob);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = `${project.name}.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        if (IDEUtils) IDEUtils.showToast('Project exported!', 'success');
      }
      
    } catch (error) {
      console.error('Export failed:', error);
      if (IDEUtils) IDEUtils.showToast('Export failed', 'error');
    }
  }

  /**
   * Create new file
   */
  function handleNewFile() {
    const project = IDEState?.get('currentProject');
    if (!project) {
      if (IDEUtils) IDEUtils.showToast('Create or select a project first', 'warning');
      return;
    }
    
    const name = prompt('Enter filename:');
    if (!name) return;
    
    const validation = IDEUtils?.validateFilename(name);
    if (!validation?.valid) {
      if (IDEUtils) IDEUtils.showToast(validation?.error || 'Invalid filename', 'error');
      return;
    }
    
    createNewFile(name);
  }

  async function createNewFile(filename) {
    const project = IDEState?.get('currentProject');
    if (!project) return;
    
    try {
      await IDEStorage.Files.create({
        project: project.name,
        name: filename,
        path: filename,
        type: 'file',
        content: '',
        size: 0
      });
      
      // Refresh file tree
      if (AppState.fileTree) {
        AppState.fileTree.refresh();
      }
      
      // Open the new file
      const newFile = await IDEStorage.Files.get(project.name, filename);
      if (newFile && AppState.codeEditor) {
        AppState.codeEditor.openFile({ ...newFile, project: project.name });
      }
      
      if (IDEUtils) IDEUtils.showToast(`Created ${filename}`, 'success');
      
    } catch (error) {
      console.error('Failed to create file:', error);
      if (IDEUtils) IDEUtils.showToast('Failed to create file', 'error');
    }
  }

  /**
   * Create new folder
   */
  function handleNewFolder() {
    const project = IDEState?.get('currentProject');
    if (!project) {
      if (IDEUtils) IDEUtils.showToast('Create or select a project first', 'warning');
      return;
    }
    
    const name = prompt('Enter folder name:');
    if (!name) return;
    
    const validation = IDEUtils?.validateFilename(name);
    if (!validation?.valid) {
      if (IDEUtils) IDEUtils.showToast(validation?.error || 'Invalid folder name', 'error');
      return;
    }
    
    createNewFolder(name);
  }

  async function createNewFolder(folderName) {
    const project = IDEState?.get('currentProject');
    if (!project) return;
    
    try {
      await IDEStorage.Files.create({
        project: project.name,
        name: folderName,
        path: folderName,
        type: 'folder',
        children: []
      });
      
      // Refresh file tree
      if (AppState.fileTree) {
        AppState.fileTree.refresh();
      }
      
      if (IDEUtils) IDEUtils.showToast(`Created folder ${folderName}`, 'success');
      
    } catch (error) {
      console.error('Failed to create folder:', error);
      if (IDEUtils) IDEUtils.showToast('Failed to create folder', 'error');
    }
  }

  /**
   * Refresh files
   */
  async function handleRefreshFiles() {
    if (IDEUtils) IDEUtils.showToast('Refreshing files...', 'info');
    
    if (AppState.fileTree) {
      await AppState.fileTree.refresh();
    }
    
    if (IDEUtils) IDEUtils.showToast('Files refreshed', 'success');
  }

  /**
   * Handle context menu action
   */
  function handleContextAction(action, item) {
    switch (action) {
      case 'open':
        if (item.type === 'file' && AppState.codeEditor) {
          const project = IDEState?.get('currentProject');
          AppState.codeEditor.openFile({ ...item, project: project?.name });
        }
        break;
        
      case 'edit':
        if (item.type === 'file' && AppState.codeEditor) {
          const project = IDEState?.get('currentProject');
          AppState.codeEditor.openFile({ ...item, project: project?.name });
          setTimeout(() => AppState.codeEditor.enterEditMode(), 100);
        }
        break;
        
      case 'copy-path':
        if (IDEUtils && item.path) {
          IDEUtils.copyToClipboard(item.path);
        }
        break;
        
      case 'delete':
        deleteItem(item);
        break;
        
      case 'new-file':
        handleNewFile();
        break;
        
      case 'new-folder':
        handleNewFolder();
        break;
    }
  }

  async function deleteItem(item) {
    const project = IDEState?.get('currentProject');
    if (!project) return;
    
    const confirmed = confirm(`Delete "${item.name}"? This cannot be undone.`);
    if (!confirmed) return;
    
    try {
      await IDEStorage.Files.delete(project.name, item.path);
      
      // Close tab if open
      if (AppState.codeEditor) {
        AppState.codeEditor.closeTab(item.path);
      }
      
      // Refresh tree
      if (AppState.fileTree) {
        AppState.fileTree.refresh();
      }
      
      if (IDEUtils) IDEUtils.showToast(`Deleted ${item.name}`, 'success');
      
    } catch (error) {
      console.error('Delete failed:', error);
      if (IDEUtils) IDEUtils.showToast('Delete failed', 'error');
    }
  }

  // ============================================
  // Utility Features
  // ============================================
  
  function showQuickOpen() {
    if (IDEUtils) IDEUtils.showToast('Quick Open coming soon!', 'info');
  }

  function showHelp() {
    alert(`SBIDE - Keyboard Shortcuts:
    
Ctrl+B - Toggle sidebar
Ctrl+S - Save file
Ctrl+P - Quick open
Esc - Close modal / Exit edit mode`);
  }

  // ============================================
  // Error Handling
  // ============================================
  
  function showInitError(message) {
    const errorEl = document.getElementById('init-error-message');
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.classList.remove('hidden');
    }
    
    console.error('Initialization Error:', message);
  }

  // ============================================
  // LLM Manager UI Helpers
  // ============================================

  /**
   * Update context window indicator in toolbar
   */
  function updateContextWindowIndicator() {
    if (!window.LLMManagerComponent) return;
    
    let usage;
    try {
      usage = LLMManagerComponent.getContextUsage();
    } catch (e) {
      usage = null;
    }
    
    // Defensive: ensure usage is a valid object with numeric percentage
    const safePct = (usage && typeof usage.percentage === 'number' && !isNaN(usage.percentage)) 
      ? Math.min(100, Math.max(0, usage.percentage)) : 0;
    const safeTotal = (usage && typeof usage.total === 'number' && !isNaN(usage.total)) 
      ? usage.total : 0;
    const safeUsed = (usage && typeof usage.used === 'number' && !isNaN(usage.used)) 
      ? usage.used : 0;
    const safeMsgCount = (usage && typeof usage.messageCount === 'number') 
      ? usage.messageCount : 0;
    
    // Update fill bar
    const fill = document.getElementById('context-window-fill');
    if (fill) {
      fill.style.width = `${safePct}%`;
      
      // Color based on usage level
      fill.classList.remove('warning', 'danger');
      if (safePct > 80) {
        fill.classList.add('danger');
      } else if (safePct > 60) {
        fill.classList.add('warning');
      }
    }
    
    // Update text - show informative label when no/low usage
    const text = document.getElementById('context-window-text');
    if (text) {
      const provider = LLMManagerComponent.getCurrentProvider();
      
      if (!provider) {
        text.textContent = '—';
        text.style.color = 'var(--color-text-muted, #9ca3af)';
      } else if (safePct === 0 && safeMsgCount === 0) {
        text.textContent = 'Ready';
        text.style.color = 'var(--color-text-tertiary, #9ca3af)';
      } else {
        text.textContent = `${safePct}%`;
        text.style.color = '';
      }
    }
    
    // Update title with more info
    const indicator = document.getElementById('context-window-indicator');
    if (indicator) {
      const provider = LLMManagerComponent.getCurrentProvider();
      if (!provider) {
        indicator.title = 'No LLM provider selected\nClick to choose a provider';
      } else if (safePct === 0 && safeMsgCount === 0) {
        indicator.title = `Context window ready (${formatNumber(safeTotal)} tokens available)\nClick to switch provider`;
      } else {
        indicator.title = `Context: ${formatNumber(safeUsed)} / ${formatNumber(safeTotal)} tokens (${safeMsgCount} messages)\nClick to switch provider`;
      }
    }
  }

  /**
   * Update provider badge in toolbar
   */
  function updateProviderBadge(event) {
    if (!window.LLMManagerComponent) return;
    
    const provider = LLMManagerComponent.getCurrentProvider();
    
    // Update name text
    const nameText = document.getElementById('provider-name-text');
    if (nameText && provider) {
      nameText.textContent = provider.name.length > 15 
        ? provider.name.substring(0, 13) + '...' 
        : provider.name;
    }
    
    // Update dot color
    const dot = document.getElementById('provider-dot');
    if (dot && provider) {
      dot.style.setProperty('--provider-color', provider.color);
      dot.style.backgroundColor = provider.color;
      
      // Check if rate limited
      if (LLMManagerComponent.isRateLimited(provider.id)) {
        dot.classList.add('rate-limited');
      } else {
        dot.classList.remove('rate-limited');
      }
    }
    
    // Update button title
    const btn = document.getElementById('llm-provider-btn');
    if (btn && provider) {
      btn.title = `Current: ${provider.name}\nContext: ${provider.contextWindow.toLocaleString()} tokens\nClick to switch provider`;
    }
    
    // Also refresh context indicator since context window may have changed
    updateContextWindowIndicator();
  }

  /**
   * Handle rate limit event - show notification and optionally switcher
   */
  function handleRateLimitEvent(event) {
    const { providerId, reason, details } = event.detail;
    
    console.warn(`Rate limit detected for provider: ${providerId}`, details);
    
    // Show toast notification
    if (window.IDEUtils) {
      IDEUtils.showToast(
        '⚠️ Rate limit approaching - Consider switching providers',
        'warning',
        5000
      );
    }
    
    // Update provider badge to show rate limited state
    updateProviderBadge(event);
  }

  /**
   * Handle provider change from LLM Manager
   */
  function handleProviderChange(provider) {
    console.log(`Provider changed to: ${provider?.name}`);
    
    // Could add logic here to reconfigure API endpoints
    // For now, just log and update UI
    
    if (window.IDEUtils) {
      IDEUtils.showToast(`Switched to ${provider?.name || 'unknown'}`, 'success', 3000);
    }
  }

  /**
   * Format number for display
   */
  function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  }

  // ============================================
  // Progressive Loading Skeleton Reveal
  // ============================================
  
  /**
   * Setup listeners for progressive section loading
   * Hides skeletons as each section's module loads (from index.js events)
   * This provides visual feedback that sections are becoming ready
   */
  function setupProgressiveReveal() {
    // Track which sections have been revealed
    const revealedSections = new Set();
    
    /**
     * Hide a specific skeleton with smooth transition
     * @param {string} sectionId - The ID of the skeleton element
     */
    function revealSection(sectionId) {
      if (revealedSections.has(sectionId)) return;
      revealedSections.add(sectionId);
      
      const skeleton = document.getElementById(sectionId);
      if (skeleton) {
        // Add fade-out class (defined in CSS)
        skeleton.classList.add('fade-out');
        
        // Remove from DOM after transition completes
        setTimeout(() => {
          if (skeleton.parentNode) {
            skeleton.style.display = 'none';
          }
        }, 320);
        
        console.log(`[SBIDE] 🎬 Revealed section: ${sectionId}`);
      }
    }
    
    // Listen for section-ready events from barrel loader (index.js)
    window.addEventListener('ide:section-ready', (event) => {
      const { section, module, elapsed } = event.detail || {};
      
      // Map section names to their skeleton IDs
      const sectionToSkeleton = {
        'sidebar': 'sidebar-skeleton',
        'chat': 'chat-skeleton',
        'editor': 'editor-skeleton'
      };
      
      const skeletonId = sectionToSkeleton[section];
      if (skeletonId) {
        revealSection(skeletonId);
      }
    });
    
    // Also listen for modules-ready as fallback (reveal all remaining)
    window.addEventListener('ide:modules-ready', () => {
      // Reveal any skeletons that haven't been revealed yet
      ['sidebar-skeleton', 'chat-skeleton', 'editor-skeleton'].forEach(id => {
        revealSection(id);
      });
    });
    
    console.log('[SBIDE] Progressive reveal setup complete');
  }

  // ============================================
  // Boot
  // ============================================
  
  // Setup progressive reveal early (before init completes)
  setupProgressiveReveal();
  
  // Wait for DOM to be ready, then initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    // DOM already ready
    initialize();
  }
  
  // Expose app state globally for debugging
  window.IDEApp = AppState;

})();
