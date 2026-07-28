/**
 * SBIDE - Bootstrap / Initialization Module
 * 
 * This file MUST load first (before any other JS).
 * It sets up:
 * - Global error handling for CDN failures
 * - Font loading state detection
 * - Performance monitoring
 * - Safe globals for cross-module communication
 * 
 * @module boot
 * @version 2.0.0
 */

(function() {
  'use strict';

  // ============================================
  // 1. CDN Failure Tracking
  // ============================================
  
  /**
   * Track failed external library loads
   * @type {string[]}
   */
  window._cdnFailures = [];
  
  /**
   * Handle CDN load errors gracefully
   * Called via onerror attribute on script/link tags
   * @param {string} src - Identifier for the failed resource
   */
  window.handleCDNError = function handleCDNError(src) {
    if (!src) return;
    window._cdnFailures.push(src);
    console.warn(`[SBIDE] Failed to load: ${src}`);
    
    // Dispatch event for UI feedback
    try {
      window.dispatchEvent(new CustomEvent('cdn:error', { 
        detail: { source: src, timestamp: Date.now() } 
      }));
    } catch (e) {
      // Ignore dispatch errors in critical path
    }
  };

  // ============================================
  // 2. Font Loading State Detection
  // ============================================
  
  /**
   * Detect font loading state and apply appropriate classes
   * Works with the font CSS link's onload/onerror handlers
   */
  function initFontDetection() {
    const root = document.documentElement;
    
    // Check if fonts already loaded (cached)
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        root.classList.add('fonts-loaded');
      }).catch(() => {
        root.classList.add('fonts-failed');
      });
    }
    
    // Fallback: timeout-based detection
    // If fonts haven't loaded after 3s, show system fonts
    setTimeout(() => {
      if (!root.classList.contains('fonts-loaded')) {
        root.classList.add('fonts-fallback');
        console.info('[SBIDE] Using system font fallback');
      }
    }, 3000);
  }

  // ============================================
  // 3. Global State Container
  // ============================================
  
  /**
   * Global state container for cross-module communication
   * Initialized here, populated by other modules
   * @namespace
   */
  window.AppState = {
    /** @type {Object|null} Sidebar component reference */
    sidebar: null,
    
    /** @type {Object|null} Code editor component reference */
    editor: null,
    
    /** @type {Object|null} Chat window component reference */
    chat: null,
    
    /** @type {Object|null} LLM manager reference */
    llmManager: null,
    
    /** @type {Object|null} Storage module reference */
    storage: null,
    
    /** @type {Object|null} Theme manager reference */
    themes: null,
    
    /**
     * Show a toast notification
     * @param {string} message - Toast message
     * @param {'info'|'success'|'warning'|'error'} type - Toast type
     * @param {number} duration - Display duration in ms
     */
    showToast(message, type = 'info', duration = 3000) {
      // Will be overridden by app.js with full implementation
      console.log(`[Toast ${type}]`, message);
      
      // Basic fallback implementation
      const container = document.getElementById('toast-container');
      if (!container) return;
      
      const toast = document.createElement('div');
      toast.className = `toast toast-${type}`;
      toast.textContent = message;
      toast.style.cssText = `
        padding: 0.75rem 1rem;
        border-radius: 0.5rem;
        margin-bottom: 0.5rem;
        background: ${type === 'error' ? '#fef2f2' : type === 'warning' ? '#fffbeb' : type === 'success' ? '#f0fdf4' : '#eff6ff'};
        color: ${type === 'error' ? '#991b1b' : type === 'warning' ? '#92400e' : type === 'success' ? '#166534' : '#1e40af'};
        border: 1px solid ${type === 'error' ? '#fecaca' : type === 'warning' ? '#fde68a' : type === 'success' ? '#bbf7d0' : '#bfdbfe'};
        font-size: 0.875rem;
        animation: slideIn 0.2s ease-out;
        max-width: 400px;
      `;
      
      container.appendChild(toast);
      
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => toast.remove(), 300);
      }, duration);
    },
    
    /**
     * Register a component instance
     * @param {string} name - Component name
     * @param {Object} instance - Component instance
     */
    register(name, instance) {
      this[name] = instance;
    }
  };

  // ============================================
  // 4. Toolbar State (shared across modules)
  // ============================================
  
  /**
   * Toolbar toggle states (Web Search, Diff Patch)
   * Read by api.js to modify message content
   * Set by app.js toolbar button handlers
   */
  window.__ideToolbarState = {
    webSearchEnabled: false,
    diffPatchMode: false
  };

  // ============================================
  // 5. Performance & Error Monitoring
  // ============================================
  
  /**
   * Log initialization timing for performance analysis
   */
  const _bootTime = performance.now();
  
  window._idePerf = {
    bootTime: _bootTime,
    marks: {},
    
    /**
     * Record a performance mark
     * @param {string} name - Mark name
     */
    mark(name) {
      this.marks[name] = performance.now() - _bootTime;
    },
    
    /**
     * Get elapsed time since boot
     * @returns {number} Elapsed milliseconds
     */
    elapsed() {
      return performance.now() - _bootTime;
    }
  };
  
  // Mark boot complete
  window._idePerf.mark('boot-complete');

  // ============================================
  // 6. Initialization
  // ============================================
  
  // Run font detection when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFontDetection);
  } else {
    initFontDetection();
  }
  
  // Mark that boot module is loaded
  window._idePerf.mark('boot-script-loaded');
  
  console.log('[SBIDE] Boot module loaded', window._idePerf.elapsed().toFixed(1) + 'ms');

})();
