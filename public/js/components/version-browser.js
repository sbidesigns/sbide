/**
 * SBIDE - Version Browser Component
 * Manages project version history, creation, and restoration
 */

const VersionBrowserComponent = (() => {
  // ============================================
  // State
  // ============================================
  
  let container = null;
  let versions = [];
  let isLoading = false;
  let currentVersion = null;
  
  // Dialog state
  let dialog = null;
  let pendingRestoreVersion = null;

  // ============================================
  // Initialization
  // ============================================
  
  function init(element) {
    if (!element) {
      console.error('VersionBrowser: Container element required');
      return;
    }
    
    container = element;
    
    // Subscribe to state changes
    if (window.IDEState) {
      IDEState.subscribe((state, prevState) => {
        if (state.currentProject !== prevState.currentProject) {
          loadVersions(state.currentProject);
        }
        if (state.versionRefreshKey !== prevState.versionRefreshKey) {
          loadVersions(state.currentProject);
        }
      });
    }
    
    render();
  }

  // ============================================
  // Data Loading
  // ============================================
  
  async function loadVersions(project) {
    if (!project || !project.name) {
      versions = [];
      currentVersion = null;
      render();
      return;
    }
    
    isLoading = true;
    render();
    
    try {
      const response = await fetch(`/api/ide/versions?project=${encodeURIComponent(project.name)}`);
      
      if (response.ok) {
        const data = await response.json();
        versions = data.success ? (data.data || []) : [];
        currentVersion = project.currentVersion || null;
      } else {
        // Fallback to local storage
        versions = IDEStorage?.Versions?.getByProject(project.name) || [];
        currentVersion = project.currentVersion || null;
      }
    } catch (error) {
      console.error('Failed to load versions:', error);
      versions = [];
    } finally {
      isLoading = false;
      render();
    }
  }

  // ============================================
  // Rendering
  // ============================================
  
  function render() {
    if (!container) return;
    
    const project = IDEState?.get('currentProject');
    
    if (!project) {
      container.innerHTML = `
        <div class="version-empty-state">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-muted">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          <p>No versions available</p>
          <p class="empty-hint">Select a project to view version history</p>
        </div>
      `;
      return;
    }
    
    if (isLoading) {
      container.innerHTML = `
        <div class="version-loading">
          <div class="spinner"></div>
          <span>Loading versions...</span>
        </div>
      `;
      return;
    }
    
    container.innerHTML = `
      <div class="version-panel-content">
        <!-- Header -->
        <div class="version-header">
          <h3 class="version-title">Version History</h3>
          ${currentVersion ? `<span class="current-version-badge">v${currentVersion}</span>` : ''}
          <div class="version-actions">
            <button class="icon-btn sm version-create-btn" title="Create new version" aria-label="Create version">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            </button>
            <button class="icon-btn sm version-refresh-btn" title="Refresh" aria-label="Refresh versions">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
              </svg>
            </button>
          </div>
        </div>
        
        <!-- Versions List -->
        ${versions.length > 0 ? `
          <div class="versions-list">
            ${versions.map(version => renderVersionCard(version)).join('')}
          </div>
        ` : `
          <div class="version-empty-state">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" class="text-muted">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            <p>No versions yet</p>
            <p class="empty-hint">Create a checkpoint to save your progress</p>
            <button class="btn btn-primary btn-sm create-first-version-btn">Create First Version</button>
          </div>
        `}
      </div>
    `;
    
    wireUpEventListeners(container);
  }
  
  /**
   * Render a single version card
   */
  function renderVersionCard(version) {
    const isCurrent = version.versionNumber === currentVersion;
    const createdAt = new Date(version.createdAt);
    
    return `
      <div 
        class="version-card ${isCurrent ? 'is-current' : ''}"
        data-version-number="${version.versionNumber}"
      >
        <div class="version-card-header">
          <div class="version-info">
            <span class="version-number">v${version.versionNumber}</span>
            ${isCurrent ? '<span class="version-current-badge">Current</span>' : ''}
          </div>
          
          ${!isCurrent ? `
            <button 
              class="btn btn-ghost btn-xs version-restore-btn"
              data-version="${version.versionNumber}"
              title="Restore this version"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="1 4 1 10 7 10"/><polyline points="23 20 23 14 17 14"/>
                <path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/>
              </svg>
              Restore
            </button>
          ` : ''}
        </div>
        
        <div class="version-meta">
          <span class="meta-item">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
            ${formatRelativeTime(createdAt)}
          </span>
          ${version.fileCount != null ? `
            <span class="meta-item">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/>
                <polyline points="13 2 13 9 20 9"/>
              </svg>
              ${version.fileCount} files
            </span>
          ` : ''}
          ${version.size ? `
            <span class="meta-item">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0021 19V5"/>
                <path d="M3 12A9 3 0 0021 12"/>
              </svg>
              ${formatBytes(version.size)}
            </span>
          ` : ''}
        </div>
        
        ${version.description ? `<p class="version-description">${escapeHtml(version.description)}</p>` : ''}
      </div>
    `;
  }

  // ============================================
  // Event Handling
  // ============================================
  
  function wireUpEventListeners(panelEl) {
    // Create version button
    panelEl.querySelector('.version-create-btn, .create-first-version-btn')?.addEventListener('click', () => {
      showCreateVersionDialog();
    });
    
    // Refresh button
    panelEl.querySelector('.version-refresh-btn')?.addEventListener('click', () => {
      const project = IDEState?.get('currentProject');
      loadVersions(project);
    });
    
    // Restore buttons
    panelEl.querySelectorAll('.version-restore-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const versionNum = parseInt(btn.dataset.version);
        confirmRestore(versions.find(v => v.versionNumber === versionNum));
      });
    });
  }
  
  /**
   * Show create version dialog
   */
  function showCreateVersionDialog() {
    closeDialog();
    
    dialog = document.createElement('div');
    dialog.className = 'modal-overlay';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    
    dialog.innerHTML = `
      <div class="modal modal-sm">
        <div class="modal-header">
          <h2 class="modal-title">Create New Version</h2>
          <button class="icon-btn dialog-close-btn" aria-label="Close dialog">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label" for="version-description">Description (optional)</label>
            <textarea 
              id="version-description"
              class="input"
              rows="3"
              placeholder="What changes are in this version?"
            ></textarea>
          </div>
          
          <label class="toggle-item toggle-sm">
            <div class="toggle-info">
              <span class="toggle-label">Create ZIP Archive</span>
              <span class="toggle-desc">Also create a downloadable backup</span>
            </div>
            <input type="checkbox" class="toggle-input" id="create-zip-toggle" />
            <span class="toggle-switch"></span>
          </label>
        </div>
        
        <div class="modal-footer">
          <button class="btn btn-outline cancel-dialog-btn">Cancel</button>
          <button class="btn btn-primary confirm-create-version-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            Create Version
          </button>
        </div>
      </div>
    `;
    
    const descInput = dialog.querySelector('#version-description');
    const zipToggle = dialog.querySelector('#create-zip-toggle');
    const confirmBtn = dialog.querySelector('.confirm-create-version-btn');
    const cancelBtn = dialog.querySelector('.cancel-dialog-btn');
    const closeBtn = dialog.querySelector('.dialog-close-btn');
    
    confirmBtn.addEventListener('click', () => createVersion(descInput.value, zipToggle.checked));
    cancelBtn.addEventListener('click', closeDialog);
    closeBtn.addEventListener('click', closeDialog);
    
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) closeDialog();
    });
    
    document.body.appendChild(dialog);
    descInput.focus();
  }
  
  /**
   * Create new version
   */
  async function createVersion(description = '', createArchive = false) {
    const project = IDEState?.get('currentProject');
    if (!project) return;
    
    try {
      const response = await fetch('/api/ide/versions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: project.name,
          description,
          createArchive
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        closeDialog();
        
        // Refresh versions list
        await loadVersions(project);
        
        // Update current version in state
        if (data.success && data.data?.versionNumber) {
          if (IDEState) {
            IDEState.set({ 
              currentProject: { ...project, currentVersion: data.data.versionNumber }
            });
          }
        }
        
        if (IDEUtils) {
          IDEUtils.showToast(`Version v${data.data?.versionNumber || 'created'} saved`, 'success');
        }
      } else {
        throw new Error('Failed to create version');
      }
    } catch (error) {
      console.error('Failed to create version:', error);
      
      // Fallback to local storage
      try {
        const newVersion = {
          versionNumber: (versions.length > 0 ? Math.max(...versions.map(v => v.versionNumber)) : 0) + 1,
          createdAt: new Date().toISOString(),
          fileCount: null,
          size: null,
          description
        };
        
        versions.unshift(newVersion);
        
        if (IDEStorage?.Versions) {
          await IDEStorage.Version.save(project.name, newVersion);
        }
        
        closeDialog();
        render();
        if (IDEUtils) IDEUtils.showToast('Version created locally', 'success');
      } catch (fallbackError) {
        console.error('Fallback also failed:', fallbackError);
        if (IDEUtils) IDEUtils.showToast('Failed to create version', 'error');
      }
    }
  }
  
  /**
   * Confirm restore with warning dialog
   */
  function confirmRestore(version) {
    if (!version) return;
    
    pendingRestoreVersion = version;
    
    closeDialog();
    
    dialog = document.createElement('div');
    dialog.className = 'modal-overlay';
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'restore-dialog-title');
    
    dialog.innerHTML = `
      <div class="modal modal-sm">
        <div class="modal-header modal-header-warning">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <h2 class="modal-title" id="restore-dialog-title">Restore Version</h2>
          <button class="icon-btn dialog-close-btn" aria-label="Close dialog">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        
        <div class="modal-body">
          <div class="warning-content">
            <p>Are you sure you want to restore to <strong>version v${version.versionNumber}</strong>?</p>
            <p class="warning-text">This will replace all current files with the files from that version. Consider creating a backup first.</p>
            
            <div class="restore-details">
              <div class="detail-row">
                <span>Version:</span>
                <strong>v${version.versionNumber}</strong>
              </div>
              <div class="detail-row">
                <span>Created:</span>
                <span>${new Date(version.createdAt).toLocaleString()}</span>
              </div>
              ${version.description ? `
                <div class="detail-row">
                  <span>Description:</span>
                  <span>${escapeHtml(version.description)}</span>
                </div>
              ` : ''}
            </div>
          </div>
        </div>
        
        <div class="modal-footer">
          <button class="btn btn-outline cancel-restore-btn">Cancel</button>
          <button class="btn btn-primary btn-danger confirm-restore-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="1 4 1 10 7 10"/><polyline points="23 20 23 14 17 14"/>
              <path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/>
            </svg>
            Restore Version
          </button>
        </div>
      </div>
    `;
    
    const cancelBtn = dialog.querySelector('.cancel-restore-btn');
    const confirmBtn = dialog.querySelector('.confirm-restore-btn');
    const closeBtn = dialog.querySelector('.dialog-close-btn');
    
    cancelBtn.addEventListener('click', closeDialog);
    closeBtn.addEventListener('click', closeDialog);
    confirmBtn.addEventListener('click', executeRestore);
    
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) closeDialog();
    });
    
    document.body.appendChild(dialog);
  }
  
  /**
   * Execute the restore operation
   */
  async function executeRestore() {
    if (!pendingRestoreVersion) return;
    
    const project = IDEState?.get('currentProject');
    if (!project) return;
    
    try {
      const response = await fetch('/api/ide/versions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: project.name,
          versionNumber: pendingRestoreVersion.versionNumber
        })
      });
      
      if (response.ok) {
        closeDialog();
        
        // Update state
        if (IDEState) {
          IDEState.set({
            currentProject: { ...project, currentVersion: pendingRestoreVersion.versionNumber }
          });
          IDEState.refreshFiles(); // Reload files from restored version
        }
        
        if (IDEUtils) {
          IDEUtils.showToast(`Restored to v${pendingRestoreVersion.versionNumber}`, 'success');
        }
      } else {
        throw new Error('Restore failed');
      }
    } catch (error) {
      console.error('Failed to restore:', error);
      if (IDEUtils) IDEUtils.showToast('Failed to restore version', 'error');
    }
    
    pendingRestoreVersion = null;
  }
  
  /**
   * Close dialog
   */
  function closeDialog() {
    if (dialog) {
      dialog.remove();
      dialog = null;
    }
  }

  // ============================================
  // Utility Functions
  // ============================================
  
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  function formatRelativeTime(dateStr) {
    const date = new Date(dateStr);
    const diff = Date.now() - date.getTime();
    
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    
    return date.toLocaleDateString();
  }
  
  function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  // ============================================
  // Public API
  // ============================================
  
  return {
    init,
    loadVersions,
    refresh: () => {
      const project = IDEState?.get('currentProject');
      loadVersions(project);
    },
    
    // Expose for external use
    getVersions: () => versions,
    getCurrentVersion: () => currentVersion
  };
})();

// Export for use in other modules
window.VersionBrowserComponent = VersionBrowserComponent;
