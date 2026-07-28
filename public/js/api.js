/**
 * SBIDE - API Client
 * Handles all server communication including chat streaming, file operations, and proxy calls
 */

const IDEAPI = (() => {
  // ============================================
  // Configuration
  // ============================================
  
  const CONFIG = {
    // Base URL for API calls (uses Next.js API routes)
    baseUrl: '',
    
    // Timeout for regular requests (ms)
    timeout: 30000,
    
    // Streaming chunk timeout (ms)
    streamTimeout: 60000,
    
    // Max retries for failed requests
    maxRetries: 2
  };

  // ============================================
  // HTTP Helpers
  // ============================================
  
  /**
   * Make an HTTP request with error handling
   */
  async function request(url, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout || CONFIG.timeout);
    
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Request failed' }));
        throw new Error(errorData.message || `HTTP ${response.status}`);
      }
      
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        throw new Error('Request timed out');
      }
      throw error;
    }
  }

  /**
   * GET request helper
   */
  async function get(endpoint, params = {}) {
    const url = new URL(`${CONFIG.baseUrl}${endpoint}`, window.location.origin);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, value);
      }
    });
    
    const response = await request(url.toString());
    return response.json();
  }

  /**
   * POST request helper
   */
  async function post(endpoint, data, options = {}) {
    const response = await request(`${CONFIG.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      body: JSON.stringify(data),
      ...options
    });
    
    return response.json();
  }

  /**
   * PUT request helper
   */
  async function put(endpoint, data) {
    const response = await request(`${CONFIG.baseUrl}${endpoint}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    
    return response.json();
  }

  /**
   * DELETE request helper
   */
  async function del(endpoint) {
    const response = await request(`${CONFIG.baseUrl}${endpoint}`, {
      method: 'DELETE'
    });
    
    return response.json();
  }

  // ============================================
  // Chat & AI Operations
  // ============================================
  
  /**
   * Send a message and receive streaming response
   * @param {Object} params - Chat parameters
   * @param {string} params.message - User's message
   * @param {Array} params.messages - Conversation history
   * @param {string} params.projectName - Current project name
   * @param {Object} params.projectState - Current project state
   * @param {Function} params.onChunk - Called with each text chunk
   * @param {Function} params.onToolCall - Called when tool is invoked
   * @param {Function} params.onToolResult - Called when tool completes
   * @param {Function} params.onDone - Called when streaming complete
   * @param {Function} params.onError - Called on error
   * @returns {AbortController} - Controller to cancel streaming
   */
  async function sendMessageStream(params) {
    const {
      message,
      messages = [],
      projectName,
      projectState,
      onChunk,
      onToolCall,
      onToolResult,
      onDone,
      onError,
      onBackend
    } = params;

    // ============================================
    // Integrate toolbar toggles (Web Search / Diff Patch)
    // Read from global state set by app.js toolbar buttons
    // ============================================
    const toolbarState = window.__ideToolbarState || {};
    const webSearchEnabled = toolbarState.webSearchEnabled || false;
    const diffPatchMode = toolbarState.diffPatchMode || false;

    // If Web Search is enabled, perform search and prepend results to message
    let enhancedMessage = message;
    if (webSearchEnabled) {
      try {
        // Use the existing webSearch API method
        const searchResults = await API.webSearch(message);
        
        if (searchResults && Array.isArray(searchResults.results) && searchResults.results.length > 0) {
          // Format search results as context
          const formattedResults = searchResults.results.slice(0, 5).map((r, i) => 
            `[${i + 1}] ${r.title || 'Untitled'}\nURL: ${r.url || ''}\n${r.snippet || r.description || ''}`
          ).join('\n\n');
          
          enhancedMessage = `[WEB SEARCH CONTEXT]\nThe user's query was searched on the internet. Here are relevant results:\n\n${formattedResults}\n\n[END WEB SEARCH CONTEXT]\n\nNow respond to the user's original message, incorporating these search results where helpful:\n\n${message}`;
          
          // Update context indicator count
          const contextIndicator = document.getElementById('context-result-count');
          if (contextIndicator) {
            contextIndicator.textContent = String(searchResults.results.length);
          }
        }
      } catch (searchError) {
        console.warn('[API] Web search failed:', searchError);
        // Continue without search results — don't block the message
        enhancedMessage = `[Note: Web search was requested but encountered an error. Proceed with your knowledge.]\n\n${message}`;
      }
    }

    // If Diff Patch Mode is enabled, instruct AI to use unified diff format
    if (diffPatchMode) {
      enhancedMessage = `[DIFF PATCH MODE ENABLED]\nWhen suggesting code changes or modifications, you MUST output them in unified diff format (diff -u syntax). Use the following format:\n\n--- a/filename.ext\n+++ b/filename.ext\n@@ -line,count +line,count @@\n-context line\n+new line\n\nOnly output the diff for changed files. Include file paths relative to the project root.\n\n[END DIFF PATCH INSTRUCTIONS]\n\n${enhancedMessage}`;
    }

    const controller = new AbortController();
    
    // Build conversation context (shared by cloud + local fallback)
    const conversationMessages = [
      ...(messages || []).map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content
      })),
      { role: 'user', content: enhancedMessage }
    ];

    try {
      // Prepare request body
      const body = {
        messages: conversationMessages,
        projectName: projectName || null,
        projectState: projectState || {}
      };

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        // Surface a clear, actionable error for the common static-site case
        // where there is no backend at /api/chat (SBIDE deployed as a static
        // site returns the Next.js 404 HTML page). Without this, the user
        // sees a generic "Chat failed" message and has no idea why.
        if (response.status === 404) {
          throw new Error(
            'No chat backend is configured. SBIDE is running as a static site ' +
            'without an /api/chat endpoint. To chat, either: (1) run SBIDE ' +
            'locally with the Next.js dev server, (2) configure a local Ollama ' +
            'instance in Settings, or (3) wait for OfflineKit\'s WebLLM to load.'
          );
        }
        const errorData = await response.json().catch(() => ({ message: 'Chat failed' }));
        throw new Error(errorData.message || `HTTP ${response.status}`);
      }

      // Cloud backend is live — notify caller
      if (onBackend) onBackend({ type: 'cloud', name: 'Cloud' });

      // Handle streaming response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        
        // Process SSE events
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            
            if (data === '[DONE]') {
              if (onDone) onDone();
              return controller;
            }
            
            try {
              const parsed = JSON.parse(data);
              
              switch (parsed.type) {
                case 'text':
                  if (onChunk && parsed.content) {
                    onChunk(parsed.content);
                  }
                  break;
                  
                case 'tool_call':
                  if (onToolCall && parsed.tool) {
                    onToolCall(parsed.tool, parsed.args || {});
                  }
                  break;
                  
                case 'tool_result':
                  if (onToolResult) {
                    onToolResult(parsed.result, parsed.success);
                  }
                  break;
                  
                case 'error':
                  if (onError) {
                    onError(new Error(parsed.message || 'Unknown error'));
                  }
                  break;
                  
                default:
                  if (onChunk && parsed.content) {
                    onChunk(parsed.content);
                  }
              }
            } catch (e) {
              // Not JSON, treat as plain text
              if (onChunk && data) {
                onChunk(data);
              }
            }
          }
        }
      }
      
      if (onDone) onDone();
      
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('Streaming cancelled');
        return controller;
      }
      console.error('Streaming error:', error);

      // ─────────────────────────────────────────────────────
      // Offline Kit fallback: if /api/chat is unreachable
      // (network error, server down, 4xx/5xx), try the local
      // LLM router. If a local LLM is available (Ollama /
      // WebLLM / configured cloud-via-OfflineKit), stream its
      // output through the same onChunk callback so the UI
      // experience is seamless.
      // ─────────────────────────────────────────────────────
      if (window.OfflineKit) {
        try {
          // Refresh the routing decision (in case Ollama just came online)
          await OfflineKit.pickLLM();
          const status = OfflineKit.getStatus();
          const llm = status.llm || {};
          const usable = llm.type === 'ollama' || llm.type === 'webllm' || llm.type === 'cloud';
          if (usable) {
            console.warn('[API] /api/chat failed — falling back to OfflineKit:', llm);
            if (onBackend) onBackend(llm);
            // Stream tokens from the local LLM
            for await (const delta of OfflineKit.chat(conversationMessages, {})) {
              if (controller.signal.aborted) break;
              if (onChunk && delta) onChunk(delta);
            }
            if (onDone) onDone();
            return controller;
          }
        } catch (fallbackErr) {
          console.error('[API] OfflineKit fallback also failed:', fallbackErr);
        }
      }

      // No local LLM available — instead of surfacing a dead-end error,
      // stream a clear, actionable demo response so the user understands
      // why chat failed and what they can do about it. This keeps the UX
      // responsive on static deployments (e.g. HuggingFace Spaces) where
      // no /api/chat backend exists.
      console.warn('[API] No backend available — streaming demo response.');
      if (onBackend) onBackend({ type: 'demo', name: 'Demo', model: 'stub' });
      const userMsg = conversationMessages[conversationMessages.length - 1]?.content || '';
      const demoText = buildDemoResponse(userMsg, error);
      // Stream word-by-word so the UI shows the typing animation
      const words = demoText.split(/(\s+)/);
      for (const w of words) {
        if (controller.signal.aborted) break;
        if (onChunk) onChunk(w);
        // Small delay for typewriter effect (≈60ms/word ≈ 16 wpm)
        await new Promise(r => setTimeout(r, 30));
      }
      if (onDone) onDone();
    }

    return controller;
  }

  /**
   * Build a helpful demo response when no chat backend is configured.
   * Explains the situation and lists the three ways to enable real chat.
   */
  function buildDemoResponse(userMessage, error) {
    const errMsg = (error && error.message) ? error.message : 'Unknown error';
    return [
      'I couldn\'t reach a chat backend for that request. Here\'s what\'s happening and how to fix it:',
      '',
      '**Why:** ' + errMsg.split('\n')[0],
      '',
      '**How to enable real AI chat:**',
      '',
      '1. **Run SBIDE locally** with the Next.js dev server (`npm run dev`) — this exposes `/api/chat` and gives you full chat capabilities.',
      '2. **Configure Ollama** — install [Ollama](https://ollama.com), run `ollama serve`, then open the OfflineKit badge (bottom-right) and set the endpoint to `http://localhost:11434`.',
      '3. **Load WebLLM in-browser** — open the OfflineKit badge, click "Load WebLLM model". This downloads a small Llama model (~1GB, one-time) and runs it via WebGPU. No server required.',
      '',
      'Your message was:',
      '> ' + (userMessage || '').slice(0, 200),
      '',
      'Once a backend is available, I\'ll be able to respond to it properly.'
    ].join('\n');
  }

  /**
   * Send non-streaming message (for simple responses)
   */
  async function sendMessage(message, messages = [], projectName = null) {
    const conversationMessages = [
      ...messages.map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content
      })),
      { role: 'user', content: message }
    ];

    return post('/api/chat', {
      messages: conversationMessages,
      projectName,
      stream: false
    });
  }

  /**
   * Cancel current streaming request
   */
  function cancelStream(controller) {
    if (controller) {
      controller.abort();
    }
  }

  // ============================================
  // File Proxy Operations
  // ============================================
  
  const FilesAPI = {
    /**
     * Read file content via proxy
     */
    async read(projectName, path) {
      return get('/api/files/read', { projectName, path });
    },

    /**
     * Write/update file content via proxy
     */
    async write(projectName, path, content) {
      return post('/api/files/write', { projectName, path, content });
    },

    /**
     * Create new file/folder
     */
    async create(projectName, path, type = 'file', content = '') {
      return post('/api/files/create', { projectName, path, type, content });
    },

    /**
     * Delete file or folder
     */
    async delete(projectName, path) {
      return del(`/api/files/delete?projectName=${encodeURIComponent(projectName)}&path=${encodeURIComponent(path)}`);
    },

    /**
     * List directory contents
     */
    async list(projectName, path = '') {
      return get('/api/files/list', { projectName, path });
    },

    /**
     * Search files by pattern
     */
    async search(projectName, query) {
      return get('/api/files/search', { projectName, query });
    }
  };

  // ============================================
  // Project Operations
  // ============================================
  
  const ProjectsAPI = {
    /**
     * Get all projects
     */
    async getAll() {
      return get('/api/projects');
    },

    /**
     * Get single project details
     */
    async get(name) {
      return get(`/api/projects/${encodeURIComponent(name)}`);
    },

    /**
     * Create new project
     */
    async create(name) {
      return post('/api/projects', { name });
    },

    /**
     * Update project settings
     */
    async update(name, updates) {
      return put(`/api/projects/${encodeURIComponent(name)}`, updates);
    },

    /**
     * Delete project
     */
    async delete(name) {
      return del(`/api/projects/${encodeURIComponent(name)}`);
    },

    /**
     * Export project as ZIP
     */
    async exportZip(name) {
      const response = await request(`/api/projects/${encodeURIComponent(name)}/export`);
      const blob = await response.blob();
      return blob;
    },

    /**
     * Import project from ZIP
     */
    async importZip(file, name = null) {
      const formData = new FormData();
      formData.append('file', file);
      if (name) formData.append('name', name);
      
      const response = await request('/api/projects/import', {
        method: 'POST',
        body: formData
      });
      
      return response.json();
    }
  };

  // ============================================
  // Version Control Operations
  // ============================================
  
  const VersionsAPI = {
    /**
     * Get versions for a project
     */
    async getByProject(projectName) {
      return get('/api/versions', { projectName });
    },

    /**
     * Create new version checkpoint
     */
    async create(projectName, description = '') {
      return post('/api/versions', { projectName, description });
    },

    /**
     * Get specific version details
     */
    async get(versionId) {
      return get(`/api/versions/${versionId}`);
    },

    /**
     * Delete version
     */
    async delete(versionId) {
      return del(`/api/versions/${versionId}`);
    },

    /**
     * Restore from version
     */
    async restore(versionId) {
      return post(`/api/versions/${versionId}/restore`);
    }
  };

  // ============================================
  // Search Operations
  // ============================================
  
  const SearchAPI = {
    /**
     * Global search across project
     */
    async search(query, projectName, options = {}) {
      return post('/api/search', {
        query,
        projectName,
        ...options
      });
    },

    /**
     * Web search (if available)
     */
    async webSearch(query) {
      return post('/api/search/web', { query });
    }
  };

  // ============================================
  // Memory & Context Operations
  // ============================================
  
  const MemoryAPI = {
    /**
     * Get project memory
     */
    async get(projectName) {
      return get('/api/memory', { projectName });
    },

    /**
     * Update project memory
     */
    async save(memoryData) {
      return post('/api/memory', memoryData);
    },

    /**
     * Add anchor to memory
     */
    async addAnchor(projectName, anchor) {
      return post('/api/memory/anchor', { projectName, anchor });
    }
  };

  const ContextAPI = {
    /**
     * Get context items
     */
    async get(projectName) {
      return get('/api/context', { projectName });
    },

    /**
     * Add item to context
     */
    async add(result) {
      return post('/api/context/add', result);
    },

    /**
     * Remove item from context
     */
    async remove(url) {
      return del(`/api/context/remove?url=${encodeURIComponent(url)}`);
    },

    /**
     * Clear context
     */
    async clear(projectName) {
      return del(`/api/context/clear?projectName=${encodeURIComponent(projectName)}`);
    }
  };

  // ============================================
  // Utility Functions
  // ============================================
  
  /**
   * Check if API is available
   */
  async function healthCheck() {
    try {
      const result = await get('/api/health');
      return result.status === 'ok';
    } catch (error) {
      return false;
    }
  }

  /**
   * Update base URL configuration
   */
  function setBaseUrl(url) {
    CONFIG.baseUrl = url;
  }

  // Public API
  return {
    // Core
    request,
    get,
    post,
    put,
    delete: del,
    
    // Chat
    sendMessageStream,
    sendMessage,
    cancelStream,
    
    // Resource APIs
    Files: FilesAPI,
    Projects: ProjectsAPI,
    Versions: VersionsAPI,
    Search: SearchAPI,
    Memory: MemoryAPI,
    Context: ContextAPI,
    
    // Utilities
    healthCheck,
    setBaseUrl,
    
    // Config
    CONFIG
  };
})();

// Export for use in other modules
window.IDEAPI = IDEAPI;
