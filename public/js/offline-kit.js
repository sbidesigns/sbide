/**
 * SBIDE - Offline Kit
 * ============================================
 * Self-contained module that adds offline-first capabilities to the IDE.
 * Loaded as a regular <script>; exposes window.OfflineKit.
 *
 * Capabilities (all progressive enhancement — no-op if unsupported):
 *   1. OPFS         — persistent in-browser filesystem (survives reloads,
 *                     works even when IndexedDB is blocked by extensions)
 *   2. FS Access    — opt-in save-to-real-disk via showDirectoryPicker()
 *   3. Sync queue   — offline mutations queued in OPFS, drained on 'online'
 *   4. WebLLM       — local LLM in browser via WebGPU (no install)
 *   5. Ollama       — local LLM via localhost:11434 (user installs Ollama)
 *   6. LLM router   — picks best available: ollama → webllm → cloud → queue
 *
 * Public API:
 *   OfflineKit.init()
 *   await OfflineKit.write(project, path, content)   // writes to all layers
 *   const text = await OfflineKit.read(project, path)
 *   await OfflineKit.delete(project, path)
 *   const files = await OfflineKit.list(project)
 *   await OfflineKit.connectFolder()                 // user gesture required
 *   OfflineKit.disconnectFolder()
 *   OfflineKit.hasFolder()
 *   const status = OfflineKit.getStatus()            // {storage, llm, queue}
 *   OfflineKit.onStatusChange(cb)
 *   await OfflineKit.chat(messages, opts)            // AsyncGenerator<string>
 *   OfflineKit.setOllamaEndpoint(url)
 *   OfflineKit.setCloudLLM({endpoint, apiKey, model})
 *   OfflineKit.openSettings()                        // opens the kit's modal
 */

