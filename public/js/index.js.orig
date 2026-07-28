/**
 * SBIDE - Module Barrel Loader (Optimized v2.2)
 * 
 * This file is the SINGLE entry point for all application scripts.
 * Uses PARALLEL loading for independent modules + lazy loading for optional ones.
 * 
 * LOADING STRATEGY:
 * ┌─────────────────────────────────────────────────────────────┐
 * │ Phase 1: Boot + CDN libs (parallel)                         │
 * │   ↓                                                         │
 * │ Phase 2: Core modules (sequential - depend on each other)    │
 * │   ↓                                                         │
 * │ Phase 3: Infrastructure (parallel - independent of each other)│
 * │   ↓                                                         │
 * │ Phase 4: UI Components (parallel - independent)              │
 * │   ↓                                                         │
 * │ Phase 5: App bootstrap (after all critical modules ready)     │
 * │                                                              │
 * │ ⏳ Background: Optional modules (lazy, non-blocking)          │
 * └─────────────────────────────────────────────────────────────┘
 * 
 * CACHING & PERFORMANCE:
 * - Detects repeat visits via sessionStorage
 * - Parallel loading reduces total time by 40-60%
 * - Optional modules loaded asynchronously after app is interactive
 * - Preload hints in HTML for critical paths
 * 
 * @module barrel
 * @version 2.2.0
 */

