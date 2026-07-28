/**
 * SBIDE - Sidebar Component
 * Manages sidebar state, tabs, panels, project CRUD, and all sidebar interactions
 */

const SidebarComponent = (() => {
  // ============================================
  // State
  // ============================================
  
  let container = null;
  let sidebarElement = null;
  let toggleButton = null;
  
  // Panel containers
  let filesPanel = null;
  let searchPanel = null;
  let memoryPanel = null;
  let versionsPanel = null;
  let contextPanel = null;
  
  // Current state
  let isOpen = false;
  let isCollapsed = false; // Collapsed to rail (icons only)
  let activeTab = 'files';
  
  // Sub-component references
  let fileTree = null;

  // ============================================
  // Initialization
  // ============================================
  
  /**
   * Initialize sidebar component
   * @param {HTMLElement} element - Main sidebar container
   * @param {Object} options - Configuration options
   */
  function init(element, options = {}) {
    if (!element) {
      console.error('Sidebar: Container element required');
      return;
    }
    
    container = element;
    sidebarElement = element; // The <aside id="sidebar"> element itself
    
    // Find panel containers using CORRECT IDs from HTML
    filesPanel = document.getElementById('panel-files');
    searchPanel = document.getElementById('panel-search');
    memoryPanel = document.getElementById('panel-memory');
    versionsPanel = document.getElementById('panel-versions');
    // Note: context is inside search panel in this HTML structure
    
    // Find toggle buttons
    // collapse-sidebar-btn is inside expanded sidebar
    // expand-sidebar-btn is inside collapsed sidebar
    
    // Initialize file tree - using #file-tree from HTML
    const treeContainer = document.getElementById('file-tree');
    if (treeContainer) {
      fileTree = window.FileTreeComponent || null;
      if (fileTree) {
        fileTree.init(treeContainer, {
          onFileSelect: handleFileSelect,
          onFileAction: handleFileAction
        });
      }
    }
    
    // Setup event listeners
    setupEventListeners();
    
    // Wire up the file-tree panel header buttons (New File / New Folder /
    // sort toggles). Refresh button is wired in app.js.
    setupFileTreeHeaderButtons();
    
    // Setup sidebar resize handle for adjustable width
    setupSidebarResizeHandle();
    
    // Listen for sort-state changes from FileTreeComponent (so the toggle
    // buttons stay in sync even when setSort is called programmatically).
    document.addEventListener('ide:file-sort-changed', () => {
      updateSortButtonStates();
    });
    
    // Keep #files-project-name in sync with the current project
    // (Restored from v1: shows the active project name in the file-tree header)
    function updateFilesProjectName(state) {
      const el = document.getElementById('files-project-name');
      if (!el) return;
      const project = state?.currentProject;
      if (project && project.name) {
        el.textContent = project.name;
        el.title = project.name;
      } else {
        el.textContent = 'No project';
        el.title = '';
      }
    }
    if (window.IDEState) {
      updateFilesProjectName(IDEState.getState());
      IDEState.subscribe((state) => updateFilesProjectName(state));
    }

    // Subscribe to state changes
    if (window.IDEState) {
      IDEState.subscribe((state, prevState) => {
        // Sidebar open/close
        if (state.sidebarOpen !== prevState.sidebarOpen) {
          toggleSidebar(state.sidebarOpen);
        }
        
        // Active tab changes
        if (state.activeTab !== prevState.activeTab) {
          switchTab(state.activeTab);
        }
        
        // Project changes
        if (state.currentProject?.name !== prevState.currentProject?.name) {
          loadProjectData(state.currentProject);
        }
        
        // Settings panel
        if (state.settingsOpen !== prevState.settingsOpen) {
          toggleSettings(state.settingsOpen);
        }
      });
      
      // Initialize from saved state
      const savedState = IDEState.getState();
      isOpen = savedState.sidebarOpen || false;
      activeTab = savedState.activeTab || 'files';
      
      if (isOpen) {
        showSidebar();
      }
      
      switchTab(activeTab, false);
    }
    
    // Setup tab click handlers
    setupTabHandlers();
    
    // Setup modal handlers
    setupModalHandlers();
    
    // Setup search handlers
    setupSearchHandlers();
    
    console.log('Sidebar initialized');
  }

  /**
   * Setup main event listeners
   */
  function setupEventListeners() {
    // Mobile menu button (id="mobile-menu-btn")
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    if (mobileMenuBtn) {
      mobileMenuBtn.addEventListener('click', () => {
        toggleSidebar(!isOpen);
      });
    }
    
    // Collapse sidebar button (id="collapse-sidebar-btn") - inside expanded sidebar
    const collapseBtn = document.getElementById('collapse-sidebar-btn');
    if (collapseBtn) {
      collapseBtn.addEventListener('click', () => {
        // When collapsing, show the collapsed (icon-only) view
        setCollapsed(true);
      });
    }
    
    // Expand sidebar button (id="expand-sidebar-btn") - inside collapsed sidebar
    const expandBtn = document.getElementById('expand-sidebar-btn');
    if (expandBtn) {
      expandBtn.addEventListener('click', () => {
        // When expanding, show the full sidebar
        setCollapsed(false);
        // Also make sure it's open
        if (!isOpen) {
          toggleSidebar(true);
        }
      });
    }
    
    // Close sidebar when clicking mobile overlay
    const mobileOverlay = document.getElementById('mobile-overlay');
    if (mobileOverlay) {
      mobileOverlay.addEventListener('click', () => {
        toggleSidebar(false);
      });
    }
    
    // Window resize handling
    window.addEventListener('resize', IDEUtils?.debounce(() => {
      // Auto-adjust for screen size
      if (window.innerWidth <= 768 && isOpen) {
        // On mobile, we might want to auto-close
      }
    }, 200));
  }

  /**
   * Setup tab click handlers - HTML uses .tab-btn and .sidebar-nav-btn classes
   */
  function setupTabHandlers() {
    // Tab buttons in expanded sidebar (.tab-btn)
    const tabs = container.querySelectorAll('.tab-btn');
    
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;
        if (tabName) {
          switchTab(tabName);
        }
      });
    });
    
    // Nav buttons in collapsed sidebar (.sidebar-nav-btn)
    const navBtns = container.querySelectorAll('.sidebar-nav-btn');
    
    navBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tabName = btn.dataset.tab;
        if (tabName) {
          // First expand if collapsed
          if (isCollapsed) {
            setCollapsed(false);
            if (!isOpen) toggleSidebar(true);
          }
          switchTab(tabName);
        }
      });
    });
  }

  /**
   * Setup modal handlers (new project, import)
   */
  function setupModalHandlers() {
    // New project modal
    const newProjectBtn = document.getElementById('new-project-btn');
    const newProjectModal = document.getElementById('new-project-modal');
    const cancelNewBtn = document.getElementById('cancel-new-project-btn');
    const confirmNewBtn = document.getElementById('confirm-new-project-btn');
    const projectNameInput = document.getElementById('new-project-name');
    
    if (newProjectBtn && newProjectModal) {
      newProjectBtn.addEventListener('click', () => showModal(newProjectModal));
    }
    
    if (cancelNewBtn && newProjectModal) {
      cancelNewBtn.addEventListener('click', () => hideModal(newProjectModal));
    }
    
    if (projectNameInput && confirmNewBtn) {
      projectNameInput.addEventListener('input', () => {
        const validation = IDEUtils?.validateProjectName(projectNameInput.value);
        confirmNewBtn.disabled = !validation.valid;
        
        // Show slug preview or error
        const hint = document.getElementById('project-name-hint');
        if (hint) {
          if (!projectNameInput.value.trim()) {
            hint.textContent = 'Any name works — we\'ll make it URL-safe';
            hint.className = 'form-hint';
          } else if (!validation.valid) {
            hint.textContent = validation.error || 'Please enter a valid name';
            hint.className = 'form-hint error';
          } else {
            const slug = IDEUtils?.slugify(projectNameInput.value) || '';
            hint.textContent = `Will be created as: ${slug}`;
            hint.className = 'form-hint success';
          }
        }
      });
      
      confirmNewBtn.addEventListener('click', () => createProject(projectNameInput.value));
      
      // Enter key to submit
      projectNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !confirmNewBtn.disabled) {
          createProject(projectNameInput.value);
        }
      });
    }
    
    // Import project modal
    const importBtn = document.getElementById('import-project-btn');
    const importModal = document.getElementById('import-modal');
    const cancelImportBtn = document.getElementById('cancel-import-btn');
    const confirmImportBtn = document.getElementById('confirm-import-btn');
    const importFileInput = document.getElementById('import-file-input');
    const importNameInput = document.getElementById('import-name-input');
    
    if (importBtn && importModal) {
      importBtn.addEventListener('click', () => showModal(importModal));
    }
    
    if (cancelImportBtn && importModal) {
      cancelImportBtn.addEventListener('click', () => hideModal(importModal));
    }
    
    if (importFileInput && confirmImportBtn) {
      importFileInput.addEventListener('change', () => {
        confirmImportBtn.disabled = !importFileInput.files.length;
        
        // Auto-fill name from filename
        if (importFileInput.files.length && importNameInput) {
          const fileName = importFileInput.files[0].name.replace(/\.zip$/i, '');
          importNameInput.value = fileName.toLowerCase().replace(/[^a-z0-9-]/g, '-').substring(0, 50);
        }
      });
      
      confirmImportBtn.addEventListener('click', () => importProject(importFileInput, importNameInput?.value));
    }
    
    // Close buttons in modals
    document.querySelectorAll('.modal-overlay .icon-btn[aria-label="Close dialog"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const modal = btn.closest('.modal-overlay');
        if (modal) hideModal(modal);
      });
    });
    
    // Click overlay to close
    document.querySelectorAll('.modal-overlay').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) hideModal(modal);
      });
    });
  }

  /**
   * Setup search handlers
   */
  function setupSearchHandlers() {
    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');
    const clearSearchBtn = document.getElementById('clear-search-btn');
    
    if (searchInput) {
      const debouncedSearch = IDEUtils?.debounce(performSearch, 300) || performSearch;
      
      searchInput.addEventListener('input', debouncedSearch);
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') performSearch();
        if (e.key === 'Escape') clearSearch();
      });
    }
    
    if (searchBtn) {
      searchBtn.addEventListener('click', performSearch);
    }
    
    if (clearSearchBtn) {
      clearSearchBtn.addEventListener('click', clearSearch);
    }
  }

  // ============================================
  // Sidebar State Management
  // ============================================
  
  /**
   * Toggle sidebar visibility
   * HTML structure: #sidebar contains #sidebar-collapsed and #sidebar-expanded
   */
  function toggleSidebar(forceOpen) {
    isOpen = typeof forceOpen === 'boolean' ? forceOpen : !isOpen;
    
    // Update main sidebar element
    if (sidebarElement) {
      sidebarElement.classList.toggle('open', isOpen);
      sidebarElement.classList.toggle('closed', !isOpen);
    }
    
    // Show/hide collapsed vs expanded sections
    const collapsedDiv = document.getElementById('sidebar-collapsed');
    const expandedDiv = document.getElementById('sidebar-expanded');
    
    if (collapsedDiv) {
      // Collapsed div shows when sidebar is closed OR when in rail mode
      const showCollapsed = !isOpen || isCollapsed;
      collapsedDiv.classList.toggle('hidden', isOpen && !isCollapsed);
    }
    
    if (expandedDiv) {
      // Expanded div shows when sidebar is open AND not in rail mode
      expandedDiv.classList.toggle('hidden', !isOpen || isCollapsed);
    }
    
    // Update mobile menu button
    const mobileBtn = document.getElementById('mobile-menu-btn');
    if (mobileBtn) {
      mobileBtn.setAttribute('aria-expanded', String(isOpen));
      // Swap icons
      const menuIcon = mobileBtn.querySelector('.icon-menu');
      const xIcon = mobileBtn.querySelector('.icon-x');
      if (menuIcon && xIcon) {
        menuIcon.classList.toggle('hidden', isOpen);
        xIcon.classList.toggle('hidden', !isOpen);
      }
    }
    
    // Sync overlay
    syncOverlay();
    
    // Update state
    if (window.IDEState) {
      IDEState.setSidebarOpen(isOpen);
    }
  }

  /**
   * Sync mobile overlay visibility with sidebar open state.
   * (Restored from v1: only show overlay on mobile when sidebar is open.)
   */
  function syncOverlay() {
    const mobileOverlay = document.getElementById('mobile-overlay');
    if (mobileOverlay) {
      // Only show overlay on mobile when sidebar is open
      const isMobile = window.innerWidth <= 767;
      mobileOverlay.classList.toggle('hidden', !isOpen || !isMobile);
    }
  }

  /**
   * Set collapsed (rail-only) mode.
   *
   * Animation timing: the `.sidebar` element has `transition: width var(--transition-slow)`
   * (300ms). To make sidebar→rail animate the same way rail→sidebar does, we keep
   * #sidebar-expanded visible (clipped by .sidebar's overflow:hidden) while the width
   * shrinks, then swap to the rail after the transition completes. Without this delay,
   * the CSS rule `.sidebar.collapsed #sidebar-expanded { display: none }` would fire
   * instantly and the user would see the content vanish before the empty space collapses.
   */
  let collapseAnimTimeout = null;
  const COLLAPSE_ANIM_MS = 300; // matches --transition-slow

  function setCollapsed(collapsed) {
    isCollapsed = collapsed;

    // Cancel any pending content-swap from a previous toggle
    if (collapseAnimTimeout) {
      clearTimeout(collapseAnimTimeout);
      collapseAnimTimeout = null;
    }

    if (sidebarElement) {
      sidebarElement.classList.toggle('collapsed', collapsed);
    }

    // Restored from v1: When un-collapsing, ensure sidebar is open (not closed)
    if (!collapsed && !isOpen) {
      isOpen = true;
      if (sidebarElement) {
        sidebarElement.classList.add('open');
        sidebarElement.classList.remove('closed');
      }
    }

    const collapsedDiv = document.getElementById('sidebar-collapsed');
    const expandedDiv = document.getElementById('sidebar-expanded');

    if (collapsed) {
      // Collapsing sidebar → rail:
      //  - Keep #sidebar-expanded visible during the width animation. It will be
      //    clipped naturally by .sidebar's `overflow: hidden` as the width shrinks.
      //  - Keep #sidebar-collapsed hidden via .hidden (!important) so it doesn't
      //    steal layout space from #sidebar-expanded mid-animation (which would
      //    cause expanded content to reflow/jump).
      //  - After 300ms (width transition done), swap: hide expanded, show rail.
      if (expandedDiv) expandedDiv.classList.remove('hidden');
      if (collapsedDiv) collapsedDiv.classList.add('hidden');

      collapseAnimTimeout = setTimeout(() => {
        if (expandedDiv) expandedDiv.classList.add('hidden');
        if (collapsedDiv) collapsedDiv.classList.remove('hidden');
        collapseAnimTimeout = null;
      }, COLLAPSE_ANIM_MS);
    } else {
      // Expanding rail → sidebar:
      //  - Show #sidebar-expanded immediately so it reveals progressively as the
      //    width grows (this is the direction the user already sees as "animated").
      //  - #sidebar-collapsed is auto-hidden by the CSS rule
      //    `.sidebar:not(.collapsed):not(.closed) #sidebar-collapsed { display: none }`
      //    the instant .collapsed is removed, which is fine for expand.
      if (expandedDiv) expandedDiv.classList.remove('hidden');
    }

    // Keep overlay in sync (Restored from v1)
    syncOverlay();

    // Persist state (Restored from v1)
    if (window.IDEState) {
      IDEState.setSidebarOpen(isOpen);
    }
  }

  /**
   * Toggle collapsed (rail) mode
   */
  function toggleCollapse(forceCollapsed) {
    setCollapsed(typeof forceCollapsed === 'boolean' ? forceCollapsed : !isCollapsed);
  }

  /**
   * Show sidebar (force open)
   */
  function showSidebar() {
    toggleSidebar(true);
  }

  /**
   * Hide sidebar (force close)
   */
  function hideSidebar() {
    toggleSidebar(false);
  }

  // ============================================
  // Tab Management
  // ============================================
  
  /**
   * Switch between sidebar tabs
   * HTML uses .tab-btn for tab buttons and #panel-* for panels
   */
  function switchTab(tabName, updateState = true) {
    if (!tabName) return;
    
    activeTab = tabName;
    
    // Update tab UI - both .tab-btn (expanded) and .sidebar-nav-btn (collapsed)
    const tabs = container.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
      const isActive = tab.dataset.tab === tabName;
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-selected', String(isActive));
    });
    
    // Also update nav buttons in collapsed sidebar
    const navBtns = container.querySelectorAll('.sidebar-nav-btn');
    navBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    
    // Show/hide panels using correct IDs: panel-files, panel-search, etc.
    const panelMap = {
      'files': 'panel-files',
      'search': 'panel-search',
      'memory': 'panel-memory',
      'versions': 'panel-versions',
      'meetings': 'panel-meetings'
    };
    
    Object.entries(panelMap).forEach(([key, panelId]) => {
      const el = document.getElementById(panelId);
      if (el) {
        el.classList.toggle('active', key === tabName);
      }
    });
    
    // Update state
    if (updateState && window.IDEState) {
      IDEState.setActiveTab(tabName);
    }
  }

  // ============================================
  // Project Operations
  // ============================================
  
  /**
   * Create a new project
   */
  async function createProject(displayName) {
    const validation = IDEUtils?.validateProjectName(displayName);
    if (!validation?.valid) {
      if (IDEUtils) IDEUtils.showToast(validation?.error || 'Invalid project name', 'error');
      return;
    }
    
    // Use slugified name internally, keep display name for UI
    const slug = validation.slug || IDEUtils?.slugify(displayName) || displayName;
    
    try {
      // Create in storage with slug as the key
      const project = await IDEStorage.Projects.create(slug);
      
      // Store display name separately if different from slug
      if (slug !== displayName.trim()) {
        project.displayName = displayName.trim();
        await IDEStorage.Projects.update(slug, { displayName: displayName.trim() });
      }
      
      // Set as current project
      if (window.IDEState) {
        await IDEState.setCurrentProject(project);
      }
      
      // Load project data
      await loadProjectData(project);
      
      // Hide modal
      hideModal(document.getElementById('new-project-modal'));
      
      // Clear input
      const input = document.getElementById('new-project-name');
      if (input) input.value = '';
      
      // Show success message with both names if different
      const showName = slug !== displayName.trim() 
        ? `${displayName.trim()} (${slug})` 
        : slug;
      if (IDEUtils) IDEUtils.showToast(`Project "${showName}" created!`, 'success');
      
      // Switch to files tab
      switchTab('files');
      
    } catch (error) {
      console.error('Failed to create project:', error);
      if (IDEUtils) IDEUtils.showToast(`Failed to create project: ${error.message}`, 'error');
    }
  }

  /**
   * Import project from ZIP
   */
  async function importProject(fileInput, nameOverride) {
    if (!fileInput || !fileInput.files.length) return;
    
    const file = fileInput.files[0];
    
    // Validate file type (only allow ZIP files)
    if (!file.name.toLowerCase().endsWith('.zip') && file.type !== 'application/zip' && file.type !== 'application/x-zip-compressed') {
      if (IDEUtils) IDEUtils.showToast('Please select a valid .zip file', 'error');
      return;
    }
    
    // Validate file size (max 50MB to prevent browser crash/memory issues)
    const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
    if (file.size > MAX_FILE_SIZE) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
      if (IDEUtils) IDEUtils.showToast(`File too large (${sizeMB}MB). Maximum size is 50MB.`, 'error');
      return;
    }
    
    // Validate minimum file size (not empty)
    if (file.size === 0) {
      if (IDEUtils) IDEUtils.showToast('Selected file is empty', 'error');
      return;
    }
    
    const name = nameOverride || file.name.replace(/\.zip$/i, '');
    
    try {
      // Validate name first
      const validation = IDEUtils?.validateProjectName(name);
      if (!validation?.valid) {
        if (IDEUtils) IDEUtils.showToast(validation?.error || 'Invalid project name', 'error');
        return;
      }
      
      // Create project
      const project = await IDEStorage.Projects.create(name);
      
      // Read ZIP file
      if (window.JSZip) {
        let zip;
        try {
          zip = await JSZip.loadAsync(file);
        } catch (zipError) {
          console.error('Invalid ZIP file:', zipError);
          if (IDEUtils) IDEUtils.showToast('Invalid or corrupted ZIP file', 'error');
          return;
        }
        
        const files = {};
        const MAX_FILES = 1000; // Prevent ZIP bomb
        let totalSize = 0;
        
        // Extract all files with safety limits
        for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
          // Safety: limit number of files
          if (Object.keys(files).length >= MAX_FILES) {
            console.warn(`ZIP contains more than ${MAX_FILES} files, truncating`);
            if (IDEUtils) IDEUtils.showToast(`Too many files in ZIP (limit: ${MAX_FILES}). Some files were skipped.`, 'warning');
            break;
          }
          
          if (!zipEntry.dir) {
            // Safety: check individual file size
            if (zipEntry._data?.uncompressedSize > 10 * 1024 * 1024) { // 10MB per file limit
              console.warn(`Skipping large file: ${relativePath}`);
              continue;
            }
            
            try {
              const content = await zipEntry.async('string');
              // Safety: sanitize path to prevent path traversal
              const safePath = relativePath.replace(/^\.+\//, '').replace(/^\//, '');
              if (safePath) {
                files[safePath] = content;
                totalSize += content.length;
              }
            } catch (readError) {
              console.warn(`Failed to read ${relativePath}:`, readError);
            }
          }
        }
        
        // Safety: check total extracted size
        if (totalSize > 100 * 1024 * 1024) { // 100MB total
          if (IDEUtils) IDEUtils.showToast('Extracted content exceeds size limit. Import may be incomplete.', 'warning');
        }
        
        // Import files to storage
        await IDEStorage.Files.importFiles(project.name, files);
        
        // Update project file count
        await IDEStorage.Projects.updateFileCount(project.name);
        
        // Set as current project
        if (window.IDEState) {
          await IDEState.setCurrentProject(project);
        }
        
        // Load data
        await loadProjectData(project);
        
        // Hide modal and reset
        hideModal(document.getElementById('import-modal'));
        fileInput.value = '';
        const nameInput = document.getElementById('import-name-input');
        if (nameInput) nameInput.value = '';
        
        if (IDEUtils) IDEUtils.showToast(`Imported ${Object.keys(files).length} files`, 'success');
        switchTab('files');
      }
      
    } catch (error) {
      console.error('Failed to import:', error);
      if (IDEUtils) IDEUtils.showToast(`Import failed: ${error.message}`, 'error');
    }
  }

  /**
   * Switch to a different project
   */
  async function switchProject(projectName) {
    try {
      const project = await IDEStorage.Projects.get(projectName);
      if (project) {
        if (window.IDEState) {
          IDEState.setCurrentProject(project);
        }
        await loadProjectData(project);
      }
    } catch (error) {
      console.error('Failed to switch project:', error);
    }
  }

  /**
   * Delete current project
   */
  async function deleteCurrentProject() {
    const project = IDEState?.get('currentProject');
    if (!project) return;
    
    const confirmed = confirm(`Are you sure you want to delete "${project.name}"? This cannot be undone.`);
    if (!confirmed) return;
    
    try {
      await IDEStorage.Projects.delete(project.name);
      
      // Clear state
      if (window.IDEState) {
        IDEState.setCurrentProject(null);
        IDEState.setMessages([]);
      }
      
      // Clear components
      if (fileTree) fileTree.clear();
      
      if (IDEUtils) IDEUtils.showToast(`Project "${project.name}" deleted`, 'success');
      
      // Reload projects list
      await populateProjectsList();
      
    } catch (error) {
      console.error('Failed to delete project:', error);
      if (IDEUtils) IDEUtils.showToast(`Delete failed: ${error.message}`, 'error');
    }
  }

  /**
   * Load data for selected project into all panels
   */
  async function loadProjectData(project) {
    if (!project) {
      if (fileTree) fileTree.clear();
      return;
    }
    
    // Load file tree
    if (fileTree) {
      await fileTree.loadFilesForProject(project);
    }
    
    // Load other panel data
    await loadMemoryData(project.name);
    await loadVersionsData(project.name);
    await loadContextData(project.name);
    
    // Update project selector
    await populateProjectsList();
  }

  /**
   * Populate project selector dropdown
   */
  /**
   * Populate projects list in sidebar
   * HTML uses #projects-list (div with role="listbox"), not a <select>
   */
  async function populateProjectsList() {
    const listContainer = document.getElementById('projects-list');
    const noProjectsEl = document.getElementById('no-projects');
    const loadingEl = document.getElementById('projects-loading');
    
    if (!listContainer) return;
    
    try {
      // Show loading
      if (loadingEl) {
        loadingEl.classList.remove('hidden');
      }
      if (noProjectsEl) {
        noProjectsEl.classList.add('hidden');
      }
      
      const projects = await IDEStorage.Projects.getAll();
      const currentProject = IDEState?.get('currentProject');
      
      // Hide loading
      if (loadingEl) {
        loadingEl.classList.add('hidden');
      }
      
      // Clear list
      listContainer.innerHTML = '';
      
      if (projects.length === 0) {
        if (noProjectsEl) {
          noProjectsEl.classList.remove('hidden');
        }
        listContainer.classList.add('hidden');
        return;
      }
      
      listContainer.classList.remove('hidden');
      
      // Render each project as a clickable item
      projects.forEach(p => {
        const item = document.createElement('div');
        item.className = `project-item ${currentProject?.name === p.name ? 'active' : ''}`;
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(currentProject?.name === p.name));
        item.dataset.projectName = p.name;
        
        item.innerHTML = `
          <span class="project-icon">${IDEUtils?.Icons?.folder || ''}</span>
          <span class="project-name">${IDEUtils?.escapeHtml(p.displayName || p.name) || p.name}</span>
          <span class="project-meta">${IDEUtils?.formatRelativeTime(p.updatedAt) || ''}</span>
        `;
        
        // Click to switch project
        item.addEventListener('click', () => {
          switchProject(p.name);
        });
        
        // Double-click or context menu for more options
        item.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          showProjectContextMenu(e, p);
        });
        
        listContainer.appendChild(item);
      });
      
    } catch (error) {
      console.error('Failed to load projects:', error);
      if (loadingEl) {
        loadingEl.classList.add('hidden');
      }
    }
  }

  /**
   * Show context menu for project item
   */
  function showProjectContextMenu(event, project) {
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.innerHTML = `
      <div class="context-menu-item" data-action="switch">Open Project</div>
      <div class="context-menu-item" data-action="export">Export ZIP</div>
      <div class="context-menu-divider"></div>
      <div class="context-menu-item danger" data-action="delete">Delete Project</div>
    `;
    
    menu.style.left = event.pageX + 'px';
    menu.style.top = event.pageY + 'px';
    document.body.appendChild(menu);
    
    menu.querySelectorAll('.context-menu-item').forEach(item => {
      item.addEventListener('click', () => {
        const action = item.dataset.action;
        menu.remove();
        
        switch (action) {
          case 'switch':
            switchProject(project.name);
            break;
          case 'export':
            handleExportSingleProject(project);
            break;
          case 'delete':
            deleteProjectByName(project.name);
            break;
        }
      });
    });
    
    setTimeout(() => {
      document.addEventListener('click', function closeMenu(e) {
        if (!menu.contains(e.target)) {
          menu.remove();
          document.removeEventListener('click', closeMenu);
        }
      });
    }, 0);
  }

  async function handleExportSingleProject(project) {
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
        
        if (IDEUtils) IDEUtils.showToast(`Exported ${project.name}`, 'success');
      }
    } catch (error) {
      console.error('Export failed:', error);
      if (IDEUtils) IDEUtils.showToast('Export failed', 'error');
    }
  }

  async function deleteProjectByName(name) {
    const confirmed = confirm(`Delete "${name}" and all its files? This cannot be undone.`);
    if (!confirmed) return;
    
    try {
      await IDEStorage.Projects.delete(name);
      
      // Clear state if this was the current project
      if (IDEState?.get('currentProject')?.name === name) {
        IDEState.setCurrentProject(null);
        IDEState.setMessages([]);
        if (AppState.fileTree) AppState.fileTree.clear();
      }
      
      // Refresh list
      await populateProjectsList();
      
      if (IDEUtils) IDEUtils.showToast(`Deleted ${name}`, 'success');
    } catch (error) {
      console.error('Delete failed:', error);
      if (IDEUtils) IDEUtils.showToast('Delete failed', 'error');
    }
  }

  // ============================================
  // Panel Data Loading
  // ============================================
  
  async function loadMemoryData(projectName) {
    if (!memoryPanel || !projectName) return;
    
    try {
      const memory = await IDEStorage.Memory.get(projectName);
      renderMemoryPanel(memory);
    } catch (error) {
      console.error('Failed to load memory:', error);
    }
  }

  function renderMemoryPanel(memory) {
    if (!memoryPanel) return;
    
    const content = memoryPanel.querySelector('.panel-content');
    if (!content) return;
    
    if (!memory || (!memory.anchors?.length && !memory.keyDecisions?.length)) {
      content.innerHTML = `
        <div class="empty-state">
          <p>No memory data yet</p>
          <p class="hint">AI will build context as you work together</p>
        </div>
      `;
      return;
    }
    
    let html = '';
    
    if (memory.anchors?.length) {
      html += '<h4>Context Anchors</h4><ul class="anchor-list">';
      memory.anchors.forEach(a => {
        html += `<li><strong>${a.type}:</strong> ${IDEUtils?.escapeHtml(a.content) || ''}</li>`;
      });
      html += '</ul>';
    }
    
    if (memory.keyDecisions?.length) {
      html += '<h4>Key Decisions</h4><ul class="decision-list">';
      memory.keyDecisions.forEach(d => {
        html += `<li>${IDEUtils?.escapeHtml(d) || ''}</li>`;
      });
      html += '</ul>';
    }
    
    content.innerHTML = html;
  }

  async function loadVersionsData(projectName) {
    if (!versionsPanel || !projectName) return;
    
    try {
      const versions = await IDEStorage.Versions.getByProject(projectName);
      renderVersionsPanel(versions);
    } catch (error) {
      console.error('Failed to load versions:', error);
    }
  }

  function renderVersionsPanel(versions) {
    if (!versionsPanel) return;
    
    const content = versionsPanel.querySelector('.panel-content');
    if (!content) return;
    
    if (!versions?.length) {
      content.innerHTML = `
        <div class="empty-state">
          <p>No version history</p>
          <p class="hint">Create checkpoints to save your progress</p>
        </div>
      `;
      return;
    }
    
    let html = '<div class="version-list">';
    versions.reverse().forEach(v => {
      html += `
        <div class="version-item" data-id="${v.id}">
          <div class="version-header">
            <span class="version-number">${v.versionNumber}</span>
            <span class="version-date">${IDEUtils?.formatRelativeTime(v.createdAt) || ''}</span>
          </div>
          <p class="version-description">${IDEUtils?.escapeHtml(v.description) || ''}</p>
          <div class="version-meta">
            ${v.fileCount ? `<span>${v.fileCount} files</span>` : ''}
            ${v.size ? `<span>${IDEUtils?.formatBytes(v.size) || ''}</span>` : ''}
          </div>
        </div>
      `;
    });
    html += '</div>';
    
    content.innerHTML = html;
  }

  async function loadContextData(projectName) {
    if (!contextPanel || !projectName) return;
    
    // Context is managed in state, not storage
    const contextResults = IDEState?.get('contextResults') || [];
    renderContextPanel(contextResults);
  }

  function renderContextPanel(contextResults) {
    if (!contextPanel) return;
    
    const content = contextPanel.querySelector('.panel-content');
    if (!content) return;
    
    if (!contextResults?.length) {
      content.innerHTML = `
        <div class="empty-state">
          <p>No context items</p>
          <p class="hint">Add items during search or AI will suggest relevant context</p>
        </div>
      `;
      return;
    }
    
    let html = '<ul class="context-list">';
    contextResults.forEach(item => {
      html += `
        <li class="context-item" data-url="${item.url || ''}">
          <span class="context-title">${IDEUtils?.escapeHtml(item.title || item.url) || ''}</span>
          <button class="context-remove" data-url="${item.url || ''}" title="Remove">
            ${IDEUtils?.Icons?.x || ''}
          </button>
        </li>
      `;
    });
    html += '</ul>';
    
    content.innerHTML = html;
    
    // Wire up remove buttons
    content.querySelectorAll('.context-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const url = btn.dataset.url;
        if (url && window.IDEState) {
          IDEState.removeFromContext(url);
        }
      });
    });
  }

  // ============================================
  // Search Functionality
  // ============================================
  
  async function performSearch() {
    const input = document.getElementById('search-input');
    if (!input) return;
    
    const query = input.value.trim();
    if (!query) return;
    
    const project = IDEState?.get('currentProject');
    if (!project) {
      if (IDEUtils) IDEUtils.showToast('Select a project first', 'warning');
      return;
    }
    
    // Show loading state
    if (window.IDEState) {
      IDEState.setSearching(true);
      IDEState.setSearchQuery(query);
    }
    
    try {
      // Search in local files
      const files = await IDEStorage.Files.getByProject(project.name);
      const results = [];
      
      const lowerQuery = query.toLowerCase();
      files.forEach(file => {
        if (file.type === 'file' && file.content) {
          const lines = file.content.split('\n');
          lines.forEach((line, index) => {
            if (line.toLowerCase().includes(lowerQuery)) {
              results.push({
                file: file.path,
                line: index + 1,
                content: line.trim(),
                match: line.toLowerCase().indexOf(lowerQuery)
              });
            }
          });
        }
      });
      
      // Update state with results
      if (window.IDEState) {
        IDEState.setSearchResults(results);
        IDEState.setSearching(false);
      }
      
      // Render results
      renderSearchResults(results, query);
      
      // Switch to search tab
      switchTab('search');
      
    } catch (error) {
      console.error('Search failed:', error);
      if (window.IDEState) {
        IDEState.setSearching(false);
      }
    }
  }

  function renderSearchResults(results, query) {
    if (!searchPanel) return;
    
    const content = searchPanel.querySelector('.results-container');
    if (!content) return;
    
    if (!results?.length) {
      content.innerHTML = `
        <div class="no-results">
          <span class="no-results-icon">${IDEUtils?.Icons?.search || ''}</span>
          <p>No results found for "${IDEUtils?.escapeHtml(query) || query}"</p>
        </div>
      `;
      return;
    }
    
    let html = `<p class="results-count">${results.length} results found</p><ul class="search-results">`;
    
    // Group by file
    const grouped = {};
    results.forEach(r => {
      if (!grouped[r.file]) grouped[r.file] = [];
      grouped[r.file].push(r);
    });
    
    Object.entries(grouped).forEach(([file, matches]) => {
      html += `
        <li class="result-group">
          <div class="result-file">${IDEUtils?.getFileIcon(file) || ''} ${file}</div>
          <ul class="result-matches">
      `;
      
      matches.slice(0, 10).forEach(m => {
        const highlighted = highlightMatch(m.content, query);
        html += `
          <li class="result-match" data-path="${file}" data-line="${m.line}">
            <span class="line-num">${m.line}</span>
            <span class="match-content">${highlighted}</span>
          </li>
        `;
      });
      
      html += '</ul></li>';
    });
    
    html += '</ul>';
    content.innerHTML = html;
    
    // Wire up result clicks
    content.querySelectorAll('.result-match').forEach(match => {
      match.addEventListener('click', () => {
        const path = match.dataset.path;
        const line = parseInt(match.dataset.line);
        openFileAtLine(path, line);
      });
    });
  }

  function highlightMatch(content, query) {
    if (!content || !query) return IDEUtils?.escapeHtml(content) || '';
    const escaped = IDEUtils?.escapeHtml(content) || content;
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return escaped.replace(regex, '<mark>$1</mark>');
  }

  function clearSearch() {
    const input = document.getElementById('search-input');
    if (input) input.value = '';
    
    if (window.IDEState) {
      IDEState.clearSearchResults();
    }
    
    if (searchPanel) {
      const content = searchPanel.querySelector('.results-container');
      if (content) content.innerHTML = '';
    }
  }

  // ============================================
  // File Actions
  // ============================================
  
  function handleFileSelect(file) {
    // File was clicked in tree - open in editor
    if (window.CodeEditorComponent) {
      CodeEditorComponent.openFile(file);
    }
    
    // Focus editor
    if (window.IDEState) {
      IDEState.focusEditor();
    }
  }

  function handleFileAction(action) {
    // Handle file operations from tree (move, rename, etc.)
    console.log('File action:', action);
    
    switch (action.type) {
      case 'move':
        // TODO: Implement move
        break;
      case 'delete':
        // TODO: Confirm and delete
        break;
    }
  }

  async function openFileAtLine(path, line) {
    const project = IDEState?.get('currentProject');
    if (!project) return;
    
    try {
      const file = await IDEStorage.Files.get(project.name, path);
      if (file && window.CodeEditorComponent) {
        CodeEditorComponent.openFile({ ...file, project: project.name });
        // TODO: Scroll to line
      }
    } catch (error) {
      console.error('Failed to open file:', error);
    }
  }

  // ============================================
  // Sidebar Resize Handle (adjustable expanded width)
  // ============================================

  /**
   * Setup the drag handle on the right edge of the expanded sidebar.
   * Dragging resizes --sidebar-width-expanded on the sidebar element,
   * which both .sidebar and .sidebar-expanded read from. The custom
   * width is persisted to localStorage and restored on next load.
   */
  function setupSidebarResizeHandle() {
    const handle = sidebarElement?.querySelector('.sidebar-resize-handle');
    if (!handle) return;

    const STORAGE_KEY = 'ide:sidebar-width';
    const MIN_REM = 12;   // 192px
    const MAX_REM = 32;   // 512px
    const DEFAULT_REM = 18;

    // Restore saved width
    try {
      const saved = parseFloat(localStorage.getItem(STORAGE_KEY));
      if (!isNaN(saved) && saved >= MIN_REM && saved <= MAX_REM) {
        sidebarElement.style.setProperty('--sidebar-width-expanded', `${saved}rem`);
      }
    } catch (e) { /* ignore */ }

    let dragging = false;
    let startX = 0;
    let startWidthRem = 0;

    function onPointerDown(e) {
      // Only resize when sidebar is expanded (not collapsed/closed)
      if (sidebarElement.classList.contains('collapsed') ||
          sidebarElement.classList.contains('closed')) return;
      dragging = true;
      startX = e.clientX || (e.touches && e.touches[0]?.clientX) || 0;
      const current = getComputedStyle(sidebarElement).getPropertyValue('--sidebar-width-expanded').trim();
      const m = String(current).match(/([\d.]+)rem/);
      startWidthRem = m ? parseFloat(m[1]) : DEFAULT_REM;
      handle.classList.add('dragging');
      sidebarElement.classList.add('resizing');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    }

    function onPointerMove(e) {
      if (!dragging) return;
      const x = e.clientX || (e.touches && e.touches[0]?.clientX) || 0;
      const deltaPx = x - startX;
      // Convert px to rem using the root font-size
      const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const deltaRem = deltaPx / rootFontSize;
      let newWidthRem = startWidthRem + deltaRem;
      newWidthRem = Math.max(MIN_REM, Math.min(MAX_REM, newWidthRem));
      sidebarElement.style.setProperty('--sidebar-width-expanded', `${newWidthRem}rem`);
    }

    function onPointerUp() {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('dragging');
      sidebarElement.classList.remove('resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // Persist
      const current = getComputedStyle(sidebarElement).getPropertyValue('--sidebar-width-expanded').trim();
      const m = String(current).match(/([\d.]+)rem/);
      if (m) {
        try { localStorage.setItem(STORAGE_KEY, m[1]); } catch (e) { /* ignore */ }
      }
    }

    handle.addEventListener('mousedown', onPointerDown);
    handle.addEventListener('touchstart', onPointerDown, { passive: false });
    document.addEventListener('mousemove', onPointerMove);
    document.addEventListener('touchmove', onPointerMove, { passive: false });
    document.addEventListener('mouseup', onPointerUp);
    document.addEventListener('touchend', onPointerUp);

    // Keyboard support: arrow keys adjust width by 1rem
    handle.addEventListener('keydown', (e) => {
      if (sidebarElement.classList.contains('collapsed') ||
          sidebarElement.classList.contains('closed')) return;
      const current = getComputedStyle(sidebarElement).getPropertyValue('--sidebar-width-expanded').trim();
      const m = String(current).match(/([\d.]+)rem/);
      let w = m ? parseFloat(m[1]) : DEFAULT_REM;
      if (e.key === 'ArrowLeft')  { w = Math.max(MIN_REM, w - 1); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { w = Math.min(MAX_REM, w + 1); e.preventDefault(); }
      else if (e.key === 'Enter' || e.key === ' ') { w = DEFAULT_REM; e.preventDefault(); }
      else return;
      sidebarElement.style.setProperty('--sidebar-width-expanded', `${w}rem`);
      try { localStorage.setItem(STORAGE_KEY, String(w)); } catch (e2) { /* ignore */ }
    });
  }

  // ============================================
  // File-Tree Panel Header Buttons
  // (New File / New Folder / sort toggles)
  // ============================================
  
  function setupFileTreeHeaderButtons() {
    const newFileBtn = document.getElementById('new-file-btn');
    const newFolderBtn = document.getElementById('new-folder-btn');
    const sortNameBtn = document.getElementById('sort-name-btn');
    const sortDateBtn = document.getElementById('sort-date-btn');
    
    if (newFileBtn && window.FileTreeComponent) {
      newFileBtn.addEventListener('click', () => {
        FileTreeComponent.showCreateFileDialog();
      });
    }
    
    if (newFolderBtn && window.FileTreeComponent) {
      newFolderBtn.addEventListener('click', () => {
        FileTreeComponent.showCreateFolderDialog();
      });
    }
    
    // Sort by name toggle: cycles asc <-> desc
    if (sortNameBtn && window.FileTreeComponent) {
      sortNameBtn.addEventListener('click', () => {
        const cur = FileTreeComponent.getSort();
        let newDir;
        if (cur.key === 'name') {
          // Already sorting by name: flip direction
          newDir = cur.dir === 'asc' ? 'desc' : 'asc';
        } else {
          // Switching from date to name: default to asc (A→Z)
          newDir = 'asc';
        }
        FileTreeComponent.setSort('name', newDir);
        updateSortButtonStates();
      });
    }
    
    // Sort by date toggle: cycles desc <-> asc
    if (sortDateBtn && window.FileTreeComponent) {
      sortDateBtn.addEventListener('click', () => {
        const cur = FileTreeComponent.getSort();
        let newDir;
        if (cur.key === 'date') {
          // Already sorting by date: flip direction
          newDir = cur.dir === 'desc' ? 'asc' : 'desc';
        } else {
          // Switching from name to date: default to desc (newest first)
          newDir = 'desc';
        }
        FileTreeComponent.setSort('date', newDir);
        updateSortButtonStates();
      });
    }
    
    // Initial sync of button visual states with the default sort (name/asc)
    updateSortButtonStates();
  }
  
  /**
   * Update the aria-pressed, title, and icon state of the two sort-toggle
   * buttons based on the current FileTreeComponent sort state.
   */
  function updateSortButtonStates() {
    if (!window.FileTreeComponent) return;
    const { key, dir } = FileTreeComponent.getSort();
    
    const sortNameBtn = document.getElementById('sort-name-btn');
    const sortDateBtn = document.getElementById('sort-date-btn');
    
    if (sortNameBtn) {
      const isActive = key === 'name';
      const isAsc = dir === 'asc';
      sortNameBtn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      sortNameBtn.classList.toggle('active', isActive);
      sortNameBtn.title = isActive
        ? (isAsc ? 'Sorting by name (A→Z). Click to reverse.' : 'Sorting by name (Z→A). Click to reverse.')
        : 'Sort by name (A→Z)';
      /* FIX: always show at least one icon so the button is never blank.
         When active, show the icon matching the current direction.
         When not active, show the default (asc) icon as a preview. */
      const ascIcon = sortNameBtn.querySelector('.icon-asc');
      const descIcon = sortNameBtn.querySelector('.icon-desc');
      if (ascIcon && descIcon) {
        const showAsc = isActive ? isAsc : true; // default to asc when inactive
        ascIcon.classList.toggle('hidden', !showAsc);
        descIcon.classList.toggle('hidden', showAsc);
      }
    }

    if (sortDateBtn) {
      const isActive = key === 'date';
      const isDesc = dir === 'desc'; // "desc" = newest-first
      sortDateBtn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      sortDateBtn.classList.toggle('active', isActive);
      sortDateBtn.title = isActive
        ? (isDesc ? 'Sorting by date (Newest first). Click to reverse.' : 'Sorting by date (Oldest first). Click to reverse.')
        : 'Sort by date (Newest first)';
      /* FIX: always show at least one icon so the button is never blank.
         When active, show the icon matching the current direction.
         When not active, show the default (desc=newest-first) icon as a preview. */
      const ascIcon = sortDateBtn.querySelector('.icon-asc');
      const descIcon = sortDateBtn.querySelector('.icon-desc');
      if (ascIcon && descIcon) {
        const showDesc = isActive ? isDesc : true; // default to desc when inactive
        descIcon.classList.toggle('hidden', !showDesc);
        ascIcon.classList.toggle('hidden', showDesc);
      }
    }
  }
  
  // ============================================
  // Modal Helpers
  // ============================================
  
  function showModal(modal) {
    if (!modal) return;
    modal.classList.remove('hidden');
    
    // Focus first input
    const input = modal.querySelector('input:not([type="hidden"])');
    if (input) setTimeout(() => input.focus(), 100);
    
    // Trap focus (basic)
    modal.addEventListener('keydown', trapFocus);
  }

  function hideModal(modal) {
    if (!modal) return;
    modal.classList.add('hidden');
    modal.removeEventListener('keydown', trapFocus);
  }

  function trapFocus(e) {
    if (e.key === 'Escape') {
      hideModal(e.currentTarget);
    }
  }

  // ============================================
  // Settings Panel
  // ============================================
  
  function toggleSettings(show) {
    // HTML uses #settings-modal with .modal-body containing .setting-group elements
    const settingsModal = document.getElementById('settings-modal');
    if (!settingsModal) return;
    
    if (show) {
      settingsModal.classList.remove('hidden');
      setupSettingsHandlers(settingsModal);
    } else {
      settingsModal.classList.add('hidden');
    }
  }

  /**
   * Setup event handlers for settings modal - uses EXISTING HTML structure
   * HTML has: .modal-body > .setting-group with #theme-select, #font-scale-slider, etc.
   */
  function setupSettingsHandlers(modal) {
    const settings = IDEState?.get('settings') || {};
    
    // Theme selector (#theme-select is a <select> in HTML)
    const themeSelect = modal.querySelector('#theme-select');
    if (themeSelect) {
      // Set current value — resolve legacy theme IDs (graphite, midnight, etc.)
      // to their current equivalent so the dropdown shows the right option.
      const rawTheme = settings.theme || 'unthemed';
      const currentTheme = window.IDEThemes
        ? IDEThemes.resolveThemeId(rawTheme)
        : rawTheme;
      themeSelect.value = currentTheme;
      
      // Remove old listener to avoid duplicates
      const newThemeSelect = themeSelect.cloneNode(true);
      themeSelect.parentNode.replaceChild(newThemeSelect, themeSelect);
      
      newThemeSelect.addEventListener('change', (e) => {
        if (window.IDEThemes) {
          IDEThemes.applyTheme(e.target.value);
        }
        if (window.IDEState) {
          IDEState.updateSettings({ theme: e.target.value });
        }
      });
    }
    
    // Font scale slider (#font-scale-slider)
    const fontSlider = modal.querySelector('#font-scale-slider');
    const fontScaleValue = modal.querySelector('#font-scale-value');
    if (fontSlider && fontScaleValue) {
      fontSlider.value = settings.fontScale || 1;
      fontScaleValue.textContent = (settings.fontScale || 1) + 'x';
      
      const newFontSlider = fontSlider.cloneNode(true);
      fontSlider.parentNode.replaceChild(newFontSlider, fontSlider);
      
      newFontSlider.addEventListener('input', (e) => {
        const scale = parseFloat(e.target.value);
        fontScaleValue.textContent = scale.toFixed(2) + 'x';
        if (window.IDEThemes) {
          IDEThemes.setFontScale(scale);
        }
      });
      
      newFontSlider.addEventListener('change', (e) => {
        const scale = parseFloat(e.target.value);
        if (window.IDEState) {
          IDEState.updateSettings({ fontScale: scale });
        }
      });
    }
    
    // Notifications toggle (#notifications-toggle)
    const notifToggle = modal.querySelector('#notifications-toggle');
    if (notifToggle) {
      notifToggle.checked = settings.showNotifications !== false; // default true
      
      const newNotifToggle = notifToggle.cloneNode(true);
      notifToggle.parentNode.replaceChild(newNotifToggle, notifToggle);
      
      newNotifToggle.addEventListener('change', (e) => {
        if (window.IDEState) {
          IDEState.updateSettings({ showNotifications: e.target.checked });
        }
      });
    }
    
    // ZIP backup toggle (#zip-backup-toggle)
    const zipToggle = modal.querySelector('#zip-backup-toggle');
    if (zipToggle) {
      zipToggle.checked = settings.autoCreateZipBackup || false;
      
      const newZipToggle = zipToggle.cloneNode(true);
      zipToggle.parentNode.replaceChild(newZipToggle, zipToggle);
      
      newZipToggle.addEventListener('change', (e) => {
        if (window.IDEState) {
          IDEState.updateSettings({ autoCreateZipBackup: e.target.checked });
        }
      });
    }

    // Sound effects toggle (#sound-effects-toggle) — ported from v1 IDE
    const soundToggle = modal.querySelector('#sound-effects-toggle');
    if (soundToggle) {
      soundToggle.checked = settings.soundEffects || false;

      const newSoundToggle = soundToggle.cloneNode(true);
      soundToggle.parentNode.replaceChild(newSoundToggle, soundToggle);

      newSoundToggle.addEventListener('change', (e) => {
        if (window.IDEState) {
          IDEState.updateSettings({ soundEffects: e.target.checked });
        }
        // Play a confirmation cue immediately so the user hears what it sounds like
        if (e.target.checked && window.IDEUtils && IDEUtils.playSound) {
          IDEUtils.playSound('success');
        }
      });
    }

    // Word wrap toggle (#word-wrap-toggle) — ported from v1 IDE
    const wordWrapToggle = modal.querySelector('#word-wrap-toggle');
    if (wordWrapToggle) {
      wordWrapToggle.checked = settings.wordWrap !== false; // default true

      const newWordWrapToggle = wordWrapToggle.cloneNode(true);
      wordWrapToggle.parentNode.replaceChild(newWordWrapToggle, wordWrapToggle);

      newWordWrapToggle.addEventListener('change', (e) => {
        if (window.IDEState) {
          IDEState.updateSettings({ wordWrap: e.target.checked });
        }
        document.dispatchEvent(new CustomEvent('ide:settings-applied', {
          detail: { settings: IDEState.get('settings'), prev: {} }
        }));
      });
    }

    // Line numbers toggle (#line-numbers-toggle) — ported from v1 IDE
    const lineNumbersToggle = modal.querySelector('#line-numbers-toggle');
    if (lineNumbersToggle) {
      lineNumbersToggle.checked = settings.lineNumbers !== false; // default true

      const newLineNumbersToggle = lineNumbersToggle.cloneNode(true);
      lineNumbersToggle.parentNode.replaceChild(newLineNumbersToggle, lineNumbersToggle);

      newLineNumbersToggle.addEventListener('change', (e) => {
        if (window.IDEState) {
          IDEState.updateSettings({ lineNumbers: e.target.checked });
        }
        document.dispatchEvent(new CustomEvent('ide:settings-applied', {
          detail: { settings: IDEState.get('settings'), prev: {} }
        }));
      });
    }

    // Auto-save toggle (#auto-save-toggle) — ported from v1 IDE
    const autoSaveToggle = modal.querySelector('#auto-save-toggle');
    if (autoSaveToggle) {
      autoSaveToggle.checked = settings.autoSave || false;

      const newAutoSaveToggle = autoSaveToggle.cloneNode(true);
      autoSaveToggle.parentNode.replaceChild(newAutoSaveToggle, autoSaveToggle);

      newAutoSaveToggle.addEventListener('change', (e) => {
        if (window.IDEState) {
          IDEState.updateSettings({ autoSave: e.target.checked });
        }
        if (window.IDEUtils && IDEUtils.showToast) {
          IDEUtils.showToast(
            e.target.checked ? 'Auto-save enabled' : 'Auto-save disabled',
            'info',
            2000
          );
        }
      });
    }

    // LLM Provider selection - find or create the section
    setupLLMProviderSelection(modal, settings);
    
    // Export/Clear buttons - these may need to be created or already exist
    setupDataButtons(modal);
  }

  /**
   * Setup LLM Provider Selection with free public options
   */
  function setupLLMProviderSelection(modal, settings) {
    let llmGroup = modal.querySelector('#llm-provider-group');
    
    // Create the LLM section if it doesn't exist
    if (!llmGroup) {
      const modalBody = modal.querySelector('.modal-body');
      if (!modalBody) return;
      
      llmGroup = document.createElement('div');
      llmGroup.className = 'setting-group';
      llmGroup.id = 'llm-provider-group';
      llmGroup.innerHTML = `
        <label class="setting-label" for="llm-provider-select">AI Provider (Free Public LLMs)</label>
        <select id="llm-provider-select" class="select" aria-label="Select AI provider">
          <option value="">-- Select Provider --</option>
          <optgroup label="Free Tier / Open Source">
            <option value="ollama-local">Ollama (Local)</option>
            <option value="huggingface">Hugging Face Inference API</option>
          </optgroup>
          <optgroup label="Free Tier (API Key Required)">
            <option value="openai-free">OpenAI GPT-3.5-Turbo (Free Tier)</option>
            <option value="google-ai">Google Gemini Flash (Free Tier)</option>
            <option value="groq">Groq (Fast Free Inference)</option>
            <option value="together-ai">Together AI (Free Tier)</option>
          </optgroup>
          <optgroup label="Open Models (Self-Hosted)">
            <option value="llamacpp">Llama.cpp Server</option>
            <option value="vllm">vLLM Server</option>
            <option value="localai">LocalAI</option>
          </optgroup>
        </select>
        <div id="llm-config-area" class="llm-config-area" style="margin-top: 12px; display: none;">
          <div class="setting-group" style="border-bottom: none; padding-bottom: 0;">
            <label class="setting-label" for="llm-api-key">API Key (if required)</label>
            <input type="password" id="llm-api-key" class="input" placeholder="Enter API key..." />
          </div>
          <div class="setting-group" style="border-bottom: none; padding-bottom: 0;">
            <label class="setting-label" for="llm-base-url">Base URL (for self-hosted)</label>
            <input type="text" id="llm-base-url" class="input" placeholder="http://localhost:11434" />
          </div>
          <div class="setting-group" style="border-bottom: none; padding-bottom: 0;">
            <label class="setting-label" for="llm-model-name">Model Name</label>
            <input type="text" id="llm-model-name" class="input" placeholder="e.g., llama2, mistral, codellama" />
          </div>
          <button class="btn btn-primary btn-sm" id="save-llm-config" style="margin-top: 8px;">Save Configuration</button>
        </div>
        <p class="form-hint" id="llm-status-hint" style="margin-top: 8px;">Choose an AI provider to enable chat features</p>
      `;
      
      // Insert before the last setting group (or append)
      const lastGroup = modalBody.querySelector('.setting-group:last-of-type');
      if (lastGroup && lastGroup.id !== 'llm-provider-group') {
        lastGroup.parentNode.insertBefore(llmGroup, lastGroup.nextSibling);
      } else {
        modalBody.appendChild(llmGroup);
      }
    }
    
    // Set current values
    const providerSelect = llmGroup.querySelector('#llm-provider-select');
    const apiKeyInput = llmGroup.querySelector('#llm-api-key');
    const baseUrlInput = llmGroup.querySelector('#llm-base-url');
    const modelNameInput = llmGroup.querySelector('#llm-model-name');
    const configArea = llmGroup.querySelector('#llm-config-area');
    const statusHint = llmGroup.querySelector('#llm-status-hint');
    const saveBtn = llmGroup.querySelector('#save-llm-config');
    
    if (providerSelect) {
      providerSelect.value = settings.llmProvider || '';
      
      // Show/hide config area based on selection
      const toggleConfigArea = () => {
        const val = providerSelect.value;
        const needsConfig = ['ollama-local', 'llamacpp', 'vllm', 'localai', 'huggingface'].includes(val);
        const needsApiKey = ['openai-free', 'google-ai', 'groq', 'together-ai'].includes(val);
        
        if (configArea) {
          configArea.style.display = (needsConfig || needsApiKey) ? 'block' : 'none';
        }
        
        // Update hint text
        if (statusHint) {
          if (val === '') {
            statusHint.textContent = 'Choose an AI provider to enable chat features';
            statusHint.className = 'form-hint';
          } else if (['ollama-local', 'llamacpp', 'vllm', 'localai'].includes(val)) {
            statusHint.textContent = '✓ Local provider - no API key needed. Enter your server URL below.';
            statusHint.className = 'form-hint success';
          } else if (val === 'huggingface') {
            statusHint.textContent = '⚠ Free tier available. Get API key from huggingface.co';
            statusHint.className = 'form-hint';
          } else {
            statusHint.textContent = 'ℹ Free tier available. You may need to sign up for an API key.';
            statusHint.className = 'form-hint';
          }
        }
      };
      
      // Remove old listener
      const newSelect = providerSelect.cloneNode(true);
      providerSelect.parentNode.replaceChild(newSelect, providerSelect);
      
      newSelect.addEventListener('change', toggleConfigArea);
      
      // Initial state
      setTimeout(toggleConfigArea, 0);
      
      // Load saved config
      if (apiKeyInput) apiKeyInput.value = settings.llmApiKey || '';
      if (baseUrlInput) baseUrlInput.value = settings.llmBaseUrl || '';
      if (modelNameInput) modelNameInput.value = settings.llmModelName || '';
      
      // Save button handler
      if (saveBtn) {
        saveBtn.onclick = () => {
          const config = {
            llmProvider: newSelect.value,
            llmApiKey: apiKeyInput?.value || '',
            llmBaseUrl: baseUrlInput?.value || '',
            llmModelName: modelNameInput?.value || ''
          };
          
          if (window.IDEState) {
            IDEState.updateSettings(config);
          }
          
          if (IDEUtils) {
            IDEUtils.showToast('LLM configuration saved!', 'success');
          }
          
          if (statusHint) {
            statusHint.textContent = '✓ Configuration saved successfully!';
            statusHint.className = 'form-hint success';
          }
        };
      }
    }
  }

  /**
   * Setup data export/clear buttons
   */
  function setupDataButtons(modal) {
    // Check if buttons already exist, if not create them
    let exportBtn = modal.querySelector('#export-data-btn');
    let clearBtn = modal.querySelector('#clear-data-btn');
    
    if (!exportBtn || !clearBtn) {
      const modalBody = modal.querySelector('.modal-body');
      if (!modalBody) return;
      
      // Create data section if it doesn't exist
      let dataGroup = modal.querySelector('#data-operations-group');
      if (!dataGroup) {
        dataGroup = document.createElement('div');
        dataGroup.className = 'setting-group';
        dataGroup.id = 'data-operations-group';
        dataGroup.style.borderBottom = 'none';
        dataGroup.innerHTML = `
          <h4 style="font-size: var(--font-size-sm); font-weight: 600; margin-bottom: var(--space-2); color: var(--color-text, #1f2937);">Data Management</h4>
          <button class="btn btn-outline" id="export-data-btn" style="margin-bottom: var(--space-2); width: 100%;">Export All Data</button>
          <button class="btn btn-outline btn-danger" id="clear-data-btn" style="width: 100%;">Clear All Data</button>
        `;
        modalBody.appendChild(dataGroup);
        
        exportBtn = dataGroup.querySelector('#export-data-btn');
        clearBtn = dataGroup.querySelector('#clear-data-btn');
      }
    }
    
    // Wire up export button
    if (exportBtn) {
      const newExportBtn = exportBtn.cloneNode(true);
      exportBtn.parentNode.replaceChild(newExportBtn, exportBtn);
      newExportBtn.addEventListener('click', exportAllData);
    }
    
    // Wire up clear button
    if (clearBtn) {
      const newClearBtn = clearBtn.cloneNode(true);
      clearBtn.parentNode.replaceChild(newClearBtn, clearBtn);
      newClearBtn.addEventListener('click', clearAllDataWithConfirm);
    }
  }

  async function exportAllData() {
    try {
      const data = await IDEStorage.exportAll();
      if (IDEUtils) {
        IDEUtils.downloadJSON(data, `ide-backup-${Date.now()}.json`);
        IDEUtils.showToast('Data exported successfully!', 'success');
      }
    } catch (error) {
      console.error('Export failed:', error);
      if (IDEUtils) IDEUtils.showToast('Export failed', 'error');
    }
  }

  function clearAllDataWithConfirm() {
    const confirmed = confirm('This will delete ALL your projects, files, and settings. Are you absolutely sure?');
    if (!confirmed) return;
    
    const doubleConfirmed = confirm('This action CANNOT be UNDOED. Type "DELETE" to confirm.');
    if (doubleConfirmed) {
      IDEStorage.clearAll().then(() => {
        if (window.IDEState) IDEState.reset();
        location.reload();
      });
    }
  }

  // ============================================
  // Public API
  // ============================================
  
  return {
    init,
    toggleSidebar,
    showSidebar,
    hideSidebar,
    toggleCollapse,
    switchTab,
    createProject,
    importProject,
    switchProject,
    deleteCurrentProject,
    loadProjectData,
    toggleSettings,
    refresh: async () => {
      const project = IDEState?.get('currentProject');
      await loadProjectData(project);
    },
    
    getState: () => ({
      isOpen,
      isCollapsed,
      activeTab
    })
  };
})();

