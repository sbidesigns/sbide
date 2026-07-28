/**
 * SBIDE - State Management
 * Lightweight reactive state management with localStorage persistence
 * Mirrors Zustand store functionality from original React app
 */

const IDEState = (() => {
  // ============================================
  // Default State
  // ============================================
  const defaultState = {
    // Hydration state
    _hasHydrated: false,
    
    // Current Session
    currentProject: null,
    messages: [],
    isStreaming: false,
    
    // Per-project message storage (keyed by project name)
    projectMessages: {},
    
    // UI State
    sidebarOpen: false,
    activeTab: 'files',
    activeFile: null,
    fileContent: '',
    settingsOpen: false,
    editorPanelOpen: false,
    editorFocused: false,
    
    // Search State
    searchResults: [],
    contextResults: [],
    searchQuery: '',
    isSearching: false,
    
    // Memory State
    projectMemory: null,
    
    // Versions
    versions: [],
    
    // Projects List
    projects: [],
    
    // Settings
    settings: {
      autoCreateZipBackup: true,
      showNotifications: true,
      autoCheckpoint: true,
      fontScale: 1,
      theme: 'unthemed',
      // Editor preferences (ported from v1 IDE)
      wordWrap: true,
      lineNumbers: true,
      autoSave: false,
      soundEffects: false
    },
    
    // File refresh trigger
    fileRefreshKey: 0,
    
    // Project State
    projectState: {
      currentFiles: [],
      activeFile: null,
      lastOperation: null,
      pendingChanges: false
    },
    
    // Auto-save tracking
    lastSaved: 0
  };

  // ============================================
  // State Container
  // ============================================
  let state = { ...defaultState };
  
  // Subscribers for reactive updates
  const subscribers = new Set();
  
  // Persistence key
  const PERSISTENCE_KEY = 'ide-agent-state';
  
  // Fields to persist to localStorage
  const PERSISTENT_FIELDS = [
    'currentProject',
    'messages',
    'projectMessages',
    'projectState',
    'lastSaved',
    'sidebarOpen',
    'settings',
    'contextResults'
  ];

  // ============================================
  // Core Functions
  // ============================================

  /**
   * Get current state (immutable copy)
   */
  function getState() {
    return { ...state };
  }

  /**
   * Get a specific state value
   */
  function get(key) {
    return state[key];
  }

  /**
   * Update state with partial object or function
   */
  function set(partialOrFn) {
    const previousState = { ...state };
    
    if (typeof partialOrFn === 'function') {
      state = { ...state, ...partialOrFn(state) };
    } else {
      state = { ...state, ...partialOrFn };
    }
    
    // Notify subscribers of changes
    notifySubscribers(previousState, state);
    
    // Auto-persist
    persist();
    
    return state;
  }

  /**
   * Subscribe to state changes
   * @param {Function} callback - Called with (newState, prevState)
   * @returns {Function} Unsubscribe function
   */
  function subscribe(callback) {
    subscribers.add(callback);
    return () => subscribers.delete(callback);
  }

  /**
   * Notify all subscribers of state change
   */
  function notifySubscribers(prevState, newState) {
    subscribers.forEach(callback => {
      try {
        callback(newState, prevState);
      } catch (error) {
        console.error('Subscriber error:', error);
      }
    });
  }

  // ============================================
  // Persistence
  // ============================================

  /**
   * Save persistent fields to localStorage
   */
  function persist() {
    try {
      const toPersist = {};
      PERSISTENT_FIELDS.forEach(key => {
        toPersist[key] = state[key];
      });
      
      localStorage.setItem(PERSISTENCE_KEY, JSON.stringify(toPersist));
    } catch (error) {
      console.error('Failed to persist state:', error);
    }
  }

  /**
   * Load persisted state from localStorage
   */
  function hydrate() {
    try {
      const saved = localStorage.getItem(PERSISTENCE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        state = { ...defaultState, ...parsed };
        state._hasHydrated = true;
        return true;
      }
    } catch (error) {
      console.error('Failed to hydrate state:', error);
    }
    
    state._hasHydrated = true;
    return false;
  }

  /**
   * Clear persisted state
   */
  function clearPersistence() {
    localStorage.removeItem(PERSISTENCE_KEY);
  }

  // ============================================
  // Actions - Project Management
  // ============================================

  function setCurrentProject(project) {
    set((prevState) => {
      // Save current project's messages before switching
      const updatedProjectMessages = { ...prevState.projectMessages };
      if (prevState.currentProject?.name) {
        updatedProjectMessages[prevState.currentProject.name] = prevState.messages;
      }
      
      // Load new project's messages (or empty array)
      const newMessages = project?.name 
        ? (updatedProjectMessages[project.name] || [])
        : [];
      
      return {
        currentProject: project,
        projectMessages: updatedProjectMessages,
        messages: newMessages,
        activeFile: null,
        fileContent: ''
      };
    });
  }

  function setProjects(projects) {
    set({ projects });
  }

  // ============================================
  // Actions - Messages
  // ============================================

  function setMessages(messages) {
    set({ messages });
  }

  function addMessage(message) {
    set((prevState) => ({
      messages: [...prevState.messages, message]
    }));
  }

  function updateLastMessage(content) {
    set((prevState) => {
      const messages = [...prevState.messages];
      if (messages.length > 0) {
        messages[messages.length - 1] = {
          ...messages[messages.length - 1],
          content
        };
      }
      return { messages };
    });
  }

  function setStreaming(streaming) {
    set({ isStreaming: streaming });
  }

  function deleteMessage(messageId) {
    set((prevState) => ({
      messages: prevState.messages.filter(m => m.id !== messageId)
    }));
  }

  function editMessage(messageId, newContent) {
    set((prevState) => ({
      messages: prevState.messages.map(m => 
        m.id === messageId ? { ...m, content: newContent } : m
      )
    }));
  }

  function editMessageAndTruncate(messageId, newContent) {
    set((prevState) => {
      const index = prevState.messages.findIndex(m => m.id === messageId);
      if (index === -1) return prevState;
      
      const truncatedMessages = prevState.messages.slice(0, index + 1);
      truncatedMessages[index] = { ...truncatedMessages[index], content: newContent };
      
      return { messages: truncatedMessages };
    });
  }

  function getMessageIndex(messageId) {
    return state.messages.findIndex(m => m.id === messageId);
  }

  function clearMessages() {
    set({ messages: [] });
  }

  // ============================================
  // Actions - UI State
  // ============================================

  function setSidebarOpen(open) {
    set({ sidebarOpen: open });
  }

  function setActiveTab(tab) {
    set({ activeTab: tab });
  }

  function setActiveFile(file) {
    set({ activeFile: file });
  }

  function setFileContent(content) {
    set({ fileContent: content });
  }

  function setSettingsOpen(open) {
    set({ settingsOpen: open });
  }

  function setEditorPanelOpen(open) {
    set({ editorPanelOpen: open });
  }

  function setEditorFocused(focused) {
    set({ 
      editorFocused: focused,
      editorPanelOpen: focused ? true : state.editorPanelOpen
    });
  }

  function focusEditor() {
    // Issue #5 fix: do NOT close the sidebar when focusing the editor.
    // The previous sidebarOpen:false caused the sidebar element to keep
    // occupying its 18rem width while its inner content was hidden,
    // producing a "ghost" empty column.
    set({
      editorPanelOpen: true,
      editorFocused: true
    });
  }

  // ============================================
  // Actions - Search
  // ============================================

  function setSearchResults(results) {
    set({ searchResults: results });
  }

  function setSearchQuery(query) {
    set({ searchQuery: query });
  }

  function setSearching(searching) {
    set({ isSearching: searching });
  }

  function addToContext(result) {
    set((prevState) => {
      // Check if already in context
      if (prevState.contextResults.some(r => r.url === result.url)) {
        return prevState;
      }
      // Check max limit (50)
      if (prevState.contextResults.length >= 50) {
        return prevState;
      }
      return { contextResults: [...prevState.contextResults, result] };
    });
  }

  function removeFromContext(url) {
    set((prevState) => ({
      contextResults: prevState.contextResults.filter(r => r.url !== url)
    }));
  }

  function clearContext() {
    set({ contextResults: [] });
  }

  function clearSearchResults() {
    set({ 
      searchResults: [], 
      searchQuery: '' 
    });
  }

  // ============================================
  // Actions - Memory & Versions
  // ============================================

  function setProjectMemory(memory) {
    set({ projectMemory: memory });
  }

  function setVersions(versions) {
    set({ versions });
  }

  // ============================================
  // Actions - Project State
  // ============================================

  function setProjectState(projectStateUpdate) {
    set((prevState) => ({
      projectState: { 
        ...prevState.projectState, 
        ...projectStateUpdate 
      }
    }));
  }

  function setLastSaved(timestamp) {
    set({ lastSaved: timestamp });
  }

  // ============================================
  // Actions - Settings
  // ============================================

  function updateSettings(newSettings) {
    set((prevState) => ({
      settings: { ...prevState.settings, ...newSettings }
    }));
  }

  // ============================================
  // Actions - File Refresh
  // ============================================

  function refreshFiles() {
    set((prevState) => ({ 
      fileRefreshKey: prevState.fileRefreshKey + 1 
    }));
  }

  // ============================================
  // Actions - Hydration
  // ============================================

  function setHasHydrated(hydrated) {
    set({ _hasHydrated: hydrated });
  }

  // ============================================
  // Reset
  // ============================================

  function reset() {
    state = { ...defaultState };
    clearPersistence();
    notifySubscribers(state, state);
  }

  // Initialize by hydrating from storage
  hydrate();

  // Public API
  return {
    // Core
    getState,
    get,
    set,
    subscribe,
    
    // Persistence
    hydrate,
    persist,
    clearPersistence,
    
    // Project Actions
    setCurrentProject,
    setProjects,
    
    // Message Actions
    setMessages,
    addMessage,
    updateLastMessage,
    setStreaming,
    deleteMessage,
    editMessage,
    editMessageAndTruncate,
    getMessageIndex,
    clearMessages,
    
    // UI Actions
    setSidebarOpen,
    setActiveTab,
    setActiveFile,
    setFileContent,
    setSettingsOpen,
    setEditorPanelOpen,
    setEditorFocused,
    focusEditor,
    
    // Search Actions
    setSearchResults,
    setSearchQuery,
    setSearching,
    addToContext,
    removeFromContext,
    clearContext,
    clearSearchResults,
    
    // Memory & Versions
    setProjectMemory,
    setVersions,
    
    // Project State
    setProjectState,
    setLastSaved,
    
    // Settings
    updateSettings,
    
    // File Refresh
    refreshFiles,
    
    // Hydration
    setHasHydrated,
    
    // Reset
    reset,
    
    // Constants
    defaultState,
    PERSISTENCE_KEY
  };
})();

// Export for use in other modules
window.IDEState = IDEState;
