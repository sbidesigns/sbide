import re

filepath = '/tmp/sbide/js/components/search-panel.js'

with open(filepath, 'r') as f:
    content = f.read()

new_handle_search = '''  async function handleSearch() {
    if (!localQuery.trim() || isSearching) return;
    
    if (IDEState) {
      IDEState.set({ searchQuery: localQuery, isSearching: true });
    }
    
    try {
      // ============================================
      // STEP 1: Fetch raw search results
      // ============================================
      let rawResults = [];
      
      try {
        const ddgResponse = await fetch(
          'https://api.duckduckgo.com/?q=' + encodeURIComponent(localQuery) + '&format=json&no_html=1'
        );
        
        if (ddgResponse.ok) {
          const ddgData = await ddgResponse.json();
          
          // Add Abstract as main result
          if (ddgData.Abstract) {
            rawResults.push({
              title: ddgData.Heading || localQuery,
              snippet: ddgData.Abstract,
              url: ddgData.AbstractURL || 'https://duckduckgo.com/?q=' + encodeURIComponent(localQuery),
              favicon: '',
              source: 'ddg-abstract',
              relevanceScore: 1.0
            });
          }
          
          // Add RelatedTopics as results
          if (ddgData.RelatedTopics && Array.isArray(ddgData.RelatedTopics)) {
            ddgData.RelatedTopics.forEach((topic, idx) => {
              if (topic.Text && topic.FirstURL && rawResults.length < 10) {
                rawResults.push({
                  title: topic.Text.split(' - ')[0] || topic.Text.substring(0, 80),
                  snippet: topic.Text.substring(0, 300),
                  url: topic.FirstURL,
                  favicon: topic.Icon?.URL || '',
                  source: 'ddg-related',
                  relevanceScore: 1 - (idx * 0.05) // Slight decay for later results
                });
              }
            });
          }
        }
      } catch (e) {
        console.warn('DuckDuckGo API failed:', e.message);
      }
      
      // Fallback if no DDG results
      if (rawResults.length === 0) {
        rawResults.push({
          title: 'Search on DuckDuckGo',
          snippet: 'Click to search for "' + localQuery + '" on DuckDuckGo',
          url: 'https://duckduckgo.com/?q=' + encodeURIComponent(localQuery),
          favicon: '',
          source: 'fallback',
          relevanceScore: 0.5
        });
      }
      
      // ============================================
      // STEP 2: Process with LLM (with fallbacks)
      // ============================================
      let processedResults = await processSearchResults(rawResults, localQuery);
      
      if (IDEState) IDEState.set({ searchResults: processedResults });
      if (IDEUtils) IDEUtils.showToast('Found ' + processedResults.length + ' results' + 
        (processedResults[0]?.llmProcessed ? ' (AI-enhanced)' : ''), 'success');
        
    } catch (error) {
      console.error('Search failed:', error);
      if (IDEUtils) IDEUtils.showToast('Search failed - opening in new tab', 'error');
      window.open('https://duckduckgo.com/?q=' + encodeURIComponent(localQuery), '_blank');
      if (IDEState) IDEState.set({ searchResults: [] });
    } finally {
      if (IDEState) IDEState.set({ isSearching: false });
    }
  }

  /**
   * Process search results with intelligent fallback chain:
   * 1. WebLLM (offline, in-browser) - full AI processing
   * 2. Cloud LLM API - if configured in settings
   * 3. Client-side heuristics - basic truncation/relevance
   */
  async function processSearchResults(results, query) {
    if (results.length === 0) return results;
    
    const MAX_SNIPPET_LENGTH = 250;
    const CONTEXT_TOKEN_BUDGET = 2000; // Approximate token limit for context
    
    // Try WebLLM first (offline)
    try {
      if (window.OfflineKit && typeof OfflineKit.isWebLLMSupported === 'function' && 
          OfflineKit.isWebLLMSupported()) {
        return await processWithWebLLM(results, query);
      }
    } catch (e) {
      console.warn('WebLLM processing failed, trying next option:', e.message);
    }
    
    // Try Cloud LLM second
    try {
      if (window.OfflineKit && typeof OfflineKit.getStatus === 'function') {
        const status = OfflineKit.getStatus();
        if (status.llm?.type === 'cloud') {
          return await processWithCloudLLM(results, query);
        }
      }
    } catch (e) {
      console.warn('Cloud LLM processing failed, using client-side:', e.message);
    }
    
    // Fallback: Client-side heuristic processing
    return processClientSide(results, query, MAX_SNIPPET_LENGTH, CONTEXT_TOKEN_BUDGET);
  }

  /**
   * Process with WebLLM (offline, in-browser AI)
   */
  async function processWithWebLLM(results, query) {
    if (!window.OfflineKit || typeof OfflineKit.chat !== 'function') {
      throw new Error('WebLLM not available');
    }
    
    // Build context from results
    const contextText = results.map((r, i) => 
      `[${i+1}] Title: ${r.title}\\nSnippet: ${r snippet}\\nURL: ${r.url}`
    ).join('\\n\\n');
    
    const prompt = `You are a research assistant. Analyze these search results for the query: "${query}"

SEARCH RESULTS:
${contextText}

For each result, provide:
1. A relevance score (0-1) for the query
2. A concise summary (max 100 words)
3. Key entities or concepts extracted

Respond ONLY in this JSON format:
[{"relevance":0.XX,"summary":"...","entities":["..."],"keep":true/false}]`;

    let llmResponse = '';
    const chatStream = OfflineKit.chat([{ role: 'user', content: prompt }]);
    
    for await (const chunk of chatStream) {
      llmResponse += chunk;
    }
    
    // Parse LLM response
    try {
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = llmResponse.match(/\\[[\\s\\S]*\\]/);
      if (jsonMatch) {
        const analysis = JSON.parse(jsonMatch[0]);
        
        return results.filter((_, i) => {
          const ai = analysis[i];
          if (!ai) return true; // Keep if no analysis
          return ai.keep !== false; // Default keep
        }).map((result, i) => ({
          ...result,
          snippet: (analysis[i]?.summary || result.snippet).substring(0, 250),
          relevanceScore: analysis[i]?.relevance ?? result.relevanceScore,
          entities: analysis[i]?.entities || [],
          llmProcessed: true,
          processingMethod: 'webllm'
        }));
      }
    } catch (e) {
      console.warn('Failed to parse WebLLM response:', e);
    }
    
    // Fallback to client-side if parsing fails
    return processClientSide(results, query, 250, 2000);
  }

  /**
   * Process with Cloud LLM API
   */
  async function processWithCloudLLM(results, query) {
    // Get cloud config from state/settings
    const settings = IDEState?.get?.('settings') || {};
    const cloudEndpoint = settings.cloudLLM?.endpoint;
    const cloudApiKey = settings.cloudLLM?.apiKey;
    const cloudModel = settings.cloudLLM?.model || 'gpt-3.5-turbo';
    
    if (!cloudEndpoint || !cloudApiKey) {
      throw new Error('Cloud LLM not configured');
    }
    
    const contextText = results.map((r, i) => 
      `[${i+1}] ${r.title}: ${r.snippet.substring(0, 150)}`
    ).join('\\n');
    
    const response = await fetch(cloudEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cloudApiKey}`
      },
      body: JSON.stringify({
        model: cloudModel,
        messages: [{
          role: 'user',
          content: `Rate relevance (0-1) and summarize briefly for context. Query: "${query}"\\n\\n${contextText}\\n\\nReturn JSON array: [{"relevance":0.X,"summary":"..."}]`
        }],
        temperature: 0.3,
        max_tokens: 1000
      })
    });
    
    if (!response.ok) throw new Error('Cloud LLM error');
    
    const data = await response.json();
    const llmText = data.choices?.[0]?.message?.content || '';
    
    try {
      const jsonMatch = llmText.match(/\\[[\\s\\S]*\\]/);
      if (jsonMatch) {
        const analysis = JSON.parse(jsonMatch[0]);
        return results.map((result, i) => ({
          ...result,
          snippet: (analysis[i]?.summary || result.snippet).substring(0, 250),
          relevanceScore: analysis[i]?.relevance ?? result.relevanceScore,
          llmProcessed: true,
          processingMethod: 'cloud'
        }));
      }
    } catch (e) {
      console.warn('Failed to parse cloud LLM response:', e);
    }
    
    return processClientSide(results, query, 250, 2000);
  }

  /**
   * Client-side fallback processing (no LLM needed)
   * Uses heuristics for relevance scoring and truncation
   */
  function processClientSide(results, query, maxSnippet, tokenBudget) {
    const queryTerms = query.toLowerCase()
      .split(/\\s+/)
      .filter(t => t.length > 2) // Ignore short words
      .map(t => t.replace(/[^a-z0-9]/g, '')); // Clean terms
    
    let currentTokens = 0;
    
    return results
      .map(result => {
        // Calculate relevance score based on term matches
        const searchText = (result.title + ' ' + result.snippet).toLowerCase();
        let score = result.relevanceScore || 0.5;
        
        queryTerms.forEach(term => {
          const titleMatches = (result.title.toLowerCase().match(new RegExp(term, 'g')) || []).length;
          const snippetMatches = (result.snippet.toLowerCase().match(new RegExp(term, 'g')) || []).length[];
          
          score += (titleMatches * 0.15) + (snippetMatches * 0.05);
        });
        
        // Boost exact phrase match
        if (searchText.includes(query.toLowerCase())) {
          score += 0.3;
        }
        
        // Normalize score
        score = Math.min(1, Math.max(0, score));
        
        // Truncate snippet intelligently
        let snippet = result.snippet;
        if (snippet.length > maxSnippet) {
          // Try to break at sentence boundary
          const lastPeriod = snippet.lastIndexOf('.', maxSnippet);
          const lastSpace = snippet.lastIndexOf(' ', maxSnippet);
          const breakPoint = lastPeriod > maxSnippet * 0.6 ? lastPeriod : lastSpace;
          snippet = snippet.substring(0, breakPoint || maxSnippet) + '...';
        }
        
        // Estimate tokens (rough: 1 token ≈ 4 chars)
        const estimatedTokens = (snippet.length + result.title.length) / 4;
        
        return {
          ...result,
          snippet,
          relevanceScore: Math.round(score * 100) / 100,
          estimatedTokens: Math.round(estimatedTokens),
          llmProcessed: false,
          processingMethod: 'client'
        };
      })
      .sort((a, b) => b.relevanceScore - a.relevanceScore) // Sort by relevance
      .filter(result => {
        // Filter out low relevance results (unless we have very few)
        if (results.length <= 3) return result.relevanceScore >= 0.2;
        return result.relevanceScore >= 0.25;
      })
      .filter(result => {
        // Respect token budget
        if (currentTokens + result.estimatedTokens <= tokenBudget) {
          currentTokens += result.estimatedTokens;
          return true;
        }
        return false;
      });
  }

  function clearSearchResults() {'''

content = content.replace(
  '  async function handleSearch() {',
  new_handle_search
)

# Remove duplicate clearSearchFunctions that might exist
import re
content = re.sub(r'(function clearSearchResults\(\) \{[\s\S]*?)(function clearSearchResults\(\) \{)', r'\2', content)

with open(filepath, 'w') as f:
    f.write(content)

print("Enhanced search with LLM processing + fallbacks!")