// Export for use in other modules
window.SidebarComponent = SidebarComponent;

// === Projects List Resize Handle ===
function setupProjectsResizeHandle() {
  const handle = document.querySelector('.projects-resize-handle');
  const container = document.querySelector('.projects-list-container');
  if (!handle || !container) return;

  const STORAGE_KEY = 'ide:projects-height';
  const MIN_PX = 100;
  const MAX_PX = 400;
  const DEFAULT_PX = 144; // 9rem default

  // Restore saved height
  try {
    const saved = parseInt(localStorage.getItem(STORAGE_KEY), 10);
    if (!isNaN(saved) && saved >= MIN_PX && saved <= MAX_PX) {
      container.style.setProperty('--projects-height', `${saved}px`);
      container.style.height = `${saved}px`;
      container.style.maxHeight = `${saved}px`;
    }
  } catch (e) { /* ignore */ }

  let dragging = false;
  let startY = 0;
  let startHeight = 0;

  handle.addEventListener('pointerdown', (e) => {
    dragging = true;
    startY = e.clientY;
    startHeight = container.offsetHeight;
    handle.classList.add('dragging');
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const delta = e.clientY - startY;
    let newHeight = Math.max(MIN_PX, Math.min(MAX_PX, startHeight + delta));
    container.style.height = `${newHeight}px`;
    container.style.maxHeight = `${newHeight}px`;
    container.style.setProperty('--projects-height', `${newHeight}px`);
  });

  document.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    
    // Save height
    try {
      localStorage.setItem(STORAGE_KEY, String(container.offsetHeight));
    } catch (e) { /* ignore */ }
  });
}

