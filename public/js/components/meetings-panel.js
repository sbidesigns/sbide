/**
 * SBIDE - Meetings Panel Component
 * Displays expert meeting transcripts and debate gauntlet records
 * Ported from React MeetingsPanel.tsx with full feature parity
 */

const MeetingsPanelComponent = (() => {
  // ============================================
  // State
  // ============================================
  
  let container = null;
  let meetings = [];
  let selectedMeeting = null;
  let meetingContent = '';
  let isLoading = false;

  // ============================================
  // Initialization
  // ============================================
  
  /**
   * Initialize meetings panel component
   * @param {HTMLElement} element - Container element for the panel
   */
  function init(element) {
    if (!element) {
      console.error('MeetingsPanel: Container element required');
      return;
    }
    
    container = element;
    
    // Subscribe to state changes
    if (window.IDEState) {
      IDEState.subscribe((state, prevState) => {
        if (state.currentProject !== prevState.currentProject) {
          loadMeetings(state.currentProject);
        }
        if (state.meetingsRefreshKey !== prevState.meetingsRefreshKey) {
          loadMeetings(state.currentProject);
        }
      });
    }
    
    render();
  }

  // ============================================
  // Data Loading
  // ============================================
  
  async function loadMeetings(project) {
    if (!project || !project.name) {
      meetings = [];
      selectedMeeting = null;
      meetingContent = '';
      render();
      return;
    }
    
    isLoading = true;
    render();
    
    try {
      // Load meeting files from the project's meetings directory
      const response = await fetch(`/api/ide/files?project=${encodeURIComponent(project.name)}&path=meetings`);
      
      if (response.ok) {
        const data = await response.json();
        
        if (data.success && Array.isArray(data.data)) {
          // Sort by meeting number (descending - newest first)
          const sortedMeetings = data.data
            .filter(f => f.name.startsWith('meeting_') && f.name.endsWith('.md'))
            .sort((a, b) => {
              const numA = parseInt(a.name.match(/meeting_(\d+)/)?.[1] || '0');
              const numB = parseInt(b.name.match(/meeting_(\d+)/)?.[1] || '0');
              return numB - numA;
            });
          
          // Parse meetings into structured format
          meetings = sortedMeetings.map(file => ({
            id: file.name,
            projectName: project.name,
            meetingNumber: parseInt(file.name.match(/meeting_(\d+)/)?.[1] || '0'),
            version: `${parseInt(file.name.match(/meeting_(\d+)/)?.[1] || '0')}.0`,
            createdAt: file.updatedAt || Date.now(),
            taskUnderReview: 'Loading...',
            expertsPresent: [],
            debateTranscript: [],
            consensusReached: false,
            decisions: [],
            actionItems: [],
            concernsRaised: [],
            implementationPlan: '',
            estimatedComplexity: 'medium',
            _path: file.path // Store path for loading content
          }));
        } else {
          meetings = [];
        }
      } else {
        meetings = [];
      }
    } catch (error) {
      console.error('Failed to load meetings:', error);
      meetings = [];
    } finally {
      isLoading = false;
      render();
    }
  }
  
  async function loadMeetingContent(meeting) {
    if (!meeting || !meeting._path) return;
    
    const project = IDEState?.get('currentProject');
    if (!project) return;
    
    try {
      const response = await fetch(`/api/ide/files?project=${encodeURIComponent(project.name)}&path=${encodeURIComponent(meeting._path)}`);
      
      if (response.ok) {
        const data = await response.json();
        
        if (data.success && data.data?.content) {
          meetingContent = data.data.content;
          selectedMeeting = meeting;
          render();
        }
      }
    } catch (error) {
      console.error('Failed to load meeting content:', error);
      if (IDEUtils) {
        IDEUtils.showToast('Failed to load meeting content', 'error');
      }
    }
  }

  // ============================================
  // Rendering
  // ============================================
  
  function render() {
    if (!container) return;
    
    const project = IDEState?.get('currentProject');
    
    if (!project) {
      container.innerHTML = `
        <div class="meetings-empty-state">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-muted">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 00-3-3.87"/>
            <path d="M16 3.13a4 4 0 010 7.75"/>
          </svg>
          <p>Select a project to view meetings</p>
        </div>
      `;
      return;
    }
    
    container.innerHTML = `
      <!-- Header -->
      <div class="meetings-header">
        <div class="header-content">
          <h3 class="meetings-title">Expert Meetings</h3>
          <button 
            class="icon-btn sm meetings-refresh-btn" 
            title="Refresh meetings"
            ${isLoading ? 'disabled' : ''}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="${isLoading ? 'animate-spin' : ''}">
              <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
            </svg>
          </button>
        </div>
        <p class="meetings-subtitle">Debate Gauntlet transcripts</p>
      </div>

      <!-- Content Area -->
      <div class="meetings-content">
        <!-- Meeting List -->
        <div class="meetings-list ${selectedMeeting ? 'has-selection' : ''}">
          ${isLoading ? `
            <div class="loading-state">
              <div class="spinner"></div>
              <span>Loading...</span>
            </div>
          ` : meetings.length === 0 ? `
            <div class="empty-state">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-muted">
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 00-3-3.87"/>
                <path d="M16 3.13a4 4 0 010 7.75"/>
              </svg>
              <p>No meetings yet</p>
              <p class="empty-hint">Meetings are generated during development</p>
            </div>
          ` : `
            <div class="meeting-list-items">
              ${meetings.map(meeting => `
                <button 
                  class="meeting-list-item ${selectedMeeting?.id === meeting.id ? 'active' : ''}"
                  data-meeting-id="${meeting.id}"
                >
                  <div class="meeting-item-header">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
                      <circle cx="9" cy="7" r="4"/>
                      <path d="M23 21v-2a4 4 0 00-3-3.87"/>
                      <path d="M16 3.13a4 4 0 010 7.75"/>
                    </svg>
                    <span class="meeting-number">#${meeting.meetingNumber}</span>
                  </div>
                  <div class="meeting-item-meta">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                      <line x1="16" y1="2" x2="16" y2="6"/>
                      <line x1="8" y1="2" x2="8" y2="6"/>
                      <line x1="3" y1="10" x2="21" y2="10"/>
                    </svg>
                    <span>${new Date(meeting.createdAt).toLocaleDateString()}</span>
                  </div>
                </button>
              `).join('')}
            </div>
          `}
        </div>

        <!-- Meeting Detail -->
        ${selectedMeeting ? `
          <div class="meeting-detail">
            <div class="detail-header">
              <div class="detail-title-group">
                <span class="detail-version-badge">v${selectedMeeting.version}</span>
                <span class="detail-title">Meeting #${selectedMeeting.meetingNumber}</span>
              </div>
              <button class="icon-btn xs close-detail-btn" title="Close detail">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            <div class="detail-content">
              <pre class="meeting-content-pre">${escapeHtml(meetingContent)}</pre>
            </div>
          </div>
        ` : ''}
      </div>
    `;
    
    wireUpEventListeners();
  }

  // ============================================
  // Event Handling
  // ============================================
  
  function wireUpEventListeners() {
    if (!container) return;
    
    // Refresh button
    container.querySelector('.meetings-refresh-btn')?.addEventListener('click', () => {
      const project = IDEState?.get('currentProject');
      loadMeetings(project);
    });
    
    // Meeting list items
    container.querySelectorAll('.meeting-list-item').forEach(item => {
      item.addEventListener('click', () => {
        const meetingId = item.dataset.meetingId;
        const meeting = meetings.find(m => m.id === meetingId);
        if (meeting) {
          loadMeetingContent(meeting);
        }
      });
    });
    
    // Close detail button
    container.querySelector('.close-detail-btn')?.addEventListener('click', () => {
      selectedMeeting = null;
      meetingContent = '';
      render();
    });
  }

  // ============================================
  // Utility Functions
  // ============================================
  
  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ============================================
  // Public API
  // ============================================
  
  return {
    init,
    loadMeetings,
    refresh: () => {
      const project = IDEState?.get('currentProject');
      loadMeetings(project);
    },
    
    // Expose for external use
    getMeetings: () => meetings,
    getSelectedMeeting: () => selectedMeeting
  };
})();

// Export for use in other modules
window.MeetingsPanelComponent = MeetingsPanelComponent;
