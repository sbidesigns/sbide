/**
 * SBIDE - LLM Provider Manager
 * Intelligent rate limit detection, context window tracking, and provider switching
 * 
 * Features:
 * - Automatic rate limit detection and handling
 * - Context window visualization
 * - Tiered provider list (free → freemium → paid)
 * - Smart fallback when rate limited
 */

const LLMManagerComponent = (() => {
  // ============================================
  // LLM Provider Configuration
  // ============================================
  
  /**
   * Provider Tiers:
   * - tier 1: 100% Free (no API key required, no signup)
   * - tier 2: Free API Key (requires signup but free tier available)
   * - tier 3: Freemium (free with limitations/credit card may be needed)
   */
  
  const PROVIDERS = [
    // ===== TIER 1: 100% Free (No API Key Required) =====
    {
      id: 'z-ai-default',
      name: 'Z.AI Default',
      description: 'Built-in temporary provider (rate limited)',
      tier: 1,
      requiresApiKey: false,
      requiresSignup: false,
      contextWindow: 128000,
      maxTokensPerRequest: 8192,
      rateLimit: {
        requestsPerMinute: 10,
        requestsPerDay: 100,
        tokensPerDay: 500000
      },
      icon: 'bot',
      isDefault: true,
      endpoint: '/api/chat',
      status: 'available',
      color: '#6366f1'
    },
    {
      id: 'chatgpt-free',
      name: 'ChatGPT Free',
      description: "OpenAI's free web tier via proxy",
      tier: 1,
      requiresApiKey: false,
      requiresSignup: true, // Needs OpenAI account
      contextWindow: 16384,
      maxTokensPerRequest: 4096,
      rateLimit: {
        requestsPerMinute: 20,
        requestsPerDay: 50,
        tokensPerDay: 150000
      },
      icon: 'message-circle',
      endpoint: '/api/chat/providers/openai',
      status: 'available',
      color: '#10a37f'
    },
    
    // ===== TIER 2: Free API Key (No Credit Card) =====
    {
      id: 'groq',
      name: 'Groq',
      description: 'Ultra-fast inference, free tier generous',
      tier: 2,
      requiresApiKey: true,
      requiresSignup: true,
      requiresCreditCard: false,
      apiKeyUrl: 'https://console.groq.com/keys',
      contextWindow: 131072,
      maxTokensPerRequest: 8192,
      rateLimit: {
        requestsPerMinute: 30,
        requestsPerDay: 14400,
        tokensPerDay: 6000000
      },
      icon: 'zap',
      endpoint: '/api/chat/providers/groq',
      status: 'needs-config',
      color: '#e11d48'
    },
    {
      id: 'together-ai',
      name: 'Together AI',
      description: 'Open source models, free credits on signup',
      tier: 2,
      requiresApiKey: true,
      requiresSignup: true,
      requiresCreditCard: false,
      apiKeyUrl: 'https://api.together.xyz/settings/api-keys',
      contextWindow: 128000,
      maxTokensPerRequest: 8192,
      rateLimit: {
        requestsPerMinute: 60,
        requestsPerDay: 1000,
        tokensPerDay: 1000000
      },
      icon: 'users',
      endpoint: '/api/chat/providers/together',
      status: 'needs-config',
      color: '#3b82f6'
    },
    {
      id: 'mistral',
      name: 'Mistral AI',
      description: 'European AI, free tier available',
      tier: 2,
      requiresApiKey: true,
      requiresSignup: true,
      requiresCreditCard: false,
      apiKeyUrl: 'https://console.mistral.ai/api-keys/',
      contextWindow: 131072,
      maxTokensPerRequest: 8192,
      rateLimit: {
        requestsPerMinute: 60,
        requestsPerDay: 1000,
        tokensPerDay: 400000
      },
      icon: 'wind',
      endpoint: '/api/chat/providers/mistral',
      status: 'needs-config',
      color: '#f97316'
    },
    {
      id: 'huggingface',
      name: 'HuggingFace Inference',
      description: 'Open source models, free tier',
      tier: 2,
      requiresApiKey: true,
      requiresSignup: true,
      requiresCreditCard: false,
      apiKeyUrl: 'https://huggingface.co/settings/tokens',
      contextWindow: 16000,
      maxTokensPerRequest: 4096,
      rateLimit: {
        requestsPerMinute: 30,
        requestsPerDay: 2000,
        tokensPerDay: 300000
      },
      icon: 'heart',
      endpoint: '/api/chat/providers/huggingface',
      status: 'needs-config',
      color: '#ff9d00'
    },
    {
      id: 'cohere',
      name: 'Cohere',
      description: 'Enterprise NLP, free trial available',
      tier: 2,
      requiresApiKey: true,
      requiresSignup: true,
      requiresCreditCard: false,
      apiKeyUrl: 'https://dashboard.cohere.com/api-keys',
      contextWindow: 128000,
      maxTokensPerRequest: 4096,
      rateLimit: {
        requestsPerMinute: 100,
        requestsPerDay: 1000,
        tokensPerDay: 1000000
      },
      icon: 'layers',
      endpoint: '/api/chat/providers/cohere',
      status: 'needs-config',
      color: '#7c3aed'
    },
    
    // ===== TIER 3: Freemium/Paid (May require credit card) =====
    {
      id: 'openai',
      name: 'OpenAI GPT-4o',
      description: 'Most capable, pay-as-you-go',
      tier: 3,
      requiresApiKey: true,
      requiresSignup: true,
      requiresCreditCard: true,
      apiKeyUrl: 'https://platform.openai.com/api-keys',
      contextWindow: 128000,
      maxTokensPerRequest: 16384,
      rateLimit: {
        requestsPerMinute: 500,
        requestsPerDay: 10000,
        tokensPerDay: 5000000
      },
      icon: 'sparkles',
      endpoint: '/api/chat/providers/openai-paid',
      status: 'needs-config',
      color: '#10a37f'
    },
    {
      id: 'anthropic',
      name: 'Anthropic Claude',
      description: 'Strong reasoning capabilities',
      tier: 3,
      requiresApiKey: true,
      requiresSignup: true,
      requiresCreditCard: true,
      apiKeyUrl: 'https://console.anthropic.com/settings/keys',
      contextWindow: 200000,
      maxTokensPerRequest: 8192,
      rateLimit: {
        requestsPerMinute: 60,
        requestsPerDay: 1000,
        tokensPerDay: 2250000
      },
      icon: 'brain',
      endpoint: '/api/chat/providers/anthropic',
      status: 'needs-config',
      color: '#cc785c'
    },
    {
      id: 'google-gemini',
      name: 'Google Gemini Pro',
      description: 'Multimodal, generous free tier',
      tier: 3,
      requiresApiKey: true,
      requiresSignup: true,
      requiresCreditCard: false, // Google doesn't require CC for free tier
      apiKeyUrl: 'https://aistudio.google.com/app/apikey',
      contextWindow: 1048576,
      maxTokensPerRequest: 8192,
      rateLimit: {
        requestsPerMinute: 60,
        requestsPerDay: 1500,
        tokensPerDay: 3200000
      },
      icon: 'gem',
      endpoint: '/api/chat/providers/gemini',
      status: 'needs-config',
      color: '#4285f4'
    }
  ];

  // ============================================
  // State
  // ============================================
  
  let currentProvider = null;
  let providerApiKeys = {};
  let rateLimitState = {};
  let contextUsage = {
    used: 0,
    total: 128000,
    percentage: 0,
    messages: [],
    messageCount: 0
  };
  let requestHistory = [];
  let modalElement = null;
  let onProviderChange = null;

  // ============================================
  // Initialization
  // ============================================
  
  function init(options = {}) {
    onProviderChange = options.onProviderChange || null;
    
    // Load saved state
    loadSavedState();
    
    // Set default provider if none selected
    if (!currentProvider) {
      currentProvider = PROVIDERS.find(p => p.isDefault);
    }
    
    // Setup global error listener for rate limit detection
    setupRateLimitDetection();
    
    console.log(`LLM Manager initialized with provider: ${currentProvider?.name}`);
  }

  function loadSavedState() {
    try {
      const saved = localStorage.getItem('llm-manager-state');
      if (saved) {
        const parsed = JSON.parse(saved);
        
        // Restore selected provider
        if (parsed.currentProviderId) {
          const provider = PROVIDERS.find(p => p.id === parsed.currentProviderId);
          if (provider) currentProvider = provider;
        }
        
        // Restore API keys (basic obfuscation - not true encryption but better than plaintext)
        if (parsed.providerApiKeys) {
          providerApiKeys = {};
          for (const [key, value] of Object.entries(parsed.providerApiKeys)) {
            try {
              // Attempt to decode - if it fails, store as-is (legacy format)
              providerApiKeys[key] = atob(value) || value;
            } catch {
              providerApiKeys[key] = value; // Legacy plaintext key
            }
          }
        }
        
        // Restore rate limit state
        if (parsed.rateLimitState) {
          rateLimitState = parsed.rateLimitState;
        }
      }
    } catch (e) {
      console.error('Failed to load LLM manager state:', e);
    }
  }

  function saveState() {
    try {
      // Basic obfuscation for API keys (base64 encoding)
      // NOTE: This is NOT secure encryption - it prevents casual inspection only
      // Real implementations should use proper encryption with a user-provided passphrase
      const obfuscatedKeys = {};
      for (const [key, value] of Object.entries(providerApiKeys)) {
        if (value) {
          obfuscatedKeys[key] = btoa(value);
        }
      }
      
      localStorage.setItem('llm-manager-state', JSON.stringify({
        currentProviderId: currentProvider?.id,
        providerApiKeys: obfuscatedKeys,
        rateLimitState
      }));
    } catch (e) {
      console.error('Failed to save LLM manager state:', e);
    }
  }

  // ============================================
  // Rate Limit Detection
  // ============================================
  
  function setupRateLimitDetection() {
    // Use observer pattern instead of monkey-patching fetch (anti-pattern)
    // We hook into the API client's request/response cycle instead
    
    // Listen for custom events from the API module when requests complete
    document.addEventListener('api:requestCompleted', (e) => {
      if (e.detail?.response) {
        trackRequest(e.detail.response);
      }
    });
    
    // Also patch fetch but with safety checks and cleanup awareness
    if (!window._originalFetch) {
      window._originalFetch = window.fetch.bind(window);
      window.fetch = async function(...args) {
        try {
          const response = await window._originalFetch(...args);
          trackRequest(response);
          return response;
        } catch (error) {
          throw error;
        }
      };
    }
  }

  function trackRequest(response) {
    // Get URL from response object
    const url = response.url || '';
    
    // Only track chat-related requests
    if (!url.includes('/api/chat') && !url.includes('/chat')) return;
    
    const now = Date.now();
    const requestId = `${now}-${Math.random().toString(36).substring(2, 11)}`;
    
    requestHistory.push({
      id: requestId,
      timestamp: now,
      status: response.status,
      providerId: currentProvider?.id
    });
    
    // Clean old entries (keep last hour) and cap at MAX_ENTRIES to prevent memory leaks
    const oneHourAgo = now - 3600000;
    requestHistory = requestHistory.filter(r => r.timestamp > oneHourAgo);
    
    // Safety cap: never keep more than 1000 entries (prevents memory leak under edge cases)
    const MAX_REQUEST_HISTORY = 1000;
    if (requestHistory.length > MAX_REQUEST_HISTORY) {
      requestHistory = requestHistory.slice(-MAX_REQUEST_HISTORY);
    }
    
    // Check for rate limit indicators
    checkRateLimitIndicators(response);
    
    // Update context usage estimate
    updateContextUsageEstimate();
  }

  function checkRateLimitIndicators(response) {
    const providerId = currentProvider?.id;
    
    // HTTP 429 = Too Many Requests (explicit rate limit)
    if (response.status === 429) {
      handleRateLimitHit('explicit_429');
      return;
    }
    
    // Check for rate limit headers
    const remainingRequests = response.headers.get('X-RateLimit-Remaining');
    const retryAfter = response.headers.get('Retry-After');
    const rateLimitReset = response.headers.get('X-RateLimit-Reset');
    
    if (remainingRequests !== null && parseInt(remainingRequests) <= 5) {
      handleRateLimitHit('low_remaining', { remaining: parseInt(remainingRequests) });
    }
    
    if (retryAfter) {
      handleRateLimitHit('retry_after', { retryAfterSeconds: parseInt(retryAfter) });
    }
    
    // Check for common rate limit error patterns in body (async)
    detectRateLimitFromBody(response);
  }

  async function detectRateLimitFromBody(response) {
    try {
      // Only inspect the body for rate-limit signals when the HTTP status
      // is plausibly a rate-limit response. A 404 (not found), 400 (bad
      // request), 401 (unauthorized), 500 (server error) etc. are NOT
      // rate limits — even if the body happens to contain the substring
      // "429" (which the previous /429/i regex matched inside URLs, hex
      // colors, and Next.js chunk hashes in 404 HTML pages, causing
      // false-positive rate-limit toasts on a static deployment).
      const status = response.status;
      const isPlausibleRateLimitStatus =
        status === 429 ||
        status === 503 ||
        status === 420 ||  // Enhance your calm (Twitter/Cloudflare)
        status === 502 ||  // Bad gateway (may be rate-related)
        status === 503;   // Service unavailable
      if (!isPlausibleRateLimitStatus) {
        return;
      }

      const clone = response.clone();
      const text = await clone.text();

      // Patterns are made specific (word-boundaried or phrasal) so they
      // don't match arbitrary substrings inside HTML/JSON error bodies.
      // The bare /429/i pattern is intentionally REMOVED — if the server
      // wanted to signal a rate limit it would have returned HTTP 429
      // (handled above) or one of the explicit phrases below.
      const rateLimitPatterns = [
        /\brate[- ]?limit\b/i,
        /\btoo many requests\b/i,
        /\bquota exceeded\b/i,
        /\bthrottl(?:ed|ing)?\b/i,
        /\btry again (?:later|in \d+ (?:second|minute)s?)\b/i,
        /\brequest limit (?:exceeded|reached)\b/i
      ];

      const isRateLimited = rateLimitPatterns.some(pattern => pattern.test(text));

      if (isRateLimited) {
        handleRateLimitHit('error_pattern', { message: text.substring(0, 200) });
      }
    } catch (e) {
      // Ignore body parsing errors
    }
  }

  function handleRateLimitHit(reason, details = {}) {
    const providerId = currentProvider?.id;
    
    // Update rate limit state
    if (!rateLimitState[providerId]) {
      rateLimitState[providerId] = {
        hitCount: 0,
        lastHit: null,
        isCurrentlyLimited: false,
        resetTime: null,
        reasons: []
      };
    }
    
    const state = rateLimitState[providerId];
    state.hitCount++;
    state.lastHit = Date.now();
    state.isCurrentlyLimited = true;
    state.reasons.push({ reason, details, timestamp: Date.now() });
    
    // Estimate reset time (default 60 seconds if not specified)
    const resetDelay = details.retryAfterSeconds ? details.retryAfterSeconds * 1000 : 60000;
    state.resetTime = Date.now() + resetDelay;
    
    // Save state
    saveState();
    
    // Show switcher modal after multiple hits
    if (state.hitCount >= 2) {
      showSwitcherModal({ reason: 'rate_limited', providerId, details });
    }
    
    // Dispatch custom event for UI updates
    window.dispatchEvent(new CustomEvent('llm:rateLimit', {
      detail: { providerId, reason, details, state }
    }));
    
    console.warn(`Rate limit hit for ${providerId}:`, reason, details);
  }

  function checkIfRateLimitExpired() {
    const now = Date.now();
    let changed = false;
    
    Object.keys(rateLimitState).forEach(providerId => {
      const state = rateLimitState[providerId];
      if (state.isCurrentlyLimited && state.resetTime && now > state.resetTime) {
        state.isCurrentlyLimited = false;
        changed = true;
      }
    });
    
    if (changed) {
      saveState();
      window.dispatchEvent(new CustomEvent('llm:rateLimitReset'));
    }
  }

  // ============================================
  // Context Window Tracking
  // ============================================
  
  function updateContextUsageEstimate() {
    const messages = window.IDEState?.get('messages') || [];
    
    // Calculate approximate token count (rough: 1 token ≈ 4 chars for English)
    let totalChars = 0;
    const messageInfo = messages.map(m => ({
      role: m.role,
      contentLength: m.content?.length || 0,
      timestamp: m.timestamp
    }));
    
    totalChars = messageInfo.reduce((sum, m) => sum + m.contentLength, 0);
    
    // Add overhead for system prompt, formatting, etc.
    totalChars += 1000; 
    
    // Convert to approximate tokens
    const estimatedTokens = Math.ceil(totalChars / 4);
    
    contextUsage = {
      used: estimatedTokens,
      total: currentProvider?.contextWindow || 128000,
      percentage: Math.min(100, Math.round((estimatedTokens / (currentProvider?.contextWindow || 128000)) * 100)),
      messages: messageInfo,
      messageCount: messages.length
    };
    
    // Dispatch event for UI updates
    window.dispatchEvent(new CustomEvent('llm:contextUpdate', {
      detail: contextUsage
    }));
  }

  function getContextUsage() {
    // Pure getter — return the last computed context usage.
    //
    // IMPORTANT: do NOT call updateContextUsageEstimate() here. That function
    // dispatches an 'llm:contextUpdate' event, and app.js listens for that
    // event by calling updateContextWindowIndicator() → which calls
    // getContextUsage() → which would re-dispatch → infinite recursion
    // (Maximum call stack size exceeded).
    //
    // The estimate is refreshed by updateContextUsageEstimate() on its own
    // schedule (called from trackRequest / setProvider / message events),
    // so the cached value is always reasonably fresh. If we somehow have
    // never computed it (fresh page load), compute it once here WITHOUT
    // dispatching the event.
    if (!contextUsage) {
      try {
        const msgs = (window.IDEState?.get?.('messages')) || [];
        const totalChars = msgs.reduce((n, m) => n + ((m?.content || '').length), 0);
        const total = currentProvider?.contextWindow || 128000;
        const used = Math.ceil(totalChars / 4);
        contextUsage = {
          used,
          total,
          percentage: Math.min(100, Math.round((used / total) * 100)),
          messages: [],
          messageCount: msgs.length
        };
      } catch (e) {
        contextUsage = { used: 0, total: 128000, percentage: 0, messages: [], messageCount: 0 };
      }
    }
    return contextUsage;
  }

  // ============================================
  // Provider Management
  // ============================================
  
  function getProviders(tierFilter = null) {
    if (!tierFilter) return PROVIDERS;
    return PROVIDERS.filter(p => p.tier === tierFilter);
  }

  function getCurrentProvider() {
    return currentProvider;
  }

  function setProvider(providerId, apiKey = null) {
    const provider = PROVIDERS.find(p => p.id === providerId);
    if (!provider) {
      console.error(`Provider not found: ${providerId}`);
      return false;
    }
    
    currentProvider = provider;
    
    if (apiKey) {
      providerApiKeys[providerId] = apiKey;
    }
    
    // Update context window for new provider
    contextUsage.total = provider.contextWindow;
    
    saveState();
    
    // Notify listeners
    if (onProviderChange) {
      onProviderChange(provider);
    }
    
    window.dispatchEvent(new CustomEvent('llm:providerChanged', {
      detail: { provider }
    }));
    
    if (IDEUtils) {
      IDEUtils.showToast(`Switched to ${provider.name}`, 'success');
    }
    
    return true;
  }

  function setApiKey(providerId, apiKey) {
    providerApiKeys[providerId] = apiKey;
    saveState();
  }

  function getApiKey(providerId) {
    return providerApiKeys[providerId] || null;
  }

  function getProviderStatus(providerId) {
    const provider = PROVIDERS.find(p => p.id === providerId);
    const hasKey = !!providerApiKeys[providerId];
    const rateLimited = rateLimitState[providerId]?.isCurrentlyLimited || false;
    
    if (!hasKey && provider.requiresApiKey) {
      return 'needs-config';
    }
    
    if (rateLimited) {
      return 'rate-limited';
    }
    
    return 'available';
  }

  // ============================================
  // Switcher Modal
  // ============================================
  
  function showSwitcherModal(context = {}) {
    // Close existing modal
    closeSwitcherModal();
    
    checkIfRateLimitExpired();
    
    modalElement = document.createElement('div');
    modalElement.className = 'modal-overlay llm-switcher-modal';
    modalElement.setAttribute('role', 'dialog');
    modalElement.setAttribute('aria-modal', 'true');
    modalElement.setAttribute('aria-labelledby', 'llm-switcher-title');
    
    const { reason } = context;
    const isRateLimited = reason === 'rate_limited';
    
    modalElement.innerHTML = renderModalContent(isRateLimited, context);
    
    document.body.appendChild(modalElement);
    
    // Wire up events
    wireUpModalEvents();
    
    // Focus management
    setTimeout(() => {
      const closeBtn = modalElement.querySelector('.modal-close-btn');
      if (closeBtn) closeBtn.focus();
    }, 100);
  }

  function renderModalContent(isRateLimited, context) {
    const tier1Providers = PROVIDERS.filter(p => p.tier === 1);
    const tier2Providers = PROVIDERS.filter(p => p.tier === 2);
    const tier3Providers = PROVIDERS.filter(p => p.tier === 3);
    
    const icons = {
      'bot': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M8 15h.01M16 15h.01M12 17h.01"/></svg>',
      'message-circle': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>',
      'zap': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
      'users': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>',
      'wind': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9.59 4.59A2 2 0 1111 8H2m10.59 11.41A2 2 0 1014 16H2m15.73-8.27A2.5 2.5 0 1119.5 12H2"/></svg>',
      'heart': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>',
      'layers': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
      'sparkles': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l1.912 5.813a2 2 0 001.275 1.275L21 12l-5.813 1.912a2 2 0 00-1.275 1.275L12 21l-1.912-5.813a2 2 0 00-1.275-1.275L3 12l5.813-1.912a2 2 0 001.275-1.275L12 3z"/></svg>',
      'brain': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9.5 2A2.5 2.5 0 0112 4.5v15a2.5 2.5 0 01-4.96.44 2.5 2.5 0 01-2.96-3.08 3 3 0 01-.34-5.58 2.5 2.5 0 011.32-4.24 2.5 2.5 0 011.98-3A2.5 2.5 0 019.5 2z"/><path d="M14.5 2A2.5 2.5 0 0012 4.5v15a2.5 2.5 0 004.96.44 2.5 2.5 0 002.96-3.08 3 3 0 00.34-5.58 2.5 2.5 0 00-1.32-4.24 2.5 2.5 0 00-1.98-3A2.5 2.5 0 0014.5 2z"/></svg>',
      'gem': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 9 12 22 22 9 12 2"/><line x1="2" y1="9" x2="12" y2="22"/><line x1="22" y1="9" x2="12" y2="22"/></svg>'
    };

    const renderProviderCard = (provider) => {
      const isSelected = currentProvider?.id === provider.id;
      const status = getProviderStatus(provider.id);
      const hasKey = !!providerApiKeys[provider.id];
      const isRateLimited = rateLimitState[provider.id]?.isCurrentlyLimited;
      const savedKey = providerApiKeys[provider.id] || '';
      // Create masked version of saved key for display
      const maskedKey = savedKey ? maskApiKey(savedKey) : '';
      
      // Determine status badge state
      let statusBadge = '';
      if (isRateLimited) {
        // Rate limited: Red X badge with countdown
        const resetTime = rateLimitState[provider.id]?.resetTime;
        const timeUntil = resetTime ? formatTimeUntil(resetTime) : 'unknown';
        statusBadge = `
          <button class="status-badge status-rate-limited" 
                  data-provider-id="${provider.id}"
                  title="Rate limited - resets in ${timeUntil}. Click for details."
                  aria-label="Rate limited, resets in ${timeUntil}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="15" y1="9" x2="9" y2="15"/>
              <line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
            <span class="status-countdown" data-reset-time="${resetTime || ''}">${timeUntil}</span>
          </button>`;
      } else if (isSelected || status === 'available') {
        // Active/Available: Green checkmark badge
        statusBadge = `
          <span class="status-badge status-available" 
                title="${isSelected ? 'Currently active' : 'Available'}"
                role="status"
                aria-label="${isSelected ? 'Active' : 'Available'}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
          </span>`;
      } else if (status === 'needs-config') {
        // Needs config: Gray warning badge
        statusBadge = `
          <span class="status-badge status-needs-config"
                title="Requires API key configuration"
                role="status"
                aria-label="Needs configuration">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </span>`;
      }
      
      return `
        <div class="llm-provider-card ${isSelected ? 'selected' : ''} ${isRateLimited ? 'rate-limited' : ''} ${status === 'needs-config' && !hasKey ? 'needs-config' : ''}" 
             data-provider-id="${provider.id}"
             data-requires-key="${provider.requiresApiKey}"
             data-has-key="${hasKey}">
          <div class="provider-header">
            <div class="provider-icon" style="color: ${provider.color}">
              ${icons[provider.icon] || icons['bot']}
            </div>
            <div class="provider-info">
              <div class="provider-name">${provider.name}</div>
              <div class="provider-description">${provider.description}</div>
            </div>
            ${statusBadge}
            ${hasKey && !isRateLimited ? '<span class="provider-badge saved">✓ Key Saved</span>' : ''}
          </div>
          
          <div class="provider-specs">
            <div class="spec-item">
              <span class="spec-label">Context</span>
              <span class="spec-value">${formatNumber(provider.contextWindow)}</span>
            </div>
            <div class="spec-item">
              <span class="spec-label">Max output</span>
              <span class="spec-value">${formatNumber(provider.maxTokensPerRequest)} tk</span>
            </div>
            <div class="spec-item">
              <span class="spec-label">Tier</span>
              <span class="spec-value tier-${provider.tier}">
                ${provider.tier === 1 ? '🆓 Free' : provider.tier === 2 ? '🔑 Free Key' : '💎 Pro'}
              </span>
            </div>
          </div>
          
          ${isRateLimited ? `
            <div class="provider-warning rate-limit-expanded">
              <div class="rate-limit-header">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="warning-icon">
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/>
                  <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <div class="rate-limit-info">
                  <strong>Rate Limited</strong>
                  <span class="rate-limit-timer" data-reset-time="${rateLimitState[provider.id]?.resetTime || ''}">
                    Reseting in ${formatTimeUntil(rateLimitState[provider.id]?.resetTime)}
                  </span>
                </div>
              </div>
              <div class="rate-limit-progress">
                <div class="rate-limit-bar"></div>
              </div>
              <p class="rate-limit-hint">This provider will automatically become available when the rate limit expires, or switch to another provider now.</p>
            </div>
          ` : ''}
          
          ${provider.requiresApiKey ? `
            <div class="provider-api-key-section">
              <label class="api-key-label">
                API Key
                ${hasKey ? '<span class="key-saved-indicator">✓ Saved</span>' : ''}
              </label>
              ${hasKey ? `
                <!-- Key is saved: show masked display with edit/clear options -->
                <div class="saved-key-display">
                  <span class="masked-key" title="API key is saved and will be used automatically">${maskedKey}</span>
                  <button class="icon-btn edit-key-btn" data-provider-id="${provider.id}" title="Edit API key">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                  <button class="icon-btn clear-key-btn" data-provider-id="${provider.id}" title="Remove saved API key">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
                <input type="password" class="api-key-input hidden" placeholder="Enter new API key..." 
                       data-provider-id="${provider.id}" value="${savedKey}" />
              ` : `
                <!-- No key saved: show input field -->
                <input type="password" class="api-key-input" placeholder="Enter API key..." 
                       data-provider-id="${provider.id}" />
              `}
              ${provider.apiKeyUrl ? `
                <a href="${provider.apiKeyUrl}" target="_blank" rel="noopener" class="get-api-key-link">
                  Get free API key →
                </a>
              ` : ''}
            </div>
          ` : ''}
          
          <button class="btn ${isSelected ? 'btn-primary' : 'btn-outline'} select-provider-btn"
                  data-provider-id="${provider.id}"
                  ${status === 'needs-config' && !hasKey ? 'disabled' : ''}>
            ${isSelected ? '✓ Using' : 'Select'}
          </button>
        </div>
      `;
    };

    return `
      <div class="modal modal-lg llm-switcher-content">
        <div class="modal-header">
          <h2 class="modal-title" id="llm-switcher-title">
            ${isRateLimited ? '⚠️ Rate Limit Detected' : '🔄 Switch LLM Provider'}
          </h2>
          <button class="icon-btn modal-close-btn" aria-label="Close dialog">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        
        <div class="modal-body">
          ${isRateLimited ? `
            <div class="rate-limit-alert">
              <div class="alert-icon">⚡</div>
              <div class="alert-content">
                <strong>Current provider hit rate limits</strong>
                <p>Choose a different provider to continue without interruption.</p>
              </div>
            </div>
          ` : ''}
          
          <!-- Current Status -->
          <div class="current-provider-status">
            <div class="status-label">Current Provider</div>
            <div class="status-value" style="--provider-color: ${currentProvider?.color || '#6366f1'}">
              <span class="status-dot"></span>
              ${currentProvider?.name || 'None'} · 
              Context: ${contextUsage.percentage}% used (${formatNumber(contextUsage.used)}/${formatNumber(contextUsage.total)})
            </div>
          </div>
          
          <!-- Tier 1: 100% Free -->
          <section class="provider-tier-section">
            <h3 class="tier-title">
              <span class="tier-icon">🆓</span>
              100% Free Providers
              <span class="tier-subtitle">No signup or API key required</span>
            </h3>
            <div class="providers-grid">
              ${tier1Providers.map(renderProviderCard).join('')}
            </div>
          </section>
          
          <!-- Tier 2: Free API Key -->
          <section class="provider-tier-section">
            <h3 class="tier-title">
              <span class="tier-icon">🔑</span>
              Free API Key Providers
              <span class="tier-subtitle">Free signup, no credit card required</span>
            </h3>
            <div class="providers-grid">
              ${tier2Providers.map(renderProviderCard).join('')}
            </div>
          </section>
          
          <!-- Tier 3: Freemium/Paid -->
          <details class="provider-tier-details">
            <summary class="tier-summary">
              <span class="tier-icon">💎</span>
              Premium Providers
              <span class="tier-subtitle">May require credit card</span>
            </summary>
            <div class="providers-grid">
              ${tier3Providers.map(renderProviderCard).join('')}
            </div>
          </details>
        </div>
        
        <div class="modal-footer">
          <button class="btn btn-outline close-switcher-btn">Close</button>
        </div>
      </div>
    `;
  }

  function wireUpModalEvents() {
    if (!modalElement) return;
    
    // Close button
    modalElement.querySelector('.close-switcher-btn')?.addEventListener('click', closeSwitcherModal);
    modalElement.querySelector('.modal-close-btn')?.addEventListener('click', closeSwitcherModal);
    
    // Click outside to close
    modalElement.addEventListener('click', (e) => {
      if (e.target === modalElement) closeSwitcherModal();
    });
    
    // Escape key
    document.addEventListener('keydown', handleEscapeKey);
    
    // Provider selection buttons
    modalElement.querySelectorAll('.select-provider-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const providerId = btn.dataset.providerId;
        const providerCard = btn.closest('.llm-provider-card');
        const keyInput = providerCard.querySelector('.api-key-input');
        const apiKey = keyInput?.value?.trim();
        
        if (setProvider(providerId, apiKey)) {
          closeSwitcherModal();
        }
      });
    });
    
    // API key inputs - enable/disable select button + auto-save
    modalElement.querySelectorAll('.api-key-input').forEach(input => {
      input.addEventListener('input', () => {
        const providerId = input.dataset.providerId;
        const card = input.closest('.llm-provider-card');
        const selectBtn = card.querySelector('.select-provider-btn');
        
        if (selectBtn) {
          selectBtn.disabled = !input.value.trim();
        }
      });
      
      // Auto-save key on blur (when user leaves the input)
      input.addEventListener('blur', () => {
        const providerId = input.dataset.providerId;
        const keyValue = input.value.trim();
        
        if (keyValue) {
          setApiKey(providerId, keyValue);
          const card = input.closest('.llm-provider-card');
          const provider = PROVIDERS.find(p => p.id === providerId);
          showSaveConfirmation(card, provider?.name || providerId);
          console.log(`✅ API key saved for ${providerId}`);
        }
      });
      
      // Save on Enter key
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          input.blur(); // Trigger save via blur event
        }
      });
    });

    // Edit key buttons - toggle visibility of input
    modalElement.querySelectorAll('.edit-key-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const providerId = btn.dataset.providerId;
        const card = btn.closest('.llm-provider-card');
        const savedDisplay = card.querySelector('.saved-key-display');
        const keyInput = card.querySelector('.api-key-input');
        
        if (savedDisplay && keyInput) {
          savedDisplay.classList.add('hidden');
          keyInput.classList.remove('hidden');
          keyInput.focus();
        }
      });
    });

    // Clear key buttons - remove saved key
    modalElement.querySelectorAll('.clear-key-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const providerId = btn.dataset.providerId;
        const card = btn.closest('.llm-provider-card');
        const provider = PROVIDERS.find(p => p.id === providerId);
        
        // Confirm before clearing
        if (confirm(`Remove saved API key for ${provider?.name || providerId}?`)) {
          delete providerApiKeys[providerId];
          saveState();
          
          // Refresh the modal to show updated state
          closeSwitcherModal();
          showSwitcherModal();
          
          if (window.IDEUtils) {
            IDEUtils.showToast(`API key removed for ${provider?.name || providerId}`, 'info', 3000);
          }
        }
      });
    });

    // Rate limited badge click - show details or alternative providers
    modalElement.querySelectorAll('.status-rate-limited').forEach(badge => {
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        const providerId = badge.dataset.providerId;
        const state = rateLimitState[providerId];
        
        if (state && window.IDEUtils) {
          const resetTime = formatTimeUntil(state.resetTime);
          IDEUtils.showToast(
            `Rate limit active. Resets in ${resetTime}. Try another provider.`,
            'warning',
            4000
          );
        }
      });
    });

    // Start countdown timers for rate limited providers
    startCountdownTimers();
    
    // Provider cards - click to select (if configured)
    modalElement.querySelectorAll('.llm-provider-card:not(.needs-config)').forEach(card => {
      card.addEventListener('click', (e) => {
        // Don't trigger if clicking on input/button inside
        if (e.target.closest('input, button, a')) return;
        
        const providerId = card.dataset.providerId;
        if (setProvider(providerId)) {
          closeSwitcherModal();
        }
      });
    });
  }

  function handleEscapeKey(e) {
    if (e.key === 'Escape' && modalElement) {
      closeSwitcherModal();
    }
  }

  function closeSwitcherModal() {
    if (modalElement) {
      modalElement.remove();
      modalElement = null;
      document.removeEventListener('keydown', handleEscapeKey);
    }
  }

  // ============================================
  // Utility Functions
  // ============================================
  
  function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  }

  function formatTimeUntil(timestamp) {
    if (!timestamp) return 'unknown time';
    const diff = timestamp - Date.now();
    if (diff <= 0) return 'now';
    
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return `${seconds}s`;
    
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    
    const hours = Math.floor(minutes / 60);
    return `${hours}h`;
  }

  /**
   * Mask API key for display - show first 4 chars and last 4, rest as dots
   */
  function maskApiKey(key) {
    if (!key || key.length <= 8) return '••••••••';
    const first = key.substring(0, 4);
    const last = key.substring(key.length - 4);
    const dots = '•'.repeat(Math.min(key.length - 8, 12));
    return `${first}${dots}${last}`;
  }

  /**
   * Show temporary save confirmation toast on a specific element
   */
  function showSaveConfirmation(cardElement, providerName) {
    // Remove any existing confirmation
    cardElement.querySelector('.save-confirmation')?.remove();
    
    const confirm = document.createElement('div');
    confirm.className = 'save-confirmation';
    confirm.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> Key saved!`;
    
    const header = cardElement.querySelector('.provider-header');
    if (header) {
      header.appendChild(confirm);
      // Auto-remove after 2 seconds
      setTimeout(() => confirm.remove(), 2000);
    }
  }

  /**
   * Start countdown timers for rate-limited providers
   * Auto-updates badges and reverts to green when limit expires
   */
  let countdownInterval = null;
  
  function startCountdownTimers() {
    // Clear any existing interval
    if (countdownInterval) {
      clearInterval(countdownInterval);
    }
    
    // Update every second
    countdownInterval = setInterval(() => {
      if (!modalElement) {
        clearInterval(countdownInterval);
        countdownInterval = null;
        return;
      }
      
      let needsRefresh = false;
      
      // Update all countdown displays
      modalElement.querySelectorAll('.status-countdown, .rate-limit-timer').forEach(el => {
        const resetTime = parseInt(el.dataset.resetTime);
        if (!resetTime) return;
        
        const diff = resetTime - Date.now();
        
        if (diff <= 0) {
          // Rate limit has expired - mark for refresh
          el.textContent = 'now';
          needsRefresh = true;
        } else {
          // Update display
          const seconds = Math.floor(diff / 1000);
          if (seconds < 60) {
            el.textContent = `${seconds}s`;
          } else {
            const minutes = Math.floor(seconds / 60);
            el.textContent = minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`;
          }
        }
      });
      
      // Update progress bars
      modalElement.querySelectorAll('.rate-limit-bar').forEach(bar => {
        const timer = bar.closest('.rate-limit-expanded')?.querySelector('.rate-limit-timer');
        const resetTime = timer ? parseInt(timer.dataset.resetTime) : 0;
        if (!resetTime) return;
        
        const diff = resetTime - Date.now();
        // Assume rate limit duration was ~60 seconds, calculate remaining percentage
        const totalDuration = 60000; // Default 60 second window
        const elapsed = Math.max(0, totalDuration - diff);
        const percent = Math.min(100, Math.max(0, (elapsed / totalDuration) * 100));
        
        bar.style.width = `${100 - percent}%`;
      });
      
      // Check if any rate limits have expired
      Object.keys(rateLimitState).forEach(providerId => {
        const state = rateLimitState[providerId];
        if (state.isCurrentlyLimited && state.resetTime && Date.now() > state.resetTime) {
          state.isCurrentlyLimited = false;
          needsRefresh = true;
          console.log(`✅ Rate limit expired for ${providerId}`);
        }
      });
      
      // Refresh modal if needed to show updated badges
      if (needsRefresh) {
        saveState();
        // Dispatch event for external listeners
        window.dispatchEvent(new CustomEvent('llm:rateLimitReset'));
        
        // Refresh the modal content
        const isRateLimitedContext = Object.values(rateLimitState).some(s => s.isCurrentlyLimited);
        if (modalElement && !isRateLimitedContext) {
          // Only auto-refresh if no providers are still rate limited
          // This prevents flickering when multiple providers are limited
          const stillLimited = modalElement.querySelectorAll('.status-rate-limited').length > 0;
          if (!stillLimited) {
            closeSwitcherModal();
            showSwitcherModal();
            
            if (window.IDEUtils) {
              IDEUtils.showToast('Rate limit(s) expired - providers available again', 'success', 3000);
            }
          }
        }
      }
    }, 1000);
  }

  // ============================================
  // Public API
  // ============================================
  
  return {
    init,
    
    // Provider Management
    getProviders,
    getCurrentProvider,
    setProvider,
    getProviderStatus,
    setApiKey,
    getApiKey,
    
    // Rate Limit Detection
    getRateLimitState: () => ({ ...rateLimitState }),
    isRateLimited: (providerId) => rateLimitState[providerId]?.isCurrentlyLimited || false,
    
    // Context Window
    getContextUsage,
    updateContextUsage: updateContextUsageEstimate,
    
    // Modal
    showSwitcherModal,
    closeSwitcherModal,
    
    // Constants
    PROVIDERS,
    
    // State
    getState: () => ({
      currentProvider,
      contextUsage,
      rateLimitState: { ...rateLimitState }
    })
  };
})();

// Export for use in other modules
window.LLMManagerComponent = LLMManagerComponent;
