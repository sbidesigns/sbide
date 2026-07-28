import re

filepath = '/tmp/sbide/js/components/search-panel.js'

with open(filepath, 'r') as f:
    content = f.read()

new_function = '''  async function handleSearch() {
    if (!localQuery.trim() || isSearching) return;
    
    if (IDEState) {
      IDEState.set({ searchQuery: localQuery, isSearching: true });
    }
    
    try {
      // Use DuckDuckGo instant answer API (free, no key, works from browser)
      const ddgResponse = await fetch(
        'https://api.duckduckgo.com/?q=' + encodeURIComponent(localQuery) + '&format=json&no_html=1'
      );
      
      if (!ddgResponse.ok) throw new Error('DDG API error');
      
      const ddgData = await ddgResponse.json();
      
      let results = [];
      
      // Add Abstract as main result
      if (ddgData.Abstract) {
        results.push({
          title: ddgData.Heading || localQuery,
          snippet: ddgData.Abstract,
          url: ddgData.AbstractURL || 'https://duckduckgo.com/?q=' + encodeURIComponent(localQuery),
          favicon: ''
        });
      }
      
      // Add RelatedTopics as results
      if (ddgData.RelatedTopics && Array.isArray(ddgData.RelatedTopics)) {
        ddgData.RelatedTopics.forEach(topic => {
          if (topic.Text && topic.FirstURL && results.length < 10) {
            results.push({
              title: topic.Text.split(' - ')[0] || topic.Text.substring(0, 80),
              snippet: topic.Text.substring(0, 200),
              url: topic.FirstURL,
              favicon: topic.Icon?.URL || ''
            });
          }
        });
      }
      
      // Fallback if no results
      if (results.length === 0) {
        results.push({
          title: 'Search on DuckDuckGo',
          snippet: 'Click to search for "' + localQuery + '" on DuckDuckGo',
          url: 'https://duckduckgo.com/?q=' + encodeURIComponent(localQuery),
          favicon: ''
        });
      }
      
      if (IDEState) IDEState.set({ searchResults: results });
      if (IDEUtils) IDEUtils.showToast('Found ' + results.length + ' results', 'success');
    } catch (error) {
      console.error('Search failed:', error);
      if (IDEUtils) IDEUtils.showToast('Opening search in new tab...', 'info');
      window.open('https://duckduckgo.com/?q=' + encodeURIComponent(localQuery), '_blank');
      if (IDEState) IDEState.set({ searchResults: [] });
    } finally {
      if (IDEState) IDEState.set({ isSearching: false });
    }
  }

  function clearSearchResults() {'''

content = content.replace('  function clearSearchResults() {', new_function)

with open(filepath, 'w') as f:
    f.write(content)

print("Fixed!")
