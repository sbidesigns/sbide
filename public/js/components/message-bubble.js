/**
 * SBIDE - Message Bubble Component
 * Renders individual chat messages with markdown, code blocks, and action buttons
 * Ported from React MessageBubble.tsx with full feature parity
 */

const MessageBubbleComponent = (() => {
  // ============================================
  // State
  // ============================================
  
  let container = null;
  let message = null;
  let isStreaming = false;
  
  // Callbacks
  let onRegenerate = null;
  let onRollback = null;
  let onEditAndRegenerate = null;
  
  // Dialog state
  let activeDialog = null;

  // ============================================
  // Initialization
  // ============================================
  
  /**
   * Initialize message bubble component
   * @param {HTMLElement} element - Container element for the bubble
   * @param {Object} options - Configuration options
   */
  function init(element, options = {}) {
    if (!element) {
      console.error('MessageBubble: Container element required');
      return;
    }
    
    container = element;
    onRegenerate = options.onRegenerate || null;
    onRollback = options.onRollback || null;
    onEditAndRegenerate = options.onEditAndRegenerate || null;
  }

  // ============================================
  // Rendering
  // ============================================
  
  /**
   * Render a message bubble
   * @param {Object} msg - Message object { id, role, content, timestamp, ... }
   * @param {Object} renderOptions - Additional options
   */
  function render(msg, renderOptions = {}) {
    if (!container) return;
    
    message = msg;
    isStreaming = renderOptions.isStreaming || false;
    onRegenerate = renderOptions.onRegenerate || onRegenerate;
    onRollback = renderOptions.onRollback || onRollback;
    onEditAndRegenerate = renderOptions.onEditAndRegenerate || onEditAndRegenerate;
    
    const isUser = msg.role === 'user';
    const isSystem = msg.role === 'system';
    
    // System message (centered)
    if (isSystem) {
      container.innerHTML = `
        <div class="message-bubble message-system">
          <span class="message-system-content">${escapeHtml(msg.content)}</span>
        </div>
      `;
      return;
    }
    
    // Regular message (user or assistant)
    const formattedTime = formatTime(msg.timestamp);
    const avatarHtml = renderAvatar(isUser);
    const contentHtml = renderContent(msg, isUser);
    const metaHtml = renderMetadata(msg, isUser, formattedTime);
    const actionsHtml = !isStreaming ? renderActions(msg, isUser) : '';
    const sourcesHtml = !isUser && msg.sources && msg.sources.length > 0 ? renderSources(msg.sources) : '';
    const streamingProgressHtml = isStreaming && !isUser && msg.content ? renderStreamingProgress(msg.content) : '';
    
    container.innerHTML = `
      <div class="message-bubble ${isUser ? 'message-user' : 'message-assistant'}" data-message-id="${msg.id}">
        <div class="message-avatar">${avatarHtml}</div>
        <div class="message-body">
          <div class="message-content ${isUser ? 'user-content' : 'assistant-content'}">
            ${contentHtml}
            ${isStreaming && isUser ? '<span class="streaming-cursor"></span>' : ''}
          </div>
          ${streamingProgressHtml}
          ${metaHtml}
          ${actionsHtml}
          ${sourcesHtml}
        </div>
      </div>
      
      <!-- Dialogs will be appended here when needed -->
      <div class="message-dialogs"></div>
    `;
    
    // Wire up event listeners
    wireUpActions(container, msg, isUser);
    
    // Apply syntax highlighting to code blocks
    applySyntaxHighlighting(container);
  }
  
  /**
   * Render avatar icon
   */
  function renderAvatar(isUser) {
    if (isUser) {
      return `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="avatar-icon">
          <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
          <circle cx="12" cy="7" r="4"/>
        </svg>
      `;
    }
    return `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="avatar-icon">
        <rect x="3" y="11" width="18" height="10" rx="2"/>
        <circle cx="12" cy="5" r="2"/>
        <path d="M8 15h.01M16 15h.01M12 17h.01"/>
      </svg>
    `;
  }
  
  /**
   * Render message content with markdown support
   */
  function renderContent(msg, isUser) {
    const content = msg.content || '';
    
    // Show typing indicator for empty streaming messages
    if (isStreaming && !content) {
      return `
        <div class="typing-indicator">
          <span class="typing-dot"></span>
          <span class="typing-dot"></span>
          <span class="typing-dot"></span>
        </div>
      `;
    }
    
    // Parse and render markdown
    return parseMarkdown(content, isUser);
  }
  
  /**
   * Parse markdown content to HTML
   */
  function parseMarkdown(content, isUser) {
    if (!content) return '';
    
    let html = escapeHtml(content);
    
    // Code blocks (```language\ncode\n```)
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (match, language, code) => {
      return renderCodeBlock(code.trim(), language.trim(), isUser);
    });
    
    // Inline code (`code`)
    html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
    
    // Bold (**text**)
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    
    // Italic (*text*)
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    
    // Headers
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    
    // Links [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    
    // Line breaks
    html = html.replace(/\n/g, '<br>');
    
    // Paragraphs (double newline)
    html = html.replace(/<br><br>/g, '</p><p>');
    
    return `<div class="markdown-content">${html}</div>`;
  }
  
  /**
   * Render a code block with syntax highlighting and controls
   */
  function renderCodeBlock(code, language, isUser) {
    const lineCount = code.split('\n').length;
    const isLarge = lineCount > 30;
    const blockId = `code-block-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    return `
      <div class="code-block ${isLarge ? 'code-block-large' : ''}" data-block-id="${blockId}" data-language="${language}">
        <div class="code-block-header">
          <div class="code-block-info">
            <span class="code-language">${language || 'text'}</span>
            ${isLarge ? `<span class="code-line-count">${lineCount} lines</span>` : ''}
          </div>
          <button class="code-copy-btn icon-btn xs" title="Copy code" data-code="${escapeAttr(code)}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
            </svg>
            <span>Copy</span>
          </button>
        </div>
        <div class="code-block-body ${isLarge ? 'collapsed' : ''}">
          <pre class="code-pre"><code class="language-${language}">${code}</code></pre>
          ${isLarge ? `
            <div class="code-expand-overlay">
              <button class="code-expand-btn btn btn-ghost btn-xs">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
                Show ${lineCount - 15} more lines
              </button>
            </div>
          ` : ''}
        </div>
        ${isLarge ? `
          <div class="code-block-footer hidden">
            <button class="code-collapse-btn btn btn-ghost btn-xs">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="18 15 12 9 6 15"/>
              </svg>
              Collapse
            </button>
          </div>
        ` : ''}
      </div>
    `;
  }
  
  /**
   * Render metadata (timestamp, badges)
   */
  function renderMetadata(msg, isUser, formattedTime) {
    const badges = [];
    
    // Files badge
    if ((msg.filesCreated?.length || msg.filesModified?.length)) {
      badges.push(`
        <span class="message-badge badge-files">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/>
            <polyline points="13 2 13 9 20 9"/>
          </svg>
          ${(msg.filesCreated?.length || 0) + (msg.filesModified?.length || 0)} files
        </span>
      `);
    }
    
    // Anchors badge
    if (msg.memoryAnchors && msg.memoryAnchors.length > 0) {
      badges.push(`
        <span class="message-badge badge-anchors">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="5" r="3"/>
            <line x1="12" y1="22" x2="12" y2="8"/>
            <path d="M5 12H2a10 10 0 0020 0h-3"/>
          </svg>
          ${msg.memoryAnchors.length} anchors
        </span>
      `);
    }
    
    // Confidence badge
    if (msg.confidence !== undefined) {
      const confidenceClass = msg.confidence > 0.8 ? 'confidence-high' : msg.confidence > 0.5 ? 'confidence-medium' : 'confidence-low';
      badges.push(`<span class="message-badge ${confidenceClass}">${Math.round(msg.confidence * 100)}% confident</span>`);
    }
    
    return `
      <div class="message-meta ${isUser ? 'meta-user' : 'meta-assistant'}">
        <span class="message-time" title="${new Date(msg.timestamp).toLocaleString()}">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
          ${formattedTime}
        </span>
        ${badges.join('')}
      </div>
    `;
  }
  
  /**
   * Render action buttons
   */
  function renderActions(msg, isUser) {
    if (isUser) {
      return `
        <div class="message-actions actions-user">
          <button class="action-btn btn-action-copy" data-action="copy" title="Copy">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
            </svg>
            <span>Copy</span>
          </button>
          <button class="action-btn btn-action-edit" data-action="edit" title="Edit">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            <span>Edit</span>
          </button>
          <button class="action-btn btn-action-delete destructive" data-action="delete" title="Delete">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
            </svg>
            <span>Delete</span>
          </button>
        </div>
      `;
    }
    
    return `
      <div class="message-actions actions-assistant">
        <button class="action-btn btn-action-copy" data-action="copy" title="Copy">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
          </svg>
          <span>Copy</span>
        </button>
        <button class="action-btn btn-action-rollback destructive" data-action="rollback" title="Rollback">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="1 4 1 10 7 10"/>
            <polyline points="23 20 23 14 17 14"/>
            <path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/>
          </svg>
          <span>Rollback</span>
        </button>
        <button class="action-btn btn-action-delete destructive" data-action="delete" title="Delete">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
          </svg>
          <span>Delete</span>
        </button>
        <button class="action-btn btn-action-regenerate" data-action="regenerate" title="Regenerate">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
          </svg>
          <span>Regenerate</span>
        </button>
      </div>
    `;
  }
  
  /**
   * Render sources list
   */
  function renderSources(sources) {
    return `
      <div class="message-sources">
        <p class="sources-label">Sources:</p>
        <div class="sources-list">
          ${sources.map(source => `
            <a href="${source.url}" target="_blank" rel="noopener noreferrer" class="source-link">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
              <span class="source-title">${escapeHtml(source.title)}</span>
            </a>
          `).join('')}
        </div>
      </div>
    `;
  }
  
  /**
   * Render streaming progress indicator
   */
  function renderStreamingProgress(content) {
    const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
    const charCount = content.length;
    const lineCount = content.split('\n').length;
    
    return `
      <div class="streaming-progress">
        <div class="streaming-status">
          <span class="streaming-dot"></span>
          <span>Streaming...</span>
        </div>
        <div class="streaming-stats">
          <span>${wordCount} words</span>
          <span>${charCount} chars</span>
          <span>${lineCount} lines</span>
        </div>
      </div>
    `;
  }

  // ============================================
  // Event Handling
  // ============================================
  
  /**
   * Wire up action button events
   */
  function wireUpActions(bubbleEl, msg, isUser) {
    // Copy action
    bubbleEl.querySelector('.btn-action-copy')?.addEventListener('click', () => handleCopy(msg));
    
    // Edit action (user only)
    bubbleEl.querySelector('.btn-action-edit')?.addEventListener('click', () => handleEdit(msg));
    
    // Delete action
    bubbleEl.querySelector('.btn-action-delete')?.addEventListener('click', () => handleDelete(msg));
    
    // Rollback action (AI only)
    bubbleEl.querySelector('.btn-action-rollback')?.addEventListener('click', () => handleRollback(msg));
    
    // Regenerate action (AI only)
    bubbleEl.querySelector('.btn-action-regenerate')?.addEventListener('click', () => handleRegenerate(msg));
    
    // Code block copy buttons
    bubbleEl.querySelectorAll('.code-copy-btn').forEach(btn => {
      btn.addEventListener('click', () => handleCodeCopy(btn));
    });
    
    // Code block expand/collapse
    bubbleEl.querySelector('.code-expand-btn')?.addEventListener('click', (e) => {
      const block = e.target.closest('.code-block');
      expandCodeBlock(block);
    });
    
    bubbleEl.querySelector('.code-collapse-btn')?.addEventListener('click', (e) => {
      const block = e.target.closest('.code-block');
      collapseCodeBlock(block);
    });
  }
  
  /**
   * Handle copy message
   */
  async function handleCopy(msg) {
    try {
      await navigator.clipboard.writeText(msg.content || '');
      if (IDEUtils) IDEUtils.showToast('Copied to clipboard', 'success');
      
      // Update button state briefly
      const btn = container.querySelector('.btn-action-copy');
      if (btn) {
        btn.classList.add('copied');
        setTimeout(() => btn.classList.remove('copied'), 2000);
      }
    } catch (err) {
      console.error('Failed to copy:', err);
      if (IDEUtils) IDEUtils.showToast('Failed to copy', 'error');
    }
  }
  
  /**
   * Handle copy code block
   */
  async function handleCodeCopy(btn) {
    const code = btn.dataset.code;
    if (!code) return;
    
    try {
      await navigator.clipboard.writeText(code);
      btn.classList.add('copied');
      btn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        <span>Copied!</span>
      `;
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.innerHTML = `
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
          </svg>
          <span>Copy</span>
        `;
      }, 2000);
    } catch (err) {
      console.error('Failed to copy code:', err);
    }
  }
  
  /**
   * Expand large code block
   */
  function expandCodeBlock(block) {
    const body = block?.querySelector('.code-block-body');
    const overlay = block?.querySelector('.code-expand-overlay');
    const footer = block?.querySelector('.code-block-footer');
    
    if (body) body.classList.remove('collapsed');
    if (overlay) overlay.style.display = 'none';
    if (footer) footer.classList.remove('hidden');
  }
  
  /**
   * Collapse large code block
   */
  function collapseCodeBlock(block) {
    const body = block?.querySelector('.code-block-body');
    const footer = block?.querySelector('.code-block-footer');
    
    if (body) body.classList.add('collapsed');
    if (footer) footer.classList.add('hidden');
  }
  
  /**
   * Handle edit message (show edit dialog)
   */
  function handleEdit(msg) {
    showEditDialog(msg);
  }
  
  /**
   * Handle delete message
   */
  function handleDelete(msg) {
    showDeleteDialog(msg);
  }
  
  /**
   * Handle rollback
   */
  function handleRollback(msg) {
    showRollbackDialog(msg);
  }
  
  /**
   * Handle regenerate
   */
  function handleRegenerate(msg) {
    showRegenerateDialog(msg);
  }

  // ============================================
  // Dialog Management
  // ============================================
  
  /**
   * Show edit & regenerate confirmation dialog
   */
  function showEditDialog(msg) {
    closeDialog();
    
    activeDialog = document.createElement('div');
    activeDialog.className = 'modal-overlay';
    activeDialog.setAttribute('role', 'alertdialog');
    activeDialog.setAttribute('aria-modal', 'true');
    
    activeDialog.innerHTML = `
      <div class="modal modal-sm">
        <div class="modal-header">
          <h2 class="modal-title">Edit & Regenerate</h2>
          <button class="icon-btn dialog-close-btn" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="modal-body">
          <p class="dialog-description">
            Editing this message will remove all responses after it and regenerate a new response.
            A backup checkpoint will be created before making changes.
            Are you sure you want to continue?
          </p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline cancel-dialog-btn">Cancel</button>
          <button class="btn btn-primary confirm-edit-btn">Edit & Regenerate</button>
        </div>
      </div>
    `;
    
    wireUpDialogEvents(activeDialog, {
      onCancel: () => closeDialog(),
      onConfirm: () => {
        if (onEditAndRegenerate) {
          // For now, just call the callback - edit UI would need more work
          onEditAndRegenerate(msg.id, msg.content);
        }
        closeDialog();
      }
    });
    
    document.body.appendChild(activeDialog);
  }
  
  /**
   * Show delete confirmation dialog
   */
  function showDeleteDialog(msg) {
    closeDialog();
    
    activeDialog = document.createElement('div');
    activeDialog.className = 'modal-overlay';
    activeDialog.setAttribute('role', 'alertdialog');
    activeDialog.setAttribute('aria-modal', 'true');
    
    activeDialog.innerHTML = `
      <div class="modal modal-sm">
        <div class="modal-header modal-header-danger">
          <h2 class="modal-title">Delete Message</h2>
          <button class="icon-btn dialog-close-btn" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="modal-body">
          <p class="dialog-description">
            This will delete this message. This action may affect the conversation context.
            Are you sure you want to continue?
          </p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline cancel-dialog-btn">Cancel</button>
          <button class="btn btn-danger confirm-delete-btn">Delete</button>
        </div>
      </div>
    `;
    
    wireUpDialogEvents(activeDialog, {
      onCancel: () => closeDialog(),
      onConfirm: () => {
        // Call store to delete message
        if (IDEState && typeof IDEState.deleteMessage === 'function') {
          IDEState.deleteMessage(msg.id);
        }
        if (IDEUtils) IDEUtils.showToast('Message deleted', 'success');
        closeDialog();
      }
    });
    
    document.body.appendChild(activeDialog);
  }
  
  /**
   * Show rollback confirmation dialog
   */
  function showRollbackDialog(msg) {
    closeDialog();
    
    activeDialog = document.createElement('div');
    activeDialog.className = 'modal-overlay';
    activeDialog.setAttribute('role', 'alertdialog');
    activeDialog.setAttribute('aria-modal', 'true');
    
    activeDialog.innerHTML = `
      <div class="modal modal-sm">
        <div class="modal-header modal-header-warning">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <h2 class="modal-title">Rollback Conversation</h2>
          <button class="icon-btn dialog-close-btn" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="modal-body">
          <p class="dialog-description">
            This will remove this message and all messages after it.
            This may affect project state and any changes made by the AI.
            A backup checkpoint will be created before rollback.
          </p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline cancel-dialog-btn">Cancel</button>
          <button class="btn btn-danger confirm-rollback-btn">Rollback</button>
        </div>
      </div>
    `;
    
    wireUpDialogEvents(activeDialog, {
      onCancel: () => closeDialog(),
      onConfirm: () => {
        if (onRollback) {
          onRollback(msg.id);
        }
        closeDialog();
      }
    });
    
    document.body.appendChild(activeDialog);
  }
  
  /**
   * Show regenerate confirmation dialog
   */
  function showRegenerateDialog(msg) {
    closeDialog();
    
    activeDialog = document.createElement('div');
    activeDialog.className = 'modal-overlay';
    activeDialog.setAttribute('role', 'alertdialog');
    activeDialog.setAttribute('aria-modal', 'true');
    
    activeDialog.innerHTML = `
      <div class="modal modal-sm">
        <div class="modal-header">
          <h2 class="modal-title">Regenerate Response</h2>
          <button class="icon-btn dialog-close-btn" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="modal-body">
          <p class="dialog-description">
            This will generate a new response. A backup checkpoint will be created
            with version suffix ".2" before regenerating.
          </p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline cancel-dialog-btn">Cancel</button>
          <button class="btn btn-primary confirm-regenerate-btn">Regenerate</button>
        </div>
      </div>
    `;
    
    wireUpDialogEvents(activeDialog, {
      onCancel: () => closeDialog(),
      onConfirm: () => {
        if (onRegenerate) {
          onRegenerate(msg.id);
        }
        closeDialog();
      }
    });
    
    document.body.appendChild(activeDialog);
  }
  
  /**
   * Wire up common dialog events
   */
  function wireUpDialogEvents(dialogEl, { onCancel, onConfirm }) {
    dialogEl.querySelector('.cancel-dialog-btn, .dialog-close-btn')?.addEventListener('click', onCancel);
    dialogEl.querySelector('.confirm-edit-btn, .confirm-delete-btn, .confirm-rollback-btn, .confirm-regenerate-btn')?.addEventListener('click', onConfirm);
    
    dialogEl.addEventListener('click', (e) => {
      if (e.target === dialogEl) onCancel();
    });
    
    dialogEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') onCancel();
    });
  }
  
  /**
   * Close any open dialog
   */
  function closeDialog() {
    if (activeDialog) {
      activeDialog.remove();
      activeDialog = null;
    }
  }

  // ============================================
  // Syntax Highlighting
  // ============================================
  
  /**
   * Apply syntax highlighting to code blocks
   */
  function applySyntaxHighlighting(containerEl) {
    if (window.hljs) {
      containerEl.querySelectorAll('pre code').forEach(block => {
        hljs.highlightElement(block);
      });
    }
  }

  // ============================================
  // Utility Functions
  // ============================================
  
  /**
   * Format timestamp to time string
   */
  function formatTime(timestamp) {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });
  }
  
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
   * Escape HTML attribute value
   */
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
    closeDialog,
    
    // Expose for external use
    showEditDialog,
    showDeleteDialog,
    showRollbackDialog,
    showRegenerateDialog
  };
})();

// Export for use in other modules
window.MessageBubbleComponent = MessageBubbleComponent;