// === Editor Panel Resize Handle ===
function setupEditorResizeHandle() {
  const handle = document.querySelector('.editor-resize-handle');
  const editorPanel = document.querySelector('.editor-panel');
  if (!handle || !editorPanel) return;

  const STORAGE_KEY = 'ide:editor-width';
  const MIN_PX = 300;
  const MAX_PX = 900;
  const DEFAULT_PX = 448; // 28rem default

  // Restore saved width
  try {
    const saved = parseInt(localStorage.getItem(STORAGE_KEY), 10);
    if (!isNaN(saved) && saved >= MIN_PX && saved <= MAX_PX) {
      editorPanel.style.width = `${saved}px`;
      editorPanel.style.flexBasis = `${saved}px`;
    }
  } catch (e) { /* ignore */ }

  let dragging = false;
  let startX = 0;
  let startWidth = 0;

  handle.addEventListener('pointerdown', (e) => {
    // Only if editor is visible
    if (editorPanel.classList.contains('hidden')) return;
    dragging = true;
    startX = e.clientX;
    startWidth = editorPanel.offsetWidth;
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const delta = e.clientX - startX;
    // For right-side panel, dragging left increases size
    let newWidth = Math.max(MIN_PX, Math.min(MAX_PX, startWidth - delta));
    editorPanel.style.width = `${newWidth}px`;
    editorPanel.style.flexBasis = `${newWidth}px`;
    editorPanel.style.flexGrow = '0';
  });

  document.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    
    // Save width
    try {
      localStorage.setItem(STORAGE_KEY, String(editorPanel.offsetWidth));
    } catch (e) { /* ignore */ }
  });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setupProjectsResizeHandle();
    setupEditorResizeHandle();
  });
} else {
  setupProjectsResizeHandle();
  setupEditorResizeHandle();
}
