/**
 * SBIDE - Search Panel Component
 * Handles web search, results display, and context management
 * Ported from React SearchPanel.tsx with full feature parity
 */

const SearchPanelComponent = (() => {
  // ============================================
  // State
  // ============================================
  
  let container = null;
  let searchResults = [];
  let contextResults = [];
  let localQuery = '';
  let isSearching = false;
  
  // Callbacks
  let onAddToContext = null;
  let onRemoveFromContext = null;
  let onClearContext = null;
  
  // Constants
  const MAX_CONTEXT_RESULTS = 50;

  // ============================================
  // Initialization
  // ============================================
  
  /**
   * Initialize search panel component
   * @param {HTMLElement} element - Container element for the panel
   * @param {Object} options - Configuration options
   */
  function init(element, options = {}) {
    if (!element) {
      console.error('SearchPanel: Container element required');
      return;
    }
    
    container = element;
    onAddToContext = options.onAddToContext || null;
    onRemoveFromContext = options.onRemoveFromContext || null;
    onClearContext = options.onClearContext || null;
    
    // Subscribe to state changes
    if (window.IDEState) {
      IDEState.subscribe((state, prevState) => {
        if (state.searchQuery !== prevState.searchQuery) {
          localQuery = state.searchQuery || '';
          render();
        }
        if (state.searchResults !== prevState.searchResults) {
          searchResults = state.searchResults || [];
          render();
        }
        if (state.contextResults !== prevState.contextResults) {
          contextResults = state.contextResults || [];
          render();
        }
        if (state.isSearching !== prevState.isSearching) {
          isSearching = state.isSearching || false;
          render();
        }
      });
    }
    
    render();
  }

  // ============================================
  // Rendering
  // ============================================
  
  function render() {
    if (!container) return;
    
    container.innerHTML = `
      <!-- Header -->
      <div class="search-header">
        <h3 class="search-title">Manual Web Search</h3>
        <p class="search-description">Search the web, then add results to AI context</p>
        
        <!-- Search Input -->
        <div class="search-input-container">
          <input 
            type="text" 
            class="search-input input" 
            value="${escapeHtml(localQuery)}"
            placeholder="Enter search query..."
            id="search-query-input"
          />
          <button 
            class="btn btn-primary search-btn" 
            id="execute-search-btn"
            ${isSearching || !localQuery.trim() ? 'disabled' : ''}
          >
            ${isSearching ? `
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="animate-spin">
                <path d="M21 12a9 9 0 11-6.219-8.56"/>
              </svg>
            ` : `
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            `}
          </button>
        </div>
      </div>

      <!-- Context Results (Added to context) -->
      ${contextResults.length > 0 ? `
        <div class="context-results-section">
          <div class="context-header">
            <span class="context-badge badge">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              ${contextResults.length}/${MAX_CONTEXT_RESULTS} in context
            </span>
            <button class="btn btn-ghost btn-xs clear-context-btn" id="clear-all-context-btn">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
              </svg>
              Clear all
            </button>
          </div>
          <div class="context-list" id="context-results-list">
            ${contextResults.map(result => `
              <div class="context-item" data-url="${escapeAttr(result.url)}">
                <span class="context-item-title">${escapeHtml(result.title)}</span>
                <button class="icon-btn xs remove-context-btn" data-url="${escapeAttr(result.url)}" title="Remove from context">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- Search Results -->
      <div class="search-results-section">
        ${searchResults.length === 0 ? `
          <div class="search-empty-state">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-muted">
              <circle cx="12" cy="12" r="10"/>
              <line x1="2" y1="12" x2="22" y2="12"/>
              <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
            </svg>
            <p>Search the web</p>
            <p class="empty-hint">Click + to add results to AI context</p>
          </div>
        ` : `
          <div class="results-header">
            <span class="results-count">${searchResults.length} results found</span>
            <button class="btn btn-ghost btn-xs clear-results-btn" id="clear-search-results-btn">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
              Clear results
            </button>
          </div>
          
          <div class="search-results-list">
            ${searchResults.map((result, idx) => renderSearchResultCard(result, idx)).join('')}
          </div>
        `}
      </div>

      <!-- Footer -->
      <div class="search-footer">
        <p class="footer-text">
          Results with AI responses use current web data, not outdated training data.
          Add relevant results to context for better accuracy.
        </p>
      </div>
    `;
    
    wireUpEventListeners();
  }
  
  /**
   * Render a single search result card
   */
  function renderSearchResultCard(result, index) {
    const isInContext = isResultInContext(result.url);
    
    return `
      <div class="search-result-card ${isInContext ? 'in-context' : ''}" data-url="${escapeAttr(result.url)}">
        <div class="result-content">
          <span class="result-index">${index + 1}</span>
          <div class="result-info">
            <a href="${result.url}" target="_blank" rel="noopener noreferrer" class="result-title">
              ${escapeHtml(result.title)}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="external-icon">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
            </a>
            <p class="result-snippet">${escapeHtml(result.snippet)}</p>
            <div class="result-meta">
              ${result.favicon ? `<img src="${result.favicon}" alt="" class="result-favicon" onerror="this.style.display='none'" />` : ''}
              <span class="result-url">${escapeHtml(result.url)}</span>
            </div>
          </div>
        </div>
        <button 
          class="btn ${isInContext ? 'btn-primary' : 'btn-outline'} btn-xs toggle-context-btn"
          data-url="${escapeAttr(result.url)}"
          title="${isInContext ? 'Remove from context' : 'Add to context'}"
        >
          ${isInContext ? `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          ` : `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          `}
        </button>
      </div>
    `;
  }

  // ============================================
  // Event Handling
  // ============================================
  
  function wireUpEventListeners() {
    if (!container) return;
    
    // Search input
    const searchInput = container.querySelector('#search-query-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        localQuery = e.target.value;
      });
      
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          handleSearch();
        }
      });
    }
    
    // Search button
    container.querySelector('#execute-search-btn')?.addEventListener('click', handleSearch);
    
    // Clear results button
    container.querySelector('#clear-search-results-btn')?.addEventListener('click', () => {
      clearSearchResults();
    });
    
    // Clear all context button
    container.querySelector('#clear-all-context-btn')?.addEventListener('click', () => {
      handleClearContext();
    });
    
    // Remove individual context items
    container.querySelectorAll('.remove-context-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const url = btn.dataset.url;
        handleRemoveFromContext(url);
      });
    });
    
    // Toggle context buttons on result cards
    container.querySelectorAll('.toggle-context-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const url = btn.dataset.url;
        const result = searchResults.find(r => r.url === url);
        if (result) {
          handleToggleContext(result);
        }
      });
    });
  }

  // ============================================
  // Search Operations
  // ============================================
  
  async function handleSearch() {
    if (!localQuery.trim() || isSearching) return;
    
    // Update state
    if (IDEState) {
      IDEState.set({ searchQuery: localQuery, isSearching: true });
    }
    
    try {
      const response = await fetch('/api/ide/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: localQuery, num: 10 })
      });
      
      const data = await response.json();
      
      if (data.success) {
        if (IDEState) {
          IDEState.set({ searchResults: data.data || [] });
        }
        if (IDEUtils) {
          IDEUtils.showToast(`Found ${(data.data || []).length} results`, 'success');
        }
      } else {
        throw new Error(data.error || 'Search failed');
      }
    } catch (error) {
      console.error('Search failed:', error);
      if (IDEUtils) {
        IDEUtils.showToast('Search failed', 'error');
      }
    } finally {
      if (IDEState) {
        IDEState.set({ isSearching: false });
      }
    }
  }
  
  function clearSearchResults() {
    if (IDEState) {
      IDEState.set({ searchResults: [] });
    }
  }

  // ============================================
  // Context Management
  // ============================================
  
  function isResultInContext(url) {
    return contextResults.some(r => r.url === url);
  }
  
  function handleToggleContext(result) {
    if (isResultInContext(result.url)) {
      handleRemoveFromContext(result.url);
    } else {
      if (contextResults.length >= MAX_CONTEXT_RESULTS) {
        if (IDEUtils) {
          IDEUtils.showToast(`Maximum ${MAX_CONTEXT_RESULTS} results in context`, 'warning');
        }
        return;
      }
      
      handleAddToContext(result);
    }
  }
  
  function handleAddToContext(result) {
    if (onAddToContext) {
      onAddToContext(result);
    } else if (IDEState && typeof IDEState.addToContext === 'function') {
      IDEState.addToContext(result);
    }
    
    // Re-render to update UI
    contextResults = IDEState?.get('contextResults') || [...contextResults, result];
    render();
    
    if (IDEUtils) {
      IDEUtils.showToast('Added to context', 'success');
    }
  }
  
  function handleRemoveFromContext(url) {
    if (onRemoveFromContext) {
      onRemoveFromContext(url);
    } else if (IDEState && typeof IDEState.removeFromContext === 'function') {
      IDEState.removeFromContext(url);
    }
    
    // Re-render to update UI
    contextResults = (IDEState?.get('contextResults') || contextResults).filter(r => r.url !== url);
    render();
  }
  
  function handleClearContext() {
    if (onClearContext) {
      onClearContext();
    } else if (IDEState && typeof IDEState.clearContext === 'function') {
      IDEState.clearContext();
    }
    
    // Re-render to update UI
    contextResults = [];
    render();
  }

  // ============================================
  // Utility Functions
  // ============================================
  
  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  function escapeAttr(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // ============================================
  // Public API
  // ============================================
  
  return {
    init,
    render,
    handleSearch,
    clearSearchResults,
    handleAddToContext,
    handleRemoveFromContext,
    handleClearContext,
    
    // Expose for external use
    getSearchResults: () => searchResults,
    getContextResults: () => contextResults,
    MAX_CONTEXT_RESULTS
  };
})();

// Export for use in other modules
window.SearchPanelComponent = SearchPanelComponent;