const OfflineKit = (() => {
  // ============================================
  // State
  // ============================================
  const state = {
    opfsRoot: null,           // FileSystemDirectoryHandle for OPFS root
    opfsAvailable: false,
    fsHandle: null,           // User-granted folder handle (File System Access API)
    fsAvailable: false,       // typeof showDirectoryPicker !== 'undefined'
    queue: [],                // Sync queue (in-memory mirror of OPFS log)
    queueDraining: false,
    online: navigator.onLine,
    // LLM
    ollamaEndpoint: 'http://localhost:11434',
    ollamaReachable: false,
    ollamaModels: [],
    webLLMEngine: null,
    webLLMLoading: null,      // Promise during load
    webLLMProgress: 0,        // Download progress 0-100
    webLLMProgressText: '',   // Progress description text
    webLLMSpeed: 0,           // Current download speed in bytes/sec
    webLLMLastProgressTime: 0, // Timestamp of last progress callback
    webLLMLastProgress: 0,    // Progress value at last callback (0-100)
    webLLMStartTime: 0,       // When the current download started
    webLLMLoadError: null,     // Error message if last load failed
    webLLMCached: false,      // Current model has been downloaded before
    webLLMUsingCache: false,  // Current load is reading from cache
    webLLMIsCustom: false,    // User entered a custom model name
    webLLMModelId: 'Llama-3.2-1B-Instruct-q4f32_1-MLC',
    webLLMSupported: typeof navigator !== 'undefined' && 'gpu' in navigator,
    webLLMCachedModels: {},   // { modelId: { cachedAt: timestamp, label: string } }
    webLLMRetryCount: 0,      // Current auto-retry attempt number (resets on success)
    webLLMMaxRetries: 3,      // Max auto-retries for transient errors (network/abort)
    webLLMLastGoodProgress: 0, // Last known good progress % before failure
    webLLMAutoRetrying: false, // Flag: true when we're in auto-retry (prevents finally from killing new promise)
    webLLMLastRetryTime: 0,   // Timestamp of last auto-retry (prevents rapid-fire)
    webLLMCacheBackend: null, // Cache backend: "cache" | "indexeddb" | "opfs" | null (auto-detect)
    cloudLLM: null,           // {endpoint, apiKey, model}
    activeLLM: null,          // {type: 'ollama'|'webllm'|'cloud'|'queued'|'none', name, model}
    statusListeners: new Set(),
    // Server sync (optional — set by app if a backend exists)
    syncEndpoint: null,
  };

  // ============================================
  // Utility
  // ============================================
  function log(...args) { console.log('[OfflineKit]', ...args); }
  function warn(...args) { console.warn('[OfflineKit]', ...args); }
  function err(...args) { console.error('[OfflineKit]', ...args); }

  // ============================================
  // Model Label Helper
  // ============================================
  const KNOWN_MODELS = {
    'Llama-3.2-1B-Instruct-q4f32_1-MLC': '⚡ Llama 3.2 1B',
    'Phi-3-mini-4k-instruct-q4f32_1-MLC': '🔥 Phi-3 Mini 4K',
    'gemma-2-2b-it-q4f32_1-MLC': '💎 Gemma 2 2B',
    'Llama-3.2-3B-Instruct-q4f32_1-MLC': '🧠 Llama 3.2 3B',
    'Llama-3.1-8B-Instruct-q4f32_1-MLC': '🚀 Llama 3.1 8B'
  };

  function getModelLabel(modelId) {
    return KNOWN_MODELS[modelId] || modelId.split('-Instruct')[0].replace(/-/g, ' ') || modelId;
  }

  // ============================================
  // Model Size Map (approximate download sizes in bytes)
  // ============================================
  const MODEL_SIZES = {
    'Llama-3.2-1B-Instruct-q4f32_1-MLC': 500 * 1024 * 1024,    // ~500MB
    'Phi-3-mini-4k-instruct-q4f32_1-MLC': 2 * 1024 * 1024 * 1024,   // ~2GB
    'gemma-2-2b-it-q4f32_1-MLC': 1.5 * 1024 * 1024 * 1024,     // ~1.5GB
    'Llama-3.2-3B-Instruct-q4f32_1-MLC': 1.8 * 1024 * 1024 * 1024,  // ~1.8GB
    'Llama-3.1-8B-Instruct-q4f32_1-MLC': 4.9 * 1024 * 1024 * 1024,   // ~4.9GB
  };

  function getModelSize(modelId) {
    return MODEL_SIZES[modelId] || 1 * 1024 * 1024 * 1024; // Default to 1GB for unknown models
  }

  // ============================================
  // Speed Formatting Helper
  // ============================================
  function formatSpeed(bytesPerSec) {
    if (!bytesPerSec || bytesPerSec <= 0) return '...';
    if (bytesPerSec >= 1024 * 1024 * 1024) {
      return (bytesPerSec / (1024 * 1024 * 1024)).toFixed(2) + ' GB/s';
    } else if (bytesPerSec >= 1024 * 1024) {
      return (bytesPerSec / (1024 * 1024)).toFixed(1) + ' MB/s';
    } else if (bytesPerSec >= 1024) {
      return (bytesPerSec / 1024).toFixed(0) + ' kB/s';
    } else {
      return bytesPerSec.toFixed(0) + ' B/s';
    }
  }

  // ============================================
  // CacheStorage Health Check
  // ============================================
  
  /**
   * Tests if CacheStorage API is functional for this origin.
   * Returns: { healthy: boolean, error: string|null }
   * 
   * This is critical because corrupted CacheStorage causes 
   * 'Failed to execute open on CacheStorage' errors that
   * CANNOT be fixed by JavaScript alone — they require
   * the user to clear site data via browser settings.
   */
  async function checkCacheStorageHealth() {
    // Basic support check
    if (!('caches' in window)) {
      return { healthy: false, error: 'CacheStorage API not supported in this context' };
    }
    
    try {
      // Test 1: Can we call caches.keys()?
      const names = await caches.keys();
      
      // Test 2: Can we open a cache? (This is where corruption usually shows up)
      const testCache = await caches.open('__offlinekit_health_test__');
      
      // Test 3: Can we put/get a value?
      await testCache.put('/__health_test__', new Response('ok'));
      const response = await testCache.match('/__health_test__');
      const ok = response && (await response.text()) === 'ok';
      
      // Cleanup test cache
      await testCache.delete('/__health_test__');
      await caches.delete('__offlinekit_health_test__');
      
      if (!ok) {
        return { healthy: false, error: 'CacheStorage read/write test failed' };
      }
      
      return { healthy: true, error: null };
    } catch (e) {
      const msg = (e.message || e.toString()).toLowerCase();
      log('CacheStorage health check FAILED:', e.message);
      
      // Identify specific corruption patterns
      if (msg.includes('cachestorage') && (msg.includes('internal error') || msg.includes('unexpected'))) {
        return { healthy: false, error: 'CacheStorage internal error — database corrupted', isCorruption: true };
      } else if (msg.includes('invalidstateerror') || msg.includes('state had changed')) {
        return { healthy: false, error: 'InvalidStateError — OPFS/CacheStorage state corrupted', isCorruption: true };
      } else if (msg.includes('security') || msg.includes('permission')) {
        return { healthy: false, error: 'Permission denied — may be in private browsing or restricted context' };
      }
      
      return { healthy: false, error: e.message?.substring(0, 100) || 'Unknown CacheStorage error', isCorruption: true };
    }
  }
  
  /**
   * Post-nuclear recovery state management.
   * sessionStorage survives page reloads but NOT tab closes.
   */
  function getPostNuclearState() {
    try {
      const raw = sessionStorage.getItem('offlinekit:post-nuclear');
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  }
  
  function setPostNuclearState(attempt = 0, triedManualClear = false) {
    try {
      sessionStorage.setItem('offlinekit:post-nuclear', JSON.stringify({
        time: Date.now(),
        attempt: attempt,
        triedManualClear: triedManualClear
      }));
    } catch { /* sessionStorage might be blocked */ }
  }
  
  function clearPostNuclearState() {
    try {
      sessionStorage.removeItem('offlinekit:post-nuclear');
    } catch { /* ignore */ }
  }
  
  function markManualClearAttempted() {
    const current = getPostNuclearState();
    if (current) {
      setPostNuclearState(current.attempt || 0, true);
    } else {
      setPostNuclearState(0, true);
    }
  }

  // ============================================
  // Storage Quota Pre-Flight Check
  // ============================================
  
  /**
   * Checks if browser has enough storage space for the model BEFORE downloading.
   * Uses navigator.storage.estimate() to get available quota.
   * 
   * Returns: { 
   *   ok: boolean, 
   *   needed: string (e.g., "500 MB"), 
   *   available: string (e.g., "1.2 GB"), 
   *   availableBytes: number,
   *   neededBytes: number,
   *   error: string|null,
   *   browser: string (for tailored instructions)
   * }
   */
  async function checkStorageQuota(modelId) {
    const neededBytes = getModelSize(modelId);
    const neededMB = Math.ceil(neededBytes / (1024 * 1024));
    const neededStr = neededMB >= 1024 ? `${(neededMB / 1024).toFixed(1)} GB` : `${neededMB} MB`;
    
    // Detect browser for tailored instructions
    const isOpera = navigator.userAgent.includes('OPR') || navigator.userAgent.includes('Opera');
    const isChrome = navigator.userAgent.includes('Chrome') && !isOpera;
    const isEdge = navigator.userAgent.includes('Edg');
    const isFirefox = navigator.userAgent.includes('Firefox');
    let browser = 'chrome';
    if (isOpera) browser = 'opera';
    else if (isEdge) browser = 'edge';
    else if (isFirefox) browser = 'firefox';
    
    // Default result — assume OK if we can't check
    const defaultResult = { 
      ok: true, 
      needed: neededStr, 
      available: 'unknown', 
      availableBytes: Infinity,
      neededBytes,
      error: null,
      browser 
    };
    
    // Check if Storage API is available
    if (!('storage' in navigator) || !navigator.storage || !navigator.storage.estimate) {
      log('Storage API not available — skipping quota check');
      return defaultResult;
    }
    
    try {
      const estimate = await navigator.storage.estimate();
      const quota = estimate.quota || 0; // Total allowed
      const usage = estimate.usage || 0; // Currently used
      const availableBytes = quota - usage;
      const availableMB = Math.floor(availableBytes / (1024 * 1024));
      const availableStr = availableMB >= 1024 ? `${(availableMB / 1024).toFixed(1)} GB` : `${availableMB} MB`;
      
      log(`Storage quota: ${availableStr} available of ${neededStr} needed (used ${Math.round(usage / (1024*1024))}MB / ${Math.round(quota / (1024*1024))}MB total)`);
      
      // Need at least 20% headroom beyond model size (WebLLM needs working space)
      const requiredWithHeadroom = neededBytes * 1.2;
      
      if (availableBytes < requiredWithHeadroom) {
        return {
          ok: false,
          needed: neededStr,
          available: availableStr,
          availableBytes,
          neededBytes,
          error: `Insufficient storage: need ~${neededStr} but only ~${availableStr} available`,
          browser
        };
      }
      
      return {
        ok: true,
        needed: neededStr,
        available: availableStr,
        availableBytes,
        neededBytes,
        error: null,
        browser
      };
      
    } catch (e) {
      log('Storage estimate failed:', e.message);
      // If estimate fails, allow download to proceed (error will be caught later)
      return defaultResult;
    }
  }
  
  /**
   * Generates browser-specific instructions for freeing storage space
   */
  function getStorageHelpInstructions(browser, needed, available) {
    const instructions = {
      opera: `🔸 **Opera Browser** — Free up space:\n\n` +
        `1️⃣ Click the **Opera menu** (☰ top-left) → **Settings**\n` +
        `2️⃣ Go to **Privacy & security** → **Site settings**\n` +
        `3️⃣ Click **View permissions and data stored across sites**\n` +
        `4️⃣ Search for "sandboxinit" → Click **Delete data**\n` +
        `5️⃣ Also try: Settings → Privacy & security → **Clear browsing data**\n` +
        `   ✓ Check "Cached images and files"\n` +
        `   ✅ UNCHECK "Passwords", "History", "Auto-fill"!\n` +
        `6️⃣ Time range: **All time** → Clear data\n` +
        `7️⃣ Restart Opera completely and try again\n\n` +
        `💡 Opera may have lower default storage quotas than Chrome.\n` +
        `   If issues persist, try Chrome or Edge instead.`,
        
      chrome: `🔸 **Chrome Browser** — Free up space:\n\n` +
        `1️⃣ Go to **chrome://settings/content/all**\n` +
        `2️⃣ Search for "sandboxinit" → **Clear data**\n` +
        `3️⃣ Or: chrome://settings/privacy → **Clear browsing data**\n` +
        `   ✓ Check "Cached images and files"\n` +
        `   ✅ UNCHECK passwords/history!\n` +
        `4️⃣ Time range: **All time** → Clear data\n` +
        `5️⃣ Restart Chrome completely`,
        
      edge: `🔸 **Edge Browser** — Free up space:\n\n` +
        `1️⃣ Go to **edge://settings/content/all**\n` +
        `2️⃣ Search for "sandboxinit" → **Clear data**\n` +
        `3️⃣ Or: edge://settings/privacy → **Choose what to clear**\n` +
        `   ✓ Check "Cached images and files"\n` +
        `4️⃣ Restart Edge completely`,
        
      firefox: `🔸 **Firefox** — Free up space:\n\n` +
        `1️⃣ Go to **about:preferences#privacy**\n` +
        `2️⃣ Scroll to **Cookies and Site Data** → **Clear Data...**\n` +
        `3️⃣ Or: about:preferences#privacy → Scroll down\n` +
        `   to "Cached Web Content" → **Clear Now**\n` +
        `4️⃣ Restart Firefox`
    };
    
    return instructions[browser] || instructions.chrome;
  }

  // ============================================
  // Smart Pre-Flight: Auto-detect & Clean Partial Downloads
  // ============================================
  
  /**
   * Detects and auto-cleans stale/partial WebLLM downloads before attempting
   * a fresh load. This prevents CacheStorage corruption errors by proactively
   * removing incomplete model data from previous interrupted sessions.
   * 
   * Detection methods:
   * 1. Check for 'offlinekit:webllm-downloading' flag in sessionStorage
   *     (set during download, cleared on success — if present on load = crashed)
   * 2. Check if model is marked as cached but CacheStorage health check fails
   * 3. Look for OPFS entries with model name that are suspiciously small
   * 
   * @param {string} modelId - The model about to be loaded
   * @returns {Promise<{cleaned: boolean, reason: string|null, details: string[]}>}
   */
  async function detectAndCleanPartialDownload(modelId) {
    const result = { 
      cleaned: false, 
      reason: null, 
      details: [] 
    };
    
    const modelKey = modelId.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    log(`Pre-flight check for model: ${modelId} (key: ${modelKey})`);
    
    // === DETECTION 1: Stale download-in-progress flag ===
    // This flag is set when download starts, cleared on success.
    // If it's present on page load, the previous session crashed mid-download.
    try {
      const downloadingFlag = sessionStorage.getItem('offlinekit:webllm-downloading');
      if (downloadingFlag) {
        const flagData = JSON.parse(downloadingFlag);
        // If flag is for THIS model or is older than 5 minutes = stale
        const isStale = (flagData.modelId !== modelId) || 
                        (Date.now() - flagData.startTime > 300000);
        
        if (isStale) {
          result.cleaned = true;
          result.reason = `Stale download flag found (model: ${flagData.modelId}, started ${Math.round((Date.now() - flagData.startTime) / 1000)}s ago)`;
          result.details.push('Detected crashed/interrupted download session');
          
          // Clear the stale flag
          sessionStorage.removeItem('offlinekit:webllm-downloading');
          result.details.push('Cleared stale download flag');
        } else {
          // Download was recently started for this exact model — might be a quick page refresh
          // Give it 30 seconds grace period before treating as stale
          if (Date.now() - flagData.startTime > 30000) {
            result.cleaned = true;
            result.reason = 'Recent download appears stalled';
            result.details.push('Download started >30s ago but no completion detected');
          }
        }
      }
    } catch(e) {
      result.details.push(`Flag check error: ${e.message?.substring(0, 40)}`);
    }
    
    // === DETECTION 2: Model marked as cached but cache is actually corrupted/empty ===
    try {
      const wasCached = state.webLLMCachedModels[modelId] || 
                         localStorage.getItem('offlinekit:webllm-cached') === modelId;
      
      if (wasCached) {
        // Quick sanity check: can we even open caches?
        try {
          const testNames = await caches.keys();
          const hasWebllmCache = testNames.some(n => 
            n.includes('webllm') || n.includes('mlc') || n.includes('workbox')
          );
          
          if (!hasWebllmCache && wasCached) {
            // Model claims to be cached but no WebLLM caches exist = data was lost
            result.cleaned = true;
            result.reason = 'Model marked as cached but no cache storage found';
            result.details.push('Cache storage missing — clearing stale cache markers');
            
            // Clean up stale markers
            delete state.webLLMCachedModels[modelId];
            saveCachedModels();
            if (localStorage.getItem('offlinekit:webllm-cached') === modelId) {
              localStorage.removeItem('offlinekit:webllm-cached');
            }
            state.webLLMCached = false;
            result.details.push('Removed stale cache markers');
          }
        } catch(cacheErr) {
          // If we can't even list caches, they might be corrupted
          if (cacheErr.message?.includes('cachestorage') || 
              cacheErr.message?.includes('internal error')) {
            result.cleaned = true;
            result.reason = 'CacheStorage appears corrupted';
            result.details.push(`CacheStorage error: ${cacheErr.message?.substring(0, 60)}`);
          }
        }
      }
    } catch(e) {
      result.details.push(`Cache marker check error: ${e.message?.substring(0, 40)}`);
    }
    
    // === DETECTION 3: Previous load error that wasn't resolved ===
    try {
      if (state.webLLMLoadError && !result.cleaned) {
        const errorMsg = (state.webLLMLoadError || '').toLowerCase();
        if (errorMsg.includes('cachestorage') || errorMsg.includes('corrupted') ||
            errorMsg.includes('invalidstateerror')) {
          // Previous attempt failed with corruption error — clean before retrying
          result.cleaned = true;
          result.reason = 'Previous load failed with cache corruption error';
          result.details.push(`Previous error: ${state.webLLMLoadError?.substring(0, 80)}`);
        }
      }
    } catch(e) {
      result.details.push(`Error check error: ${e.message?.substring(0, 40)}`);
    }
    
    // === IF ANY DETECTION TRIGGERED: AUTO-CLEAN THE MODEL'S CACHE ===
    if (result.cleaned) {
      log(`⚡ Pre-flight detected issue: ${result.reason}`);
      log('Auto-cleaning model cache before fresh download...');
      
      // Use existing deleteCachedModel function for surgical cleanup
      try {
        const deleteResult = await deleteCachedModel(modelId);
        if (deleteResult.warnings && deleteResult.warnings.length > 0) {
          result.details.push(...deleteResult.warnings);
        }
        result.details.push('✅ Auto-clean completed — ready for fresh download');
      } catch(cleanErr) {
        result.details.push(`Auto-clean warning: ${cleanErr.message?.substring(0, 60)}`);
        // Don't fail the whole operation — still try to load
      }
      
      // Also clear the error state since we're attempting recovery
      state.webLLMLoadError = null;
    } else {
      log('✅ Pre-flight check passed — no issues detected');
    }
    
    return result;
  }
  
  /**
   * Set the "currently downloading" flag in sessionStorage.
   * This survives page reloads so we can detect crashes.
   */
  function setDownloadingFlag(modelId) {
    try {
      sessionStorage.setItem('offlinekit:webllm-downloading', JSON.stringify({
        modelId: modelId,
        startTime: Date.now()
      }));
    } catch(e) { /* sessionStorage might be blocked */ }
  }
  
  function clearDownloadingFlag() {
    try {
      sessionStorage.removeItem('offlinekit:webllm-downloading');
    } catch(e) { /* ignore */ }
  }

  // ============================================
  // Cached Models Management
  // ============================================
  function saveCachedModels() {
    try {
      localStorage.setItem('offlinekit:webllm-cached-models', JSON.stringify(state.webLLMCachedModels));
    } catch (e) {
      err('Failed to save cached models:', e);
    }
  }

  function loadCachedModels() {
    try {
      const saved = localStorage.getItem('offlinekit:webllm-cached-models');
      if (saved) {
        state.webLLMCachedModels = JSON.parse(saved);
        log('Loaded cached models:', Object.keys(state.webLLMCachedModels));
      }
    } catch (e) {
      err('Failed to load cached models:', e);
    }
  }

  async function deleteCachedModel(modelId) {
    const errors = []; // Collect all errors for reporting
    
    try {
      // Remove from state
      delete state.webLLMCachedModels[modelId];
      saveCachedModels();
      
      // Clear localStorage markers
      if (localStorage.getItem('offlinekit:webllm-cached') === modelId) {
        localStorage.removeItem('offlinekit:webllm-cached');
      }
      state.webLLMCached = false;
      
      log('Clearing WebLLM cache for model:', modelId);
      
      // === METHOD 1: Clear browser Cache API (where WebLLM stores model weights) ===
      try {
        const cacheNames = await caches.keys();
        for (const name of cacheNames) {
          // WebLLM uses caches with names like 'webllm-', 'mlc-', or workbox caches
          if (name.includes('webllm') || name.includes('mlc') || name.includes('workbox') || name.includes('cache')) {
            await caches.delete(name);
            log('Deleted CacheStorage:', name);
          }
        }
      } catch (e) {
        errors.push(`Cache API: ${e.message}`);
        warn('Cache API cleanup failed:', e.message);
      }
      
      // === METHOD 2: Try WebLLM's own cleanup ===
      try {
        const webllmModule = await import('https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.9/+esm');
        if (webllmModule && typeof webllmModule.clearCache === 'function') {
          await webllmModule.clearCache();
          log('Cleared via WebLLM.clearCache()');
        }
      } catch (e) {
        // This often fails due to CacheStorage corruption - that's ok, we tried other methods
        log('WebLLM.clearCache() not available or failed:', e.message?.substring(0, 50));
      }
      
      // === METHOD 3: Clear OPFS directory where WebLLM stores models ===
      if (navigator.storage && navigator.storage.getDirectory) {
        try {
          const root = await navigator.storage.getDirectory();
          await clearOPFSRecursively(root, ['webllm', 'cache', 'models', modelId.replace(/[^a-zA-Z0-9_-]/g, '_')]);
          log('Attempted OPFS cleanup');
        } catch (e) {
          errors.push(`OPFS: ${e.message}`);
          warn('OPFS cleanup failed:', e.message);
          
          // If OPFS is corrupted, try nuking everything we can access
          if (e.message.includes('InvalidStateError') || e.message.includes('state had changed')) {
            log('OPFS appears corrupted, attempting aggressive cleanup...');
            try {
              const root = await navigator.storage.getDirectory();
              await nukeOPFSAggressive(root);
              log('Aggressive OPFS cleanup attempted');
            } catch (e2) {
              errors.push(`Aggressive OPFS: ${e2.message}`);
            }
          }
        }
      }
      
      // === METHOD 4: Clear all IndexedDB databases ===
      try {
        const dbs = await indexedDB.databases();
        for (const db of dbs) {
          if (db.name && (db.name.includes('webllm') || db.name.includes('cache') || 
              db.name.includes('model') || db.name.includes('mlc'))) {
            indexedDB.deleteDatabase(db.name);
            log('Deleted IndexedDB:', db.name);
          }
        }
      } catch (e) {
        errors.push(`IndexedDB: ${e.message}`);
        warn('IndexedDB cleanup failed:', e.message);
      }
      
      // === METHOD 5: Clear sessionStorage (WebLLM might use it) ===
      try {
        const keysToRemove = [];
        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i);
          if (key && (key.includes('webllm') || key.includes('mlc') || key.includes('model'))) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach(key => sessionStorage.removeItem(key));
        if (keysToRemove.length > 0) log('Cleared sessionStorage entries:', keysToRemove.length);
      } catch (e) {
        warn('SessionStorage cleanup failed:', e.message);
      }
      
      notifyStatusChange();
      renderBadge();
      
      if (errors.length > 0) {
        log('Cache cleared WITH some errors:', errors);
        return { success: true, warnings: errors };
      }
      
      log('Cleared model cache for:', modelId);
      return { success: true };
    } catch (e) {
      err('Failed to delete model cache:', e);
      return { success: false, error: e.message };
    }
  }

  /**
   * Aggressive OPFS cleanup - tries to remove EVERYTHING when normal methods fail
   * Use only when OPFS is in a corrupted state
   */
  async function nukeOPFSAggressive(rootDir) {
    const removed = [];
    const failed = [];
    
    try {
      for await (const entry of rootDir.values()) {
        try {
          await rootDir.removeEntry(entry.name, { recursive: true });
          removed.push(entry.name);
        } catch (e) {
          failed.push(entry.name);
        }
      }
      log(`Aggressive OPFS: removed ${removed.length}, failed ${failed.length}`);
      if (failed.length > 0) {
        warn('Could not remove these OPFS entries:', failed);
      }
    } catch (e) {
      warn('Aggressive OPFS iteration failed:', e.message);
    }
  }

  async function clearOPFSRecursively(rootDir, dirNamesToRemove) {
    for (const dirName of dirNamesToRemove) {
      try {
        const entry = await rootDir.removeEntry(dirName, { recursive: true });
        log('Removed OPFS entry:', dirName);
      } catch (e) {
        // Entry might not exist, that's ok
      }
    }
    
    // Also try removing any files/dirs at root level that look like model caches
    try {
      for await (const entry of rootDir.values()) {
        if (entry.kind === 'directory' && (
          entry.name.startsWith('webllm') || 
          entry.name.includes('cache') ||
          entry.name.includes('model') ||
          entry.name.includes('mlc')
        )) {
          try {
            await rootDir.removeEntry(entry.name, { recursive: true });
            log('Removed OPFS dir:', entry.name);
          } catch (e) {}
        }
      }
    } catch (e) {}
  }

  // ============================================
  // Render Cached Models List (for Manager UI)
  // ============================================
  function renderCachedModelsList(containerEl) {
    if (!containerEl) return;
    
    const models = state.webLLMCachedModels || {};
    const modelIds = Object.keys(models);
    
    if (modelIds.length === 0) {
      containerEl.innerHTML = '';
      return;
    }
    
    containerEl.innerHTML = modelIds.map(modelId => {
      const info = models[modelId];
      const label = info?.label || getModelLabel(modelId);
      const cachedAt = info?.cachedAt ? new Date(info.cachedAt) : null;
      const timeAgo = cachedAt ? formatTimeAgo(cachedAt) : 'unknown';
      const sizeEstimate = MODEL_SIZES[modelId] || (1 * 1024 * 1024 * 1024);
      const sizeStr = formatSize(sizeEstimate);
      const isCurrentModel = modelId === state.webLLMModelId;
      
      return `
        <div style="display:flex;align-items:center;gap:8px;padding:8px;background:#fff;border:1px solid ${isCurrentModel ? '#86efac' : '#e5e7eb'};border-radius:6px;${isCurrentModel ? 'border-left:3px solid #22c55e;' : ''}">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:4px;">
              <span style="font-weight:600;font-size:12px;color:#1f2937;">${label}</span>
              ${isCurrentModel ? '<span style="font-size:9px;background:#dcfce7;color:#166534;padding:1px 4px;border-radius:3px;">ACTIVE</span>' : ''}
            </div>
            <div style="display:flex;gap:8px;margin-top:2px;font-size:10px;color:#6b7280;">
              <span>📦 ${sizeStr}</span>
              <span>🕐 ${timeAgo}</span>
            </div>
          </div>
          <button data-delete-cached-model="${modelId}" type="button" 
            style="padding:4px 8px;background:#fef2f2;border:1px solid #fecaca;border-radius:5px;color:#dc2626;font-size:10px;cursor:pointer;flex-shrink:0;"
            title="Remove ${label} from cache">
            🗑️
          </button>
        </div>
      `;
    }).join('');
    
    // Wire up delete buttons
    containerEl.querySelectorAll('[data-delete-cached-model]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const modelId = btn.dataset.deleteCachedModel;
        const info = models[modelId];
        const label = info?.label || getModelLabel(modelId);
        
        if (confirm(`Remove "${label}" from cache?\n\nThis will clear the model's data from browser storage.`)) {
          btn.disabled = true;
          btn.textContent = '...';
          
          try {
            await deleteCachedModel(modelId);
            // Re-render the list
            const currentModal = document.getElementById('offline-kit-modal');
            renderCachedModelsList(containerEl);
            updateManagerUI(currentModal);
          } catch (e) {
            err('Delete failed:', e);
            btn.disabled = false;
            btn.textContent = '🗑️';
          }
        }
      });
    });
  }
  
  function formatTimeAgo(date) {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
    if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
    return Math.floor(seconds / 86400) + 'd ago';
  }
  
  function formatSize(bytes) {
    if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(0) + ' MB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' kB';
    return bytes + ' B';
  }
  
  function updateManagerUI(modal) {
    if (!modal) return;
    
    const count = Object.keys(state.webLLMCachedModels || {}).length;
    
    // Update toggle button text
    const toggleBtn = modal.querySelector('#ok-manage-models-toggle');
    if (toggleBtn) {
      toggleBtn.innerHTML = `<span>📦 Manage Cached Models <span style="font-weight:normal;opacity:0.6;">(${count} stored)</span></span><span id="ok-manage-chevron">▶</span>`;
      toggleBtn.style.background = count > 0 ? '#f0fdf4' : '#f9fafb';
      toggleBtn.style.borderColor = count > 0 ? '#86efac' : '#e5e7eb';
    }
    
    // Update no-models message
    const noModels = modal.querySelector('#ok-no-cached-models');
    if (noModels) {
      noModels.style.display = count === 0 ? 'block' : 'none';
    }
    
    // Update clear-all button
    const clearAllBtn = modal.querySelector('#ok-clear-all-cache');
    if (clearAllBtn) {
      clearAllBtn.style.opacity = count > 0 ? '' : '0.4';
      clearAllBtn.style.cursor = count > 0 ? 'pointer' : 'not-allowed';
    }
  }

  async function switchToModel(modelId) {
    if (state.webLLMEngine && state.webLLMModelId === modelId) {
      log('Model already loaded:', modelId);
      return; // Already loaded
    }
    
    // Update selection
    state.webLLMModelId = modelId;
    state.webLLMIsCustom = !KNOWN_MODELS[modelId];
    state.webLLMCached = !!state.webLLMCachedModels[modelId];
    localStorage.setItem('offlinekit:webllm-model', modelId);
    localStorage.setItem('offlinekit:webllm-is-custom', state.webLLMIsCustom);
    
    // If model was cached, update current cache flag
    if (state.webLLMCached) {
      localStorage.setItem('offlinekit:webllm-cached', modelId);
    }
    
    // Clear current engine (will reload on next chat or explicit load)
    state.webLLMEngine = null;
    
    notifyStatusChange();
    renderBadge();
    
    // Refresh modal
    const modal = document.getElementById('offline-kit-modal');
    if (modal) {
      closeModal();
      setTimeout(openSettings, 100);
    }
    
    log('Switched to model:', modelId, state.webLLMCached ? '(cached)' : '(needs download)');
  }

  function notifyStatusChange() {
    const status = getStatus();
    state.statusListeners.forEach(cb => {
      try { cb(status); } catch (e) { err('status listener error', e); }
    });
  }

  function getStatus() {
    let storage = 'memory';
    if (state.fsHandle) storage = 'filesystem';
    else if (state.opfsAvailable) storage = 'opfs';
    return {
      storage,
      opfs: state.opfsAvailable,
      filesystem: !!state.fsHandle,
      online: state.online,
      queueLength: state.queue.length,
      llm: state.activeLLM,
      webLLMSupported: state.webLLMSupported,
      ollamaReachable: state.ollamaReachable,
    };
  }

  function onStatusChange(cb) {
    state.statusListeners.add(cb);
    cb(getStatus());
    return () => state.statusListeners.delete(cb);
  }

  // ============================================
  // Layer 1: OPFS (Origin Private File System)
  // ============================================
  async function initOPFS() {
    if (!('storage' in navigator) || !navigator.storage.getDirectory) {
      warn('OPFS not supported in this browser');
      return false;
    }
    try {
      state.opfsRoot = await navigator.storage.getDirectory();
      state.opfsAvailable = true;
      log('OPFS ready');
      return true;
    } catch (e) {
      warn('OPFS init failed:', e);
      return false;
    }
  }

  async function getProjectDir(project, create = true) {
    if (!state.opfsRoot) return null;
    try {
      const projectsDir = await state.opfsRoot.getDirectoryHandle('projects', { create });
      return await projectsDir.getDirectoryHandle(project, { create });
    } catch (e) {
      warn('OPFS getProjectDir failed:', e);
      return null;
    }
  }

  async function opfsWrite(project, path, content) {
    if (!state.opfsAvailable) return false;
    const projDir = await getProjectDir(project, true);
    if (!projDir) return false;
    try {
      // Walk/create intermediate dirs
      const parts = path.split('/').filter(Boolean);
      let dir = projDir;
      for (let i = 0; i < parts.length - 1; i++) {
        dir = await dir.getDirectoryHandle(parts[i], { create: true });
      }
      const fileName = parts[parts.length - 1] || 'untitled';
      const fileHandle = await dir.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(content);
      await writable.close();
      return true;
    } catch (e) {
      warn('OPFS write failed:', e);
      return false;
    }
  }

  async function opfsRead(project, path) {
    if (!state.opfsAvailable) return null;
    const projDir = await getProjectDir(project, false);
    if (!projDir) return null;
    try {
      const parts = path.split('/').filter(Boolean);
      let dir = projDir;
      for (let i = 0; i < parts.length - 1; i++) {
        dir = await dir.getDirectoryHandle(parts[i], { create: false });
      }
      const fileName = parts[parts.length - 1] || 'untitled';
      const fileHandle = await dir.getFileHandle(fileName, { create: false });
      const file = await fileHandle.getFile();
      return await file.text();
    } catch (e) {
      return null; // file doesn't exist
    }
  }

  async function opfsDelete(project, path) {
    if (!state.opfsAvailable) return false;
    const projDir = await getProjectDir(project, false);
    if (!projDir) return false;
    try {
      const parts = path.split('/').filter(Boolean);
      let dir = projDir;
      for (let i = 0; i < parts.length - 1; i++) {
        dir = await dir.getDirectoryHandle(parts[i], { create: false });
      }
      const fileName = parts[parts.length - 1] || 'untitled';
      await dir.removeEntry(fileName);
      return true;
    } catch (e) {
      return false;
    }
  }

  async function opfsList(project) {
    if (!state.opfsAvailable) return [];
    const projDir = await getProjectDir(project, false);
    if (!projDir) return [];
    const results = [];
    async function walk(dir, prefix) {
      for await (const [name, handle] of dir.entries()) {
        const fullPath = prefix ? `${prefix}/${name}` : name;
        if (handle.kind === 'file') {
          results.push({ path: fullPath, kind: 'file' });
        } else {
          results.push({ path: fullPath, kind: 'directory' });
          await walk(handle, fullPath);
        }
      }
    }
    await walk(projDir, '');
    return results;
  }

  // ============================================
  // Layer 2: File System Access API (real disk)
  // ============================================
  function fsAccessSupported() {
    return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
  }

  async function connectFolder() {
    if (!fsAccessSupported()) {
      warn('File System Access API not supported. Use Chrome/Edge.');
      return false;
    }
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      state.fsHandle = handle;
      // Persist handle to OPFS so next session can re-request permission silently
      if (state.opfsAvailable) {
        try {
          const metaDir = await state.opfsRoot.getDirectoryHandle('.offline-kit', { create: true });
          const handleFile = await metaDir.getFileHandle('fs-handle', { create: true });
          const writable = await handleFile.createWritable();
          // Note: structuredClone is the standard way, but handle serialization
          // requires the File System Access API serialization support.
          // We store a marker; actual handle re-acquisition requires user gesture
          // in some browsers. For now, just remember we had one.
          await writable.write(JSON.stringify({ connected: true, name: handle.name }));
          await writable.close();
        } catch (e) { /* non-fatal */ }
      }
      log('Connected folder:', handle.name);
      notifyStatusChange();
      return true;
    } catch (e) {
      if (e.name === 'AbortError') return false;
      warn('connectFolder failed:', e);
      return false;
    }
  }

  function disconnectFolder() {
    state.fsHandle = null;
    notifyStatusChange();
  }

  function hasFolder() { return !!state.fsHandle; }

  async function ensureFsPermission() {
    if (!state.fsHandle) return false;
    const perm = await state.fsHandle.queryPermission({ mode: 'readwrite' });
    if (perm === 'granted') return true;
    const requested = await state.fsHandle.requestPermission({ mode: 'readwrite' });
    return requested === 'granted';
  }

  async function fsWrite(path, content) {
    if (!state.fsHandle) return false;
    if (!(await ensureFsPermission())) return false;
    try {
      const parts = path.split('/').filter(Boolean);
      let dir = state.fsHandle;
      for (let i = 0; i < parts.length - 1; i++) {
        dir = await dir.getDirectoryHandle(parts[i], { create: true });
      }
      const fileName = parts[parts.length - 1] || 'untitled';
      const fileHandle = await dir.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(content);
      await writable.close();
      return true;
    } catch (e) {
      warn('FS write failed:', e);
      return false;
    }
  }

  async function fsRead(path) {
    if (!state.fsHandle) return null;
    if (!(await ensureFsPermission())) return null;
    try {
      const parts = path.split('/').filter(Boolean);
      let dir = state.fsHandle;
      for (let i = 0; i < parts.length - 1; i++) {
        dir = await dir.getDirectoryHandle(parts[i], { create: false });
      }
      const fileName = parts[parts.length - 1] || 'untitled';
      const fileHandle = await dir.getFileHandle(fileName, { create: false });
      const file = await fileHandle.getFile();
      return await file.text();
    } catch (e) {
      return null;
    }
  }

  // ============================================
  // Layer 3: Unified write (write to all available layers)
  // ============================================
  async function write(project, path, content) {
    const tasks = [];
    if (state.opfsAvailable) tasks.push(opfsWrite(project, path, content));
    if (state.fsHandle) tasks.push(fsWrite(`${project}/${path}`, content));
    await Promise.all(tasks);
    // Enqueue for server sync (if a sync endpoint is set)
    enqueue({ op: 'write', project, path, content_hash: await hashContent(content), ts: Date.now() });
  }

  async function read(project, path) {
    // Try OPFS first (faster), fall back to FS, fall back to null
    let text = await opfsRead(project, path);
    if (text !== null) return text;
    text = await fsRead(`${project}/${path}`);
    return text;
  }

  async function remove(project, path) {
    await opfsDelete(project, path);
    enqueue({ op: 'delete', project, path, ts: Date.now() });
  }

  async function list(project) {
    return opfsList(project);
  }

  async function hashContent(content) {
    try {
      const data = new TextEncoder().encode(content);
      const buf = await crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) { return ''; }
  }

  // ============================================
  // Layer 4: Sync Queue (offline → online)
  // ============================================
  async function initQueue() {
    // Load any persisted queue from OPFS
    if (!state.opfsAvailable) return;
    try {
      const metaDir = await state.opfsRoot.getDirectoryHandle('.offline-kit', { create: true });
      const handle = await metaDir.getFileHandle('sync-queue.json', { create: true });
      const file = await handle.getFile();
      const text = await file.text();
      if (text) {
        state.queue = JSON.parse(text);
        log(`Loaded ${state.queue.length} queued ops from OPFS`);
      }
    } catch (e) { /* non-fatal */ }
  }

  async function persistQueue() {
    if (!state.opfsAvailable) return;
    try {
      const metaDir = await state.opfsRoot.getDirectoryHandle('.offline-kit', { create: true });
      const handle = await metaDir.getFileHandle('sync-queue.json', { create: true });
      const writable = await handle.createWritable();
      await writable.write(JSON.stringify(state.queue));
      await writable.close();
    } catch (e) { /* non-fatal */ }
  }

  function enqueue(op) {
    state.queue.push(op);
    persistQueue();
    notifyStatusChange();
    if (state.online) {
      drainQueue(); // best-effort, non-blocking
    }
  }

  async function drainQueue() {
    if (state.queueDraining || !state.syncEndpoint) return;
    if (state.queue.length === 0) return;
    state.queueDraining = true;
    try {
      while (state.queue.length > 0 && state.online) {
        const op = state.queue[0];
        try {
          const res = await fetch(state.syncEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(op),
          });
          if (res.ok) {
            state.queue.shift();
          } else {
            break; // server error — stop, retry later
          }
        } catch (e) {
          break; // network error — stop, retry later
        }
      }
      await persistQueue();
      notifyStatusChange();
    } finally {
      state.queueDraining = false;
    }
  }

  function setupOnlineListeners() {
    window.addEventListener('online', () => {
      state.online = true;
      log('Online — draining queue');
      drainQueue();
      probeOllama(); // re-check ollama now that we're online
      notifyStatusChange();
    });
    window.addEventListener('offline', () => {
      state.online = false;
      log('Offline — mutations will queue');
      notifyStatusChange();
    });
    state.online = navigator.onLine;
  }

  // ============================================
  // Layer 5: WebLLM (in-browser LLM via WebGPU)
  // ============================================
  function isWebLLMSupported() { return state.webLLMSupported; }

  async function loadWebLLM(modelId) {
    if (state.webLLMEngine) return state.webLLMEngine;
    if (state.webLLMLoading) return state.webLLMLoading;
    if (!state.webLLMSupported) throw new Error('WebGPU not available');
    state.webLLMLoading = (async () => {
      try {
        // Reset speed tracking for new download
        state.webLLMSpeed = 0;
        state.webLLMLastProgressTime = 0;
        state.webLLMLastProgress = 0;
        state.webLLMStartTime = performance.now();
        
        log('Loading WebLLM library + model:', modelId || state.webLLMModelId);
        const webllm = await import('https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.9/+esm');
        
        // Validate that WebLLM's config loaded properly
        if (!webllm.prebuiltAppConfig?.model_list) {
          throw new Error('WebLLM config failed to load (prebuiltAppConfig undefined). This usually means the CDN is blocked or having issues. Try refreshing or check your network.');
        }
        
        log(`WebLLM loaded OK. Available models: ${webllm.prebuiltAppConfig.model_list.length} models in config`);
        
        const engine = await webllm.CreateMLCEngine(
          modelId || state.webLLMModelId,
          {
            initProgressCallback: (p) => {
              log(`WebLLM: ${(p.progress * 100).toFixed(1)}% — ${p.text}`);
            }
          }
        );
        state.webLLMEngine = engine;
        state.webLLMModelId = modelId || state.webLLMModelId;
        log('WebLLM ready');
        notifyStatusChange();
        return engine;
      } catch (e) {
        err('WebLLM load failed:', e);
        throw e;
      } finally {
        state.webLLMLoading = null;
      }
    })();
    return state.webLLMLoading;
  }

  async function* webLLMChat(messages, opts = {}) {
    const engine = await loadWebLLM(opts.model);
    const stream = await engine.chat.completions.create({
      messages,
      stream: true,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.max_tokens ?? 1024,
    });
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content || '';
      if (delta) yield delta;
    }
  }

  // ============================================
  // Layer 6: Ollama (local LLM via localhost)
  // ============================================
  function setOllamaEndpoint(url) {
    state.ollamaEndpoint = url.replace(/\/$/, '');
    localStorage.setItem('offlinekit:ollama-endpoint', state.ollamaEndpoint);
    probeOllama();
  }

  async function probeOllama() {
    // Skip Ollama probe in iframe contexts (localhost won't work due to CORS)
    // Also skip if we've recently failed (cache negative result for 5 minutes)
    try {
      const lastFail = sessionStorage.getItem('offlinekit:ollama-fail-time');
      if (lastFail && (Date.now() - parseInt(lastFail, 10)) < 300000) {
        state.ollamaReachable = false;
        return; // Recently failed, skip probe
      }
      
      // Detect iframe context where localhost is inaccessible
      if (window.self !== window.top) {
        state.ollamaReachable = false;
        return; // In iframe, localhost won't work
      }
    } catch (e) {
      // sessionStorage may be blocked
    }
    
    try {
      const ctrl = new AbortController();
      // Reduced timeout: 300ms (was 800ms) for faster startup
      const t = setTimeout(() => ctrl.abort(), 300);
      const res = await fetch(`${state.ollamaEndpoint}/api/tags`, { signal: ctrl.signal });
      clearTimeout(t);
      if (res.ok) {
        const data = await res.json();
        state.ollamaReachable = true;
        state.ollamaModels = (data.models || []).map(m => m.name);
        log('Ollama reachable. Models:', state.ollamaModels);
      } else {
        state.ollamaReachable = false;
        cacheOllamaFailure();
      }
    } catch (e) {
      state.ollamaReachable = false;
      cacheOllamaFailure();
    }
    notifyStatusChange();
  }
  
  /**
   * Cache Ollama probe failure to avoid repeated slow probes
   */
  function cacheOllamaFailure() {
    try {
      sessionStorage.setItem('offlinekit:ollama-fail-time', Date.now().toString());
    } catch (e) {
      // Silently fail
    }
  }

  async function* ollamaChat(messages, opts = {}) {
    const model = opts.model || (state.ollamaModels[0]) || 'llama3.1:8b';
    const res = await fetch(`${state.ollamaEndpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        temperature: opts.temperature ?? 0.7,
      }),
    });
    if (!res.ok) throw new Error(`Ollama error ${res.status}: ${await res.text()}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') return;
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content || '';
          if (delta) yield delta;
        } catch (e) { /* skip */ }
      }
    }
  }

  // ============================================
  // Layer 7: Cloud LLM (OpenAI-compatible)
  // ============================================
  function setCloudLLM(config) {
    state.cloudLLM = config;
    localStorage.setItem('offlinekit:cloud-llm', JSON.stringify(config));
    notifyStatusChange();
  }

  async function* cloudLLMChat(messages, opts = {}) {
    if (!state.cloudLLM) throw new Error('No cloud LLM configured');
    const { endpoint, apiKey, model } = state.cloudLLM;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model || model,
        messages,
        stream: true,
        temperature: opts.temperature ?? 0.7,
      }),
    });
    if (!res.ok) throw new Error(`Cloud LLM error ${res.status}: ${await res.text()}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') return;
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content || '';
          if (delta) yield delta;
        } catch (e) { /* skip */ }
      }
    }
  }

  // ============================================
  // Layer 8: Smart LLM Router
  // ============================================
  async function pickLLM() {
    // 1. Ollama if reachable
    if (state.ollamaReachable) {
      state.activeLLM = { type: 'ollama', name: 'Ollama', model: state.ollamaModels[0] || 'llama3.1' };
      return 'ollama';
    }
    // 2. WebLLM if supported and engine is loaded (or loadable)
    if (state.webLLMSupported) {
      state.activeLLM = { type: 'webllm', name: 'WebLLM', model: state.webLLMModelId };
      return 'webllm';
    }
    // 3. Cloud if configured and online
    if (state.cloudLLM && state.online) {
      state.activeLLM = { type: 'cloud', name: 'Cloud', model: state.cloudLLM.model };
      return 'cloud';
    }
    // 4. Queue for later
    state.activeLLM = { type: state.online ? 'none' : 'queued', name: state.online ? 'None' : 'Queued', model: null };
    return state.activeLLM.type;
  }

  async function* chat(messages, opts = {}) {
    const backend = await pickLLM();
    if (backend === 'ollama') {
      try { yield* ollamaChat(messages, opts); return; }
      catch (e) { warn('Ollama failed, falling through:', e.message); }
    }
    if (backend === 'webllm' || state.webLLMSupported) {
      try { yield* webLLMChat(messages, opts); return; }
      catch (e) { warn('WebLLM failed, falling through:', e.message); }
    }
    if (backend === 'cloud' || (state.cloudLLM && state.online)) {
      try { yield* cloudLLMChat(messages, opts); return; }
      catch (e) { warn('Cloud failed:', e.message); }
    }
    // 4. Queue
    yield '(queued — will respond when a backend becomes available)';
    enqueue({ op: 'chat', messages, opts, ts: Date.now() });
  }

  function getActiveLLM() { return state.activeLLM; }

  // ============================================
  // Status UI (badge + settings modal)
  // ============================================
  function injectStyles() {
    if (document.getElementById('offline-kit-styles')) return;
    const css = `
.offline-kit-badge {
  position: fixed; bottom: 12px; right: 12px; z-index: 9999;
  display: flex; align-items: center; gap: 6px;
  padding: 6px 10px; border-radius: 999px;
  background: var(--color-card, #fff);
  border: 1px solid var(--color-border, #e5e7eb);
  box-shadow: 0 2px 8px color-mix(in srgb, #000 8%, transparent), 0 0 0 1px color-mix(in srgb, var(--color-border, #e5e7eb) 50%, transparent);
  font-size: 11px; font-weight: 600;
  color: var(--color-text-secondary, #6b7280);
  cursor: pointer; user-select: none;
  transition: transform 0.15s, box-shadow 0.15s;
  font-family: var(--font-sans, system-ui, sans-serif);
}
.offline-kit-badge:hover { transform: translateY(-1px); box-shadow: 0 4px 12px color-mix(in srgb, #000 12%, transparent), 0 0 0 1px color-mix(in srgb, var(--color-border, #e5e7eb) 60%, transparent); }
.offline-kit-badge .dot { width: 8px; height: 8px; border-radius: 50%; background: #9ca3af; }  /* Gray = no LLM loaded */
.offline-kit-badge.offline .dot { background: #f59e0b; }
.offline-kit-badge.queued .dot { background: #ef4444; animation: pulse 1.4s ease-in-out infinite; }
.offline-kit-badge.downloading .dot { background: #f97316; animation: pulse 1s ease-in-out infinite; }
.offline-kit-badge.loaded .dot { background: #10b981; }  /* Green = model ready */
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

.offline-kit-modal {
  position: fixed; inset: 0; z-index: 10000;
  background: color-mix(in srgb, #000 50%, transparent); display: flex; align-items: center; justify-content: center;
  font-family: var(--font-sans, system-ui, sans-serif);
}
.offline-kit-modal-card {
  background: var(--color-bg-primary, #fff); color: var(--color-text-primary, #1a1a1a);
  border-radius: 12px; box-shadow: 0 20px 60px color-mix(in srgb, #000 30%, transparent);
  width: min(560px, 92vw); max-height: 86vh; overflow-y: auto;
  padding: 24px;
}
.offline-kit-modal h2 { font-size: 18px; font-weight: 700; margin: 0 0 16px; }
.offline-kit-modal h3 { font-size: 13px; font-weight: 600; margin: 20px 0 8px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-text-muted, #9ca3af); }
.offline-kit-modal .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--color-border, #e5e7eb); }
.offline-kit-modal .row:last-child { border-bottom: none; }
.offline-kit-modal .label { font-size: 13px; font-weight: 500; }
.offline-kit-modal .value { font-size: 12px; color: var(--color-text-secondary, #6b7280); font-family: var(--font-mono, monospace); }
.offline-kit-modal input[type="text"], .offline-kit-modal input[type="password"] {
  width: 100%; padding: 8px 10px; font-size: 13px; font-family: var(--font-mono, monospace);
  border: 1px solid var(--color-border, #e5e7eb); border-radius: 6px;
  background: var(--color-bg-primary, #fff); color: var(--color-text-primary, #1a1a1a);
}
.offline-kit-modal button {
  padding: 8px 14px; font-size: 13px; font-weight: 500; border-radius: 6px; cursor: pointer;
  border: 1px solid var(--color-border, #e5e7eb); background: var(--color-card, #fff); color: var(--color-text-primary, #1a1a1a);
}
.offline-kit-modal button.primary { background: var(--color-primary, #6366f1); color: white; border-color: transparent; }
.offline-kit-modal .close { position: absolute; top: 12px; right: 16px; background: none; border: none; font-size: 22px; cursor: pointer; color: var(--color-text-muted, #9ca3af); }
.offline-kit-modal .footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
.offline-kit-modal .hint { font-size: 11px; color: var(--color-text-muted, #9ca3af); margin-top: 4px; }
    `;
    const style = document.createElement('style');
    style.id = 'offline-kit-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function renderBadge() {
    let badge = document.getElementById('offline-kit-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'offline-kit-badge';
      badge.className = 'offline-kit-badge';
      badge.addEventListener('click', openSettings);
      document.body.appendChild(badge);
    }
    const status = getStatus();
    const classes = ['offline-kit-badge'];
    if (!status.online) classes.push('offline');
    if (status.queueLength > 0) classes.push('queued');
    // Show ORANGE pulsing dot only when WebLLM is actively downloading (not just supported)
    if (state.webLLMLoading && !state.webLLMEngine) classes.push('downloading');
    // Show green dot ONLY when model is actually loaded and ready
    else if (state.webLLMEngine) classes.push('loaded');
    badge.className = classes.join(' ');

    let label;
    if (!status.online) label = `Offline · ${status.queueLength} queued`;
    else if (status.queueLength > 0) label = `Syncing · ${status.queueLength} left`;
    else if (state.webLLMLoading && !state.webLLMEngine) label = `WebLLM · ${state.webLLMProgress.toFixed(0)}%`;
    else if (state.webLLMEngine) label = `Local · WebLLM ✓`;  // Green = loaded
    else if (status.llm?.type === 'ollama') label = `Local · ${status.llm.model || 'Ollama'}`;
    else if (status.llm?.type === 'cloud') label = `Cloud · ${status.llm.model || 'LLM'}`;
    else label = `${status.storage.toUpperCase()} · ready`;  // No LLM = neutral
    badge.innerHTML = `<span class="dot"></span><span>${label}</span>`;
  }

  function openSettings() {
    closeModal();
    const status = getStatus();
    const modal = document.createElement('div');
    modal.className = 'offline-kit-modal';
    modal.id = 'offline-kit-modal';
    modal.innerHTML = `
      <div class="offline-kit-modal-card" style="position:relative">
        <button class="close" aria-label="Close">×</button>
        <h2>Offline Kit</h2>

        <h3>Storage</h3>
        <div class="row"><span class="label">OPFS (in-browser)</span><span class="value">${status.opfs ? '✓ Available' : '✗ Unsupported'}</span></div>
        <div class="row"><span class="label">Connected folder</span>
          <span class="value">${status.filesystem ? '✓ Connected' : 'Not connected'}</span>
          <button id="ok-connect-folder">${status.filesystem ? 'Disconnect' : 'Connect…'}</button>
        </div>
        <p class="hint">Connecting a folder lets saves go to your real disk (Chrome/Edge only). Data always saves to OPFS as a backup.</p>

        <h3>Local LLM</h3>
        <div class="row"><span class="label">Ollama (localhost)</span><span class="value">${status.ollamaReachable ? '✓ ' + (state.ollamaModels[0] || 'Ready') : 'Not running'}</span>
          <button id="ok-probe-ollama">Check</button>
        </div>
        <div class="row"><span class="label">Ollama endpoint</span></div>
        <input type="text" id="ok-ollama-url" value="${state.ollamaEndpoint}" placeholder="http://localhost:11434">
        <p class="hint">Install Ollama from ollama.com, then run <code>ollama serve</code>. Set OLLAMA_ORIGINS=* if your IDE is on a different origin.</p>

        <div class="row">
          <span class="label">WebLLM (in-browser)</span>
          <span class="value">${status.webLLMSupported ? '✓ Supported' : '✗ Needs WebGPU (Chrome/Edge)'}</span>
          ${status.webLLMSupported ? `<button id="ok-load-webllm">${state.webLLMEngine ? '✓ Loaded' : 'Load WebLLM Model'}</button>` : ''}
        </div>
        <div id="ok-webllm-progress" style="display:${(state.webLLMLoading && !state.webLLMEngine) ? 'block' : 'none'}; margin:6px 0; padding:10px 12px; background:#f0fdf4; border-radius:8px; font-size:13px; color:#166534;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
            <span style="font-weight:600;">⬇️ ${state.webLLMProgressText || 'Downloading WebLLM model...'}</span>
            <strong style="font-size:16px;color:#15803d;" id="ok-webllm-pct">${state.webLLMProgress.toFixed(0)}%</strong>
          </div>
          <div style="height:6px; background:#bbf7d0; border-radius:3px; overflow:hidden;margin-bottom:8px;"><div id="ok-webllm-bar" style="height:100%; width:${state.webLLMProgress}%; background:linear-gradient(90deg,#22c55e,#16a34a); border-radius:3px; transition:width 0.3s ease;"></div></div>
          <div style="display:flex;align-items:center;justify-content:space-between;font-size:12px;">
            <span id="ok-webllm-speed" style="color:#4d7c0f;font-weight:500;">${state.webLLMSpeed > 0 ? formatSpeed(state.webLLMSpeed) : 'Calculating speed...'}</span>
            <span style="opacity:0.7;">✨ Close modal — download continues</span>
          </div>
        </div>
        <!-- Error / Failure State -->
        <div id="ok-webllm-error" style="display:${state.webLLMLoadError ? 'block' : 'none'}; margin:6px 0; padding:10px 12px; background:#fef2f2; border-radius:8px; font-size:13px; color:#991b1b; border:1px solid #fecaca;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
            <span style="font-size:18px;">❌</span>
            <strong>Download Failed</strong>
          </div>
          <p id="ok-webllm-error-msg" style="margin:0 0 8px;font-size:12px;opacity:0.9;">${state.webLLMLoadError || 'An error occurred during download.'}</p>
          <div id="ok-error-buttons" style="display:flex;flex-direction:column;gap:6px;">
            <div style="display:flex;gap:6px;">
              <button id="ok-retry-download" type="button" style="flex:1;padding:6px 10px;background:#3b82f6;border:none;border-radius:6px;color:#fff;font-size:11px;font-weight:600;cursor:pointer;">🔄 Retry Download</button>
              <button id="ok-clear-and-retry" type="button" style="flex:1;padding:6px 10px;background:#dc2626;border:none;border-radius:6px;color:#fff;font-size:11px;font-weight:600;cursor:pointer;">🗑️ Clear Cache & Retry</button>
            </div>
            <!-- Nuclear option for corrupted storage - hidden by default -->
            <div id="ok-nuclear-option" style="display:none;border-top:1px solid #fca5a5;padding-top:8px;margin-top:4px;">
              <p style="margin:0 0 6px;font-size:11px;color:#7f1d1d;">
                ⚠️ Standard cache clear didn't work. The browser's internal storage is corrupted.
              </p>
              <button id="ok-nuclear-clear" type="button" style="width:100%;padding:6px 10px;background:#7f1d1d;border:none;border-radius:6px;color:#fff;font-size:11px;font-weight:600;cursor:pointer;">
                🧹 Reset WebLLM Cache Only
              </button>
              <p style="margin:4px 0 0;font-size:9px;color:#991b1b;">
                ✅ Safe — only clears WebLLM model data, your projects/settings are preserved.
              </p>
              <!-- Deep Clean option - shown after 2+ failed attempts -->
              <div id="ok-deep-clean-option" style="display:none;margin-top:8px;border-top:1px solid #fca5a5;padding-top:8px;">
                <p style="margin:0 0 6px;font-size:11px;color:#7f1d1d;">
                  🔴 If that didn't work, try Deep Clean:
                </p>
                <button id="ok-deep-clean" type="button" style="width:100%;padding:8px 10px;background:#991b1d;border:none;border-radius:6px;color:#fff;font-size:12px;font-weight:600;cursor:pointer;">
                  🧹 Deep Clear ALL Caches (keeps projects)
                </button>
                <p style="margin:4px 0 0;font-size:9px;color:#991b1b;">
                  Clears ALL cache storage but preserves your project files and settings.
                </p>
                <!-- Manual fix as last resort -->
                <div id="ok-manual-fix-option" style="display:none;margin-top:8px;border-top:1px solid #fca5a5;padding-top:8px;">
                  <p style="margin:0 0 6px;font-size:11px;color:#7f1d1d;">
                    📋 Last resort — manual fix:
                  </p>
                  <button id="ok-manual-clear-help" type="button" style="width:100%;padding:8px 10px;background:#1e40af;border:none;border-radius:6px;color:#fff;font-size:11px;font-weight:600;cursor:pointer;">
                    📖 Open Chrome Site Settings
                  </button>
                  <p style="margin:4px 0 0;font-size:9px;color:#1e40af;">
                    Opens Chrome's site data settings to fully reset this site's storage.
                  </p>
                  <!-- For users who already cleared manually -->
                  <div id="ok-already-cleared-section" style="margin-top:8px;border-top:1px solid #dbeafe;padding-top:8px;">
                    <p style="margin:0 0 6px;font-size:10px;color:#1e40af;">
                      Already cleared via Chrome settings?
                    </p>
                    <button id="ok-tried-manual-clear" type="button" style="width:100%;padding:6px 10px;background:#3b82f6;border:none;border-radius:6px;color:#fff;font-size:10px;font-weight:600;cursor:pointer;">
                      ✓ I already did the manual clear
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="row"><span class="label">WebLLM model</span></div>
        <select id="ok-webllm-model" style="width:100%;padding:6px 8px;border:1px solid var(--color-border,#e5e7eb);border-radius:6px;background:var(--color-card,#fff);color:var(--color-text,#1f2937);font-size:13px;">
          <option value="Llama-3.2-1B-Instruct-q4f32_1-MLC"${state.webLLMModelId === 'Llama-3.2-1B-Instruct-q4f32_1-MLC' ? ' selected' : ''}>⚡ Llama 3.2 1B (~500MB) — Fastest, lightest</option>
          <option value="Phi-3-mini-4k-instruct-q4f32_1-MLC"${state.webLLMModelId === 'Phi-3-mini-4k-instruct-q4f32_1-MLC' ? ' selected' : ''}>🔥 Phi-3 Mini 4K (~2GB) — Great balance</option>
          <option value="gemma-2-2b-it-q4f32_1-MLC"${state.webLLMModelId === 'gemma-2-2b-it-q4f32_1-MLC' ? ' selected' : ''}>💎 Gemma 2 2B (~1.5GB) — Google's efficient model</option>
          <option value="Llama-3.2-3B-Instruct-q4f32_1-MLC"${state.webLLMModelId === 'Llama-3.2-3B-Instruct-q4f32_1-MLC' ? ' selected' : ''}>🧠 Llama 3.2 3B (~1.8GB) — More capable</option>
          <option value="Llama-3.1-8B-Instruct-q4f32_1-MLC"${state.webLLMModelId === 'Llama-3.1-8B-Instruct-q4f32_1-MLC' ? ' selected' : ''}>🚀 Llama 3.1 8B (~4.9GB) — Most capable, larger</option>
        </select>
        
        <!-- === CACHE BACKEND SELECTOR (Advanced) === -->
        <div style="margin-top:6px;">
          <button id="ok-cache-backend-toggle" type="button" style="width:100%;padding:4px 10px;background:none;border:1px dashed #d1d5db;border-radius:6px;color:#6b7280;font-size:11px;cursor:pointer;text-align:left;display:flex;align-items:center;justify-content:space-between;">
            <span>⚙️ Cache Backend: <strong id="ok-cache-backend-label">${state.webLLMCacheBackend || 'Auto-detect'}</strong></span>
            <span id="ok-cache-backend-chevron">▶</span>
          </button>
          <div id="ok-cache-backend-options" style="display:none;margin-top:4px;padding:8px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;font-size:12px;">
            <p style="margin:0 0 6px;color:#6b7280;font-size:11px;">How WebLLM stores model files. Change if download fails with "Cache.add" errors.</p>
            <select id="ok-cache-backend-select" style="width:100%;padding:4px 6px;border:1px solid #d1d5db;border-radius:4px;background:#fff;font-size:12px;">
              <option value="">🔍 Auto-detect (recommended)</option>
              <option value="cache"${state.webLLMCacheBackend === 'cache' ? ' selected' : ''}>💾 Cache API (default, may fail in Opera)</option>
              <option value="indexeddb"${state.webLLMCacheBackend === 'indexeddb' ? ' selected' : ''}>🗄️ IndexedDB (more reliable, higher quota)</option>
              <option value="opfs"${state.webLLMCacheBackend === 'opfs' ? ' selected' : ''}>📁 OPFS (good for large files)</option>
            </select>
            <p id="ok-cache-backend-hint" style="margin:6px 0 0;font-size:10px;color:#9ca3af;"></p>
          </div>
        </div>
        
        <!-- === MODEL CACHE MANAGER (Accordion) === -->
        <button id="ok-manage-models-toggle" type="button" style="width:100%;margin-top:6px;padding:8px 10px;background:${Object.keys(state.webLLMCachedModels || {}).length > 0 ? '#f0fdf4' : '#f9fafb'};border:1px solid ${Object.keys(state.webLLMCachedModels || {}).length > 0 ? '#86efac' : '#e5e7eb'};border-radius:8px;color:#374151;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:space-between;text-align:left;">
          <span>📦 Manage Cached Models <span style="font-weight:normal;opacity:0.6;">(${Object.keys(state.webLLMCachedModels || {}).length} stored)</span></span>
          <span id="ok-manage-chevron">▶</span>
        </button>
        <div id="ok-model-manager" style="display:none;margin-top:4px;padding:10px;background:#fafafa;border:1px solid #e5e7eb;border-radius:8px;">
          <div id="ok-cached-models-list" style="display:flex;flex-direction:column;gap:6px;max-height:180px;overflow-y:auto;">
            <!-- Populated by JS below -->
          </div>
          <div id="ok-no-cached-models" style="${Object.keys(state.webLLMCachedModels || {}).length === 0 ? 'display:block' : 'display:none'};text-align:center;padding:16px;color:#9ca3af;font-size:12px;">
            <p style="margin:0;">📭 No cached models yet</p>
            <p style="margin:4px 0 0;font-size:11px;">Download a model and it will appear here for management.</p>
          </div>
          <div style="margin-top:8px;padding-top:8px;border-top:1px solid #e5e7eb;display:flex;justify-content:flex-end;">
            <button id="ok-clear-all-cache" type="button" style="padding:4px 10px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;color:#dc2626;font-size:10px;cursor:pointer;${Object.keys(state.webLLMCachedModels || {}).length > 0 ? '' : 'opacity:0.4;cursor:not-allowed;'}">
              🗑️ Clear All Cache
            </button>
          </div>
        </div>
        <button id="ok-custom-model-toggle" type="button" style="margin-top:4px;background:none;border:none;color:#6b7280;font-size:11px;cursor:pointer;text-decoration:underline;padding:2px 0;">✏️ Enter custom model name…</button>
        <div id="ok-custom-model-wrapper" style="display:${state.webLLMIsCustom ? 'block' : 'none'};margin-top:6px;padding:8px;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:6px;">
          <label style="font-size:11px;font-weight:600;color:#475569;display:block;margin-bottom:4px;">Custom WebLLM Model ID</label>
          <input type="text" id="ok-webllm-model-custom" value="${state.webLLMIsCustom ? state.webLLMModelId : ''}" placeholder="e.g., Mistral-7B-Instruct-v0.3-q4f16_1-MLC" style="width:100%;padding:6px 8px;border:1px solid var(--color-border,#e5e7eb);border-radius:6px;font-size:12px;font-family:monospace;">
          <p style="margin:4px 0 0;font-size:10px;color:#94a3b8;">Enter any MLC WebLLM-compatible model ID. Find models at <a href="https://mlc.ai/web-llm/" target="_blank" style="color:#3b82f6;">mlc.ai/web-llm</a></p>
        </div>
        <p class="hint" style="margin-top:6px;padding:6px 8px;background:#fefce8;border-radius:6px;font-size:11px;color:#854d0e;border:1px solid #fde047;">
          <strong>💡 Trade-off:</strong> Larger models are smarter but use more GPU memory (VRAM) and generate text slower. 1B = snappy responses, 8B = thoughtful but slower. All run locally — no data leaves your browser.
        </p>
        <p class="hint">${state.webLLMEngine ? '✅ WebLLM model loaded and ready!' : 'Click "Load WebLLM Model" to download (one-time). Auto-cached afterwards.'}</p>
        
        ${(() => {
          const cachedIds = Object.keys(state.webLLMCachedModels);
          if (cachedIds.length === 0) return '';
          
          // Build model manager HTML
          let managerHtml = `
            <div style="margin-top:12px;padding:10px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                <span style="font-size:12px;font-weight:700;color:#166534;">📦 Downloaded Models (${cachedIds.length})</span>
                <span style="font-size:10px;color:#15803d;">Click to switch · 🗑️ to remove</span>
              </div>
              <div style="display:flex;flex-direction:column;gap:4px;">
          `;
          
          cachedIds.forEach(modelId => {
            const info = state.webLLMCachedModels[modelId];
            const isCurrent = modelId === state.webLLMModelId;
            const isLoaded = isCurrent && state.webLLMEngine;
            const cacheDate = info.cachedAt ? new Date(info.cachedAt).toLocaleDateString() : '?';
            
            managerHtml += `
              <div style="display:flex;align-items:center;gap:6px;padding:5px 8px;background:${isCurrent ? '#dcfce7' : '#fff'};border:1px solid ${isCurrent ? '#86efac' : '#e5e7eb'};border-radius:5px;font-size:11px;">
                <span style="flex:1;cursor:pointer;" data-switch-model="${modelId}" title="Click to switch to this model">
                  ${isLoaded ? '✅' : '📦'} ${info.label || getModelLabel(modelId)}
                  ${isCurrent ? '<strong>(active)</strong>' : ''}
                </span>
                <span style="color:#9ca3ab;font-size:9px;">${cacheDate}</span>
                <button data-delete-model="${modelId}" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:14px;padding:0 2px;line-height:1;" title="Remove from cache">🗑️</button>
              </div>
            `;
          });
          
          managerHtml += `</div></div>`;
          return managerHtml;
        })()}

        <h3>Cloud LLM (fallback)</h3>
        <div class="row"><span class="label">Endpoint</span></div>
        <input type="text" id="ok-cloud-endpoint" value="${state.cloudLLM?.endpoint || ''}" placeholder="https://api.openai.com/v1/chat/completions">
        <div class="row" style="margin-top:8px"><span class="label">API key</span></div>
        <input type="password" id="ok-cloud-key" value="${state.cloudLLM?.apiKey || ''}" placeholder="sk-...">
        <div class="row" style="margin-top:8px"><span class="label">Model</span></div>
        <input type="text" id="ok-cloud-model" value="${state.cloudLLM?.model || ''}" placeholder="gpt-4o">

        <h3>Sync</h3>
        <div class="row"><span class="label">Online status</span><span class="value">${status.online ? 'Online' : 'Offline'}</span></div>
        <div class="row"><span class="label">Queued ops</span><span class="value">${status.queueLength}</span></div>

        <div class="footer">
          <button id="ok-cancel">Cancel</button>
          <button class="primary" id="ok-save">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('.close').addEventListener('click', closeModal);
    modal.querySelector('#ok-cancel').addEventListener('click', closeModal);
    modal.querySelector('#ok-connect-folder').addEventListener('click', async () => {
      if (status.filesystem) { disconnectFolder(); }
      else { await connectFolder(); }
      closeModal(); openSettings();
    });
    modal.querySelector('#ok-probe-ollama').addEventListener('click', async () => {
      state.ollamaEndpoint = modal.querySelector('#ok-ollama-url').value.replace(/\/$/, '');
      await probeOllama();
      closeModal(); openSettings();
    });

    // Load WebLLM Model button handler
    const loadBtn = modal.querySelector('#ok-load-webllm');
    if (loadBtn) {
      // Update button state based on current loading status
      if (state.webLLMLoading && !state.webLLMEngine) {
        loadBtn.disabled = true;
        loadBtn.textContent = `${state.webLLMProgress.toFixed(0)}%...`;
      } else if (state.webLLMEngine) {
        loadBtn.textContent = '✓ Loaded';
        loadBtn.style.background = '#22c55e';
        loadBtn.style.color = '#fff';
      }

      loadBtn.addEventListener('click', async () => {
        if (state.webLLMEngine) return; // Already loaded
        if (state.webLLMLoading) return; // Already loading - just reopen to see progress
        
        // Get model ID early for pre-flight checks
        const targetModelId = modal.querySelector('#ok-webllm-model').value || state.webLLMModelId;
        
        // Reset progress state
        state.webLLMProgress = 0;
        state.webLLMProgressText = 'Initializing...';
        state.webLLMUsingCache = false; // Will be set to true if cache detected
        state.webLLMLoadError = null; // Clear any previous error
        // Reset speed tracking for new download
        state.webLLMSpeed = 0;
        state.webLLMLastProgressTime = 0;
        state.webLLMLastProgress = 0;
        // Reset retry tracking for new attempt (keep count if user manually retries)
        state.webLLMLastGoodProgress = 0;
        state.webLLMStartTime = performance.now();
        
        // Set loading promise so badge knows download is active
        state.webLLMLoading = (async () => {
          try {
            // ============================================
            // PRE-FLIGHT PHASE 1: Auto-detect & clean partial downloads
            // This runs FIRST — before post-nuclear or health checks.
            // It detects stale/crashed downloads from previous sessions
            // and auto-cleans them, preventing CacheStorage errors.
            // ============================================
            log(`🔍 Running pre-flight detection for: ${targetModelId}`);
            state.webLLMProgressText = 'Checking for partial downloads...';
            
            // Sync pre-flight status to modal
            const preflightModal = document.getElementById('offline-kit-modal');
            if (preflightModal) {
              const speedEl = preflightModal.querySelector('#ok-webllm-speed');
              if (speedEl) {
                speedEl.textContent = '🔍 Pre-flight check...';
                speedEl.style.color = '#92400e';
              }
              const pct = preflightModal.querySelector('#ok-webllm-pct');
              if (pct) pct.textContent = '...';
            }
            renderBadge();
            
            const preflightResult = await detectAndCleanPartialDownload(targetModelId);
            
            if (preflightResult.cleaned) {
              log(`✅ Pre-flight auto-cleaned: ${preflightResult.reason}`);
              
              // Show brief "cleaned" message before proceeding
              state.webLLMProgressText = `Cleaned partial download...`;
              
              if (preflightModal) {
                const speedEl2 = preflightModal.querySelector('#ok-webllm-speed');
                if (speedEl2) {
                  speedEl2.textContent = '🧹 Cleaned partial data — starting fresh';
                  speedEl2.style.color = '#166534';
                }
              }
              renderBadge();
              
              // Brief pause so user sees the cleanup happened
              await new Promise(r => setTimeout(r, 800));
            }
            
            // ============================================
            // PRE-FLIGHT PHASE 1.5: Storage Quota Check
            // Catches "Storage full" errors BEFORE starting download
            // ============================================
            log(`💾 Checking storage quota for ${targetModelId}...`);
            state.webLLMProgressText = 'Checking storage space...';
            
            if (preflightModal) {
              const speedEl3 = preflightModal.querySelector('#ok-webllm-speed');
              if (speedEl3) {
                speedEl3.textContent = '💾 Checking storage...';
                speedEl3.style.color = '#1e40af';
              }
            }
            renderBadge();
            
            const storageCheck = await checkStorageQuota(targetModelId);
            
            if (!storageCheck.ok) {
              log('❌ Storage quota check FAILED:', storageCheck.error);
              
              // Build detailed error message with browser-specific instructions
              const storageErrorMsg = `📦 **Not enough storage space**\n\n` +
                `**Required:** ~${storageCheck.needed} (model + working space)\n` +
                `**Available:** ~${storageCheck.available}\n\n` +
                getStorageHelpInstructions(storageCheck.browser, storageCheck.needed, storageCheck.available);
              
              // Show error and stop
              state.webLLMLoadError = storageErrorMsg;
              state.webLLMProgress = 0;
              state.webLLMProgressText = '';
              renderBadge();
              
              const storageModal = document.getElementById('offline-kit-modal');
              if (storageModal) {
                const btn = storageModal.querySelector('#ok-load-webllm');
                const progressEl = storageModal.querySelector('#ok-webllm-progress');
                const errorEl = storageModal.querySelector('#ok-webllm-error');
                const errorMsgEl = storageModal.querySelector('#ok-webllm-error-msg');
                
                if (btn) {
                  btn.disabled = false;
                  btn.textContent = 'Load WebLLM Model';
                  btn.style.background = '';
                }
                if (progressEl) progressEl.style.display = 'none';
                if (errorEl) {
                  errorEl.style.display = 'block';
                  if (errorMsgEl) errorMsgEl.textContent = storageErrorMsg;
                }
                
                // Show a special "Free Space" help section for storage errors
                const nuclearOpt = storageModal.querySelector('#ok-nuclear-option');
                if (nuclearOpt) {
                  nuclearOpt.style.display = 'block';
                  // Update nuclear button text for this context
                  const nuclearBtn = nuclearOpt.querySelector('#ok-nuclear-clear');
                  if (nuclearBtn) {
                    nuclearBtn.textContent = '🧹 Clear Browser Cache (frees space)';
                    nuclearBtn.title = 'Clear cached data to free up storage for the model';
                  }
                  
                  // Also show deep clean option immediately for storage issues
                  const deepCleanOpt = storageModal.querySelector('#ok-deep-clean-option');
                  if (deepCleanOpt) deepCleanOpt.style.display = 'block';
                }
              }
              
              return; // Don't attempt to load WebLLM
            } else {
              log(`✅ Storage OK: ~${storageCheck.available} available for ~${storageCheck.needed} model`);
            }
            
            // ============================================
            // PRE-FLIGHT PHASE 2: Post-nuclear recovery mode (if applicable)
            // Only runs if we just did a nuclear clear in the last 2 minutes
            // ============================================
            const postNuclear = getPostNuclearState();
            const isPostNuclear = postNuclear && (Date.now() - postNuclear.time) < 120000; // Within 2 minutes
            
            if (isPostNuclear) {
              log(`Post-nuclear recovery mode (attempt #${postNuclear.attempt + 1}) — running CacheStorage health check...`);
              state.webLLMProgressText = 'Checking cache integrity...';
              
              // Sync to modal
              const curModal = document.getElementById('offline-kit-modal');
              if (curModal) {
                const speedEl = curModal.querySelector('#ok-webllm-speed');
                if (speedEl) {
                  speedEl.textContent = '🔍 Checking storage health...';
                  speedEl.style.color = '#92400e';
                }
                const pct = curModal.querySelector('#ok-webllm-pct');
                if (pct) pct.textContent = '...';
              }
              renderBadge();
              
              // Run health check
              const health = await checkCacheStorageHealth();
              
              if (!health.healthy) {
                log('CacheStorage still corrupted after nuclear clear:', health.error);
                
                // Determine error message based on attempt count and whether user tried manual clear
                const attemptNum = (postNuclear.attempt || 0) + 1;
                const triedManual = postNuclear.triedManualClear || false;
                let errorMsg;
                
                if (triedManual) {
                  // User already tried Chrome settings clear — show browser-level recovery
                  errorMsg = `🔴 CacheStorage corruption persists after ${attemptNum} attempts (including manual clear).\n\n` +
                    `This is a deep browser-level issue. Try these steps IN ORDER:\n\n` +
                    `1️⃣ RESTART BROWSER (most likely fix)\n` +
                    `   • Close ALL Chrome windows completely\n` +
                    `   • Reopen Chrome and come back here\n\n` +
                    `2️⃣ TRY INCOGNITO MODE\n` +
                    `   • Press Ctrl+Shift+N (or ⌘+Shift+N on Mac)\n` +
                    `   • Paste this URL and try loading WebLLM\n` +
                    `   • Incognito has fresh storage — might work!\n\n` +
                    `3️⃣ TRY EDGE BROWSER\n` +
                    `   • Edge uses different storage backend than Chrome\n` +
                    `   • Same URL, different result possible\n\n` +
                    `4️⃣ CLEAR CHROME PROFILE CACHE (advanced)\n` +
                    `   • Close Chrome entirely\n` +
                    `   • Delete: %LOCALAPPDATA%\\Google\\Chrome\\User Data\\Default\\Cache\n` +
                    `   • (Or ~/Library/Caches/Google/Chrome on Mac)\n\n` +
                    `Error details: ${health.error}`;
                } else if (attemptNum >= 2) {
                  // Haven't tried manual yet, show manual instructions
                  errorMsg = `🔴 CacheStorage is STILL corrupted after ${attemptNum} cleanup attempts.\n\n` +
                    `This is a browser-level issue that JavaScript cannot fully fix.\n\n` +
                    `📋 NEXT STEP — Manual Clear:\n` +
                    `1. Copy this site's URL from the address bar\n` +
                    `2. Open: chrome://settings/content/all\n` +
                    `3. Search for "sandboxinit"\n` +
                    `4. Click "Clear data" → Confirm\n` +
                    `5. Come back and click "I did the manual clear" below\n\n` +
                    `Error: ${health.error}`;
                } else {
                  errorMsg = `⚠️ CacheStorage still damaged after cleanup.\n\n` +
                    `The browser's internal cache database for this site is corrupted.\n` +
                    `You can try "🧹 Reset WebLLM Cache" again.\n\n` +
                    `Error: ${health.error}`;
                }
                
                // Update attempt counter (preserve triedManual flag)
                setPostNuclearState(attemptNum, triedManual);
                
                // Show error with special UI
                state.webLLMLoadError = errorMsg;
                state.webLLMProgress = 0;
                renderBadge();
                
                const curModal2 = document.getElementById('offline-kit-modal');
                if (curModal2) {
                  const btn = curModal2.querySelector('#ok-load-webllm');
                  const progressEl = curModal2.querySelector('#ok-webllm-progress');
                  const errorEl = curModal2.querySelector('#ok-webllm-error');
                  const errorMsgEl = curModal2.querySelector('#ok-webllm-error-msg');
                  
                  if (btn) {
                    btn.disabled = false;
                    btn.textContent = 'Load WebLLM Model';
                    btn.style.background = '';
                  }
                  if (progressEl) progressEl.style.display = 'none';
                  if (errorEl) {
                    errorEl.style.display = 'block';
                    if (errorMsgEl) errorMsgEl.textContent = errorMsg;
                    
                    // Show nuclear option
                    const nuclearOpt = curModal2.querySelector('#ok-nuclear-option');
                    if (nuclearOpt) {
                      nuclearOpt.style.display = 'block';
                      
                      // Show Deep Clean option after 2+ attempts
                      const deepCleanOpt = curModal2.querySelector('#ok-deep-clean-option');
                      if (deepCleanOpt) {
                        deepCleanOpt.style.display = attemptNum >= 2 ? 'block' : 'none';
                        
                        // Show Manual Fix option after deep clean (attemptNum >= 10)
                        const manualFixOpt = curModal2.querySelector('#ok-manual-fix-option');
                        if (manualFixOpt) {
                          manualFixOpt.style.display = attemptNum >= 10 ? 'block' : 'none';
                        }
                      }
                    }
                  }
                }
                
                return; // Don't attempt to load WebLLM
              } else {
                log('CacheStorage health check PASSED after nuclear clear! Proceeding with load.');
                clearPostNuclearState(); // Recovery successful - clear flag
                // Brief success message then continue
                state.webLLMProgressText = 'Cache OK — loading model...';
              }
            }
            
            state.webLLMModelId = targetModelId; // Use the pre-flight resolved model ID
            
            // === Set downloading flag for crash detection ===
            setDownloadingFlag(targetModelId);
            
            // Import and load WebLLM with progress tracking in state
            const webllm = await import('https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.9/+esm');
            state.webLLMProgressText = 'Initializing...';
            
            // Detect if this might be a cache load (model loaded before)
            const wasCached = state.webLLMCached;
            let detectedCache = false;
            
            const engine = await webllm.CreateMLCEngine(
              state.webLLMModelId,
              {
                initProgressCallback: (p) => {
                  // Store progress in STATE (persists even when modal is closed)
                  const now = performance.now();
                  const newProgress = p.progress * 100;
                  state.webLLMProgress = newProgress;
                  state.webLLMProgressText = p.text || 'Loading...';
                  
                  // === CALCULATE DOWNLOAD SPEED ===
                  const modelSizeBytes = getModelSize(state.webLLMModelId);
                  if (state.webLLMLastProgressTime > 0 && newProgress > state.webLLMLastProgress) {
                    const timeDeltaSec = (now - state.webLLMLastProgressTime) / 1000;
                    const progressDelta = newProgress - state.webLLMLastProgress; // in percent
                    const bytesDownloaded = (progressDelta / 100) * modelSizeBytes;
                    if (timeDeltaSec > 0.05) { // Ignore sub-50ms intervals (too noisy)
                      const instantSpeed = bytesDownloaded / timeDeltaSec;
                      // Smooth with exponential moving average (alpha=0.3)
                      state.webLLMSpeed = state.webLLMSpeed > 0 
                        ? 0.3 * instantSpeed + 0.7 * state.webLLMSpeed 
                        : instantSpeed;
                    }
                  }
                  // Update tracking vars for next callback
                  state.webLLMLastProgressTime = now;
                  state.webLLMLastProgress = newProgress;
                  
                  // Track last known GOOD progress (for retry recovery messages)
                  if (newProgress > state.webLLMLastGoodProgress) {
                    state.webLLMLastGoodProgress = newProgress;
                  }
                  
                  // Detect REAL cache usage (model fully downloaded before)
                  // Only flag as cache if:
                  //  1. Text explicitly says "from cache" / "restored from" (not just mentioning cache)
                  //  2. AND progress is moving extremely fast (> 80% in under 3 seconds = instant load)
                  const text = (p.text || '').toLowerCase();
                  const isExplicitCacheText = text.includes('from cache') || text.includes('restored from') || 
                    text.includes('loaded from') || (text.includes('cache') && text.includes('hit'));
                  
                  // Calculate time elapsed since download started
                  const elapsedSec = state.webLLMLastProgressTime > 0 
                    ? (now - (state.webLLMStartTime || now)) / 1000 
                    : 0;
                  
                  // Only mark as cache if: explicit text OR insanely fast progress on previously-cached model
                  if (isExplicitCacheText) {
                    detectedCache = true;
                    state.webLLMUsingCache = true;
                  } else if (wasCached && elapsedSec < 5 && state.webLLMProgress > 80 && !detectedCache) {
                    // 80%+ in under 5 seconds on a previously-loaded model = almost certainly cache
                    state.webLLMUsingCache = true;
                    detectedCache = true;
                  }
                  
                  log(`WebLLM: ${state.webLLMProgress.toFixed(1)}% — ${state.webLLMProgressText} @ ${formatSpeed(state.webLLMSpeed)}${state.webLLMUsingCache ? ' [CACHE]' : ''}`);
                  
                  // Sync to WHATEVER modal is currently open (if any)
                  const curModal = document.getElementById('offline-kit-modal');
                  if (curModal) {
                    const pct = curModal.querySelector('#ok-webllm-pct');
                    const bar = curModal.querySelector('#ok-webllm-bar');
                    const btn = curModal.querySelector('#ok-load-webllm');
                    const speedEl = curModal.querySelector('#ok-webllm-speed');
                    const cacheBadge = curModal.querySelector('#ok-webllm-progress .cache-badge');
                    if (pct) pct.textContent = `${state.webLLMProgress.toFixed(0)}%`;
                    if (bar) bar.style.width = `${state.webLLMProgress}%`;
                    if (btn && !state.webLLMEngine) btn.textContent = `${state.webLLMProgress.toFixed(0)}%...`;
                    // Update speed display — ALWAYS show speed, add cache badge if applicable
                    if (speedEl) {
                      if (state.webLLMSpeed > 0) {
                        // Show speed with optional cache indicator
                        const cacheTag = state.webLLMUsingCache ? ' 📦' : '';
                        speedEl.textContent = '⚡ ' + formatSpeed(state.webLLMSpeed) + cacheTag;
                        speedEl.style.color = state.webLLMUsingCache ? '#1e40af' : '#4d7c0f';
                      } else if (state.webLLMUsingCache) {
                        speedEl.textContent = '📦 From cache';
                        speedEl.style.color = '#1e40af';
                      } else if (state.webLLMProgress > 0) {
                        speedEl.textContent = '⏳ Measuring...';
                        speedEl.style.color = '#92400e';
                      } else {
                        speedEl.textContent = 'Connecting...';
                        speedEl.style.color = '#92400e';
                      }
                    }
                    // Show/hide CACHED badge dynamically
                    if (state.webLLMUsingCache && !cacheBadge) {
                      const badgeSpan = document.createElement('span');
                      badgeSpan.className = 'cache-badge';
                      badgeSpan.style.cssText = 'font-size:10px;background:#dbeafe;color:#1e40af;padding:1px 5px;border-radius:4px;';
                      badgeSpan.textContent = 'CACHED';
                      const flexDiv = curModal.querySelector('#ok-webllm-progress > div');
                      if (flexDiv) flexDiv.appendChild(badgeSpan);
                    }
                  }
                  
                  // ALWAYS update badge to show live progress
                  renderBadge();
                },
                // === CACHE BACKEND CONFIGURATION ===
                // Switch from default "cache" (CacheStorage API) to avoid Opera compatibility issues
                // Options: "cache" | "indexeddb" | "opfs" | "cross-origin"
                // - "cache": Default, but fails in Opera with Cache.add() errors
                // - "indexeddb": More reliable storage, higher quota limits
                // - "opfs": Origin Private File System, good for large files
                // - "cross-origin": Requires Chrome extension
                ...(state.webLLMCacheBackend ? { 
                  appConfig: { cacheBackend: state.webLLMCacheBackend } 
                } : {})
              }
            );
            state.webLLMEngine = engine;
            state.webLLMProgress = 100;
            state.webLLMProgressText = 'Complete!';
            
            // === Reset retry state on success ===
            state.webLLMRetryCount = 0;
            state.webLLMLastGoodProgress = 0;
            state.webLLMLastRetryTime = 0; // Reset retry timer
            
            // === Clear downloading flag — download completed successfully! ===
            clearDownloadingFlag();
            
            // Mark THIS model as cached (supports multiple models)
            state.webLLMCached = true;
            const modelLabel = getModelLabel(state.webLLMModelId);
            state.webLLMCachedModels[state.webLLMModelId] = {
              cachedAt: Date.now(),
              label: modelLabel,
              isCustom: state.webLLMIsCustom
            };
            saveCachedModels();
            localStorage.setItem('offlinekit:webllm-cached', state.webLLMModelId);
            notifyStatusChange();
            renderBadge();
            
            // Update UI in currently open modal (if any)
            const curModal = document.getElementById('offline-kit-modal');
            if (curModal) {
              const btn = curModal.querySelector('#ok-load-webllm');
              const progressEl = curModal.querySelector('#ok-webllm-progress');
              if (btn) {
                btn.textContent = '✓ Loaded';
                btn.style.background = '#22c55e';
                btn.style.color = '#fff';
              }
              if (progressEl) progressEl.style.display = 'none';
              
              // Update hint text
              const hints = curModal.querySelectorAll('.hint');
              hints.forEach(hint => {
                if (hint.textContent.includes('Click') || hint.textContent.includes('Load')) {
                  hint.textContent = '✅ WebLLM model loaded and ready!';
                  hint.style.color = '#166534';
                }
              });
            }
          } catch (e) {
            err('WebLLM load failed:', e);
            err('Full error details:', JSON.stringify({
              name: e.name,
              message: e.message,
              stack: e.stack?.substring(0, 500),
              cause: e.cause?.message || e.cause
            }));
            
            // === Clear downloading flag — download ended (success or failure) ===
            clearDownloadingFlag();
            
            // Determine if this is a TRANSIENT error (network/abort) that should auto-retry
            const msg = (e.message || '').toLowerCase();
            const isTransientError = (msg.includes('network') || msg.includes('fetch') || 
                    msg.includes('aborted') || msg.includes('cancel') ||
                    msg.includes('timeout') || msg.includes('socket') ||
                    msg.includes('connection') || msg.includes('reset')) &&
                   !msg.includes('cachestorage');
            
            // Log what type of error we think it is
            log(`Error classification: transient=${isTransientError}, name=${e.name}, msg_preview="${msg.substring(0, 80)}"`);
            
            // === DOWNLOAD HEALTH ANALYSIS ===
            // Before deciding to retry, analyze if the download was actually healthy
            const hadGoodProgress = state.webLLMLastGoodProgress > 3; // Made it past initial phase
            
            // Speed check: handle NaN/undefined/empty values
            const currentSpeed = (typeof state.webLLMSpeed === 'number' && !isNaN(state.webLLMSpeed)) 
              ? state.webLLMSpeed : 0;
            const hadGoodSpeed = currentSpeed > 0.5 * 1024 * 1024; // > 0.5 MB/s
            const downloadWasHealthy = hadGoodProgress && hadGoodSpeed;
            
            // Elapsed time: use proper bounds checking
            let timeSinceStart = 0;
            if (state.webLLMStartTime > 0) {
              const rawElapsed = (Date.now() - state.webLLMStartTime) / 1000;
              // Sanity check: elapsed should be positive and reasonable (< 1 hour)
              timeSinceStart = (rawElapsed > 0 && rawElapsed < 3600) ? rawElapsed : 0;
            }
            
            log(`Download health: progress=${state.webLLMLastGoodProgress}%, speed=${formatSpeed(currentSpeed)}, healthy=${downloadWasHealthy}, elapsed=${timeSinceStart.toFixed(1)}s`);
            
            // === DETECT CACHE-SPECIFIC ERRORS (Opera + HF CDN issue) ===
            // This is NOT a transient network error — it's a CacheStorage write failure
            // Pattern: "Cache.add() encountered a network error" with HTTP 200 OK responses
            const isCacheAddError = msg.includes("cache.add") || 
                                   msg.includes("execute 'add' on 'cache'") ||
                                   (msg.includes('cache') && msg.includes('network error') && e.name === 'NetworkError');
            
            if (isCacheAddError) {
              log(`🔴 Detected CacheStorage write failure (NOT a real network error!)`);
              log(`This is likely an Opera browser + HuggingFace CDN compatibility issue`);
            }
            
            // Reclassify: Cache.add errors are NOT transient (retrying won't help)
            // BUT: User reported manual retries DO make progress (11% → 23%)
            // So we allow auto-retry but with longer backoff and clear explanation
            const actualTransientError = isTransientError || isCacheAddError;
            
            // === AUTO-RETRY LOGIC for transient errors ===
            // Only auto-retry if:
            // 1. It's a REAL transient error (not Cache.add failure)
            // 2. We haven't exhausted retries
            // 3. Either: download was healthy (worth retrying) OR first attempt (give it a chance)
            // 4. Last retry was at least 10 seconds ago (prevent rapid-fire death spiral)
            const now = Date.now();
            const lastRetryTime = state.webLLMLastRetryTime || 0;
            const timeSinceLastRetry = now - lastRetryTime;
            const minRetryGap = 10000; // Minimum 10 seconds between retries
            
            const shouldAutoRetry = actualTransientError && 
              state.webLLMRetryCount < state.webLLMMaxRetries &&
              (downloadWasHealthy || state.webLLMRetryCount === 0) &&
              (timeSinceLastRetry >= minRetryGap || lastRetryTime === 0);
            
            log(`Retry decision: should=${shouldAutoRetry}, count=${state.webLLMRetryCount}/${state.webLLMMaxRetries}, sinceLastRetry=${timeSinceLastRetry}ms, isCacheAdd=${isCacheAddError}`);
            
            if (!shouldAutoRetry && isTransientError && state.webLLMRetryCount < state.webLLMMaxRetries) {
              // We're NOT retrying even though it's transient - explain why
              const reason = timeSinceLastRetry < minRetryGap 
                ? `⏳ Too soon to retry (${(timeSinceLastRetry/1000).toFixed(1)}s ago, need ${minRetryGap/1000}s gap)`
                : `📉 Download wasn't healthy enough to warrant auto-retry`;
              log(`Skipping auto-retry: ${reason}`);
            }
            
            if (shouldAutoRetry) {
              state.webLLMRetryCount++;
              const retryNum = state.webLLMRetryCount;
              const maxRetries = state.webLLMMaxRetries;
              const lastPct = Math.round(state.webLLMLastGoodProgress);
              const speed = formatSpeed(state.webLLMSpeed);
              
              // Progressive backoff: 5s, 15s, 30s (longer for healthy downloads that failed)
              let backoffDelay;
              if (downloadWasHealthy) {
                // Download was working well - give more time for network to stabilize
                backoffDelay = Math.min(5000 * retryNum, 30000); // 5s, 10s, 15s... max 30s
              } else {
                // Download never really started - shorter backoff
                backoffDelay = Math.min(3000 * retryNum, 15000); // 3s, 6s, 9s... max 15s
              }
              
              // Record when we're scheduling this retry
              state.webLLMLastRetryTime = Date.now();
              
              log(`🔄 Auto-retry ${retryNum}/${maxRetries} in ${backoffDelay}ms (was at ${lastPct}%, ${speed}, healthy=${downloadWasHealthy})`);
              
              // Show retry status to user
              state.webLLMLoadError = `🔄 Network blip detected... Auto-retry ${retryNum}/${maxRetries}\n\n` +
                `Download was at **${lastPct}%** (${speed}) — connection dropped.\n` +
                `Retrying in ${backoffDelay / 1000}s...\n\n` +
                `(If this keeps failing, try "🗑️ Clear Cache & Retry" below)`;
              state.webLLMProgress = lastPct; // Keep showing last progress
              renderBadge();
              
              // Update modal if open
              const retryModal = document.getElementById('offline-kit-modal');
              if (retryModal) {
                const errorMsgEl = retryModal.querySelector('#ok-webllm-error-msg');
                const errorEl = retryModal.querySelector('#ok-webllm-error');
                if (errorEl) errorEl.style.display = 'block';
                if (errorMsgEl) errorMsgEl.textContent = state.webLLMLoadError;
                
                // Show countdown in button text
                const btn = retryModal.querySelector('#ok-load-webllm');
                if (btn) {
                  const origText = btn.textContent;
                  btn.disabled = true;
                  let countdown = backoffDelay / 1000;
                  const countdownInterval = setInterval(() => {
                    countdown--;
                    if (countdown > 0 && btn.disabled) {
                      btn.textContent = `🔄 Retry ${countdown}s`;
                    } else {
                      clearInterval(countdownInterval);
                      if (btn) btn.textContent = origText;
                    }
                  }, 1000);
                }
              }
              
              // Wait then retry automatically
              await new Promise(r => setTimeout(r, backoffDelay));
              
              log(`🔄 Executing auto-retry #${retryNum}`);
              
              // Clear error state BEFORE scheduling retry
              state.webLLMLoadError = null;
              
              // Show user we're about to retry
              state.webLLMProgressText = `🔄 Auto-retry ${retryNum}/${state.webLLMMaxRetries}...`;
              renderBadge();
              
              // CRITICAL: Use setTimeout(0) to escape the current promise chain!
              // Without this, we're still inside the catch→finally flow of the
              // FAILED promise, which interferes with creating a NEW promise.
              // setTimeout ensures:
              // 1. Current catch/finally fully completes first
              // 2. Retry runs in a completely clean execution context
              // 3. No deadlock between old promise cleanup and new promise creation
              const retryModelId = state.webLLMModelId; // Capture current model
              setTimeout(() => {
                log(`🔄 Auto-retry #${retryNum} executing in clean context`);
                
                // Reset loading state (now safe - no more pending promises)
                state.webLLMLoading = null;
                state.webLLMAutoRetrying = false; // Reset flag
                
                // Clear any stuck button state
                const m = document.getElementById('offline-kit-modal');
                if (m) {
                  const b = m.querySelector('#ok-load-webllm');
                  if (b) {
                    b.disabled = false;
                    b.textContent = 'Load WebLLM Model';
                    b.style.background = '';
                  }
                }
                
                // Now trigger the load in a pristine context
                if (m && !state.webLLMEngine) {
                  const tb = m.querySelector('#ok-load-webllm');
                  if (tb) tb.click();
                }
              }, 0);
              
              return; // Exit catch block — let finally run, then setTimeout fires
            }
            
            // === If we exhausted retries OR it's not a transient error ===
            
            // Extract user-friendly error message
            let errorMsg = 'Download failed';
            let needsNuclearOption = false; // Flag for "Clear All Site Data" button
            let hideStandardRetry = false; // Hide retry buttons for corruption errors
            
            // Include progress context if we had some
            const hadProgress = state.webLLMLastGoodProgress > 5;
            const progressContext = hadProgress 
              ? `\n\n📊 Download was at **${Math.round(state.webLLMLastGoodProgress)}%** (${formatSpeed(state.webLLMSpeed)}) before failure.\n` +
                `WebLLM should resume from where it left off on retry.`
              : '';
            
            if (e.message) {
              const msg = e.message.toLowerCase();
              if (msg.includes('gpu') || msg.includes('webgpu')) {
                errorMsg = 'WebGPU error: Your GPU may not be supported. Try Chrome/Edge 113+.';
              } else if (isCacheAddError) {
                // === CACHE.ADD FAILURE (Opera + HF CDN Specific Issue) ===
                // The download SUCCEEDS (HTTP 200 OK) but Opera's CacheStorage can't save it
                // This is NOT fixable by retrying — it's a browser/CDN incompatibility
                
                const isOpera = navigator.userAgent.includes('OPR') || navigator.userAgent.includes('Opera');
                const browserName = isOpera ? 'Opera' : 'your browser';
                
                errorMsg = `🔴 **CacheStorage Write Failure**\n\n` +
                  `The model downloaded successfully from HuggingFace's CDN, but **${browserName}'s CacheStorage** ` +
                  `couldn't save the file.\n\n` +
                  `**Technical details:**\n` +
                  `• Error: \`${e.message.substring(0, 100)}\`\n` +
                  `• HTTP status: 200 OK (download worked)\n` +
                  `• Failure point: \`Cache.add()\` (saving to browser cache)\n` +
                  `• Progress when failed: ~${Math.round(state.webLLMLastGoodProgress)}%\n\n` +
                  `**This is a known issue with:**\n` +
                  `${isOpera ? '1️⃣ Opera browser + HuggingFace CDN (CacheStorage limits)\n' : ''}` +
                  `2️⃣ Large file writes to browser cache (~500MB+ model)\n` +
                  `3️⃣ CORS or storage policy restrictions\n\n` +
                  `💡 **Solutions (try IN ORDER):**\n\n` +
                  `**Option 1: Try Chrome or Edge** ⭐ Best chance\n` +
                  `• Chrome/Edge have more robust CacheStorage implementation\n` +
                  `• Same URL, different browser = often works!\n\n` +
                  `**Option 2: Incognito Mode** 🔒 Fresh storage\n` +
                  `• Press Ctrl+Shift+N (or ⌘+Shift+N on Mac)\n` +
                  `• Paste this URL and try loading WebLLM\n` +
                  `• Incognito has empty CacheStorage — might work!\n\n` +
                  `**Option 3: Clear ALL Browser Data** 🧹 Nuclear option\n` +
                  `• Go to ${isOpera ? 'opera://settings/clearBrowserData' : 'chrome://settings/clearBrowserData'}\n` +
                  `• Time range: **All time**\n` +
                  `• ✓ Check "Cached images and files"\n` +
                  `• ✓ Check "Cookies and other site data"\n` +
                  `• ✅ UNCHECK "Passwords" and "History"!\n` +
                  `• Clear data → Restart browser → Try again`;
                  
                needsNuclearOption = true;
                hideStandardRetry = false; // Keep retry buttons visible (user might try anyway)
                
              } else if (msg.includes('network') || msg.includes('fetch') && !msg.includes('cachestorage')) {
                const retryInfo = state.webLLMRetryCount > 0 
                  ? `\n\n⚠️ Already retried ${state.webLLMRetryCount} time(s).` 
                  : '';
                
                // If we keep failing at similar progress points, it's NOT a network issue
                const isConsistentFailure = state.webLLMLastGoodProgress > 0 && 
                  state.webLLMLastGoodProgress < 15; // Always fails early (<15%)
                
                if (isConsistentFailure && state.webLLMRetryCount >= 2) {
                  errorMsg = `🔴 **Consistent early failure detected** (always fails at ~${Math.round(state.webLLMLastGoodProgress)}%)${progressContext}${retryInfo}\n\n` +
                    `Your internet works fine — this is likely:\n\n` +
                    `1️⃣ **Browser storage quota** (Opera may limit downloads)\n` +
                    `2️⃣ **WebGPU context crash** during model init\n` +
                    `3️⃣ **HuggingFace Space CDN** issue with large files\n\n` +
                    `💡 **Try these IN ORDER:**\n` +
                    `• "🗑️ Clear Cache & Retry" (frees space)\n` +
                    `• Switch to **Llama 3.2 1B** (smallest, ~500MB)\n` +
                    `• Try in **Chrome/Edge** instead of Opera\n` +
                    `• Try **Incognito mode** (fresh storage)`;
                } else {
                  errorMsg = `🌐 Network error: Connection interrupted during download.${progressContext}${retryInfo}\n\n` +
                    `• Check your internet connection\n` +
                    `• Try "🔄 Retry Download" (WebLLM may resume)\n` +
                    `• Or "🗑️ Clear Cache & Retry" for fresh start`;
                }
              } else if (msg.includes('quota') || (msg.includes('storage') && msg.includes('space') && !msg.includes('cache')) || msg.includes('disk full')) {
                // Detect browser for tailored instructions
                const isOpera = navigator.userAgent.includes('OPR') || navigator.userAgent.includes('Opera');
                const isEdge = navigator.userAgent.includes('Edg');
                const isFirefox = navigator.userAgent.includes('Firefox');
                let browser = 'chrome';
                if (isOpera) browser = 'opera';
                else if (isEdge) browser = 'edge';
                else if (isFirefox) browser = 'firefox';
                
                const modelSize = getModelSize(state.webLLMModelId);
                const sizeMB = Math.ceil(modelSize / (1024 * 1024));
                const sizeStr = sizeMB >= 1024 ? `${(sizeMB / 1024).toFixed(1)} GB` : `${sizeMB} MB`;
                
                errorMsg = `📦 **Storage Full** — Browser ran out of space while downloading.\n\n` +
                  `**Model needs:** ~${sizeStr}\n\n` +
                  getStorageHelpInstructions(browser, sizeStr, 'unknown');
                needsNuclearOption = true; // Show cache clear button
              } else if (msg.includes('aborted') || msg.includes('cancel')) {
                errorMsg = 'Download was interrupted.';
              } else if (msg.includes('cachestorage') || 
                         (msg.includes('cache') && (msg.includes('internal error') || msg.includes('unexpected'))) ||
                         (msg.includes('open') && msg.includes('cachestorage'))) {
                // This is the specific CacheStorage corruption error!
                errorMsg = '⚠️ WebLLM\'s browser cache is corrupted.\n\nUse "🧹 Nuclear Clear" below — it only resets the WebLLM model cache, your projects and settings are safe.';
                needsNuclearOption = true;
                hideStandardRetry = true;
                // Set post-nuclear flag so NEXT attempt will run health check first
                setPostNuclearState(0);
              } else if (msg.includes('invalidstateerror') || msg.includes('state had changed')) {
                errorMsg = '⚠️ WebLLM file storage corrupted. Use "🧹 Nuclear Clear" below to reset the model cache only (your data is safe).';
                needsNuclearOption = true;
                hideStandardRetry = true;
                // Set post-nuclear flag so NEXT attempt will run health check first
                setPostNuclearState(0);
              } else if (msg.includes("cannot read properties of undefined") && msg.includes("'find'")) {
                // This is the WebLLM appConfig initialization failure!
                // Root cause: esm.run CDN fails to resolve prebuiltAppConfig properly
                errorMsg = `🔧 **WebLLM Library Initialization Failed**

The WebLLM library loaded but its internal model configuration was missing. 
This is usually caused by:

• **CDN resolution issue** — the JavaScript module didn't fully initialize
• **Browser extension blocking** — an ad/privacy blocker may have interfered  
• **Network proxy/VPN** — corporate networks sometimes break ES module imports

**Solutions (try in order):**
1. **Hard refresh**: Ctrl+Shift+R (or Cmd+Shift+R on Mac)
2. **Disable ad blockers** for this site, then retry
3. **Try Incognito mode** — no extensions to interfere
4. **Check browser console** for blocked resource warnings`;
                hideStandardRetry = false; // Retry CAN work if it was a transient load issue
              } else {
                // For unknown errors, still show nuclear as fallback
                errorMsg = e.message.substring(0, 150);
                needsNuclearOption = true; // Show nuclear for any persistent error
              }
            }
            
            state.webLLMLoadError = errorMsg;
            state.webLLMProgress = 0;
            state.webLLMProgressText = '';
            state.webLLMSpeed = 0;
            renderBadge();
            
            // Update UI in currently open modal (if any)
            const curModal = document.getElementById('offline-kit-modal');
            if (curModal) {
              const btn = curModal.querySelector('#ok-load-webllm');
              const progressEl = curModal.querySelector('#ok-webllm-progress');
              const errorEl = curModal.querySelector('#ok-webllm-error');
              const errorMsgEl = curModal.querySelector('#ok-webllm-error-msg');
              const standardBtns = curModal.querySelector('#ok-error-buttons > div:first-child'); // The row with Retry/Clear&Retry
              
              if (btn) {
                btn.disabled = false;
                btn.textContent = 'Load WebLLM Model';
                btn.style.background = '';
              }
              if (progressEl) progressEl.style.display = 'none';
              // Show error panel with retry options
              if (errorEl) {
                errorEl.style.display = 'block';
                if (errorMsgEl) errorMsgEl.textContent = errorMsg;
              }
              // Show nuclear option for storage corruption / persistent errors
              const nuclearOpt = curModal.querySelector('#ok-nuclear-option');
              const isStorageError = errorMsg.includes('Storage') || errorMsg.includes('storage') || errorMsg.includes('📦');
              
              if (nuclearOpt) {
                nuclearOpt.style.display = needsNuclearOption ? 'block' : 'none';
                // Make nuclear button pulse/stand out when it's the only option
                const nuclearBtn = nuclearOpt.querySelector('#ok-nuclear-clear');
                if (nuclearBtn && hideStandardRetry) {
                  nuclearBtn.style.animation = 'pulse 1.5s ease-in-out infinite';
                  nuclearBtn.style.boxShadow = '0 0 20px rgba(127, 29, 29, 0.5)';
                }
                
                // For storage errors: show "Try Smaller Model" quick-action
                if (isStorageError) {
                  let smallerModelBtn = curModal.querySelector('#ok-try-smaller-model');
                  if (!smallerModelBtn) {
                    smallerModelBtn = document.createElement('button');
                    smallerModelBtn.id = 'ok-try-smaller-model';
                    smallerModelBtn.type = 'button';
                    smallerModelBtn.style.cssText = 'width:100%;margin-top:8px;padding:8px 10px;background:#1e40af;border:none;border-radius:6px;color:#fff;font-size:12px;font-weight:600;cursor:pointer;';
                    smallerModelBtn.textContent = '⚡ Try Llama 3.2 1B (smallest ~500MB)';
                    smallerModelBtn.addEventListener('click', () => {
                      // Switch to smallest model and retry
                      const modelSelect = curModal.querySelector('#ok-webllm-model');
                      if (modelSelect) {
                        modelSelect.value = 'Llama-3.2-1B-Instruct-q4f32_1-MLC';
                        state.webLLMModelId = 'Llama-3.2-1B-Instruct-q4f32_1-MLC';
                        localStorage.setItem('offlinekit:webllm-model', state.webLLMModelId);
                      }
                      // Clear error and retry
                      state.webLLMLoadError = null;
                      const loadBtn2 = curModal.querySelector('#ok-load-webllm');
                      if (loadBtn2 && !loadBtn2.disabled) loadBtn2.click();
                    });
                    nuclearOpt.appendChild(smallerModelBtn);
                  }
                  smallerModelBtn.style.display = 'block';
                }
              }
              // Hide standard retry buttons for corruption errors (they won't work anyway)
              if (standardBtns && hideStandardRetry) {
                standardBtns.style.display = 'none';
              }
            }
          } finally {
            // Always clear loading state when this promise chain ends
            // (auto-retry uses setTimeout, so it creates a NEW promise — safe to null here)
            state.webLLMLoading = null;
            state.webLLMAutoRetrying = false; // Reset flag
            // Safety: ensure flag is cleared no matter how the load ended
            clearDownloadingFlag();
          }
        })();
        
        // Start the download
        state.webLLMLoading.catch(err => err('WebLLM load error:', err));
        
        // Update initial button state
        const progressEl = document.getElementById('ok-webllm-progress');
        const errorEl = document.getElementById('ok-webllm-error');
        if (progressEl) progressEl.style.display = 'block';
        if (errorEl) errorEl.style.display = 'none'; // Hide any previous error
        loadBtn.disabled = true;
        loadBtn.textContent = 'Starting...';
        renderBadge(); // Badge now shows progress mode
      });
    }
    
    // Custom model toggle (accordion)
    const customToggle = modal.querySelector('#ok-custom-model-toggle');
    const customWrapper = modal.querySelector('#ok-custom-model-wrapper');
    if (customToggle && customWrapper) {
      customToggle.addEventListener('click', () => {
        const isHidden = customWrapper.style.display === 'none' || !customWrapper.style.display;
        customWrapper.style.display = isHidden ? 'block' : 'none';
        customToggle.textContent = isHidden ? '▲ Hide custom model input' : '✏️ Enter custom model name…';
      });
      // Update toggle text if already showing
      if (state.webLLMIsCustom) {
        customToggle.textContent = '▲ Hide custom model input';
      }
    }
    
    // === CACHE BACKEND SELECTOR ===
    const cacheBackendToggle = modal.querySelector('#ok-cache-backend-toggle');
    const cacheBackendOptions = modal.querySelector('#ok-cache-backend-options');
    const cacheBackendSelect = modal.querySelector('#ok-cache-backend-select');
    const cacheBackendLabel = modal.querySelector('#ok-cache-backend-label');
    const cacheBackendHint = modal.querySelector('#ok-cache-backend-hint');
    const cacheBackendChevron = modal.querySelector('#ok-cache-backend-chevron');
    
    if (cacheBackendToggle && cacheBackendOptions) {
      // Update hint text based on browser
      const isOpera = navigator.userAgent.includes('OPR') || navigator.userAgent.includes('Opera');
      if (isOpera && cacheBackendHint) {
        cacheBackendHint.textContent = '💡 Opera detected: "IndexedDB" recommended if "Cache API" fails.';
      }
      
      cacheBackendToggle.addEventListener('click', () => {
        const isHidden = cacheBackendOptions.style.display === 'none' || !cacheBackendOptions.style.display;
        cacheBackendOptions.style.display = isHidden ? 'block' : 'none';
        if (cacheBackendChevron) cacheBackendChevron.textContent = isHidden ? '▼' : '▶';
      });
      
      if (cacheBackendSelect) {
        cacheBackendSelect.addEventListener('change', () => {
          const selected = cacheBackendSelect.value;
          state.webLLMCacheBackend = selected || null; // null = auto-detect
          if (cacheBackendLabel) {
            cacheBackendLabel.textContent = selected || 'Auto-detect';
          }
          // Save preference
          localStorage.setItem('offlinekit:webllm-cache-backend', selected || '');
          
          // Show hint about needing to re-download with new backend
          if (cacheBackendHint && selected) {
            const backendNames = { 
              cache: 'Cache API', 
              indexeddb: 'IndexedDB', 
              opfs: 'OPFS' 
            };
            cacheBackendHint.textContent = `⚠️ Switched to ${backendNames[selected] || selected}. May need to clear cache and re-download.`;
          }
          
          log(`Cache backend changed to: ${selected || 'auto-detect'}`);
        });
      }
    }
    
    // === MODEL CACHE MANAGER ===
    
    // Render initial cached models list
    const cachedModelsList = modal.querySelector('#ok-cached-models-list');
    renderCachedModelsList(cachedModelsList);
    
    // Accordion toggle for manager
    const manageToggle = modal.querySelector('#ok-manage-models-toggle');
    const managerPanel = modal.querySelector('#ok-model-manager');
    const chevron = modal.querySelector('#ok-manage-chevron');
    if (manageToggle && managerPanel) {
      manageToggle.addEventListener('click', () => {
        const isHidden = managerPanel.style.display === 'none' || !managerPanel.style.display;
        managerPanel.style.display = isHidden ? 'block' : 'none';
        if (chevron) chevron.textContent = isHidden ? '▼' : '▶';
        // Re-render list when opening (in case it changed)
        if (isHidden) {
          renderCachedModelsList(modal.querySelector('#ok-cached-models-list'));
        }
      });
    }
    
    // Clear All Cache button
    const clearAllBtn = modal.querySelector('#ok-clear-all-cache');
    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', async () => {
        const modelIds = Object.keys(state.webLLMCachedModels || {});
        if (modelIds.length === 0) return;
        
        if (confirm(`Clear ALL ${modelIds.length} cached model(s)?\n\nThis will remove all downloaded WebLLM data from browser storage.`)) {
          clearAllBtn.disabled = true;
          clearAllBtn.textContent = '🗑️ Clearing...';
          
          try {
            // Delete each model's cache
            for (const modelId of modelIds) {
              await deleteCachedModel(modelId);
            }
            
            // Also try full cleanup
            try {
              const root = await navigator.storage.getDirectory();
              await clearOPFSRecursively(root, ['webllm', 'cache', 'models']);
            } catch(e) {}
            
            clearAllBtn.textContent = '✅ All Cleared!';
            clearAllBtn.style.background = '#dcfce7';
            clearAllBtn.style.borderColor = '#86efac';
            clearAllBtn.style.color = '#166534';
            
            // Re-render
            renderCachedModelsList(cachedModelsList);
            updateManagerUI(modal);
            
            setTimeout(() => {
              clearAllBtn.disabled = false;
              clearAllBtn.textContent = '🗑️ Clear All Cache';
              clearAllBtn.style.background = '';
              clearAllBtn.style.borderColor = '';
              clearAllBtn.style.color = '';
              clearAllBtn.style.opacity = '0.4';
              clearAllBtn.style.cursor = 'not-allowed';
            }, 2000);
          } catch (e) {
            clearAllBtn.disabled = false;
            clearAllBtn.textContent = '🗑️ Clear All Cache';
            err('Clear all failed:', e);
          }
        }
      });
    }
    
    // === Retry Download Button (just retry, keep cache) ===
    const retryBtn = modal.querySelector('#ok-retry-download');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        // Reset retry count on manual retry (user gets fresh 3 auto-retries)
        state.webLLMRetryCount = 0;
        state.webLLMLastRetryTime = 0; // Reset timer so auto-retry can fire immediately if needed
        // Just trigger the load button click
        const loadBtn = modal.querySelector('#ok-load-webllm');
        if (loadBtn && !loadBtn.disabled) {
          loadBtn.click();
        }
      });
    }
    
    // === Clear Cache & Retry Button (aggressive: clear then redownload) ===
    const clearRetryBtn = modal.querySelector('#ok-clear-and-retry');
    if (clearRetryBtn) {
      clearRetryBtn.addEventListener('click', async () => {
        const currentModelId = modal.querySelector('#ok-webllm-model').value;
        
        // Disable button immediately
        clearRetryBtn.disabled = true;
        clearRetryBtn.textContent = '🗑️ Clearing...';
        
        // Safety timeout: reset button after 30 seconds no matter what
        const safetyTimeout = setTimeout(() => {
          clearRetryBtn.disabled = false;
          clearRetryBtn.textContent = '🗑️ Clear Cache & Retry';
          log('⚠️ Clear & retry safety timeout reached');
        }, 30000);
        
        try {
          await deleteCachedModel(currentModelId);
          
          // Also dispose any existing engine
          if (state.webLLMEngine) {
            try { await state.webLLMEngine.unload(); } catch(e) {}
            state.webLLMEngine = null;
          }
          
          // Clear error and retry
          state.webLLMLoadError = null;
          
          // Reset button BEFORE triggering new load
          clearTimeout(safetyTimeout);
          clearRetryBtn.disabled = false;
          clearRetryBtn.textContent = '🗑️ Clear Cache & Retry';
          
          // Trigger load
          const loadBtn = modal.querySelector('#ok-load-webllm');
          if (loadBtn) {
            setTimeout(() => loadBtn.click(), 100);
          }
        } catch (e) {
          clearTimeout(safetyTimeout);
          clearRetryBtn.disabled = false;
          clearRetryBtn.textContent = '🗑️ Clear Cache & Retry';
          err('Clear & retry failed:', e);
          
          // Show error to user
          const errorEl = modal.querySelector('#ok-webllm-error-msg');
          if (errorEl) {
            errorEl.textContent = `❌ Cleanup failed: ${e.message.substring(0, 100)}\n\nTry "Nuclear Clear" instead, or refresh the page.`;
          }
        }
      });
    }
    
    // === Surgical Nuclear Clear Button (ONLY clears WebLLM model cache, preserves user data!) ===
    const nuclearBtn = modal.querySelector('#ok-nuclear-clear');
    if (nuclearBtn) {
      nuclearBtn.addEventListener('click', async () => {
        if (!confirm('🧹 Reset WebLLM Model Cache\n\n' +
          'This will ONLY clear:\n' +
          '• WebLLM/MLC model weights from browser cache\n' +
          '• WebLLM-specific OPFS storage\n' +
          '• WebLLM IndexedDB entries\n\n' +
          '✅ Your projects, settings, and files are SAFE.\n' +
          'The page will reload afterwards. Continue?')) {
          return;
        }
        
        nuclearBtn.disabled = true;
        nuclearBtn.textContent = '🧹 Clearing WebLLM cache...';
        
        const cleanupResults = [];
        
        // ============================================
        // LAYER 1: Clear ONLY WebLLM-related CacheStorage entries
        // (NOT all caches — preserve app assets, service workers, etc.)
        // ============================================
        try {
          const names = await caches.keys();
          for (const name of names) {
            // Only target WebLLM/MLC/workbox caches, NOT general app caches
            if (name.includes('webllm') || name.includes('mlc') || 
                name.includes('workbox') || name.includes('__offlinekit_health_test__')) {
              await caches.delete(name);
              cleanupResults.push(`Cache: ${name}`);
            }
          }
          // Also try to delete any cache that might be corrupted (contains 'model' or 'weights')
          for (const name of names) {
            if ((name.includes('model') || name.includes('weight') || name.includes('mlc-')) && !cleanupResults.some(r => r.includes(name))) {
              try {
                await caches.delete(name);
                cleanupResults.push(`Cache: ${name}`);
              } catch(e) {
                cleanupResults.push(`Cache ERR (${name}): ${e.message?.substring(0, 40)}`);
              }
            }
          }
        } catch(e) { 
          cleanupResults.push(`Cache API error: ${e.message?.substring(0, 60)}`); 
        }
        
        // ============================================
        // LAYER 2: Clear ONLY WebLLM-related IndexedDB databases
        // (NOT project storage, settings, etc.)
        // ============================================
        try {
          const dbs = await indexedDB.databases();
          for (const db of dbs) {
            if (db.name && (db.name.includes('webllm') || db.name.includes('mlc') || 
                db.name.includes('model-cache') || db.name.includes('wasm-cache'))) {
              indexedDB.deleteDatabase(db.name);
              cleanupResults.push(`IDB: ${db.name}`);
            }
          }
        } catch(e) { 
          cleanupResults.push(`IDB error: ${e.message?.substring(0, 60)}`); 
        }
        
        // ============================================
        // LAYER 3: Clear ONLY WebLLM-related OPFS directories
        // (NOT /projects, /user-data, or other app directories)
        // ============================================
        if (navigator.storage?.getDirectory) {
          try {
            const root = await navigator.storage.getDirectory();
            
            // List top-level directories to identify which are WebLLM vs user data
            const entries = [];
            for await (const entry of root.values()) {
              entries.push(entry);
            }
            
            const webllmDirs = ['webllm', 'mlc', 'cache', 'models', '.cache', 'wasm'];
            
            for (const entry of entries) {
              if (entry.kind === 'directory') {
                const nameLower = entry.name.toLowerCase();
                // Only clear known WebLLM/cache directories
                if (webllmDirs.some(d => nameLower === d || nameLower.startsWith(d + '-') || nameLower.startsWith(d + '_'))) {
                  try {
                    log('Removing OPFS directory:', entry.name);
                    await root.removeEntry(entry.name, { recursive: true });
                    cleanupResults.push(`OPFS: ${entry.name}/`);
                  } catch(e) {
                    cleanupResults.push(`OPFS err (${entry.name}): ${e.message?.substring(0, 40)}`);
                  }
                } else {
                  log('Preserving OPFS directory (not WebLLM):', entry.name);
                }
              }
            }
          } catch(e) { 
            cleanupResults.push(`OPFS error: ${e.message?.substring(0, 60)}`); 
            
            // If OPFS itself is corrupted, we need more aggressive approach
            // but still try to be surgical about it
            if (e.message?.includes('InvalidStateError') || e.message?.includes('state had changed')) {
              log('OPFS appears corrupted, attempting targeted aggressive cleanup...');
              try {
                const root = await navigator.storage.getDirectory();
                // nukeOPFSAggressive removes individual entries one by one
                // This is safer than removing everything because it handles errors per-entry
                await nukeOPFSAggressive(root);
                cleanupResults.push('OPFS: aggressive cleanup attempted');
              } catch (e2) {
                cleanupResults.push(`Aggressive OPFS: ${e2.message?.substring(0, 60)}`);
              }
            }
          }
        }
        
        // ============================================
        // LAYER 4: Clear ONLY OfflineKit/WebLLM localStorage keys
        // (preserve ALL other settings: theme, editor config, projects, etc.)
        // ============================================
        try {
          const offlineKitKeys = [
            'offlinekit:webllm-cached',
            'offlinekit:webllm-cached-models',
            'offlinekit:webllm-model',
            'offlinekit:webllm-custom-model'
          ];
          
          for (const key of offlineKitKeys) {
            if (localStorage.getItem(key)) {
              localStorage.removeItem(key);
              cleanupResults.push(`LS: removed ${key}`);
            }
          }
        } catch(e) { 
          cleanupResults.push(`LS error: ${e.message?.substring(0, 60)}`); 
        }
        
        // ============================================
        // LAYER 5: Clear sessionStorage (transient only - no persistent data here)
        // This is safe - sessionStorage is meant to be session-only
        // ============================================
        try {
          sessionStorage.clear();
          cleanupResults.push('sessionStorage: cleared');
        } catch(e) { 
          cleanupResults.push(`SS error: ${e.message?.substring(0, 60)}`); 
        }
        
        // ============================================
        // LAYER 6: Try WebLLM's own cache clearing method
        // ============================================
        try {
          const webllmModule = await import('https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.9/+esm');
          if (webllmModule && typeof webllmModule.clearCache === 'function') {
            await webllmModule.clearCache();
            cleanupResults.push('WebLLM.clearCache(): executed');
          }
        } catch(e) { 
          cleanupResults.push(`WebLLM.clearCache() failed: ${e.message?.substring(0, 50)}`); 
        }
        
        // Set post-nuclear recovery flag (AFTER clearing sessionStorage so it survives)
        const nuclearAttempt = getPostNuclearState()?.attempt || 0;
        setPostNuclearState(nuclearAttempt + 1);
        
        log('Surgical nuclear clear results:', cleanupResults);
        
        // Show results and offer reload
        nuclearBtn.textContent = `✅ Cleared ${cleanupResults.length} items! Reloading...`;
        nuclearBtn.style.background = '#166534';
        
        // Reload page after a brief delay
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      });
    }
    
    // === Deep Clean Button (clears ALL caches but preserves user data) ===
    const deepCleanBtn = modal.querySelector('#ok-deep-clean');
    if (deepCleanBtn) {
      deepCleanBtn.addEventListener('click', async () => {
        if (!confirm('🧹 Deep Clear ALL Caches\n\n' +
          'This will clear ALL cache storage for this site:\n' +
          '• Every cache entry (not just WebLLM)\n' +
          '• All IndexedDB databases\n' +
          '• All OPFS data\n\n' +
          '✅ PRESERVED:\n' +
          '• Your project files (stored separately)\n' + 
          '• localStorage settings\n\n' +
          'The page will reload afterwards. Continue?')) {
          return;
        }
        
        deepCleanBtn.disabled = true;
        deepCleanBtn.textContent = '🧹 Deep clearing...';
        
        const results = [];
        
        // 1. Nuke EVERY cache (this is the key difference from surgical)
        try {
          const names = await caches.keys();
          results.push(`Found ${names.length} caches to clear`);
          for (const name of names) {
            try {
              await caches.delete(name);
              results.push(`✓ ${name}`);
            } catch(e) {
              results.push(`✗ ${name}: ${e.message?.substring(0, 30)}`);
            }
          }
        } catch(e) { 
          results.push(`Cache API error: ${e.message?.substring(0, 60)}`); 
        }
        
        // 2. Delete ALL IndexedDB databases
        try {
          const dbs = await indexedDB.databases();
          for (const db of dbs) {
            if (db.name) {
              indexedDB.deleteDatabase(db.name);
              results.push(`✓ IDB: ${db.name}`);
            }
          }
        } catch(e) { 
          results.push(`IDB error: ${e.message?.substring(0, 60)}`); 
        }
        
        // 3. Clear OPFS entirely (projects are stored elsewhere or will be re-created)
        if (navigator.storage?.getDirectory) {
          try {
            const root = await navigator.storage.getDirectory();
            await nukeOPFSAggressive(root);
            results.push('✓ OPFS cleared');
          } catch(e) { 
            results.push(`OPFS error: ${e.message?.substring(0, 60)}`); 
          }
        }
        
        // 4. Clear sessionStorage
        try {
          sessionStorage.clear();
          results.push('✓ Session cleared');
        } catch(e) {}
        
        // 5. Set post-nuclear flag with higher attempt count to trigger manual help next time
        setPostNuclearState(10); // High number = show manual fix option immediately
        
        log('Deep clean results:', results);
        
        deepCleanBtn.textContent = `✅ Cleared! Reloading...`;
        deepCleanBtn.style.background = '#166534';
        
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      });
    }
    
    // === Manual Fix Button (opens Chrome settings + marks as tried) ===
    const manualHelpBtn = modal.querySelector('#ok-manual-clear-help');
    if (manualHelpBtn) {
      manualHelpBtn.addEventListener('click', () => {
        window.open('chrome://settings/content/all', '_blank');
        // Mark that user is attempting manual clear
        markManualClearAttempted();
        // Update button to show they clicked it
        manualHelpBtn.textContent = '✓ Opened! After clearing, click Retry Download';
        manualHelpBtn.style.background = '#166534';
      });
    }
    
    // === "I did the manual clear" button (for users who already cleared) ===
    const triedManualBtn = modal.querySelector('#ok-tried-manual-clear');
    if (triedManualBtn) {
      triedManualBtn.addEventListener('click', () => {
        markManualClearAttempted();
        // Update UI to show browser-level recovery steps
        const errorMsgEl = modal.querySelector('#ok-webllm-error-msg');
        if (errorMsgEl) {
          const postNuclear = getPostNuclearState();
          const attemptNum = (postNuclear?.attempt || 0) + 1;
          errorMsgEl.textContent = `🔴 Thanks for trying manual clear! CacheStorage still corrupted.\n\n` +
            `This means the corruption is deeper than site data.\n\n` +
            `🔄 TRY RESTARTING YOUR BROWSER:\n` +
            `• Close ALL Chrome windows (not just this tab)\n` +
            `• Reopen and come back here\n\n` +
            `Or try Incognito mode (Ctrl+Shift+N) — fresh storage!`;
        }
        triedManualBtn.textContent = '✓ Noted — showing browser-level steps';
        triedManualBtn.style.background = '#166534';
        triedManualBtn.disabled = true;
      });
    }
    
    modal.querySelector('#ok-save').addEventListener('click', () => {
      setOllamaEndpoint(modal.querySelector('#ok-ollama-url').value.replace(/\/$/, ''));
      
      // Check if custom model input is visible and has a value
      const customInput = modal.querySelector('#ok-webllm-model-custom');
      const customWrapperVisible = customWrapper && customWrapper.style.display !== 'none';
      if (customWrapperVisible && customInput && customInput.value.trim()) {
        state.webLLMModelId = customInput.value.trim();
        state.webLLMIsCustom = true;
      } else {
        state.webLLMModelId = modal.querySelector('#ok-webllm-model').value || state.webLLMModelId;
        // Re-check if it's a known model or custom
        const knownModels = [
          'Llama-3.2-1B-Instruct-q4f32_1-MLC',
          'Phi-3-mini-4k-instruct-q4f32_1-MLC',
          'gemma-2-2b-it-q4f32_1-MLC',
          'Llama-3.2-3B-Instruct-q4f32_1-MLC',
          'Llama-3.1-8B-Instruct-q4f32_1-MLC'
        ];
        state.webLLMIsCustom = !knownModels.includes(state.webLLMModelId);
      }
      localStorage.setItem('offlinekit:webllm-model', state.webLLMModelId);
      localStorage.setItem('offlinekit:webllm-is-custom', state.webLLMIsCustom);
      const endpoint = modal.querySelector('#ok-cloud-endpoint').value.trim();
      const apiKey = modal.querySelector('#ok-cloud-key').value.trim();
      const model = modal.querySelector('#ok-cloud-model').value.trim();
      if (endpoint && apiKey && model) setCloudLLM({ endpoint, apiKey, model });
      closeModal();
      pickLLM();
    });
  }

  function closeModal() {
    const m = document.getElementById('offline-kit-modal');
    if (m) m.remove();
  }

  // ============================================
  // Initialization
  // ============================================
  async function init() {
    if (window.__offlineKitInit) return;
    window.__offlineKitInit = true;

    log('Initializing…');
    injectStyles();

    // Restore saved settings
    try {
      const savedOllama = localStorage.getItem('offlinekit:ollama-endpoint');
      if (savedOllama) state.ollamaEndpoint = savedOllama;
      const savedModel = localStorage.getItem('offlinekit:webllm-model');
      if (savedModel) state.webLLMModelId = savedModel;
      // Check if model was previously cached
      const savedCached = localStorage.getItem('offlinekit:webllm-cached');
      if (savedCached && savedCached === state.webLLMModelId) {
        state.webLLMCached = true;
        log('WebLLM model previously cached:', savedCached);
      }
      // Check if using a custom model name
      const knownModels = [
        'Llama-3.2-1B-Instruct-q4f32_1-MLC',
        'Phi-3-mini-4k-instruct-q4f32_1-MLC',
        'gemma-2-2b-it-q4f32_1-MLC',
        'Llama-3.2-3B-Instruct-q4f32_1-MLC',
        'Llama-3.1-8B-Instruct-q4f32_1-MLC'
      ];
      state.webLLMIsCustom = !knownModels.includes(state.webLLMModelId);
      // Also check localStorage for explicit custom flag
      const savedIsCustom = localStorage.getItem('offlinekit:webllm-is-custom');
      if (savedIsCustom === 'true') state.webLLMIsCustom = true;
      
      // Load cache backend preference (null = auto-detect)
      const savedCacheBackend = localStorage.getItem('offlinekit:webllm-cache-backend');
      if (savedCacheBackend) {
        state.webLLMCacheBackend = savedCacheBackend || null; // Empty string → null (auto)
        log(`Cache backend preference loaded: ${state.webLLMCacheBackend || 'auto-detect'}`);
      } else {
        // Auto-detect: Use IndexedDB for Opera, default for others
        const isOpera = navigator.userAgent.includes('OPR') || navigator.userAgent.includes('Opera');
        if (isOpera) {
          state.webLLMCacheBackend = 'indexeddb'; // Opera works better with IndexedDB
          log(`Auto-detected Opera: using IndexedDB cache backend`);
        }
        // else: leave as null (use WebLLM default = "cache")
      }
      
      // Load cached models list (supports multiple models)
      loadCachedModels();
      
      // If current model is in cached list, mark as cached
      if (state.webLLMCachedModels[state.webLLMModelId]) {
        state.webLLMCached = true;
        log('Current model is cached:', state.webLLMModelId);
      }
      
      const savedCloud = localStorage.getItem('offlinekit:cloud-llm');
      if (savedCloud) state.cloudLLM = JSON.parse(savedCloud);
    } catch (e) { /* ignore */ }

    // Initialize layers in parallel
    await Promise.all([
      initOPFS().then(() => initQueue()),
    ]);

    state.fsAvailable = fsAccessSupported();
    setupOnlineListeners();

    // Probe Ollama in background (don't block init)
    probeOllama();

    // Pick initial LLM
    pickLLM();

    // Render status badge
    renderBadge();
    onStatusChange(renderBadge);

    log('Ready. Status:', getStatus());
    window.dispatchEvent(new CustomEvent('offlinekit:ready', { detail: getStatus() }));
  }

  // Auto-init on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ============================================
  // Public API
  // ============================================
  return {
    init,
    // Storage
    write, read, remove, list,
    opfsWrite, opfsRead, opfsDelete, opfsList,
    connectFolder, disconnectFolder, hasFolder, fsWrite, fsRead,
    // Sync
    enqueue, drainQueue,
    setSyncEndpoint: (url) => { state.syncEndpoint = url; },
    getQueueLength: () => state.queue.length,
    // LLM
    chat, getActiveLLM, pickLLM,
    isWebLLMSupported, loadWebLLM,
    setOllamaEndpoint, probeOllama, getOllamaModels: () => state.ollamaModels,
    setCloudLLM,
    // Status
    getStatus, onStatusChange, openSettings,
  };
})();

// Export for module systems too (optional)
if (typeof module !== 'undefined' && module.exports) module.exports = OfflineKit;
