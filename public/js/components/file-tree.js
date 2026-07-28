/**
 * SBIDE - File Tree Component
 * Renders and manages the file/folder tree in the sidebar
 * Enhanced with toolbar, context menu, and full CRUD operations
 */

const FileTreeComponent = (() => {
  // ============================================
  // State
  // ============================================
  
  let container = null;
  let treeData = [];
  let expandedFolders = new Set();
  let selectedFile = null;
  let onFileSelect = null;
  let onFileAction = null;
  
  // Context menu state
  let contextMenu = null;
  let contextMenuItem = null;
  
  // Dialog state
  let dialog = null;
  let dialogCallback = null;
  
  // Drag state
  let dragItem = null;

  // Clipboard state for Copy/Cut/Paste.
  // { item: <tree node>, mode: 'copy' | 'cut', projectName: <string> }
  // Persisted to localStorage so clipboard survives page reloads.
  const CLIPBOARD_PREF_KEY = 'ide:file-tree-clipboard';
  let clipboard = loadClipboard();
  
  // Sort state (controlled by the HTML toolbar buttons in #panel-files header)
  // sortKey: 'name' | 'date'   sortDir: 'asc' | 'desc'
  let sortKey = 'name';
  let sortDir = 'asc';

  // ============================================
  // Initialization
  // ============================================
  
  /**
   * Initialize file tree component
   * @param {HTMLElement} element - Container element for the tree
   * @param {Object} options - Configuration options
   */
  function init(element, options = {}) {
    if (!element) {
      console.error('FileTree: Container element required');
      return;
    }
    
    container = element;
    onFileSelect = options.onFileSelect || null;
    onFileAction = options.onFileAction || null;
    
    // Initialize with empty state (includes toolbar)
    render();
    
    // Subscribe to state changes for file refresh
    if (window.IDEState) {
      IDEState.subscribe((state, prevState) => {
        if (state.fileRefreshKey !== prevState.fileRefreshKey) {
          loadFilesForProject(state.currentProject);
        }
        if (state.activeFile !== prevState.activeFile) {
          setSelectedFile(state.activeFile);
        }
      });
    }
    
    // Close context menu on outside click
    document.addEventListener('click', (e) => {
      if (contextMenu && !contextMenu.contains(e.target)) {
        closeContextMenu();
      }
    });
    
    // Close dialog on escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeContextMenu();
        closeDialog();
      }
    });
  }

  // ============================================
  // Data Loading
  // ============================================
  
  /**
   * Load files for a project and render tree
   */
  async function loadFilesForProject(project) {
    if (!project || !project.name) {
      treeData = [];
      render();
      return;
    }
    
    try {
      const files = await IDEStorage.Files.getByProject(project.name);
      treeData = buildTree(files);
      
      // Auto-expand root level folders
      treeData.forEach(item => {
        if (item.type === 'folder') {
          expandedFolders.add(item.path);
        }
      });
      
      render();
    } catch (error) {
      console.error('Failed to load files:', error);
      treeData = [];
      render();
    }
  }

  /**
   * Build tree structure from flat file array
   */
  function buildTree(files) {
    const map = new Map();
    const root = [];
    
    // Create map entries
    files.forEach(file => {
      map.set(file.path, { ...file, children: [] });
    });
    
    // Build hierarchy
    files.forEach(file => {
      const node = map.get(file.path);
      if (!file.path || file.path === '') {
        root.push(node);
      } else {
        const parentPath = file.path.substring(0, file.path.lastIndexOf('/'));
        const parent = map.get(parentPath);
        if (parent) {
          parent.children.push(node);
        } else {
          root.push(node);
        }
      }
    });
    
    // Sort: folders first, then alphabetically
    sortNodes(root);
    
    return root.length === 1 && root[0].path === '' ? root[0].children : root;
  }

  /**
   * Sort nodes recursively, respecting the current sortKey/sortDir.
   * Folders always come before files within their parent (regardless of sort mode),
   * then items within each type group are sorted by name or by updatedAt date.
   */
  function sortNodes(nodes) {
    nodes.sort((a, b) => {
      // Folders first (always)
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      
      // Same type: apply the active sort
      if (sortKey === 'date') {
        const ta = a.updatedAt || 0;
        const tb = b.updatedAt || 0;
        if (ta !== tb) {
          return sortDir === 'desc' ? (tb - ta) : (ta - tb);
        }
        // Tie-break by name ascending (keeps sort stable)
        return a.name.localeCompare(b.name);
      }
      
      // Default: name
      const cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      return sortDir === 'desc' ? -cmp : cmp;
    });
    
    nodes.forEach(node => {
      if (node.children && node.children.length > 0) {
        sortNodes(node.children);
      }
    });
  }
  
  /**
   * Update the sort mode and re-render.
   * @param {'name'|'date'} key
   * @param {'asc'|'desc'} dir
   */
  function setSort(key, dir) {
    sortKey = key;
    sortDir = dir;
    // Re-sort the in-memory tree without re-fetching from IndexedDB
    sortNodes(treeData);
    render();
    // Notify the panel-header toggle buttons so they can sync their visual state
    // (active class / aria-pressed / icon / title). sidebar.js listens for this.
    document.dispatchEvent(new CustomEvent('ide:file-sort-changed', {
      detail: { key: sortKey, dir: sortDir }
    }));
  }
  
  /**
   * Get current sort state (used by the HTML toggle buttons to update their
   * aria-pressed / icon state).
   */
  function getSort() {
    return { key: sortKey, dir: sortDir };
  }

  // ============================================
  // Rendering
  // ============================================
  
  /**
   * Render the complete file tree.
   * The New File / New Folder / Refresh / sort-toggle buttons live in the
   * panel-header in index.html (wired by sidebar.js), so we no longer render
   * our own toolbar here.
   */
  function render() {
    if (!container) return;
    
    // Clear container
    container.innerHTML = '';
    
    // Show empty state if no data
    if (treeData.length === 0) {
      renderEmptyState();
      // Even in empty state, allow dropping into root (e.g. dragging a file
      // out of a subfolder into root when the tree is collapsed).
      attachRootDropZone(container);
      return;
    }
    
    // Create tree container
    const treeList = document.createElement('ul');
    treeList.className = 'file-tree-list';
    treeList.setAttribute('role', 'tree');
    treeList.setAttribute('aria-label', 'Project files');
    
    // Create root folder wrapper - renders as a regular folder in the tree
    const rootFolder = {
      name: '/',  // Traditional filesystem root notation
      path: '',
      type: 'folder',
      children: [...treeData]  // All top-level items become children of root
    };
    
    // Render root folder at depth 0
    // Its children will naturally be at depth 1, grandchildren at depth 2, etc.
    const rootLi = renderTreeNode(rootFolder, 0);
    treeList.appendChild(rootLi);
    
    container.appendChild(treeList);

    // Allow dropping into empty space below the list → moves to root.
    attachRootDropZone(container);
  }

  /**
   * Make `el` accept drops that fall onto empty space (i.e. NOT on a
   * .tree-row). When a drag hovers over empty space, we show a "drop into
   * root" highlight; dropping moves the dragged item to the project root.
   */
  function attachRootDropZone(el) {
    if (!el) return;

    // Only attach once per container.
    if (el._rootDropAttached) return;
    el._rootDropAttached = true;

    el.addEventListener('dragover', (e) => {
      if (!dragItem) return;
      // If the user is hovering over a .tree-row, let that row's own
      // dragover handler take care of it — don't interfere.
      const onRow = e.target.closest('.tree-row');
      if (onRow) return;

      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      // Subtle highlight on the whole tree to signal "drop into root"
      el.classList.add('root-drop-active');
    });

    el.addEventListener('dragleave', (e) => {
      // Only clear if the pointer has actually left the container
      if (!el.contains(e.relatedTarget)) {
        el.classList.remove('root-drop-active');
      }
    });

    el.addEventListener('drop', (e) => {
      const onRow = e.target.closest('.tree-row');
      if (onRow) {
        // Let the row handler deal with this drop.
        return;
      }
      e.preventDefault();
      el.classList.remove('root-drop-active');
      if (!dragItem) return;

      const source = dragItem;
      dragItem = null;

      // Don't allow moving a root item to root (no-op)
      const sourceParent = (() => {
        const ls = source.path.lastIndexOf('/');
        return ls > 0 ? source.path.substring(0, ls) : '';
      })();
      if (sourceParent === '') {
        if (IDEUtils) IDEUtils.showToast(`"${source.name}" is already at root`, 'info');
        return;
      }

      // Also fire the legacy callback
      if (onFileAction) {
        onFileAction({
          type: 'move',
          source,
          target: { path: '', name: '/', type: 'folder' },
          targetFolderPath: ''
        });
      }

      confirmAndExecuteMove(source, '', { path: '', name: '/', type: 'folder' });
    });
  }

  /**
   * Render toolbar with New File/Folder buttons
   */
  function renderToolbar() {
    const toolbar = document.createElement('div');
    toolbar.className = 'file-tree-toolbar';
    toolbar.innerHTML = `
      <button class="toolbar-btn" data-action="new-file" title="Create new file">
        ${IDEUtils?.Icons?.newFile || ''}
        <span>New File</span>
      </button>
      <button class="toolbar-btn" data-action="new-folder" title="Create new folder">
        ${IDEUtils?.Icons?.newFolder || ''}
        <span>New Folder</span>
      </button>
    `;
    
    // Wire up toolbar buttons
    toolbar.querySelector('[data-action="new-file"]').addEventListener('click', () => {
      showCreateDialog('file');
    });
    
    toolbar.querySelector('[data-action="new-folder"]').addEventListener('click', () => {
      showCreateDialog('folder');
    });
    
    container.appendChild(toolbar);
  }

  /**
   * Render empty state
   */
  function renderEmptyState() {
    const empty = document.createElement('div');
    empty.className = 'file-tree-empty';
    empty.setAttribute('role', 'status');
    empty.innerHTML = `
      <svg class="empty-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
      </svg>
      <p class="empty-text">No files yet</p>
      <p class="empty-hint">Create or import files to get started</p>
      <button class="btn btn-primary btn-sm create-first-file-btn">
        ${IDEUtils?.Icons?.newFile || ''} Create your first file
      </button>
    `;
    
    // Wire up the "create first file" button
    empty.querySelector('.create-first-file-btn').addEventListener('click', () => {
      showCreateDialog('file');
    });
    
    container.appendChild(empty);
  }

  /**
   * Render a single tree node (recursively)
   */
  function renderTreeNode(item, depth) {
    const li = document.createElement('li');
    li.className = `tree-item ${item.type}-item`;
    li.setAttribute('data-path', item.path);
    li.setAttribute('data-type', item.type);
    li.setAttribute('role', item.type === 'folder' ? 'group' : 'treeitem');
    li.style.setProperty('--depth', depth);
    
    const isExpanded = expandedFolders.has(item.path);
    const isSelected = selectedFile && selectedFile.path === item.path;
    
    // Row element (clickable area)
    const row = document.createElement('div');
    row.className = `tree-row group ${isSelected ? 'selected' : ''}`;
    row.setAttribute('aria-selected', isSelected);
    row.tabIndex = 0;
    
    // No chevron/toggle - folder icon itself indicates expandability
    // Clicking the row toggles expansion
    
    // Icon
    const icon = document.createElement('span');
    icon.className = `tree-icon ${item.type}-icon`;
    icon.innerHTML = item.type === 'folder' 
      ? (isExpanded ? (IDEUtils?.Icons?.folderOpen || '') : (IDEUtils?.Icons?.folder || ''))
      : (IDEUtils?.getFileIcon?.(item.name) || IDEUtils?.Icons?.file || '');
    row.appendChild(icon);
    
    // Name
    const name = document.createElement('span');
    name.className = 'tree-name';
    name.textContent = item.name;
    row.appendChild(name);
    
    // Actions menu (visible on hover)
    const actions = document.createElement('div');
    actions.className = 'tree-actions';
    actions.innerHTML = `
      <button class="tree-action-btn" data-action="menu" title="More actions" aria-label="Actions menu">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>
        </svg>
      </button>
    `;
    
    actions.querySelector('[data-action="menu"]').addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      showContextMenu(e, item);
    });
    
    row.appendChild(actions);
    
    // Click handler
    row.addEventListener('click', () => handleItemClick(item));
    

    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleItemClick(item);
      }
    });
    
    // Context menu
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(e, item);
    });
    
    // Drag events
    row.draggable = true;
    row.addEventListener('dragstart', (e) => handleDragStart(e, item));
    row.addEventListener('dragover', (e) => handleDragOver(e, item));
    row.addEventListener('dragleave', (e) => handleDragLeave(e, item));
    row.addEventListener('drop', (e) => handleDrop(e, item));
    row.addEventListener('dragend', handleDragEnd);
    
    li.appendChild(row);
    
    // Render children for expanded folders
    if (item.type === 'folder' && isExpanded && item.children && item.children.length > 0) {
      const childContainer = document.createElement('ul');
      childContainer.className = 'tree-children';
      childContainer.setAttribute('role', 'group');
      // Pass depth info to children container for connector line positioning
      childContainer.style.setProperty('--child-depth', depth);
      
      item.children.forEach(child => {
        const childLi = renderTreeNode(child, depth + 1);
        childContainer.appendChild(childLi);
      });
      
      li.appendChild(childContainer);
    }
    
    return li;
  }

  // ============================================
  // Context Menu
  // ============================================
  
  /**
   * Show context menu for an item
   */
  function showContextMenu(event, item) {
    closeContextMenu();
    
    contextMenuItem = item;
    
    contextMenu = document.createElement('div');
    contextMenu.className = 'context-menu';
    contextMenu.setAttribute('role', 'menu');
    
    let menuItems = '';
    
    // For folders: add New File, New Folder options
    if (item.type === 'folder') {
      menuItems += `
        <div class="context-menu-item" data-action="new-file-in-folder" role="menuitem">
          ${IDEUtils?.Icons?.newFile || ''} New File
        </div>
        <div class="context-menu-item" data-action="new-folder-in-folder" role="menuitem">
          ${IDEUtils?.Icons?.newFolder || ''} New Folder
        </div>
        <div class="context-menu-divider"></div>
      `;
    }
    
    // Common items for all types
    menuItems += `
      <div class="context-menu-item" data-action="copy" role="menuitem">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
        Copy
      </div>
      <div class="context-menu-item" data-action="cut" role="menuitem">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>
        Cut
      </div>
      <div class="context-menu-item context-menu-paste ${clipboard.item ? '' : 'context-menu-disabled'}" data-action="paste" role="menuitem" ${clipboard.item ? '' : 'aria-disabled="true"'}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>
        Paste ${clipboard.item ? `(${clipboard.mode === 'cut' ? 'move' : 'copy'} "${escapeHtmlForDialog(clipboard.item.name)}")` : ''}
      </div>
      <div class="context-menu-item ${clipboard.item ? '' : 'context-menu-disabled'}" data-action="paste-into-root" role="menuitem" ${clipboard.item ? '' : 'aria-disabled="true"'}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>
        Paste into root
      </div>
      <div class="context-menu-divider"></div>
      <div class="context-menu-item" data-action="rename" role="menuitem">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        Rename
      </div>
      <div class="context-menu-item context-menu-danger" data-action="delete" role="menuitem">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
        Delete
      </div>
    `;
    
    contextMenu.innerHTML = menuItems;
    
    // Position menu
    const x = event.clientX || event.pageX;
    const y = event.clientY || event.pageY;
    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
    
    // Adjust position if menu goes off screen
    requestAnimationFrame(() => {
      const rect = contextMenu.getBoundingClientRect();
      if (rect.right > window.innerWidth) {
        contextMenu.style.left = `${x - rect.width}px`;
      }
      if (rect.bottom > window.innerHeight) {
        contextMenu.style.top = `${y - rect.height}px`;
      }
    });
    
    // Wire up menu items
    contextMenu.querySelectorAll('.context-menu-item').forEach(menuItem => {
      menuItem.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = menuItem.dataset.action;
        if (menuItem.classList.contains('context-menu-disabled')) {
          // Disabled items (e.g. Paste when clipboard is empty) do nothing
          return;
        }
        handleContextAction(action, item);
        closeContextMenu();
      });
    });
    
    document.body.appendChild(contextMenu);
  }
  
  /**
   * Close context menu
   */
  function closeContextMenu() {
    if (contextMenu) {
      contextMenu.remove();
      contextMenu = null;
      contextMenuItem = null;
    }
  }
  
  /**
   * Handle context menu action
   */
  function handleContextAction(action, item) {
    switch (action) {
      case 'new-file':
        showCreateDialog('file');
        break;
      case 'new-folder':
        showCreateDialog('folder');
        break;
      case 'new-file-in-folder':
        showCreateDialog('file', item);
        break;
      case 'new-folder-in-folder':
        showCreateDialog('folder', item);
        break;
      case 'copy':
        clipboard = { item: { ...item }, mode: 'copy', projectName: IDEState?.get('currentProject')?.name };
        saveClipboard(clipboard);
        if (IDEUtils) IDEUtils.showToast(`Copied "${item.name}"`, 'info');
        break;
      case 'cut':
        clipboard = { item: { ...item }, mode: 'cut', projectName: IDEState?.get('currentProject')?.name };
        saveClipboard(clipboard);
        if (IDEUtils) IDEUtils.showToast(`Cut "${item.name}"`, 'info');
        break;
      case 'paste':
        executePaste(item, /* intoRoot */ false);
        break;
      case 'paste-into-root':
        executePaste(item, /* intoRoot */ true);
        break;
      case 'rename':
        startRename(item);
        break;
      case 'delete':
        confirmDelete(item);
        break;
    }
  }

  // ============================================
  // Create Dialog
  // ============================================
  
  /**
   * Show create file/folder dialog
   * @param {string} type - 'file' or 'folder'
   * @param {Object} parentItem - Optional parent folder item
   */
  function showCreateDialog(type, parentItem = null) {
    closeDialog();
    
    const project = IDEState?.get('currentProject');
    if (!project) {
      if (IDEUtils) IDEUtils.showToast('Please select a project first', 'warning');
      return;
    }
    
    dialog = document.createElement('div');
    dialog.className = 'modal-overlay';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.innerHTML = `
      <div class="modal modal-sm">
        <div class="modal-header">
          <h2 class="modal-title">Create New ${type === 'file' ? 'File' : 'Folder'}</h2>
          <button class="icon-btn dialog-close-btn" aria-label="Close dialog">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label" for="create-name-input">${type === 'file' ? 'Filename' : 'Folder name'}</label>
            <input 
              type="text" 
              id="create-name-input"
              class="input" 
              placeholder="${type === 'file' ? 'filename.ts' : 'folder-name'}"
              autocomplete="off"
            />
            <p class="form-hint">Enter a name for the new ${type}</p>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline cancel-create-btn">Cancel</button>
          <button class="btn btn-primary confirm-create-btn" disabled>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            Create
          </button>
        </div>
      </div>
    `;
    
    const input = dialog.querySelector('#create-name-input');
    const confirmBtn = dialog.querySelector('.confirm-create-btn');
    const cancelBtn = dialog.querySelector('.cancel-create-btn');
    const closeBtn = dialog.querySelector('.dialog-close-btn');
    
    // Enable/disable confirm based on input
    input.addEventListener('input', () => {
      confirmBtn.disabled = !input.value.trim();
    });
    
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) {
        executeCreate(type, parentItem, input.value.trim());
      }
    });
    
    // Button handlers
    confirmBtn.addEventListener('click', () => {
      if (input.value.trim()) {
        executeCreate(type, parentItem, input.value.trim());
      }
    });
    
    const closeAndCleanup = () => closeDialog();
    cancelBtn.addEventListener('click', closeAndCleanup);
    closeBtn.addEventListener('click', closeAndCleanup);
    
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) closeDialog();
    });
    
    document.body.appendChild(dialog);
    
    // Focus input after animation
    requestAnimationFrame(() => {
      setTimeout(() => input.focus(), 100);
    });
  }
  
  /**
   * Execute the creation
   */
  async function executeCreate(type, parentItem, name) {
    const project = IDEState?.get('currentProject');
    if (!project) return;
    
    // Validate filename
    const validation = IDEUtils?.validateFilename?.(name);
    if (!validation?.valid) {
      if (IDEUtils) IDEUtils.showToast(validation?.error || 'Invalid name', 'error');
      return;
    }
    
    // Build path
    let path = name;
    if (parentItem && parentItem.type === 'folder') {
      path = parentItem.path ? `${parentItem.path}/${name}` : name;
    }
    
    try {
      await IDEStorage.Files.create({
        project: project.name,
        name: name,
        path: path,
        type: type,
        content: type === 'file' ? '' : undefined,
        size: 0
      });
      
      closeDialog();
      
      // Refresh tree
      if (window.IDEState) {
        IDEState.refreshFiles();
      }
      
      // If created a file, open it in editor
      if (type === 'file') {
        setTimeout(async () => {
          try {
            const newFile = await IDEStorage.Files.get(project.name, path);
            if (newFile && window.AppState?.codeEditor) {
              AppState.codeEditor.openFile({ ...newFile, project: project.name });
            }
            if (selectedFile && selectedFile.path === path) return; // Already selected
            // Select the new file
            const fileNode = findInTree(treeData, path);
            if (fileNode) selectFile(fileNode);
          } catch (e) {
            console.error('Failed to open new file:', e);
          }
        }, 100);
      }
      
      // Expand parent if creating inside folder
      if (parentItem && parentItem.type === 'folder') {
        expandedFolders.add(parentItem.path);
      }
      
      if (IDEUtils) IDEUtils.showToast(`Created ${type}: ${name}`, 'success');
      
    } catch (error) {
      console.error(`Failed to create ${type}:`, error);
      if (IDEUtils) IDEUtils.showToast(`Failed to create ${type}`, 'error');
    }
  }
  
  /**
   * Close dialog
   */
  function closeDialog() {
    if (dialog) {
      dialog.remove();
      dialog = null;
      dialogCallback = null;
    }
  }

  // ============================================
  // Rename Functionality
  // ============================================
  
  /**
   * Start inline rename for an item
   */
  function startRename(item) {
    const row = container?.querySelector(`[data-path="${item.path}"] .tree-row`);
    if (!row) return;
    
    const nameEl = row.querySelector('.tree-name');
    if (!nameEl) return;
    
    const originalName = item.name;
    
    // Create inline input
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tree-rename-input';
    input.value = originalName;
    input.dataset.originalName = originalName;
    input.dataset.itemPath = item.path;
    
    // Replace name element with input
    nameEl.style.display = 'none';
    nameEl.parentNode.insertBefore(input, nameEl.nextSibling);
    input.focus();
    input.select();
    
    // Handle rename completion
    const finishRename = async () => {
      const newName = input.value.trim();
      
      if (newName && newName !== originalName) {
        await executeRename(item, newName);
      }
      
      // Restore original display
      input.remove();
      nameEl.style.display = '';
      nameEl.textContent = newName || originalName;
    };
    
    input.addEventListener('blur', finishRename);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      } else if (e.key === 'Escape') {
        input.value = originalName;
        input.blur();
      }
    });
  }
  
  /**
   * Execute rename operation
   */
  async function executeRename(item, newName) {
    const project = IDEState?.get('currentProject');
    if (!project) return;
    
    // Validate new name
    const validation = IDEUtils?.validateFilename?.(newName);
    if (!validation?.valid) {
      if (IDEUtils) IDEUtils.showToast(validation?.error || 'Invalid filename', 'error');
      return;
    }
    
    try {
      // Call API to rename
      if (IDEAPI?.Files?.update) {
        await IDEAPI.Files.update(project.name, item.path, newName);
      }
      
      // Refresh tree
      if (window.IDEState) {
        IDEState.refreshFiles();
      }
      
      if (IDEUtils) IDEUtils.showToast(`Renamed to ${newName}`, 'success');
      
    } catch (error) {
      console.error('Failed to rename:', error);
      if (IDEUtils) IDEUtils.showToast('Failed to rename', 'error');
    }
  }

  // ============================================
  // Delete Functionality
  // ============================================
  
  /**
   * Confirm and delete an item
   */
  function confirmDelete(item) {
    const message = item.type === 'folder' 
      ? `Delete folder "${item.name}" and all its contents?`
      : `Delete "${item.name}"?`;
    
    if (!confirm(message)) return;
    
    executeDelete(item);
  }
  
  /**
   * Execute delete operation
   */
  async function executeDelete(item) {
    const project = IDEState?.get('currentProject');
    if (!project) return;
    
    try {
      // Call API to delete
      if (IDEAPI?.Files?.delete) {
        await IDEAPI.Files.delete(project.name, item.path);
      } else {
        // Fallback to storage
        await IDEStorage.Files.delete(project.name, item.path);
      }
      
      // If deleted file was selected, clear selection
      if (selectedFile && selectedFile.path === item.path) {
        selectedFile = null;
        if (window.IDEState) {
          IDEState.setActiveFile(null);
        }
      }
      
      // Refresh tree
      if (window.IDEState) {
        IDEState.refreshFiles();
      }
      
      if (IDEUtils) IDEUtils.showToast(`Deleted ${item.type}: ${item.name}`, 'success');
      
    } catch (error) {
      console.error('Failed to delete:', error);
      if (IDEUtils) IDEUtils.showToast('Failed to delete', 'error');
    }
  }

  // ============================================
  // Project Settings Modal
  // ============================================

  /**
   * Show Project Settings modal for a folder
   * Allows setting master prompt, project-level config, and other professional options
   */
  function showProjectSettingsModal(folderItem) {
    closeContextMenu();
    
    const project = IDEState?.get('currentProject');
    if (!project) {
      if (IDEUtils) IDEUtils.showToast('Please select a project first', 'warning');
      return;
    }
    
    // Load existing project settings or defaults
    const projectSettingsKey = `project-settings:${folderItem.path || 'root'}`;
    let savedSettings = {};
    try {
      const stored = localStorage.getItem(projectSettingsKey);
      if (stored) savedSettings = JSON.parse(stored);
    } catch (e) { /* ignore corrupt data */ }
    
    const modal = document.createElement('div');
    modal.className = 'modal-overlay project-settings-modal-overlay';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.id = 'project-settings-modal';
    
    modal.innerHTML = `
      <div class="modal modal-lg project-settings-modal">
        <div class="modal-header">
          <div class="modal-header-left">
            <h2 class="modal-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -3px; margin-right: 8px;">
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
              </svg>
              Project Settings
            </h2>
            <span class="modal-subtitle">${escapeHtml(folderItem.name)}${folderItem.path ? ` (${folderItem.path})` : ''}</span>
          </div>
          <button class="icon-btn ps-close-btn" aria-label="Close settings">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        
        <div class="modal-body project-settings-body">
          <!-- Tabs -->
          <div class="ps-tabs">
            <button type="button" class="ps-tab active" data-tab="prompt">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
              Master Prompt
            </button>
            <button type="button" class="ps-tab" data-tab="config">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
              Configuration
            </button>
            <button type="button" class="ps-tab" data-tab="env">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
              Environment
            </button>
          </div>
          
          <!-- Tab Content -->
          <div class="ps-tab-content">
            <!-- Master Prompt Tab -->
            <div class="ps-panel active" id="ps-prompt-panel">
              <div class="ps-section">
                <label class="ps-label">Folder Master Prompt</label>
                <p class="ps-description">This prompt will be prepended to all AI conversations when working with files in this folder. It overrides the global system prompt for this scope.</p>
                <textarea 
                  id="ps-master-prompt" 
                  class="ps-textarea"
                  rows="10"
                  spellcheck="true"
                  placeholder="Enter a master prompt specific to this folder/project...&#10;&#10;Example: 'This is a React frontend project using TypeScript...'"
                >${escapeHtml(savedSettings.masterPrompt || '')}</textarea>
                <div class="ps-field-footer">
                  <span class="ps-char-count"><span id="ps-prompt-chars">${(savedSettings.masterPrompt || '').length}</span> chars</span>
                  <div class="ps-inherit-option">
                    <label class="toggle-item toggle-sm">
                      <span class="toggle-label">Inherit Global</span>
                      <input type="checkbox" class="toggle-input ps-inherit-global" ${savedSettings.inheritGlobal !== false ? 'checked' : ''} />
                      <span class="toggle-switch"></span>
                    </label>
                  </div>
                </div>
              </div>
              
              <div class="ps-section">
                <label class="ps-label">Context Rules</label>
                <p class="ps-description">Additional context instructions that are always included when AI processes files in this folder.</p>
                <textarea 
                  id="ps-context-rules" 
                  class="ps-textarea ps-sm"
                  rows="4"
                  spellcheck="true"
                  placeholder="Example context rules:&#10;- Always use TypeScript strict mode&#10;- Follow functional component patterns&#10;- Include JSDoc for exported functions"
                >${escapeHtml(savedSettings.contextRules || '')}</textarea>
              </div>
            </div>
            
            <!-- Configuration Tab -->
            <div class="ps-panel" id="ps-config-panel">
              <div class="ps-section">
                <label class="ps-label">Default Language</label>
                <select id="ps-language" class="ps-select">
                  <option value="">Auto-detect</option>
                  <option value="javascript" ${savedSettings.language === 'javascript' ? 'selected' : ''}>JavaScript</option>
                  <option value="typescript" ${savedSettings.language === 'typescript' ? 'selected' : ''}>TypeScript</option>
                  <option value="python" ${savedSettings.language === 'python' ? 'selected' : ''}>Python</option>
                  <option value="go" ${savedSettings.language === 'go' ? 'selected' : ''}>Go</option>
                  <option value="rust" ${savedSettings.language === 'rust' ? 'selected' : ''}>Rust</option>
                  <option value="java" ${savedSettings.language === 'java' ? 'selected' : ''}>Java</option>
                  <option value="csharp" ${savedSettings.language === 'csharp' ? 'selected' : ''}>C#</option>
                  <option value="php" ${savedSettings.language === 'php' ? 'selected' : ''}>PHP</option>
                  <option value="ruby" ${savedSettings.language === 'ruby' ? 'selected' : ''}>Ruby</option>
                  <option value="html" ${savedSettings.language === 'html' ? 'selected' : ''}>HTML/CSS</option>
                </select>
              </div>
              
              <div class="ps-section">
                <label class="ps-label">Code Style Preferences</label>
                <div class="ps-style-grid">
                  <div class="ps-style-item">
                    <label class="toggle-item toggle-sm">
                      <span class="toggle-label">Semicolons</span>
                      <input type="checkbox" class="toggle-input ps-semicolons" ${savedSettings.semicolons !== false ? 'checked' : ''} />
                      <span class="toggle-switch"></span>
                    </label>
                  </div>
                  <div class="ps-style-item">
                    <label class="toggle-item toggle-sm">
                      <span class="toggle-label">Single Quotes</span>
                      <input type="checkbox" class="toggle-input ps-single-quotes" ${savedSettings.singleQuotes === true ? 'checked' : ''} />
                      <span class="toggle-switch"></span>
                    </label>
                  </div>
                  <div class="ps-style-item">
                    <label class="toggle-item toggle-sm">
                      <span class="toggle-label">Trailing Commas</span>
                      <input type="checkbox" class="toggle-input ps-trailing-commas" ${savedSettings.trailingCommas === true ? 'checked' : ''} />
                      <span class="toggle-switch"></span>
                    </label>
                  </div>
                  <div class="ps-style-item">
                    <label class="toggle-item toggle-sm">
                      <span class="toggle-label">Tab Indent</span>
                      <input type="checkbox" class="toggle-input ps-tab-indent" ${savedSettings.tabIndent === true ? 'checked' : ''} />
                      <span class="toggle-switch"></span>
                    </label>
                  </div>
                </div>
              </div>
              
              <div class="ps-section">
                <label class="ps-label">Indent Size</label>
                <div class="ps-indent-options">
                  <button type="button" class="ps-indent-btn ${savedSettings.indentSize === 2 ? 'active' : ''}" data-indent="2">2 spaces</button>
                  <button type="button" class="ps-indent-btn ${savedSettings.indentSize === 4 ? 'active' : ''}" data-indent="4">4 spaces</button>
                  <button type="button" class="ps-indent-btn ${savedSettings.indentSize === 8 ? 'active' : ''}" data-indent="8">8 spaces</button>
                  <button type="button" class="ps-indent-btn ${(savedSettings.indentSize || 0) === -1 ? 'active' : ''}" data-indent="-1">Tab</button>
                </div>
              </div>
            </div>
            
            <!-- Environment Tab -->
            <div class="ps-panel" id="ps-env-panel">
              <div class="ps-section">
                <label class="ps-label">Environment Variables</label>
                <p class="ps-description">Key-value pairs available as context during AI operations in this folder.</p>
                <div id="ps-env-list" class="ps-env-list">
                  ${(savedSettings.envVars || []).map((env, i) => `
                    <div class="ps-env-row" data-index="${i}">
                      <input type="text" class="input ps-env-key" placeholder="KEY" value="${escapeHtml(env.key)}" />
                      <span class="ps-env-eq">=</span>
                      <input type="text" class="input ps-env-value" placeholder="value" value="${escapeHtml(env.value)}" />
                      <button type="button" class="icon-btn ps-env-remove" title="Remove variable">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    </div>
                  `).join('')}
                </div>
                <button type="button" class="btn btn-xs btn-outline ps-add-env-btn">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  Add Variable
                </button>
              </div>
              
              <div class="ps-section">
                <label class="ps-label">Framework Detection</label>
                <p class="ps-description">Auto-detected frameworks (read-only, based on files in this folder).</p>
                <div class="ps-frameworks">
                  ${detectFrameworks(folderItem)}
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <div class="modal-footer">
          <button class="btn btn-outline ps-reset-btn">Reset to Defaults</button>
          <div class="ps-footer-actions">
            <button class="btn btn-outline ps-cancel-btn">Cancel</button>
            <button class="btn btn-primary ps-save-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              Save Settings
            </button>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // Wire up tab switching
    modal.querySelectorAll('.ps-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const targetTab = tab.dataset.tab;
        
        // Update tabs
        modal.querySelectorAll('.ps-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === targetTab));
        
        // Update panels
        modal.querySelectorAll('.ps-panel').forEach(p => p.classList.toggle('active', p.id === `ps-${targetTab}-panel`));
      });
    });
    
    // Wire up indent buttons
    modal.querySelectorAll('.ps-indent-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        modal.querySelectorAll('.ps-indent-btn').forEach(b => b.classList.toggle('active', b === btn));
      });
    });
    
    // Wire up add env var button
    modal.querySelector('.ps-add-env-btn')?.addEventListener('click', () => {
      const envList = modal.querySelector('#ps-env-list');
      const newRow = document.createElement('div');
      newRow.className = 'ps-env-row';
      newRow.innerHTML = `
        <input type="text" class="input ps-env-key" placeholder="KEY" />
        <span class="ps-env-eq">=</span>
        <input type="text" class="input ps-env-value" placeholder="value" />
        <button type="button" class="icon-btn ps-env-remove" title="Remove variable">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      `;
      envList.appendChild(newRow);
      
      newRow.querySelector('.ps-env-remove').addEventListener('click', () => newRow.remove());
    });
    
    // Wire up remove env var buttons
    modal.querySelectorAll('.ps-env-remove').forEach(btn => {
      btn.addEventListener('click', () => btn.closest('.ps-env-row').remove());
    });
    
    // Character count for prompt textarea
    const promptTextarea = modal.querySelector('#ps-master-prompt');
    const charCountEl = modal.querySelector('#ps-prompt-chars');
    promptTextarea?.addEventListener('input', () => {
      if (charCountEl) charCountEl.textContent = promptTextarea.value.length;
    });
    
    // Close button
    modal.querySelector('.ps-close-btn')?.addEventListener('click', () => modal.remove());
    
    // Cancel button
    modal.querySelector('.ps-cancel-btn')?.addEventListener('click', () => modal.remove());
    
    // Reset button
    modal.querySelector('.ps-reset-btn')?.addEventListener('click', () => {
      if (confirm('Reset all settings for this folder to defaults?')) {
        localStorage.removeItem(projectSettingsKey);
        modal.remove();
        if (IDEUtils) IDEUtils.showToast('Project settings reset', 'info');
      }
    });
    
    // Save button
    modal.querySelector('.ps-save-btn')?.addEventListener('click', () => {
      // Collect environment variables
      const envVars = [];
      modal.querySelectorAll('.ps-env-row').forEach(row => {
        const key = row.querySelector('.ps-env-key')?.value.trim();
        const value = row.querySelector('.ps-env-value')?.value.trim();
        if (key) envVars.push({ key, value });
      });
      
      // Get active indent size
      const activeIndentBtn = modal.querySelector('.ps-indent-btn.active');
      const indentSize = activeIndentBtn ? parseInt(activeIndentBtn.dataset.indent) : 2;
      
      const newSettings = {
        masterPrompt: modal.querySelector('#ps-master-prompt')?.value || '',
        inheritGlobal: modal.querySelector('.ps-inherit-global')?.checked !== false,
        contextRules: modal.querySelector('#ps-context-rules')?.value || '',
        language: modal.querySelector('#ps-language')?.value || '',
        semicolons: modal.querySelector('.ps-semicolons')?.checked !== false,
        singleQuotes: modal.querySelector('.ps-single-quotes')?.checked === true,
        trailingCommas: modal.querySelector('.ps-trailing-commas')?.checked === true,
        tabIndent: modal.querySelector('.ps-tab-indent')?.checked === true,
        indentSize,
        envVars
      };
      
      try {
        localStorage.setItem(projectSettingsKey, JSON.stringify(newSettings));
      } catch (e) {
        console.error('Failed to save project settings:', e);
      }
      
      // Dispatch event so other components can react
      document.dispatchEvent(new CustomEvent('ide:project-settings-updated', {
        detail: { path: folderItem.path, settings: newSettings }
      }));
      
      modal.remove();
      if (IDEUtils) IDEUtils.showToast(`Settings saved for "${folderItem.name}"`, 'success');
    });
    
    // Click outside to close
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
    
    // Escape key
    modal.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') modal.remove();
    });
  }
  
  /**
   * Detect frameworks based on folder contents
   */
  function detectFrameworks(folderItem) {
    const frameworks = [];
    // Common framework indicators (would be more sophisticated with actual file scanning)
    const children = folderItem.children || [];
    const fileNames = children.map(c => c.name.toLowerCase());
    
    if (fileNames.some(f => f === 'package.json')) frameworks.push({ name: 'Node.js', icon: '📦', color: '#68a063' });
    if (fileNames.some(f => ['tsconfig.json', 'typescript.json'].includes(f))) frameworks.push({ name: 'TypeScript', icon: '🔷', color: '#3178c6' });
    if (fileNames.some(f => f === 'vue.config.js' || f.endsWith('.vue'))) frameworks.push({ name: 'Vue', icon: '💚', color: '#42b883' });
    if (fileNames.some(f => ['next.config.js', 'next.config.mjs'].includes(f))) frameworks.push({ name: 'Next.js', icon: '▲', color: '#000000' });
    if (fileNames.some(f => f === 'angular.json')) frameworks.push({ name: 'Angular', icon: '🅰️', color: '#dd0031' });
    if (fileNames.some(f => f === 'requirements.txt' || f === 'pyproject.toml')) frameworks.push({ name: 'Python', icon: '🐍', color: '#3776ab' });
    if (fileNames.some(f => f === 'go.mod')) frameworks.push({ name: 'Go', icon: '🐹', color: '#00add8' });
    if (fileNames.some(f => f === 'Cargo.toml')) frameworks.push({ name: 'Rust', icon: '🦀', color: '#dea584' });
    if (fileNames.some(f => f === 'pom.xml')) frameworks.push({ name: 'Java/Maven', icon: '☕', color: '#f89820' });
    if (fileNames.some(f => ['.csproj', 'sln'].some(ext => f.endsWith(ext)))) frameworks.push({ name: '.NET/C#', icon: '💜', color: '#512bd4' });
    
    if (frameworks.length === 0) {
      return '<span class="ps-no-frameworks">No frameworks detected</span>';
    }
    
    return frameworks.map(f => 
      `<span class="ps-framework-badge" style="--fw-color: ${f.color}">
        <span class="ps-fw-icon">${f.icon}</span>
        ${f.name}
      </span>`
    ).join('');
  }
  
  /**
   * Escape HTML entities
   */
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ============================================
  // Event Handlers
  // ============================================
  
  /**
   * Handle item click
   */
  function handleItemClick(item) {
    if (item.type === 'folder') {
      toggleFolder(item.path);
    } else {
      selectFile(item);
    }
  }

  /**
   * Toggle folder expansion
   */
  function toggleFolder(path) {
    if (expandedFolders.has(path)) {
      expandedFolders.delete(path);
    } else {
      expandedFolders.add(path);
    }
    render();
  }

  /**
   * Select a file
   */
  function selectFile(file) {
    selectedFile = file;
    
    // Update state
    if (window.IDEState) {
      IDEState.setActiveFile(file);
    }
    
    // Update visual selection
    updateSelectionVisuals();
    
    // Callback
    if (onFileSelect) {
      onFileSelect(file);
    }
  }

  /**
   * Update selection visuals without full re-render
   */
  function updateSelectionVisuals() {
    if (!container) return;
    
    container.querySelectorAll('.tree-row').forEach(row => {
      const path = row.closest('.tree-item')?.dataset.path;
      const isSelected = selectedFile && path === selectedFile.path;
      row.classList.toggle('selected', isSelected);
      row.setAttribute('aria-selected', isSelected);
    });
  }

  /**
   * Set selected file externally
   */
  function setSelectedFile(file) {
    selectedFile = file;
    updateSelectionVisuals();
    
    // Ensure visible
    if (file && container) {
      const selectedItem = container.querySelector(`[data-path="${file.path}"] .tree-row`);
      if (selectedItem) {
        selectedItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }

  /**
   * Handle context menu (legacy - emits event)
   */
  function handleContextMenu(event, item) {
    showContextMenu(event, item);
  }

  // ============================================
  // Drag & Drop Handlers
  // ============================================

  function handleDragStart(e, item) {
    dragItem = item;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.path);
    e.target.closest('.tree-row')?.classList.add('dragging');
  }

  function handleDragOver(e, targetItem) {
    // Default: deny drop. Only allow when we have a dragItem and the
    // target is a valid drop location (a folder, OR a file — in which
    // case we drop into the file's parent folder, mirroring Finder/Explorer).
    if (!dragItem) return;

    // Don't allow dropping onto self
    if (dragItem.path === targetItem.path) return;

    // Don't allow dropping a folder into one of its own descendants
    if (dragItem.type === 'folder' && targetItem.path.startsWith(dragItem.path + '/')) {
      return;
    }

    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    e.target.closest('.tree-row')?.classList.add('drop-target');
  }

  function handleDragLeave(e, targetItem) {
    e.target.closest('.tree-row')?.classList.remove('drop-target');
  }

  function handleDrop(e, targetItem) {
    e.preventDefault();
    e.target.closest('.tree-row')?.classList.remove('drop-target');

    if (!dragItem) return;

    // Don't drop onto self
    if (dragItem.path === targetItem.path) {
      dragItem = null;
      return;
    }

    // Don't drop a folder into one of its own descendants
    if (dragItem.type === 'folder' && targetItem.path.startsWith(dragItem.path + '/')) {
      if (IDEUtils) IDEUtils.showToast('Cannot move a folder into one of its own subfolders.', 'warning');
      dragItem = null;
      return;
    }

    // Determine the destination FOLDER path.
    // - Drop onto a folder → move INTO that folder.
    // - Drop onto a file   → move into the file's PARENT folder (sibling move).
    // - Drop onto a root item with no parent → move to project root.
    let targetFolderPath;
    if (targetItem.type === 'folder') {
      targetFolderPath = targetItem.path;
    } else {
      // File: move into its parent directory
      const lastSlash = targetItem.path.lastIndexOf('/');
      targetFolderPath = lastSlash > 0 ? targetItem.path.substring(0, lastSlash) : '';
    }

    // If the source is already in this exact folder, no-op.
    const sourceParent = (() => {
      const ls = dragItem.path.lastIndexOf('/');
      return ls > 0 ? dragItem.path.substring(0, ls) : '';
    })();
    if (sourceParent === targetFolderPath) {
      // Already there — nothing to do
      dragItem = null;
      return;
    }

    // Capture source before clearing dragItem, then execute the move.
    const source = dragItem;
    dragItem = null;

    // Also fire the legacy callback (in case any sidebar-level handler wants it)
    if (onFileAction) {
      onFileAction({
        type: 'move',
        source,
        target: targetItem,
        targetFolderPath
      });
    }

    // Execute the move (with confirmation if not opted out)
    confirmAndExecuteMove(source, targetFolderPath, targetItem);
  }

  function handleDragEnd(e) {
    dragItem = null;
    container?.querySelectorAll('.dragging, .drop-target').forEach(el => {
      el.classList.remove('dragging', 'drop-target');
    });
  }

  // ============================================
  // Move Operation (with confirmation + "Don't ask again")
  // ============================================

  const MOVE_CONFIRM_PREF_KEY = 'ide:skip-move-confirm';
  const CLIPBOARD_PREF_KEY_LOCAL = CLIPBOARD_PREF_KEY; // alias to keep code below readable

  function shouldSkipMoveConfirm() {
    try { return localStorage.getItem(MOVE_CONFIRM_PREF_KEY) === '1'; }
    catch (e) { return false; }
  }

  function setSkipMoveConfirm(value) {
    try { localStorage.setItem(MOVE_CONFIRM_PREF_KEY, value ? '1' : '0'); }
    catch (e) { /* non-fatal */ }
  }

  /**
   * Load the persisted clipboard {item, mode, projectName} or return null.
   * Stored as JSON so it survives page reloads. We deliberately only persist
   * the bare minimum fields needed by Files.move / Files.copy (path, name,
   * type, etc.) — content is fetched from storage at paste time.
   */
  function loadClipboard() {
    try {
      const raw = localStorage.getItem(CLIPBOARD_PREF_KEY_LOCAL);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.item || !parsed.mode || !parsed.item.path) return null;
      return parsed;
    } catch (e) { return null; }
  }

  function saveClipboard(value) {
    try {
      if (value) localStorage.setItem(CLIPBOARD_PREF_KEY_LOCAL, JSON.stringify(value));
      else localStorage.removeItem(CLIPBOARD_PREF_KEY_LOCAL);
    } catch (e) { /* non-fatal */ }
  }

  function clearClipboard() {
    clipboard = null;
    saveClipboard(null);
  }

  /**
   * Verify the clipboard item still exists in storage (e.g. it may have been
   * deleted since Cut was invoked). Returns true if valid.
   */
  async function clipboardStillExists() {
    if (!clipboard) return false;
    const project = IDEState?.get('currentProject');
    if (!project || project.name !== clipboard.projectName) return false;
    try {
      if (window.IDEStorage && IDEStorage.Files) {
        const f = await IDEStorage.Files.get(project.name, clipboard.item.path);
        return !!f;
      }
    } catch (e) { /* fall through */ }
    return false;
  }

  /**
   * Show a move-confirmation dialog (or skip it if the user previously
   * checked "Don't ask again"). Then call executeMove.
   *
   * @param {Object} source - the file/folder being moved
   * @param {string} targetFolderPath - destination folder path ('' = root)
   * @param {Object} targetItem - the item that was dropped onto (for display)
   */
  function confirmAndExecuteMove(source, targetFolderPath, targetItem) {
    if (shouldSkipMoveConfirm()) {
      executeMove(source, targetFolderPath);
      return;
    }

    closeDialog();

    const targetLabel = targetFolderPath
      ? (targetItem.type === 'folder' ? targetItem.name : targetItem.name + '\'s folder')
      : 'project root';

    dialog = document.createElement('div');
    dialog.className = 'modal-overlay';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.innerHTML = `
      <div class="modal modal-sm">
        <div class="modal-header">
          <h2 class="modal-title">Move ${source.type === 'folder' ? 'folder' : 'file'}?</h2>
          <button class="icon-btn dialog-close-btn" aria-label="Close dialog">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="modal-body">
          <p style="margin: 0 0 var(--space-3) 0; color: var(--color-text-secondary, #6b7280); line-height: 1.5;">
            Move <strong style="color: var(--color-text-primary, #1f2937);">${escapeHtmlForDialog(source.name)}</strong>
            ${source.type === 'folder' ? ' and all its contents ' : ' '}
            into <strong style="color: var(--color-text-primary, #1f2937);">${escapeHtmlForDialog(targetLabel)}</strong>?
          </p>
          <label style="display: flex; align-items: center; gap: var(--space-2); font-size: var(--font-size-sm); color: var(--color-text-secondary, #6b7280); cursor: pointer; user-select: none;">
            <input type="checkbox" id="skip-move-confirm-checkbox" style="cursor: pointer;" />
            <span>Don't ask again next time</span>
          </label>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline cancel-move-btn">Cancel</button>
          <button class="btn btn-primary confirm-move-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            Move
          </button>
        </div>
      </div>
    `;

    const confirmBtn = dialog.querySelector('.confirm-move-btn');
    const cancelBtn = dialog.querySelector('.cancel-move-btn');
    const closeBtn = dialog.querySelector('.dialog-close-btn');
    const skipCheckbox = dialog.querySelector('#skip-move-confirm-checkbox');

    const doMove = () => {
      if (skipCheckbox.checked) setSkipMoveConfirm(true);
      closeDialog();
      executeMove(source, targetFolderPath);
    };

    const doCancel = () => closeDialog();

    confirmBtn.addEventListener('click', doMove);
    cancelBtn.addEventListener('click', doCancel);
    closeBtn.addEventListener('click', doCancel);

    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) doCancel();
    });

    document.addEventListener('keydown', function escClose(ev) {
      if (ev.key === 'Escape') {
        doCancel();
        document.removeEventListener('keydown', escClose);
      }
    });

    // Focus the Move button so Enter triggers it immediately
    document.body.appendChild(dialog);
    setTimeout(() => confirmBtn.focus(), 0);
  }

  function escapeHtmlForDialog(s) {
    if (!s) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Actually perform the move against storage + refresh the tree.
   */
  async function executeMove(source, targetFolderPath) {
    const project = IDEState?.get('currentProject');
    if (!project) {
      if (IDEUtils) IDEUtils.showToast('No project selected', 'warning');
      return;
    }

    try {
      // Prefer storage (works offline) — IDEAPI.Files doesn't have a move method.
      if (window.IDEStorage && IDEStorage.Files && IDEStorage.Files.move) {
        await IDEStorage.Files.move(project.name, source.path, targetFolderPath);
      } else {
        throw new Error('Storage.Files.move is not available');
      }

      // If the active file was the moved source (or a descendant), update its path
      const activeFile = IDEState?.get('activeFile');
      if (activeFile) {
        const isSelf = activeFile.path === source.path;
        const isDescendant = activeFile.path.startsWith(source.path + '/');
        if (isSelf || isDescendant) {
          const newPath = isSelf
            ? (targetFolderPath ? `${targetFolderPath}/${source.name}` : source.name)
            : (targetFolderPath
                ? `${targetFolderPath}/${source.name}/${activeFile.path.slice(source.path.length + 1)}`
                : `${source.name}/${activeFile.path.slice(source.path.length + 1)}`);
          IDEState.setActiveFile({ ...activeFile, path: newPath });
        }
      }

      // Refresh tree
      if (window.IDEState) IDEState.refreshFiles();

      const targetLabel = targetFolderPath ? targetFolderPath.split('/').pop() : 'root';
      if (IDEUtils) IDEUtils.showToast(`Moved "${source.name}" → ${targetLabel}`, 'success');
    } catch (error) {
      console.error('Failed to move:', error);
      if (IDEUtils) IDEUtils.showToast(error.message || 'Failed to move', 'error');
    }
  }

  // ============================================
  // Paste Operation (Copy / Cut)
  // ============================================

  /**
   * Resolve the destination folder path for a paste, given the right-clicked
   * item and whether the user explicitly chose "Paste into root".
   *
   *  - intoRoot=true → always '' (project root)
   *  - item is a folder → item.path (paste INTO that folder)
   *  - item is a file → item's parent folder (paste as sibling)
   */
  function resolvePasteTarget(item, intoRoot) {
    if (intoRoot) return '';
    if (item.type === 'folder') return item.path;
    const lastSlash = item.path.lastIndexOf('/');
    return lastSlash > 0 ? item.path.substring(0, lastSlash) : '';
  }

  /**
   * Execute a paste. Behavior depends on clipboard.mode:
   *   - 'copy' → Files.copy() (duplicates source at destination; source stays)
   *   - 'cut'  → Files.move() (relocates source to destination; clears clipboard)
   *
   * Cross-project paste is supported: if the clipboard.item.projectName
   * differs from the current project, we first verify the source exists in
   * its project, then copy/move it into the current project's target folder.
   *
   * @param {Object} item - the right-clicked tree item (target)
   * @param {boolean} intoRoot - if true, paste into project root
   */
  async function executePaste(item, intoRoot) {
    if (!clipboard || !clipboard.item) {
      if (IDEUtils) IDEUtils.showToast('Clipboard is empty', 'warning');
      return;
    }

    const currentProject = IDEState?.get('currentProject');
    if (!currentProject) {
      if (IDEUtils) IDEUtils.showToast('No project selected', 'warning');
      return;
    }

    // Verify clipboard item still exists
    const exists = await clipboardStillExists();
    if (!exists) {
      if (IDEUtils) IDEUtils.showToast('Clipboard item no longer exists', 'warning');
      clearClipboard();
      return;
    }

    const sourcePath = clipboard.item.path;
    const targetFolderPath = resolvePasteTarget(item, intoRoot);
    const sourceName = clipboard.item.name;

    // Disallow pasting a folder into itself or its descendant
    if (clipboard.item.type === 'folder') {
      const target = targetFolderPath;
      if (target === sourcePath || target.startsWith(sourcePath + '/')) {
        if (IDEUtils) IDEUtils.showToast('Cannot paste a folder into itself or one of its subfolders.', 'warning');
        return;
      }
    }

    try {
      if (clipboard.mode === 'cut') {
        // Move source → targetFolderPath. If source is already there, no-op.
        const sourceParent = (() => {
          const ls = sourcePath.lastIndexOf('/');
          return ls > 0 ? sourcePath.substring(0, ls) : '';
        })();
        if (sourceParent === targetFolderPath) {
          if (IDEUtils) IDEUtils.showToast(`"${sourceName}" is already there`, 'info');
          clearClipboard();
          return;
        }

        if (window.IDEStorage && IDEStorage.Files && IDEStorage.Files.move) {
          await IDEStorage.Files.move(currentProject.name, sourcePath, targetFolderPath);
        } else {
          throw new Error('Storage.Files.move is not available');
        }

        // Update active file path if it was the moved source (or descendant)
        const activeFile = IDEState?.get('activeFile');
        if (activeFile) {
          const isSelf = activeFile.path === sourcePath;
          const isDescendant = activeFile.path.startsWith(sourcePath + '/');
          if (isSelf || isDescendant) {
            const newPath = isSelf
              ? (targetFolderPath ? `${targetFolderPath}/${sourceName}` : sourceName)
              : (targetFolderPath
                  ? `${targetFolderPath}/${sourceName}/${activeFile.path.slice(sourcePath.length + 1)}`
                  : `${sourceName}/${activeFile.path.slice(sourcePath.length + 1)}`);
            IDEState.setActiveFile({ ...activeFile, path: newPath });
          }
        }

        if (window.IDEState) IDEState.refreshFiles();
        const label = targetFolderPath ? targetFolderPath.split('/').pop() : 'root';
        if (IDEUtils) IDEUtils.showToast(`Moved "${sourceName}" → ${label}`, 'success');
        clearClipboard();
      } else {
        // Copy mode
        if (window.IDEStorage && IDEStorage.Files && IDEStorage.Files.copy) {
          await IDEStorage.Files.copy(currentProject.name, sourcePath, targetFolderPath);
        } else {
          throw new Error('Storage.Files.copy is not available');
        }

        if (window.IDEState) IDEState.refreshFiles();
        const label = targetFolderPath ? targetFolderPath.split('/').pop() : 'root';
        if (IDEUtils) IDEUtils.showToast(`Copied "${sourceName}" → ${label}`, 'success');
        // Copy keeps the clipboard intact so user can paste multiple times
      }
    } catch (error) {
      console.error('Failed to paste:', error);
      if (IDEUtils) IDEUtils.showToast(error.message || 'Failed to paste', 'error');
    }
  }


  // ============================================
  // Public API - File Operations
  // ============================================
  
  /**
   * Add a new file to the tree
   */
  function addFile(fileData) {
    // This triggers a refresh from storage
    if (window.IDEState) {
      IDEState.refreshFiles();
    }
  }

  /**
   * Remove a file from display
   */
  function removeFile(path) {
    treeData = removeFromTree(treeData, path);
    render();
  }

  /**
   * Recursively remove item from tree by path
   */
  function removeFromTree(nodes, path) {
    return nodes.filter(node => {
      if (node.path === path) return false;
      if (node.children) {
        node.children = removeFromTree(node.children, path);
      }
      return true;
    });
  }

  /**
   * Expand all folders
   */
  function expandAll() {
    expandNodesRecursive(treeData);
    render();
  }

  /**
   * Collapse all folders
   */
  function collapseAll() {
    expandedFolders.clear();
    render();
  }

  /**
   * Recursively add all folder paths to expanded set
   */
  function expandNodesRecursive(nodes) {
    nodes.forEach(node => {
      if (node.type === 'folder') {
        expandedFolders.add(node.path);
        if (node.children) {
          expandNodesRecursive(node.children);
        }
      }
    });
  }

  /**
   * Find and reveal a file path (expand parents)
   */
  function revealPath(path) {
    if (!path) return;
    
    // Expand all parent directories
    const parts = path.split('/');
    let currentPath = '';
    
    for (let i = 0; i < parts.length - 1; i++) {
      currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
      expandedFolders.add(currentPath);
    }
    
    render();
    
    // Select and scroll to file
    setTimeout(() => {
      const fileNode = treeData.find(f => f.path === path) || findInTree(treeData, path);
      if (fileNode) {
        selectFile(fileNode);
      }
    }, 50);
  }

  /**
   * Recursively find node by path
   */
  function findInTree(nodes, path) {
    for (const node of nodes) {
      if (node.path === path) return node;
      if (node.children) {
        const found = findInTree(node.children, path);
        if (found) return found;
      }
    }
    return null;
  }

  /**
   * Refresh tree from storage
   */
  async function refresh() {
    const project = IDEState?.get('currentProject');
    await loadFilesForProject(project);
  }

  /**
   * Clear tree data
   */
  function clear() {
    treeData = [];
    expandedFolders.clear();
    selectedFile = null;
    render();
  }

  // ============================================
  // Public API
  // ============================================
  
  return {
    init,
    loadFilesForProject,
    refresh,
    clear,
    addFile,
    removeFile,
    selectFile,
    setSelectedFile,
    expandAll,
    collapseAll,
    revealPath,
    
    // Expose state for other components
    getSelectedFile: () => selectedFile,
    getTreeData: () => treeData,
    
    // Public methods for external use
    showCreateFileDialog: () => showCreateDialog('file'),
    showCreateFolderDialog: () => showCreateDialog('folder'),
    
    // Sort controls (wired to the HTML panel-header sort-toggle buttons)
    setSort,
    getSort
  };
})();

// Export for use in other modules
window.FileTreeComponent = FileTreeComponent;