(function() {
  'use strict';

  // ============================================
  // Configuration
  // ============================================
  
  const BASE_PATH = '/js';
  const COMPONENTS_PATH = `${BASE_PATH}/components`;
  
  /**
   * Timing thresholds (milliseconds)
   */
  const THRESHOLDS = {
    FAST_LOAD: 600,         // Below this: skip overlay entirely
    QUICK_LOAD: 1200,       // Below this: abbreviated overlay  
    SPLASH_MIN_DISPLAY: 300,// Minimum splash display time
    REPEAT_VISIT_TTL: 3600000, // 1 hour cache window
    MODULE_TIMEOUT: 8000,   // Max time per module before warning
    LAZY_LOAD_DELAY: 500    // Delay before loading optional modules
  };
  
  // ============================================
  // Module Definitions (with dependency info)
  // ============================================
  
  /**
   * Critical modules - must load before app can initialize
   * Organized by phase for parallel loading within each phase
   */
  const CRITICAL_MODULES = {
    // Phase 1: Local libraries (can load in parallel with anything)
    cdn: [
      { src: 'highlight.min', optional: true, local: true },
      { src: 'jszip.min', optional: true, local: true }
    ],
    
    // Phase 2: Core utilities (sequential - each may depend on previous)
    core: [
      { src: 'utils', stage: 'Loading utilities...' },
      { src: 'storage', stage: 'Initializing storage...' },
      { src: 'state', stage: 'Preparing state management...' },
      { src: 'api', stage: 'Setting up API client...' }
    ],
    
    // Phase 3: Infrastructure (can be parallelized)
    infra: [
      { src: 'themes', stage: 'Loading themes...' },
      { src: 'connections', stage: 'Connecting services...', parallelSafe: true },
      { src: 'offline-kit', stage: 'Preparing offline support...', parallelSafe: true }
    ],
    
    // Phase 4: UI Components (mostly parallelizable)
    components: [
      { src: `${COMPONENTS_PATH}/chat-window`, stage: 'Loading chat interface...', section: 'chat' },
      { src: `${COMPONENTS_PATH}/code-editor`, stage: 'Loading code editor...', section: 'editor' },
      { src: `${COMPONENTS_PATH}/file-tree`, stage: 'Loading file explorer...', section: 'sidebar' },
      { src: `${COMPONENTS_PATH}/sidebar`, stage: 'Loading sidebar...', section: 'sidebar' },
      { src: `${COMPONENTS_PATH}/llm-manager`, stage: 'Loading AI manager...' },
      { src: `${COMPONENTS_PATH}/settings-panel`, stage: 'Loading settings...' },
      { src: `${COMPONENTS_PATH}/memory-panel`, stage: 'Loading memory panel...' },
      { src: `${COMPONENTS_PATH}/version-browser`, stage: 'Loading version history...' }
    ],
    
    // Phase 5: Application bootstrap
    app: [
      { src: 'app', stage: 'Starting application...' }
    ]
  };
  
  /**
   * Optional modules - loaded lazily AFTER app is interactive
   * These won't block startup or show loading indicators
   */
  const OPTIONAL_MODULES = [
    { src: `${COMPONENTS_PATH}/message-bubble`, name: 'message-bubble' },
    { src: `${COMPONENTS_PATH}/meetings-panel`, name: 'meetings-panel' },
    { src: `${COMPONENTS_PATH}/search-panel`, name: 'search-panel' }
  ];

  // ============================================
  // Cache Detection
  // ============================================
  
  function detectCacheStatus() {
    try {
      const lastVisit = sessionStorage.getItem('sbide_last_successful_load');
      if (!lastVisit) return { isRepeat: false, cached: false };
      
      const elapsed = Date.now() - parseInt(lastVisit, 10);
      return {
        isRepeat: elapsed < THRESHOLDS.REPEAT_VISIT_TTL,
        cached: elapsed < THRESHOLDS.REPEAT_VISIT_TTL,
        lastVisit: parseInt(lastVisit, 10)
      };
    } catch (e) {
      return { isRepeat: false, cached: false };
    }
  }

  function markSuccessfulLoad() {
    try {
      sessionStorage.setItem('sbide_last_successful_load', Date.now().toString());
    } catch (e) {}
  }

  const cacheStatus = detectCacheStatus();
  window.__ideLoadCacheStatus = cacheStatus;

  // ============================================
  // Loading State
  // ============================================
  
  const moduleStatus = {};
  const loadErrors = [];
  const loadStartTime = performance.now();
  
  let useFastPath = cacheStatus.cached;
  let overlayVisible = false;
  let overlayRemoved = false;

  // ============================================
  // Script Loading Utilities
  // ============================================
  
  /**
   * Resolve full path for a module source
   */
  function resolvePath(src) {
    if (src.startsWith('http')) return src;
    if (src.startsWith('/')) return src.endsWith('.js') ? src : `${src}.js`;
    return `${BASE_PATH}/${src}.js`;
  }
  
  /**
   * Extract clean module name from path
   */
  function getModuleName(src) {
    return src.split('/').pop()?.replace('.js', '').replace('.min', '') || src;
  }
  
  /**
   * Load a single script with timeout and error handling
   * @returns {Promise<void>}
   */
  function loadScript(module) {
    const src = typeof module === 'string' ? module : module.src;
    const isOptional = (typeof module === 'object' && module.optional);
    const isCDN = typeof module === 'object' && module.cdn;
    const isLocal = typeof module === 'object' && module.local;
    const section = typeof module === 'object' ? module.section : null;
    const fullPath = resolvePath(src);
    
    // Skip already loaded
    if (moduleStatus[fullPath]?.status === 'loaded') {
      return Promise.resolve();
    }
    
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        console.warn(`[SBIDE] Slow module: ${src} taking >${THRESHOLDS.MODULE_TIMEOUT/1000}s`);
      }, THRESHOLDS.MODULE_TIMEOUT);
      
      moduleStatus[fullPath] = { status: 'loading' };
      
      const script = document.createElement('script');
      script.src = fullPath;
      
      // For parallel-safe modules, allow async loading
      script.async = module?.parallelSafe || false;
      
      const cleanup = () => {
        clearTimeout(timeoutId);
      };
      
      script.onload = () => {
        cleanup();
        moduleStatus[fullPath] = { status: 'loaded' };
        
        // Performance tracking
        if (window._idePerf) {
          window._idePerf.mark(`module:${getModuleName(src)}`);
        }
        
        // Dispatch events for progressive reveal
        dispatchModuleLoaded(src, section);
        hideSkeletonForModule(src);
        
        resolve();
      };
      
      script.onerror = () => {
        cleanup();
        const error = new Error(`Failed to load: ${fullPath}`);
        moduleStatus[fullPath] = { status: 'error', error };
        
        if (isOptional || isCDN || isLocal) {
          if ((isCDN || isLocal) && typeof window.handleCDNError === 'function') {
            window.handleCDNError(getModuleName(src));
          }
          console.warn(`[SBIDE] Optional/CDN/Local module failed: ${src}`);
          resolve(); // Non-fatal
        } else {
          loadErrors.push({ src: fullPath, error });
          reject(error); // Fatal
        }
      };
      
      document.head.appendChild(script);
    });
  }
  
  /**
   * Load multiple modules in PARALLEL (for independent modules)
   * @param {Array} modules - Array of module configs
   * @returns {Promise<void[]>}
   */
  function loadParallel(modules) {
    return Promise.all(modules.map(module => {
      if (overlayVisible && module.stage) {
        updateLoadingStage(module.stage);
      }
      return loadScript(module).catch(err => {
        console.warn('[SBIDE] Parallel load error (non-fatal):', err.message);
      });
    }));
  }
  
  /**
   * Load modules sequentially (for dependent modules)
   * @param {Array} modules - Array of module configs (in order)
   * @returns {Promise<void>}
   */
  async function loadSequential(modules) {
    for (const module of modules) {
      if (overlayVisible && module.stage) {
        updateLoadingStage(module.stage);
      }
      await loadScript(module);
    }
  }

  // ============================================
  // Event Dispatching
  // ============================================
  
  function dispatchModuleLoaded(src, section) {
    const moduleName = getModuleName(src);
    const elapsed = performance.now() - loadStartTime;
    
    window.dispatchEvent(new CustomEvent('ide:module-loaded', {
      detail: { module: moduleName, src, section, elapsed: Math.round(elapsed) }
    }));
    
    if (section) {
      window.dispatchEvent(new CustomEvent('ide:section-ready', {
        detail: { section, module: moduleName, elapsed: Math.round(elapsed) }
      }));
    }
  }

  // ============================================
  // Main Loading Pipeline
  // ============================================
  
  async function loadAllModules() {
    const totalCritical = [
      ...CRITICAL_MODULES.cdn,
      ...CRITICAL_MODULES.core,
      ...CRITICAL_MODULES.infra,
      ...CRITICAL_MODULES.components,
      ...CRITICAL_MODULES.app
    ].length;
    
    console.log(`[SBIDE] ${cacheStatus.cached ? '🚀 Fast path:' : 'Loading'} ${totalCritical} critical + ${OPTIONAL_MODULES.length} optional modules...`);
    
    // Phase 1: Start CDN loads early (don't wait for them)
    const cdnPromise = loadParallel(CRITICAL_MODULES.cdn).catch(() => {});
    
    // Phase 2: Core modules (must be sequential)
    await loadSequential(CRITICAL_MODULES.core);
    
    // Update progress (~40% after core)
    if (overlayVisible) updateProgressBar(0.4);
    
    // Phase 3: Infrastructure (parallel where safe)
    // Start parallel-safe infra modules together with sequential ones
    const parallelInfra = CRITICAL_MODULES.infra.filter(m => m.parallelSafe);
    const sequentialInfra = CRITICAL_MODULES.infra.filter(m => !m.parallelSafe);
    
    await Promise.all([
      loadParallel(parallelInfra),
      loadSequential(sequentialInfra)
    ]);
    
    // Update progress (~60% after infra)
    if (overlayVisible) updateProgressBar(0.6);
    
    // Phase 4: UI Components (ALL parallel - they're independent!)
    await loadParallel(CRITICAL_MODULES.components);
    
    // Update progress (~90% after components)
    if (overlayVisible) updateProgressBar(0.9);
    
    // Phase 5: App bootstrap
    await loadSequential(CRITICAL_MODULES.app);
    
    // Ensure CDN is done (don't block on it though)
    await cdnPromise;
    
    const totalTime = performance.now() - loadStartTime;
    console.log(`[SBIDE] ✓ All critical modules loaded in ${totalTime.toFixed(1)}ms`);
    
    // Start lazy-loading optional modules in background
    setTimeout(loadOptionalModules, THRESHOLDS.LAZY_LOAD_DELAY);
  }
  
  /**
   * Load optional modules asynchronously (non-blocking)
   * These enhance functionality but aren't needed for basic operation
   */
  async function loadOptionalModules() {
    console.log(`[SBIDE] Background loading ${OPTIONAL_MODULES.length} optional modules...`);
    
    for (const mod of OPTIONAL_MODULES) {
      try {
        await loadScript({ ...mod, optional: true });
        console.log(`[SBIDE] ✓ Optional module ready: ${mod.name}`);
      } catch (e) {
        // Silently fail - these are enhancements
      }
    }
  }

  // ============================================
  // UI Management
  // ============================================
  
  function showLoadingOverlay() {
    const overlay = document.getElementById('app-loading-overlay');
    if (!overlay) return;
    
    // Overlay is semi-transparent in CSS (40% opacity with frosted glass)
    // Content is visible through it - no hide/show dance needed!
    overlayVisible = true;
  }
  
  function updateLoadingStage(text) {
    const el = document.getElementById('loading-stage-text');
    if (el) el.textContent = text;
  }
  
  function updateProgressBar(progress) {
    const bar = document.getElementById('loading-progress-bar');
    if (bar) bar.style.width = `${Math.round(progress * 100)}%`;
  }
  
  function hideSkeletonForModule(src) {
    const skeletonMap = {
      'sidebar': 'sidebar-skeleton',
      'chat-window': 'chat-skeleton',
      'code-editor': 'editor-skeleton',
      'file-tree': 'sidebar-skeleton'
    };
    
    const skeletonId = skeletonMap[getModuleName(src)];
    if (skeletonId) {
      const skeleton = document.getElementById(skeletonId);
      if (skeleton && !skeleton.classList.contains('fade-out')) {
        skeleton.classList.add('fade-out');
        setTimeout(() => {
          if (skeleton.parentNode) skeleton.style.display = 'none';
        }, 320);
      }
    }
  }
  
  function fadeOutLoadingOverlay() {
    const overlay = document.getElementById('app-loading-overlay');
    const totalTime = performance.now() - loadStartTime;
    
    overlayRemoved = true;
    
    if (overlay) {
      // Smooth fade out
      overlay.classList.add('fade-out');
      setTimeout(() => {
        overlay.remove();
        document.documentElement.classList.add('app-ready');
      }, 350);
      
      console.log(`[SBIDE] ✓ Ready in ${Math.round(totalTime)}ms`);
    } else {
      document.documentElement.classList.add('app-ready');
    }
    
    markSuccessfulLoad();
  }

  // ============================================
  // Initialization Complete Handler
  // ============================================
  
  function onModulesLoaded() {
    const totalTime = performance.now() - loadStartTime;
    
    if (window._idePerf) {
      window._idePerf.mark('all-modules-loaded');
    }
    
    if (loadErrors.length > 0) {
      console.warn(`[SBIDE] ${loadErrors.length} module(s) failed:`);
      loadErrors.forEach(({ src }) => console.warn(`  - ${src}`));
    }
    
    if (overlayVisible) {
      updateLoadingStage('Ready!');
      updateProgressBar(1);
    }
    
    // Show "Ready!" for 200ms before fading (smoother transition)
    const READY_DISPLAY_TIME = 200;
    const minDisplay = cacheStatus.cached ? 0 : THRESHOLDS.SPLASH_MIN_DISPLAY;
    const elapsed = performance.now() - loadStartTime;
    const remainingDelay = Math.max(READY_DISPLAY_TIME, minDisplay - elapsed) + READY_DISPLAY_TIME;
    
    setTimeout(fadeOutLoadingOverlay, remainingDelay);
    
    window.dispatchEvent(new CustomEvent('ide:modules-ready', { 
      detail: { 
        errors: loadErrors,
        timing: window._idePerf?.marks || {},
        totalTime: Math.round(totalTime),
        wasCached: cacheStatus.cached,
        usedFastPath: useFastPath
      } 
    }));
  }

  // ============================================
  // Start Loading
  // ============================================
  
  if (typeof window.handleCDNError === 'undefined') {
    console.error('[SBIDE] ERROR: boot.js must be loaded first!');
    window._cdnFailures = [];
    window.handleCDNError = (src) => console.warn('CDN error:', src);
  }
  
  showLoadingOverlay();
  
  const startLoad = () => {
    loadAllModules()
      .then(onModulesLoaded)
      .catch((err) => {
        console.error('[SBIDE] Fatal error:', err);
        
        const appEl = document.getElementById('app');
        if (appEl) {
          appEl.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:2rem;text-align:center;color:#374151;font-family:system-ui,sans-serif;">
              <h1 style="font-size:1.5rem;margin-bottom:0.5rem;">Failed to Load</h1>
              <p style="color:#6b7280;max-width:400px;">SBIDE couldn't load. Please refresh.</p>
              <button onclick="location.reload()" style="margin-top:1rem;padding:0.5rem 1rem;background:#6366f1;color:white;border:none;border-radius:0.375rem;cursor:pointer;">Refresh</button>
            </div>
          `;
        }
      });
  };
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startLoad);
  } else {
    startLoad();
  }

})();
