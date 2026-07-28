/**
 * SBIDE - Memory Panel Component
 * Manages project memory anchors, context, and key decisions
 */

const MemoryPanelComponent = (() => {
  // ============================================
  // State
  // ============================================
  
  let container = null;
  let memoryData = null;
  let isLoading = false;
  
  // Dialog state
  let dialog = null;
  
  // Anchor type configuration
  const anchorTypes = [
    { id: 'decision', label: 'Decision', icon: '⚖️', color: '#6366f1' },
    { id: 'context', label: 'Context', icon: '📋', color: '#0891b2' },
    { id: 'constraint', label: 'Constraint', icon: '🚫', color: '#dc2626' },
    { id: 'goal', label: 'Goal', icon: '🎯', color: '#16a34a' }
  ];
  
  const importanceLevels = [
    { id: 'high', label: 'High', color: '#dc2626' },
    { id: 'medium', label: 'Medium', color: '#f59e0b' },
    { id: 'low', label: 'Low', color: '#6b7280' }
  ];

  // ============================================
  // Initialization
  // ============================================
  
  function init(element) {
    if (!element) {
      console.error('MemoryPanel: Container element required');
      return;
    }
    
    container = element;
    
    // Subscribe to state changes
    if (window.IDEState) {
      IDEState.subscribe((state, prevState) => {
        if (state.currentProject !== prevState.currentProject) {
          loadMemory(state.currentProject);
        }
        if (state.memoryRefreshKey !== prevState.memoryRefreshKey) {
          loadMemory(state.currentProject);
        }
      });
    }
    
    render();
  }

  // ============================================
  // Data Loading
  // ============================================
  
  async function loadMemory(project) {
    if (!project || !project.name) {
      memoryData = null;
      render();
      return;
    }
    
    isLoading = true;
    render();
    
    try {
      // Try to load from API or storage
      const response = await fetch(`/api/ide/memory?project=${encodeURIComponent(project.name)}`);
      
      if (response.ok) {
        const data = await response.json();
        memoryData = data.success ? data.data : null;
      } else {
        // Fallback to local storage
        memoryData = IDEStorage?.Memory?.get(project.name) || getDefaultMemory();
      }
    } catch (error) {
      console.error('Failed to load memory:', error);
      memoryData = getDefaultMemory();
    } finally {
      isLoading = false;
      render();
    }
  }
  
  /**
   * Get default empty memory structure
   */
  function getDefaultMemory() {
    return {
      context: '',
      anchors: [],
      keyDecisions: []
    };
  }

  // ============================================
  // Rendering
  // ============================================
  
  function render() {
    if (!container) return;
    
    const project = IDEState?.get('currentProject');
    
    if (!project) {
      container.innerHTML = `
        <div class="memory-empty-state">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-muted">
            <path d="M12 2a8 8 0 018 8c0 5.4-8 14-8 14S4 15.4 4 10a8 8 0 018-8z"/>
          </svg>
          <p>Select a project to view memory anchors</p>
        </div>
      `;
      return;
    }
    
    if (isLoading) {
      container.innerHTML = `
        <div class="memory-loading">
          <div class="spinner"></div>
          <span>Loading memory...</span>
        </div>
      `;
      return;
    }
    
    if (!memoryData || (!memoryData.context && memoryData.anchors.length === 0)) {
      container.innerHTML = `
        <div class="memory-panel-content">
          <div class="memory-header">
            <h3 class="memory-title">Memory Anchors</h3>
            <button class="icon-btn sm memory-refresh-btn" title="Refresh" aria-label="Refresh memory">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
              </svg>
            </button>
          </div>
          
          <div class="memory-empty-state">
            <p>No memory anchors yet</p>
            <p class="empty-hint">Add context and anchors to help AI understand your project</p>
            <button class="btn btn-primary btn-sm add-first-anchor-btn">Add First Anchor</button>
          </div>
        </div>
      `;
      
      wireUpEventListeners(container);
      return;
    }
    
    // Render full memory panel
    container.innerHTML = `
      <div class="memory-panel-content">
        <!-- Header -->
        <div class="memory-header">
          <h3 class="memory-title">Memory Anchors</h3>
          <div class="memory-actions">
            <button class="icon-btn sm memory-add-btn" title="Add anchor" aria-label="Add new anchor">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            </button>
            <button class="icon-btn sm memory-refresh-btn" title="Refresh" aria-label="Refresh memory">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
              </svg>
            </button>
          </div>
        </div>
        
        <!-- Project Context Section -->
        <section class="memory-section">
          <h4 class="section-label">Project Context</h4>
          <textarea 
            class="memory-context-input"
            placeholder="Describe your project context, goals, and any important background information..."
            rows="3"
          >${escapeHtml(memoryData.context || '')}</textarea>
          <button class="btn btn-ghost btn-xs save-context-btn">Save Context</button>
        </section>
        
        <!-- Memory Anchors List -->
        ${memoryData.anchors && memoryData.anchors.length > 0 ? `
          <section class="memory-section">
            <h4 class="section-label">Anchors (${memoryData.anchors.length})</h4>
            <div class="anchors-list">
              ${memoryData.anchors.map(anchor => renderAnchorCard(anchor)).join('')}
            </div>
          </section>
        ` : ''}
        
        <!-- Key Decisions Section -->
        ${memoryData.keyDecisions && memoryData.keyDecisions.length > 0 ? `
          <section class="memory-section">
            <h4 class="section-label">Key Decisions</h4>
            <ul class="decisions-list">
              ${memoryData.keyDecisions.map(decision => `
                <li class="decision-item">
                  <span class="decision-icon">🎯</span>
                  <span>${escapeHtml(decision)}</span>
                </li>
              `).join('')}
            </ul>
          </section>
        ` : ''}
      </div>
    `;
    
    wireUpEventListeners(container);
  }
  
  /**
   * Render a single anchor card
   */
  function renderAnchorCard(anchor) {
    const typeConfig = anchorTypes.find(t => t.id === anchor.type) || anchorTypes[0];
    const importanceConfig = importanceLevels.find(i => i.id === anchor.importance) || importanceLevels[1];
    
    return `
      <div 
        class="anchor-card" 
        data-anchor-id="${anchor.id}"
        style="border-left-color: ${importanceConfig.color}"
      >
        <div class="anchor-header">
          <span 
            class="anchor-type-badge" 
            style="background-color: ${typeConfig.color}20; color: ${typeConfig.color}"
          >
            ${typeConfig.icon} ${typeConfig.label}
          </span>
          <span 
            class="anchor-importance-badge"
            style="color: ${importanceConfig.color}"
          >
            ${importanceConfig.label}
          </span>
          <button class="icon-btn xs anchor-delete-btn" data-id="${anchor.id}" title="Delete anchor" aria-label="Delete anchor">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
            </svg>
          </button>
        </div>
        <p class="anchor-content">${escapeHtml(anchor.content)}</p>
        <span class="anchor-timestamp">${formatRelativeTime(anchor.timestamp)}</span>
      </div>
    `;
  }

  // ============================================
  // Event Handling
  // ============================================
  
  function wireUpEventListeners(panelEl) {
    // Refresh button
    panelEl.querySelector('.memory-refresh-btn')?.addEventListener('click', () => {
      const project = IDEState?.get('currentProject');
      loadMemory(project);
    });
    
    // Add anchor button
    panelEl.querySelector('.memory-add-btn, .add-first-anchor-btn')?.addEventListener('click', () => {
      showAddAnchorDialog();
    });
    
    // Save context button
    panelEl.querySelector('.save-context-btn')?.addEventListener('click', () => {
      const textarea = panelEl.querySelector('.memory-context-input');
      if (textarea) saveContext(textarea.value);
    });
    
    // Delete anchor buttons
    panelEl.querySelectorAll('.anchor-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteAnchor(btn.dataset.id);
      });
    });
  }
  
  /**
   * Show add/edit anchor dialog
   */
  function showAddAnchorDialog() {
    closeDialog();
    
    dialog = document.createElement('div');
    dialog.className = 'modal-overlay';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    
    dialog.innerHTML = `
      <div class="modal modal-sm">
        <div class="modal-header">
          <h2 class="modal-title">Add Memory Anchor</h2>
          <button class="icon-btn dialog-close-btn" aria-label="Close dialog">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label" for="anchor-content">Content</label>
            <textarea 
              id="anchor-content"
              class="input"
              rows="4"
              placeholder="Enter important information to remember..."
            ></textarea>
          </div>
          
          <div class="form-group">
            <label class="form-label">Type</label>
            <div class="anchor-type-options">
              ${anchorTypes.map(type => `
                <label class="radio-option">
                  <input type="radio" name="anchor-type" value="${type.id}" ${type.id === 'decision' ? 'checked' : ''} />
                  <span class="radio-label">${type.icon} ${type.label}</span>
                </label>
              `).join('')}
            </div>
          </div>
          
          <div class="form-group">
            <label class="form-label">Importance</label>
            <div class="importance-options">
              ${importanceLevels.map(level => `
                <label class="radio-option">
                  <input type="radio" name="anchor-importance" value="${level.id}" ${level.id === 'medium' ? 'checked' : ''} />
                  <span class="radio-label" style="color: ${level.color}">${level.label}</span>
                </label>
              `).join('')}
            </div>
          </div>
        </div>
        
        <div class="modal-footer">
          <button class="btn btn-outline cancel-dialog-btn">Cancel</button>
          <button class="btn btn-primary confirm-add-anchor-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            Add Anchor
          </button>
        </div>
      </div>
    `;
    
    // Wire up events
    const contentInput = dialog.querySelector('#anchor-content');
    const confirmBtn = dialog.querySelector('.confirm-add-anchor-btn');
    const cancelBtn = dialog.querySelector('.cancel-dialog-btn');
    const closeBtn = dialog.querySelector('.dialog-close-btn');
    
    confirmBtn.addEventListener('click', () => addNewAnchor(contentInput.value));
    cancelBtn.addEventListener('click', closeDialog);
    closeBtn.addEventListener('click', closeDialog);
    
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) closeDialog();
    });
    
    document.body.appendChild(dialog);
    contentInput.focus();
  }
  
  /**
   * Add new anchor
   */
  async function addNewAnchor(content) {
    if (!content.trim()) {
      if (IDEUtils) IDEUtils.showToast('Please enter content for the anchor', 'warning');
      return;
    }
    
    const project = IDEState?.get('currentProject');
    if (!project) return;
    
    const type = dialog?.querySelector('input[name="anchor-type"]:checked')?.value || 'decision';
    const importance = dialog?.querySelector('input[name="anchor-importance"]:checked')?.value || 'medium';
    
    const newAnchor = {
      id: Date.now().toString(),
      content: content.trim(),
      type,
      importance,
      timestamp: Date.now()
    };
    
    // Update local state
    if (!memoryData) memoryData = getDefaultMemory();
    if (!memoryData.anchors) memoryData.anchors = [];
    memoryData.anchors.unshift(newAnchor);
    
    // Save to storage/API
    try {
      await saveMemory();
      closeDialog();
      render();
      if (IDEUtils) IDEUtils.showToast('Anchor added', 'success');
    } catch (error) {
      console.error('Failed to add anchor:', error);
      if (IDEUtils) IDEUtils.showToast('Failed to add anchor', 'error');
    }
  }
  
  /**
   * Delete an anchor
   */
  async function deleteAnchor(anchorId) {
    if (!confirm('Delete this memory anchor?')) return;
    
    if (memoryData && memoryData.anchors) {
      memoryData.anchors = memoryData.anchors.filter(a => a.id !== anchorId);
      
      try {
        await saveMemory();
        render();
        if (IDEUtils) IDEUtils.showToast('Anchor deleted', 'success');
      } catch (error) {
        console.error('Failed to delete anchor:', error);
        if (IDEUtils) IDEUtils.showToast('Failed to delete anchor', 'error');
      }
    }
  }
  
  /**
   * Save project context
   */
  async function saveContext(context) {
    if (!memoryData) memoryData = getDefaultMemory();
    memoryData.context = context;
    
    try {
      await saveMemory();
      if (IDEUtils) IDEUtils.showToast('Context saved', 'success');
    } catch (error) {
      console.error('Failed to save context:', error);
      if (IDEUtils) IDEUtils.showToast('Failed to save context', 'error');
    }
  }
  
  /**
   * Save memory data to storage/API
   */
  async function saveMemory() {
    const project = IDEState?.get('currentProject');
    if (!project) throw new Error('No project selected');
    
    // Try API first
    try {
      const response = await fetch('/api/ide/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: project.name,
          ...memoryData
        })
      });
      
      if (response.ok) return;
    } catch (e) {
      console.log('API not available, using fallback');
    }
    
    // Fallback to local storage
    if (IDEStorage?.Memory) {
      await IDEStorage.Memory.save(project.name, memoryData);
    }
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
  
  function formatRelativeTime(timestamp) {
    if (!timestamp) return '';
    
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    
    return new Date(timestamp).toLocaleDateString();
  }

  // ============================================
  // Public API
  // ============================================
  
  return {
    init,
    loadMemory,
    refresh: () => {
      const project = IDEState?.get('currentProject');
      loadMemory(project);
    },
    
    // Expose for external use
    getMemoryData: () => memoryData,
    anchorTypes,
    importanceLevels
  };
})();

// Export for use in other modules
window.MemoryPanelComponent = MemoryPanelComponent;
