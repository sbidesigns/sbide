/**
 * SBIDE - HTML Sanitization Utility
 * Prevents XSS attacks by sanitizing user/AI content before DOM insertion
 */

const IDESanitize = (() => {
  
  /**
   * Sanitize HTML string - removes dangerous tags and attributes
   * @param {string} html - Potentially unsafe HTML
   * @param {Object} options - Sanitization options
   * @returns {string} - Safe HTML string
   */
  function sanitize(html, options = {}) {
    if (!html) return '';
    
    const {
      allowTags = [],       // Additional allowed tags (e.g., ['code', 'pre'])
      allowAttrs = [],      // Additional allowed attributes
      stripAll = false      // If true, return plain text only
    } = options;
    
    // If stripping all, just escape everything
    if (stripAll) {
      return escapeHtml(html);
    }
    
    // Create a temporary element to parse HTML
    const temp = document.createElement('div');
    temp.textContent = ''; // Clear any existing content
    
    // Basic allowed tags for rich text display
    const defaultAllowedTags = new Set([
      'b', 'i', 'em', 'strong', 'u', 's', 'del',
      'code', 'pre', 'kbd', 'samp', 'var',
      'sub', 'sup', 'br', 'hr', 'p',
      'ul', 'ol', 'li', 'blockquote',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'a', 'span', 'div', 'img'
    ]);
    
    // Add custom allowed tags
    allowTags.forEach(tag => defaultAllowedTags.add(tag.toLowerCase()));
    
    // Dangerous tags to always remove
    const dangerousTags = new Set([
      'script', 'style', 'iframe', 'object', 'embed',
      'form', 'input', 'button', 'select', 'textarea',
      'meta', 'link', 'base', 'noscript',
      'applet', 'frame', 'frameset', 'svg', 'math'
    ]);
    
    // Allowed attributes per tag
    const allowedAttrs = {
      'a': ['href', 'title', 'target'],
      'img': ['src', 'alt', 'title', 'width', 'height'],
      'td': ['colspan', 'rowspan'],
      'th': ['colspan', 'rowspan'],
      '*': ['class', 'id', 'title'] // Global allowed attrs
    };
    
    // Dangerous attributes to remove
    const dangerousAttrPatterns = [
      /^on/i,           // Event handlers: onclick, onerror, etc.
      /^javascript:/i,   // JS URLs
      /^data:text\/html/i, // Data URIs with HTML
      /expression/,     // IE CSS expressions
      /^moz-binding/,   // Mozilla binding
      /@import/         // CSS imports
    ];
    
    /**
     * Recursively sanitize a DOM node
     */
    function sanitizeNode(node) {
      const nodes = [...node.childNodes];
      
      nodes.forEach(child => {
        if (child.nodeType === Node.TEXT_NODE) {
          // Text nodes are safe
          return;
        }
        
        if (child.nodeType === Node.ELEMENT_NODE) {
          const tagName = child.tagName.toLowerCase();
          
          // Remove dangerous tags entirely (keep children)
          if (dangerousTags.has(tagName)) {
            while (child.firstChild) {
              sanitizeNode(child.firstChild);
              child.parentNode.insertBefore(child.firstChild, child);
            }
            child.remove();
            return;
          }
          
          // Remove disallowed tags but keep content
          if (!defaultAllowedTags.has(tagName)) {
            while (child.firstChild) {
              sanitizeNode(child.firstChild);
              child.parentNode.insertBefore(child.firstChild, child);
            }
            child.remove();
            return;
          }
          
          // Sanitize attributes
          const attrsToRemove = [];
          
          for (const attr of child.attributes) {
            const attrName = attr.name.toLowerCase();
            const attrValue = attr.value;
            
            // Check against dangerous patterns
            const isDangerous = dangerousAttrPatterns.some(pattern => 
              pattern.test(attrName) || pattern.test(attrValue)
            );
            
            if (isDangerous) {
              attrsToRemove.push(attr.name);
              continue;
            }
            
            // Check if attribute is allowed for this tag
            const tagAllowed = allowedAttrs[tagName] || [];
            const globalAllowed = allowedAttrs['*'] || [];
            
            if (!tagAllowed.includes(attrName) && !globalAllowed.includes(attrName)) {
              // For href/src, do extra validation
              if ((attrName === 'href' || attrName === 'src')) {
                if (attrValue.toLowerCase().startsWith('javascript:') ||
                    attrValue.toLowerCase().startsWith('data:text/html')) {
                  attrsToRemove.push(attr.name);
                }
              } else if (attrName !== 'style') { // Allow style for basic formatting
                attrsToRemove.push(attr.name);
              }
            }
            
            // Validate URLs in href/src
            if ((attrName === 'href' || attrName === 'src') && !attrsToRemove.includes(attr.name)) {
              try {
                const url = new URL(attrValue, window.location.origin);
                // Only allow http/https/mailto protocols
                if (!['http:', 'https:', 'mailto:', '#'].includes(url.protocol)) {
                  attrsToRemove.push(attr.name);
                }
              } catch {
                // Invalid URL, remove attribute
                attrsToRemove.push(attr.name);
              }
            }
          }
          
          attrsToRemove.forEach(attr => child.removeAttribute(attr));
          
          // Recursively sanitize children
          sanitizeNode(child);
        }
        
        // Remove comment nodes (can contain conditional IE code)
        if (child.nodeType === Node.COMMENT_NODE) {
          child.remove();
        }
      });
    }
    
    // Parse and sanitize
    temp.innerHTML = html;
    sanitizeNode(temp);
    
    return temp.innerHTML;
  }
  
  /**
   * Escape HTML entities (for plain text insertion)
   */
  function escapeHtml(text) {
    if (!text) return '';
    
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  /**
   * Escape HTML attributes
   */
  function escapeAttr(text) {
    if (!text) return '';
    
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
  
  /**
   * Sanitize filename/path for display
   */
  function sanitizeFilename(name) {
    if (!name) return '';
    // Remove path traversal attempts and dangerous chars
    return name
      .replace(/\.\./g, '')
      .replace(/[<>:"|?*]/g, '_')
      .substring(0, 255); // Max filename length
  }

  return {
    sanitize,
    escapeHtml,
    escapeAttr,
    sanitizeFilename
  };
})();

// Export globally
window.IDESanitize = IDESanitize;
