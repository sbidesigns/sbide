/**
 * SBIDE - Chat Window Component
 * Handles chat UI, streaming responses, and tool call visualization
 */

const ChatWindowComponent = (() => {
  // ============================================
  // State
  // ============================================
  
  let container = null;
  let messagesContainer = null;
  let inputContainer = null;
  let inputElement = null;
  let sendButton = null;
  
  // Streaming state
  let isStreaming = false;
  let currentStreamController = null;
  
  // Callbacks
  let onSendMessage = null;
  let onToolAction = null;

  // ============================================
  // Initialization
  // ============================================
  
  /**
   * Initialize chat window component
   * @param {HTMLElement} element - Container element for chat
   * @param {Object} options - Configuration options
   */
  function init(element, options = {}) {
    if (!element) {
      console.error('ChatWindow: Container element required');
      return;
    }
    
    container = element;
    onSendMessage = options.onSendMessage || null;
    onToolAction = options.onToolAction || null;
    
    // Find sub-elements using CORRECT IDs from HTML
    // HTML has: #chat-messages, .chat-input-container, #chat-input, #send-message-btn
    messagesContainer = document.getElementById('chat-messages');
    inputContainer = container.querySelector('.chat-input-container');
    inputElement = document.getElementById('chat-input');  // textarea
    sendButton = document.getElementById('send-message-btn');  // button
    
    if (!messagesContainer) {
      console.warn('ChatWindow: #chat-messages not found');
    }
    if (!inputElement) {
      console.warn('ChatWindow: #chat-input not found');
    }
    if (!sendButton) {
      console.warn('ChatWindow: #send-message-btn not found');
    }
    
    // Setup event listeners
    setupEventListeners();
    
    // Subscribe to state changes
    if (window.IDEState) {
      IDEState.subscribe((state, prevState) => {
        // Handle new messages
        if (state.messages !== prevState.messages) {
          renderMessages(state.messages);
        }
        
        // Handle streaming state changes
        if (state.isStreaming !== prevState.isStreaming) {
          setStreaming(state.isStreaming);
        }
        
        // Handle project change - load project messages
        if (state.currentProject?.name !== prevState.currentProject?.name) {
          renderMessages(state.messages);
        }
      });
      
      // Initial render with existing messages
      renderMessages(IDEState.get('messages') || []);
    }
  }

  /**
   * Create messages container if not in DOM
   */
  function createMessagesContainer() {
    const div = document.createElement('div');
    div.className = 'chat-messages';
    div.setAttribute('role', 'log');
    div.setAttribute('aria-label', 'Chat messages');
    div.setAttribute('aria-live', 'polite');
    container.prepend(div);
    return div;
  }

  /**
   * Create input area if not in DOM
   */
  function createInputContainer() {
    const div = document.createElement('div');
    div.className = 'chat-input-area';
    div.innerHTML = `
      <div class="chat-actions-toolbar">
        <button class="btn btn-ghost btn-xs clear-chat-btn" id="clear-chat-btn" title="Clear conversation" disabled>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
          </svg>
          Clear
        </button>
        <button class="btn btn-ghost btn-xs export-chat-btn" id="export-chat-btn" title="Export conversation" disabled>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Export
        </button>
        <span class="context-indicator" id="context-indicator" style="display: none;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <span class="context-count">0</span> web results in context
        </span>
      </div>
      <div class="input-wrapper">
        <textarea 
          class="chat-input" 
          placeholder="Send a message..."
          rows="1"
          aria-label="Chat message input"
        ></textarea>
        <button class="send-btn btn btn-primary" id="send-message-btn" aria-label="Send message">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>
      <p class="input-hint">Press Enter to send, Shift+Enter for new line</p>
    `;
    container.appendChild(div);
    
    inputElement = div.querySelector('.chat-input');
    sendButton = div.querySelector('#send-message-btn');
    
    // Wire up action buttons
    const clearBtn = div.querySelector('#clear-chat-btn');
    const exportBtn = div.querySelector('#export-chat-btn');
    
    if (clearBtn) {
      clearBtn.addEventListener('click', () => clearMessages());
    }
    
    if (exportBtn) {
      exportBtn.addEventListener('click', () => exportConversation());
    }
    
    return div;
  }

  /**
   * Setup event listeners
   */
  function setupEventListeners() {
    // Send button click
    if (sendButton) {
      sendButton.addEventListener('click', () => sendMessage());
    }
    
    // Input keydown (Enter to send)
    if (inputElement) {
      inputElement.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }
        
        // Auto-resize textarea
        autoResizeTextarea();
      });
      
      // Auto-resize + refresh send-button disabled state on every keystroke.
      // The send button's disabled state now tracks input content (not project
      // existence) so the user can always click it when there's text to send.
      inputElement.addEventListener('input', () => {
        autoResizeTextarea();
        updateInputState();
      });
    }
  }

  /**
   * Auto-resize textarea based on content
   */
  function autoResizeTextarea() {
    if (!inputElement) return;
    
    inputElement.style.height = 'auto';
    inputElement.style.height = Math.min(inputElement.scrollHeight, 200) + 'px';
  }

  // ============================================
  // Message Sending & Streaming
  // ============================================
  
  /**
   * Send a message
   */
  async function sendMessage() {
    if (!inputElement || isStreaming) return;
    
    let content = inputElement.value.trim();
    if (!content) return;
    
    // Input sanitization: remove null bytes and control characters (except newlines/tabs)
    content = content.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
    
    // Validate message length (prevent abuse)
    const MAX_MESSAGE_LENGTH = 100000; // ~100K chars (~25K tokens)
    if (content.length > MAX_MESSAGE_LENGTH) {
      content = content.substring(0, MAX_MESSAGE_LENGTH);
      if (IDEUtils) IDEUtils.showToast('Message was truncated (too long)', 'warning');
    }
    
    // Minimum content check after sanitization
    if (!content.trim()) return;
    
    // Clear input
    inputElement.value = '';
    inputElement.style.height = 'auto';
    
    // Dispatch event for toolbar state management (e.g., auto-disable web search)
    window.dispatchEvent(new CustomEvent('chat:message-sent', { detail: { content } }));
    
    // Create user message
    const userMessage = {
      id: IDEUtils?.generateId() || Date.now().toString(),
      role: 'user',
      content,
      timestamp: Date.now()
    };
    
    // Add to state
    if (window.IDEState) {
      IDEState.addMessage(userMessage);
    }
    
    // Set streaming state (with double-check to prevent race conditions)
    if (isStreaming) {
      console.warn('sendMessage called while already streaming, ignoring');
      return;
    }
    setStreaming(true);
    
    // Create assistant message placeholder
    const assistantMessage = {
      id: IDEUtils?.generateId() || (Date.now() + 1).toString(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true,
      toolCalls: [],
      backend: null   // populated by onBackend callback (cloud/ollama/webllm)
    };
    
    if (window.IDEState) {
      IDEState.addMessage(assistantMessage);
    }
    
    // Call send callback or use API directly
    try {
      if (onSendMessage) {
        await onSendMessage(content, {
          onChunk: (text) => handleStreamChunk(text),
          onToolCall: (tool, args) => handleToolCall(tool, args),
          onToolResult: (result, success) => handleToolResult(result, success),
          onError: (error) => handleStreamError(error),
          onBackend: (backend) => handleBackend(assistantMessage.id, backend),
          onDone: () => handleStreamDone(assistantMessage.id)
        });
      } else {
        // Default: use API client
        await streamWithAPI(content, assistantMessage.id);
      }
    } catch (error) {
      handleStreamError(error);
    }
  }

  /**
   * Record which LLM backend served this message and re-render
   * so the header can show a "local" / "ollama" / "webllm" badge.
   */
  function handleBackend(messageId, backend) {
    if (!window.IDEState || !backend) return;
    const messages = IDEState.get('messages') || [];
    const idx = messages.findIndex(m => m.id === messageId);
    if (idx === -1) return;
    const updated = { ...messages[idx], backend };
    const next = messages.slice();
    next[idx] = updated;
    IDEState.set({ messages: next });
    // Patch the DOM header in-place to avoid full re-render flicker
    const el = document.querySelector(`.message-wrapper[data-message-id="${messageId}"] .message-role`);
    if (el) {
      const label = backend.type === 'ollama' ? 'AI Assistant · Ollama'
                  : backend.type === 'webllm' ? 'AI Assistant · WebLLM'
                  : backend.type === 'cloud'  ? 'AI Assistant'
                  : backend.type === 'demo'   ? 'AI Assistant · Demo'
                  : 'AI Assistant';
      el.textContent = label;
      el.dataset.backend = backend.type || '';
    }
  }

  /**
   * Stream using API client
   */
  async function streamWithAPI(content, messageId) {
    const state = window.IDEState ? IDEState.getState() : {};
    
    currentStreamController = await IDEAPI.sendMessageStream({
      message: content,
      messages: state.messages?.filter(m => !m.isStreaming) || [],
      projectName: state.currentProject?.name || null,
      projectState: state.projectState || {},
      onChunk: (text) => handleStreamChunk(text),
      onToolCall: (tool, args) => handleToolCall(tool, args),
      onToolResult: (result, success) => handleToolResult(result, success),
      onError: (error) => handleStreamError(error),
      onBackend: (backend) => handleBackend(messageId, backend),
      onDone: () => handleStreamDone(messageId)
    });
  }

  /**
   * Handle incoming stream chunk
   */
  function handleStreamChunk(text) {
    if (!text) return;
    
    if (window.IDEState) {
      const messages = IDEState.get('messages') || [];
      const lastMessage = messages[messages.length - 1];
      
      if (lastMessage && lastMessage.role === 'assistant') {
        IDEState.updateLastMessage(lastMessage.content + text);
      }
    }
  }

  /**
   * Handle tool call from AI
   */
  function handleToolCall(tool, args) {
    // Add tool call to current message
    const messages = IDEState?.get('messages') || [];
    const lastMessage = messages[messages.length - 1];
    
    if (lastMessage && lastMessage.role === 'assistant') {
      const updatedToolCalls = [...(lastMessage.toolCalls || []), {
        id: IDEUtils?.generateId() || Date.now().toString(),
        tool,
        args,
        status: 'running',
        result: null
      }];
      
      // We need to update the message with tool calls info
      // This is handled by re-rendering which reads from state
      if (window.IDEState) {
        const updatedMessage = { ...lastMessage, toolCalls: updatedToolCalls };
        const msgIndex = messages.indexOf(lastMessage);
        const newMessages = [...messages];
        newMessages[msgIndex] = updatedMessage;
        IDEState.setMessages(newMessages);
      }
    }
    
    // Notify parent
    if (onToolAction) {
      onToolAction({ type: 'call', tool, args });
    }
  }

  /**
   * Handle tool result
   */
  function handleToolResult(result, success) {
    // Update tool call status in message
    const messages = IDEState?.get('messages') || [];
    const lastMessage = messages[messages.length - 1];
    
    if (lastMessage && lastMessage.toolCalls) {
      const toolCalls = [...lastMessage.toolCalls];
      const lastCall = toolCalls[toolCalls.length - 1];
      if (lastCall && lastCall.status === 'running') {
        lastCall.status = success ? 'complete' : 'error';
        lastCall.result = result;
        
        if (window.IDEState) {
          const updatedMessage = { ...lastMessage, toolCalls };
          const msgIndex = messages.indexOf(lastMessage);
          const newMessages = [...messages];
          newMessages[msgIndex] = updatedMessage;
          IDEState.setMessages(newMessages);
        }
      }
    }
    
    // Notify parent
    if (onToolAction) {
      onToolAction({ type: 'result', result, success });
    }
  }

  /**
   * Handle stream error
   */
  function handleStreamError(error) {
    console.error('Stream error:', error);
    
    // Add error message
    if (window.IDEState) {
      const errorMessage = {
        id: IDEUtils?.generateId() || Date.now().toString(),
        role: 'assistant',
        content: `**Error:** ${error.message || 'Something went wrong'}`,
        timestamp: Date.now(),
        isError: true
      };
      
      // Remove streaming placeholder and add error
      const messages = IDEState.get('messages').filter(m => !m.isStreaming);
      IDEState.setMessages([...messages, errorMessage]);
    }
    
    setStreaming(false);
  }

  /**
   * Handle stream completion
   */
  function handleStreamDone(messageId) {
    // Finalize the streaming message
    if (window.IDEState) {
      const messages = IDEState.get('messages') || [];
      const message = messages.find(m => m.id === messageId);
      
      if (message) {
        const finalizedMessage = { 
          ...message, 
          isStreaming: false,
          timestamp: Date.now()
        };
        
        const msgIndex = messages.indexOf(message);
        const newMessages = [...messages];
        newMessages[msgIndex] = finalizedMessage;
        IDEState.setMessages(newMessages);
      }
    }
    
    setStreaming(false);
  }

  /**
   * Stop current streaming
   */
  function stopStreaming() {
    if (currentStreamController) {
      IDEAPI.cancelStream(currentStreamController);
      currentStreamController = null;
    }
    setStreaming(false);
  }

  /**
   * Set streaming state
   */
  function setStreaming(streaming) {
    isStreaming = streaming;
    
    if (window.IDEState) {
      IDEState.setStreaming(streaming);
    }
    
    // Update UI
    updateInputState();
    scrollToBottom();
  }

  /**
   * Update input area based on state
   */
  function updateInputState() {
    if (!inputContainer) return;
    
    inputContainer.classList.toggle('streaming', isStreaming);
    
    // Update send button
    if (sendButton) {
      if (isStreaming) {
        sendButton.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M4.93 4.93l1.41 1.41"/><circle cx="18" cy="18" r="3"/></svg>`;
        sendButton.setAttribute('aria-label', 'Stop generating');
        sendButton.onclick = stopStreaming;
        sendButton.classList.add('btn-danger');
        sendButton.classList.remove('btn-primary');
      } else {
        sendButton.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
        sendButton.setAttribute('aria-label', 'Send message');
        sendButton.onclick = () => sendMessage();
        sendButton.classList.remove('btn-danger');
        sendButton.classList.add('btn-primary');
      }
    }
    
    // Show/hide stop streaming button (separate button in HTML)
    const stopBtn = document.getElementById('stop-streaming-btn');
    if (stopBtn) {
      stopBtn.classList.toggle('hidden', !isStreaming);
    }
    
    // Enable/disable action buttons when no project selected or no messages
    const hasProject = !!IDEState?.get('currentProject');
    const hasMessages = (IDEState?.get('messages')?.length || 0) > 0;
    
    if (sendButton) {
      // Send button is enabled whenever there's text in the input (or while
    // streaming, so the user can click to stop). Previously this required a
    // project to be selected, which made the button unclickable on a fresh
    // session — Enter still worked because the textarea keydown handler did
    // not check disabled state.
    const hasText = !!(inputElement && inputElement.value.trim());
    sendButton.disabled = !hasText && !isStreaming;
    }
    
    // Update Clear/Export buttons
    const clearBtn = document.getElementById('clear-chat-btn');
    const exportBtn = document.getElementById('export-chat-btn');
    
    if (clearBtn) clearBtn.disabled = !hasMessages || isStreaming;
    if (exportBtn) exportBtn.disabled = !hasMessages || isStreaming;
    
    // Update context indicator
    const contextResults = IDEState?.get('contextResults') || [];
    const contextIndicator = document.getElementById('context-indicator');
    if (contextIndicator) {
      if (contextResults.length > 0) {
        contextIndicator.style.display = 'flex';
        const countEl = contextIndicator.querySelector('.context-count');
        if (countEl) countEl.textContent = contextResults.length;
      } else {
        contextIndicator.style.display = 'none';
      }
    }
  }

  // ============================================
  // Message Rendering
  // ============================================
  
  /**
   * Render all messages
   */
  function renderMessages(messages) {
    if (!messagesContainer) return;
    
    // Check if we should do full re-render or incremental
    const shouldFullRender = messagesContainer.children.length === 0 || 
                             messages.length <= messagesContainer.children.length;
    
    if (shouldFullRender) {
      fullRender(messages);
    } else {
      incrementalRender(messages);
    }
    
    scrollToBottom();
  }

  /**
   * Full render of all messages
   */
  function fullRender(messages) {
    messagesContainer.innerHTML = '';
    
    if (!messages || messages.length === 0) {
      renderEmptyState();
      return;
    }
    
    messages.forEach((message, index) => {
      const el = renderMessage(message, index);
      messagesContainer.appendChild(el);
    });
  }

  /**
   * Incremental render (add only new messages)
   */
  function incrementalRender(messages) {
    const existingCount = messagesContainer.children.length;
    
    for (let i = existingCount; i < messages.length; i++) {
      const el = renderMessage(messages[i], i);
      messagesContainer.appendChild(el);
    }
    
    // Update last message if it's streaming
    const lastMessage = messages[messages.length - 1];
    if (lastMessage && lastMessage.isStreaming) {
      const lastEl = messagesContainer.lastElementChild;
      if (lastEl) {
        updateStreamingContent(lastEl, lastMessage);
      }
    }
  }

  /**
   * Render empty state (welcome screen)
   */
  function renderEmptyState() {
    const project = IDEState?.get('currentProject');
    
    const empty = document.createElement('div');
    empty.className = 'chat-empty-state';
    empty.innerHTML = `
      <div class="welcome-screen">
        <div class="welcome-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
            <path d="M2 17l10 5 10-5"/>
            <path d="M2 12l10 5 10-5"/>
          </svg>
        </div>
        <h2 class="welcome-title">SBIDE</h2>
        <p class="welcome-description">
          ${project ? `Working on project: <strong>${escapeHtml(project.name)}</strong>` : 'Select or create a project to get started'}
        </p>
        <div class="quick-actions">
          <button class="btn btn-outline btn-sm quick-action-btn" data-action="analyze">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <span>Analyze project</span>
          </button>
          <button class="btn btn-outline btn-sm quick-action-btn" data-action="help">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <span>Get help</span>
          </button>
          <button class="btn btn-outline btn-sm quick-action-btn" data-action="search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
            </svg>
            <span>Web search</span>
          </button>
        </div>
      </div>
    `;
    
    // Wire up quick action buttons
    empty.querySelectorAll('.quick-action-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        handleQuickAction(action);
      });
    });
    
    messagesContainer.appendChild(empty);
  }

  /**
   * Render a single message
   */
  function renderMessage(message, index) {
    const wrapper = document.createElement('div');
    wrapper.className = `message-wrapper ${message.role}`;
    wrapper.dataset.messageId = message.id;
    
    // Avatar
    const avatar = document.createElement('div');
    avatar.className = `message-avatar ${message.role}`;
    avatar.innerHTML = message.role === 'user' 
      ? (IDEUtils?.Icons?.user || '')
      : (IDEUtils?.Icons?.bot || '');
    wrapper.appendChild(avatar);
    
    // Content container
    const content = document.createElement('div');
    content.className = `message-content ${message.isStreaming ? 'streaming' : ''}`;
    
    // Header with role label and actions
    const header = document.createElement('div');
    header.className = 'message-header';
    const roleLabel = message.role === 'user' ? 'You'
                    : message.backend?.type === 'ollama' ? 'AI Assistant · Ollama'
                    : message.backend?.type === 'webllm' ? 'AI Assistant · WebLLM'
                    : message.backend?.type === 'demo'   ? 'AI Assistant · Demo'
                    : 'AI Assistant';
    header.innerHTML = `
      <span class="message-role" data-backend="${message.backend?.type || ''}">${roleLabel}</span>
      <span class="message-time">${IDEUtils?.formatRelativeTime(message.timestamp) || ''}</span>
    `;
    content.appendChild(header);
    
    // Body (text content)
    const body = document.createElement('div');
    body.className = 'message-body';
    
    if (message.content) {
      body.innerHTML = formatMessageContent(message.content);
    } else if (message.isStreaming) {
      body.innerHTML = '<span class="streaming-cursor"></span>';
    }
    
    content.appendChild(body);
    
    // Tool calls display
    if (message.toolCalls && message.toolCalls.length > 0) {
      const toolsContainer = document.createElement('div');
      toolsContainer.className = 'tool-calls-container';
      
      message.toolCalls.forEach(tc => {
        toolsContainer.appendChild(renderToolCall(tc));
      });
      
      content.appendChild(toolsContainer);
    }
    
    // Actions bar (for non-streaming messages)
    if (!message.isStreaming) {
      const actions = document.createElement('div');
      actions.className = 'message-actions';
      actions.innerHTML = `
        <button class="action-btn" data-action="copy" title="Copy content">
          ${IDEUtils?.Icons?.copy || ''}
        </button>
        ${message.role === 'user' ? `
          <button class="action-btn" data-action="edit" title="Edit message">
            ${IDEUtils?.Icons?.edit || ''}
          </button>
        ` : `
          <button class="action-btn" data-action="regenerate" title="Regenerate response">
            ${IDEUtils?.Icons?.reload || ''}
          </button>
        `}
        <button class="action-btn" data-action="delete" title="Delete message">
          ${IDEUtils?.Icons?.trash || ''}
        </button>
      `;
      
      // Wire up action buttons
      actions.querySelectorAll('.action-btn').forEach(btn => {
        btn.addEventListener('click', () => handleMessageAction(btn.dataset.action, message));
      });
      
      content.appendChild(actions);
      
      // Suggested actions for assistant messages (not streaming, not errors)
      if (message.role === 'assistant' && !message.isError) {
        const suggestedActions = generateSuggestedActions(message);
        if (suggestedActions.length > 0) {
          const suggestionsContainer = renderSuggestedActions(suggestedActions, message);
          content.appendChild(suggestionsContainer);
        }
      }
    }
    
    wrapper.appendChild(content);
    
    return wrapper;
  }

  /**
   * Format message content (markdown support)
   */
  function formatMessageContent(content) {
    if (!content) return '';
    
    // Basic markdown-like formatting
    let formatted = IDEUtils?.escapeHtml(content) || content;
    
    // Code blocks
    formatted = formatted.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
      return `<pre class="code-block"><code class="language-${lang || 'plaintext'}">${code.trim()}</code></pre>`;
    });
    
    // Inline code
    formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // Bold
    formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    
    // Italic
    formatted = formatted.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    
    // Line breaks
    formatted = formatted.replace(/\n/g, '<br>');
    
    return formatted;
  }

  /**
   * Render a single tool call
   */
  function renderToolCall(toolCall) {
    const el = document.createElement('div');
    el.className = `tool-call ${toolCall.status || 'running'}`;
    el.dataset.toolCallId = toolCall.id;
    
    const toolLabels = {
      read_file: 'Reading file',
      write_file: 'Writing file',
      create_file: 'Creating file',
      delete_file: 'Deleting file',
      list_files: 'Listing files',
      search_files: 'Searching files',
      execute_command: 'Running command',
      web_search: 'Web search',
      think: 'Thinking'
    };
    
    el.innerHTML = `
      <div class="tool-call-header">
        <span class="tool-icon">${IDEUtils?.Icons?.terminal || ''}</span>
        <span class="tool-name">${toolLabels[toolCall.tool] || toolCall.tool}</span>
        <span class="tool-status ${toolCall.status}">
          ${toolCall.status === 'running' ? '⏳ Running...' : 
            toolCall.status === 'complete' ? '✓ Complete' : 
            toolCall.status === 'error' ? '✗ Error' : ''}
        </span>
      </div>
      ${toolCall.args ? `
        <div class="tool-args">
          <pre>${IDEUtils?.escapeHtml(JSON.stringify(toolCall.args, null, 2)) || ''}</pre>
        </div>
      ` : ''}
      ${toolCall.result ? `
        <div class="tool-result">
          <summary>${toolCall.success !== false ? 'Result' : 'Error'}</summary>
          <pre>${IDEUtils?.escapeHtml(typeof toolCall.result === 'string' ? toolCall.result : JSON.stringify(toolCall.result, null, 2)) || ''}</pre>
        </div>
      ` : ''}
    `;
    
    return el;
  }

  /**
   * Update streaming message content incrementally
   */
  function updateStreamingContent(element, message) {
    const body = element.querySelector('.message-body');
    if (body && message.content) {
      body.innerHTML = formatMessageContent(message.content) + '<span class="streaming-cursor"></span>';
    }
  }

  // ============================================
  // Message Actions
  // ============================================
  
  /**
   * Handle message action button clicks
   */
  function handleMessageAction(action, message) {
    switch (action) {
      case 'copy':
        copyMessageContent(message);
        break;
      case 'edit':
        startEditMessage(message);
        break;
      case 'regenerate':
        regenerateResponse(message);
        break;
      case 'delete':
        deleteMessage(message);
        break;
    }
  }

  /**
   * Copy message content to clipboard
   */
  async function copyMessageContent(message) {
    if (message.content && IDEUtils) {
      await IDEUtils.copyToClipboard(message.content);
    }
  }

  /**
   * Start editing a user message
   */
  function startEditMessage(message) {
    if (message.role !== 'user' || !inputElement) return;
    
    inputElement.value = message.content;
    inputElement.focus();
    
    // Mark for truncation on next send
    inputElement.dataset.editMessageId = message.id;
  }

  /**
   * Regenerate an assistant response
   */
  function regenerateResponse(message) {
    if (message.role !== 'assistant') return;
    
    // Find the user message before this one
    const messages = IDEState?.get('messages') || [];
    const index = messages.findIndex(m => m.id === message.id);
    
    if (index > 0) {
      const userMessage = messages[index - 1];
      if (userMessage.role === 'user') {
        // Remove this and any subsequent messages
        const truncated = messages.slice(0, index);
        IDEState.setMessages(truncated);
        
        // Re-send the user message
        if (inputElement) {
          inputElement.value = userMessage.content;
          sendMessage();
        }
      }
    }
  }

  /**
   * Delete a message
   */
  function deleteMessage(message) {
    if (window.IDEState) {
      IDEState.deleteMessage(message.id);
    }
  }

  // ============================================
  // Suggested Actions
  // ============================================

  /**
   * Generate contextual suggested actions based on message content
   * @param {Object} message - The assistant message object
   * @returns {Array} Array of suggestion objects { id, label, icon, action, prompt }
   */
  function generateSuggestedActions(message) {
    const content = (message.content || '').toLowerCase();
    const hasCode = /```|function |const |let |var |class |import |export|<div|<span|{/.test(content);
    const hasFiles = message.toolCalls && message.toolCalls.some(tc => 
      ['read_file', 'write_file', 'create_file', 'delete_file', 'list_files'].includes(tc.tool)
    );
    const hasWebSearch = message.toolCalls && message.toolCalls.some(tc => 
      tc.tool === 'web_search'
    );
    const hasCommand = message.toolCalls && message.toolCalls.some(tc => 
      tc.tool === 'execute_command'
    );

    const suggestions = [];

    // Base suggestions for all responses
    if (hasCode) {
      suggestions.push({
        id: 'explain-code',
        label: 'Explain code',
        icon: 'code',
        action: 'prompt',
        prompt: 'Can you explain this code in more detail?'
      });
      suggestions.push({
        id: 'refactor',
        label: 'Refactor',
        icon: 'refresh',
        action: 'prompt',
        prompt: 'Can you suggest improvements or refactor this code?'
      });
    }

    if (hasFiles) {
      suggestions.push({
        id: 'show-files',
        label: 'Show related files',
        icon: 'folder',
        action: 'prompt',
        prompt: 'What other files should I look at for this feature?'
      });
    }

    // Check if response was about errors or issues
    if (/error|bug|fix|issue|problem|fail/.test(content)) {
      suggestions.push({
        id: 'debug-more',
        label: 'Debug further',
        icon: 'search',
        action: 'prompt',
        prompt: 'Help me debug this issue step by step'
      });
    }

    // Check if response contained explanations
    if (/how to|how do i|steps|tutorial|guide|implement/.test(content)) {
      suggestions.push({
        id: 'examples',
        label: 'Show examples',
        icon: 'lightbulb',
        action: 'prompt',
        prompt: 'Can you show me practical examples of this?'
      });
    }

    // Always add these core suggestions (limit to 4 total)
    if (suggestions.length < 4) {
      suggestions.push({
        id: 'elaborate',
        label: 'Tell me more',
        icon: 'message-circle',
        action: 'prompt',
        prompt: 'Can you elaborate on that?'
      });
    }

    if (suggestions.length < 4) {
      suggestions.push({
        id: 'next-steps',
        label: 'Next steps',
        icon: 'arrow-right',
        action: 'prompt',
        prompt: 'What should I do next?'
      });
    }

    if (suggestions.length < 4 && !hasWebSearch) {
      suggestions.push({
        id: 'search',
        label: 'Search web',
        icon: 'globe',
        action: 'prompt',
        prompt: 'Search the web for more information about this topic'
      });
    }

    // Return max 4 suggestions
    return suggestions.slice(0, 4);
  }

  /**
   * Render suggested actions container
   * @param {Array} suggestions - Array of suggestion objects
   * @param {Object} message - The parent message object
   * @returns {HTMLElement} The suggestions container element
   */
  function renderSuggestedActions(suggestions, message) {
    const container = document.createElement('div');
    container.className = 'suggested-actions';
    
    const icons = {
      'code': '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
      'refresh': '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>',
      'folder': '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>',
      'search': '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
      'lightbulb': '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0018 8 6 6 0 00-9-5.39a6.02 6.02 0 00-4.62 5.2c-.41 2.07.94 3.83 1.91 4.99.76.93 1.62 1.74 1.82 2.7"/></svg>',
      'message-circle': '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>',
      'arrow-right': '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>',
      'globe': '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>'
    };

    container.innerHTML = `
      <div class="suggested-actions-label">Suggested follow-ups</div>
      <div class="suggested-actions-list">
        ${suggestions.map(s => `
          <button 
            class="suggestion-chip" 
            data-suggestion-id="${s.id}"
            data-prompt="${s.prompt.replace(/"/g, '&quot;')}"
            title="${s.prompt}"
          >
            <span class="suggestion-icon">${icons[s.icon] || icons['message-circle']}</span>
            <span class="suggestion-label">${s.label}</span>
          </button>
        `).join('')}
      </div>
    `;

    // Wire up click handlers
    container.querySelectorAll('.suggestion-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const prompt = chip.dataset.prompt;
        if (prompt && inputElement) {
          inputElement.value = prompt;
          inputElement.focus();
          // Auto-send after a brief delay for UX
          setTimeout(() => sendMessage(), 100);
        }
      });
    });

    return container;
  }

  // ============================================
  // Utility Functions
  // ============================================
  
  /**
   * Escape HTML entities
   */
  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Scroll to bottom of messages
   */
  function scrollToBottom() {
    if (messagesContainer) {
      requestAnimationFrame(() => {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      });
    }
  }

  /**
   * Clear all messages with confirmation
   */
  function clearMessages() {
    const messages = IDEState?.get('messages') || [];
    if (messages.length === 0) return;
    
    if (confirm('Are you sure you want to clear the conversation? This will not affect your project files.')) {
      if (window.IDEState) {
        IDEState.clearMessages();
      }
      if (messagesContainer) {
        messagesContainer.innerHTML = '';
        renderEmptyState();
      }
      if (IDEUtils) IDEUtils.showToast('Conversation cleared', 'success');
    }
  }
  
  /**
   * Export conversation to file
   */
  function exportConversation() {
    const messages = IDEState?.get('messages') || [];
    if (messages.length === 0) {
      if (IDEUtils) IDEUtils.showToast('No messages to export', 'warning');
      return;
    }
    
    const conversation = messages
      .map(m => `[${new Date(m.timestamp).toISOString()}] ${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n');
    
    const blob = new Blob([conversation], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `conversation-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    
    if (IDEUtils) IDEUtils.showToast('Conversation exported', 'success');
  }
  
  /**
   * Handle quick action button clicks
   */
  function handleQuickAction(action) {
    const suggestions = {
      analyze: 'Help me understand the project structure',
      help: 'What can you help me with?',
      search: 'Search for the latest web development trends'
    };
    
    if (inputElement && suggestions[action]) {
      inputElement.value = suggestions[action];
      inputElement.focus();
      // Refresh send-button disabled state — the input now has text.
      updateInputState();
    }
  }
  
  /**
   * Rollback - remove message and all after it
   */
  function rollbackMessage(messageId) {
    const messages = IDEState?.get('messages') || [];
    const index = messages.findIndex(m => m.id === messageId);
    if (index === -1) return;
    
    // Create backup before rollback
    const project = IDEState?.get('currentProject');
    if (project) {
      fetch('/api/ide/versions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          project: project.name,
          createArchive: true,
          suffix: '.2',
          description: 'Pre-rollback backup'
        })
      }).catch(e => console.error('Pre-rollback backup failed:', e));
    }
    
    // Keep only messages before this one
    const truncated = messages.slice(0, index);
    IDEState.setMessages(truncated);
    
    if (IDEUtils) IDEUtils.showToast('Rolled back conversation', 'success');
  }

  /**
   * Focus input field
   */
  function focusInput() {
    if (inputElement) {
      inputElement.focus();
    }
  }

  // ============================================
  // Public API
  // ============================================
  
  return {
    init,
    sendMessage,
    stopStreaming,
    clearMessages,
    exportConversation,
    focusInput,
    rollbackMessage,
    
    getState: () => ({
      isStreaming,
      hasMessages: (IDEState?.get('messages')?.length || 0) > 0
    })
  };
})();

// Export for use in other modules
window.ChatWindowComponent = ChatWindowComponent;
