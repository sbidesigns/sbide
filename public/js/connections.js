/**
 * SBIDE — Connections Module
 * ---------------------------------------------------------------
 * Provides OAuth/PAT-style connections to HuggingFace and GitHub
 * directly from a static page. Tokens are stored in OPFS via
 * OfflineKit when available, falling back to localStorage with a
 * light obfuscation wrapper (NOT secure storage — explicit warning
 * is shown to the user in the modal).
 *
 * Public API (window.Connections):
 *   init()                          — wire up event listeners
 *   openModal()                     — show the connections modal
 *   closeModal()                    — hide the modal
 *   getStatus()                     — { huggingface, github } status objects
 *   isConnected(provider)           — bool
 *   listRepos(provider)             — array of repo summaries
 *   createRepo(provider, opts)      — create a new repo / space
 *   pushProject(provider, opts)     — push current IDE project to remote
 *   pullProject(provider, opts)     — pull remote repo into IDE as new project
 *   deleteRepo(provider, name)      — delete a remote repo (with confirm)
 *   disconnect(provider)            — revoke local token (does not call provider)
 *   onStatusChange(cb)              — subscribe to status changes
 */

const Connections = (() => {
  'use strict';

  // ============================================
  // Constants
  // ============================================

  const PROVIDERS = {
    huggingface: {
      id: 'huggingface',
      name: 'HuggingFace',
      tokenHelp: 'https://huggingface.co/settings/tokens',
      tokenHint: 'Create a token with "Read" + "Write" permissions.',
      apiBase: 'https://huggingface.co/api',
      fileBase: 'https://huggingface.co',
      scopes: [], // HF tokens are scoped at creation time on the website
    },
    github: {
      id: 'github',
      name: 'GitHub',
      tokenHelp: 'https://github.com/settings/tokens/new?scopes=repo,read:user',
      tokenHint: 'Use a "Fine-grained" or "Classic" token with "repo" + "read:user" scopes.',
      apiBase: 'https://api.github.com',
      // For GitHub device flow (optional). If empty, only PAT input is offered.
      // The user can override this from inside the modal — value is persisted
      // to localStorage so they only need to enter it once.
      clientIdKey: 'connections:github-client-id',
      deviceClientIdDefault: '',
      scopes: ['repo', 'read:user'],
    }
  };

  const STORAGE_KEYS = {
    huggingface: 'connections:hf-token',
    github: 'connections:gh-token',
    githubMeta: 'connections:gh-meta',
  };

  // ============================================
  // State
  // ============================================

  const state = {
    statusListeners: new Set(),
    status: {
      huggingface: { connected: false, username: null, name: null, avatar: null },
      github: { connected: false, username: null, name: null, avatar: null }
    },
    cache: {
      huggingface: { repos: null, fetchedAt: 0 },
      github: { repos: null, fetchedAt: 0 }
    }
  };

  // ============================================
  // Logging / utils
  // ============================================

  function log(...args) {
    try { console.log('[Connections]', ...args); } catch (e) {}
  }
  function warn(...args) {
    try { console.warn('[Connections]', ...args); } catch (e) {}
  }
  function err(...args) {
    try { console.error('[Connections]', ...args); } catch (e) {}
  }

  // Lightweight XOR obfuscation. NOT secure — just prevents the token
  // from being trivially readable in localStorage. Real protection comes
  // from OPFS when available.
  const OBF_SALT = 'IDE-Conn-v1-salt';
  function obfuscate(str) {
    if (!str) return '';
    let out = '';
    for (let i = 0; i < str.length; i++) {
      out += String.fromCharCode(str.charCodeAt(i) ^ OBF_SALT.charCodeAt(i % OBF_SALT.length));
    }
    // base64 for safe storage
    return btoa(unescape(encodeURIComponent(out)));
  }
  function deobfuscate(b64) {
    if (!b64) return '';
    try {
      const str = decodeURIComponent(escape(atob(b64)));
      let out = '';
      for (let i = 0; i < str.length; i++) {
        out += String.fromCharCode(str.charCodeAt(i) ^ OBF_SALT.charCodeAt(i % OBF_SALT.length));
      }
      return out;
    } catch (e) {
      return '';
    }
  }

  // ============================================
  // Token storage (OPFS via OfflineKit, fallback to localStorage)
  // ============================================

  async function opfsAvailable() {
    return !!(window.OfflineKit && OfflineKit.opfsAvailable);
  }

  async function opfsReadSecrets() {
    if (!await opfsAvailable()) return null;
    try {
      const raw = await OfflineKit.opfsRead('.secrets', 'connections.json');
      if (!raw) return {};
      return JSON.parse(raw);
    } catch (e) {
      warn('OPFS secrets read failed', e);
      return {};
    }
  }

  async function opfsWriteSecrets(obj) {
    if (!await opfsAvailable()) return false;
    try {
      await OfflineKit.opfsWrite('.secrets', 'connections.json', JSON.stringify(obj, null, 2));
      return true;
    } catch (e) {
      warn('OPFS secrets write failed', e);
      return false;
    }
  }

  async function getToken(provider) {
    const key = STORAGE_KEYS[provider];
    // Try OPFS first
    const secrets = await opfsReadSecrets();
    if (secrets && secrets[key]) {
      return deobfuscate(secrets[key]);
    }
    // Fallback localStorage
    const raw = localStorage.getItem(key);
    return raw ? deobfuscate(raw) : '';
  }

  async function setToken(provider, token) {
    const key = STORAGE_KEYS[provider];
    const enc = obfuscate(token || '');
    // Always write to localStorage as a fallback (even if OPFS works)
    localStorage.setItem(key, enc);
    // And mirror to OPFS when available
    const secrets = await opfsReadSecrets() || {};
    secrets[key] = enc;
    await opfsWriteSecrets(secrets);
  }

  async function clearToken(provider) {
    const key = STORAGE_KEYS[provider];
    localStorage.removeItem(key);
    const secrets = await opfsReadSecrets() || {};
    delete secrets[key];
    await opfsWriteSecrets(secrets);
  }

  // ============================================
  // HTTP helpers
  // ============================================

  async function httpFetch(url, opts = {}) {
    const res = await fetch(url, {
      ...opts,
      headers: {
        'Accept': 'application/json',
        ...(opts.headers || {})
      }
    });
    if (!res.ok) {
      let detail = '';
      try {
        const body = await res.json();
        detail = body?.error || body?.message || JSON.stringify(body).slice(0, 200);
      } catch (e) {
        try { detail = (await res.text()).slice(0, 200); } catch (_) {}
      }
      const e = new Error(`HTTP ${res.status} ${res.statusText}${detail ? ' — ' + detail : ''}`);
      e.status = res.status;
      e.body = detail;
      throw e;
    }
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return res.json();
    if (ct.includes('text/')) return res.text();
    return res.arrayBuffer();
  }

  // ============================================
  // HuggingFace client
  // ============================================

  const HF = {
    async validate(token) {
      // Returns { name, fullname, avatar } on success
      const json = await httpFetch('https://huggingface.co/api/whoami-v2', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      return {
        username: json.name,
        name: json.fullname || json.name,
        avatar: json.avatarUrl || null,
        orgs: (json.orgs || []).map(o => o.name)
      };
    },

    async listRepos(token, username) {
      // We list models + spaces + datasets the user owns.
      const [models, spaces, datasets] = await Promise.all([
        httpFetch(`https://huggingface.co/api/models?author=${encodeURIComponent(username)}&limit=200`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        httpFetch(`https://huggingface.co/api/spaces?author=${encodeURIComponent(username)}&limit=200`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        httpFetch(`https://huggingface.co/api/datasets?author=${encodeURIComponent(username)}&limit=200`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ]);
      const map = (arr, type) => arr.map(r => ({
        provider: 'huggingface',
        type,                                  // 'model' | 'space' | 'dataset'
        id: r.id,                              // "user/repo"
        name: r.id,
        private: r.private,
        url: `https://huggingface.co/${r.id}`,
        updatedAt: r.lastModified || r.createdAt || null,
        description: r.tags?.join(', ') || null,
        raw: r
      }));
      return [...map(models, 'model'), ...map(spaces, 'space'), ...map(datasets, 'dataset')];
    },

    async createRepo(token, { name, type = 'model', private: isPrivate = false, description = '' }) {
      // POST /api/repos/create
      // Body: { type, name, private, ... }
      // 'name' here is just the repo slug (no namespace) — the API attaches the current user.
      return httpFetch('https://huggingface.co/api/repos/create', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ type, name, private: isPrivate, description })
      });
    },

    async listFiles(token, repoId, type = 'model', revision = 'main') {
      // GET /api/{type}/{repo}/tree/{revision}?recursive=true
      const url = `https://huggingface.co/api/${type}/${repoId}/tree/${revision}?recursive=true`;
      return httpFetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
    },

    async downloadFile(token, repoId, type, path, revision = 'main') {
      // GET /{repo}/resolve/{rev}/{path}
      const url = `https://huggingface.co/${repoId}/resolve/${revision}/${path.split('/').map(encodeURIComponent).join('/')}`;
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`Failed to download ${path}: ${res.status}`);
      return await res.text();
    },

    async uploadFile(token, repoId, type, path, content, revision = 'main', commitMsg = null) {
      // PUT /api/{type}/{repo}/upload/{revision}/{path}
      // Body: raw bytes (use Blob for binary)
      const url = `https://huggingface.co/api/${type}/${repoId}/upload/${revision}/${path.split('/').map(encodeURIComponent).join('/')}`;
      const isText = typeof content === 'string';
      const body = isText ? content : content;
      return httpFetch(url, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/octet-stream',
          ...(commitMsg ? { 'X-Commit-Message': commitMsg } : {})
        },
        body
      });
    },

    async deleteFile(token, repoId, type, path, revision = 'main') {
      const url = `https://huggingface.co/api/${type}/${repoId}/delete/${revision}/${path.split('/').map(encodeURIComponent).join('/')}`;
      return httpFetch(url, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
    },

    async deleteRepo(token, repoId, type) {
      // DELETE /api/{type}/{repo}/delete
      const url = `https://huggingface.co/api/${type}/${repoId}/delete`;
      return httpFetch(url, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
    }
  };

  // ============================================
  // GitHub client
  // ============================================

  const GH = {
    async validate(token) {
      const json = await httpFetch('https://api.github.com/user', {
        headers: { 'Authorization': `token ${token}` }
      });
      return {
        username: json.login,
        name: json.name || json.login,
        avatar: json.avatar_url,
        userId: json.id
      };
    },

    async listRepos(token) {
      const json = await httpFetch('https://api.github.com/user/repos?sort=updated&per_page=100&type=owner', {
        headers: { 'Authorization': `token ${token}` }
      });
      return json.map(r => ({
        provider: 'github',
        type: r.full_name.includes('/') ? 'repo' : 'repo',
        id: r.full_name,
        name: r.name,
        full_name: r.full_name,
        private: r.private,
        url: r.html_url,
        updatedAt: r.updated_at,
        description: r.description,
        default_branch: r.default_branch,
        size: r.size,
        raw: r
      }));
    },

    async createRepo(token, { name, private: isPrivate = false, description = '', autoInit = true }) {
      return httpFetch('https://api.github.com/user/repos', {
        method: 'POST',
        headers: {
          'Authorization': `token ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name, private: isPrivate, description, auto_init: autoInit })
      });
    },

    async listFiles(token, owner, repo, branch = 'main') {
      // Use git trees API to get the entire tree recursively
      const tree = await httpFetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`, {
        headers: { 'Authorization': `token ${token}` }
      });
      return (tree.tree || []).filter(n => n.type === 'blob').map(n => ({
        path: n.path,
        size: n.size,
        sha: n.sha
      }));
    },

    async downloadFile(token, owner, repo, path, branch = 'main') {
      const json = await httpFetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${branch}`,
        { headers: { 'Authorization': `token ${token}` } }
      );
      if (json.encoding === 'base64' && json.content) {
        // Handle UTF-8 properly
        const binary = atob(json.content.replace(/\n/g, ''));
        try {
          // Try UTF-8 decode
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          return new TextDecoder('utf-8').decode(bytes);
        } catch (e) {
          return binary;
        }
      }
      return json.content || '';
    },

    async uploadFile(token, owner, repo, path, content, branch = 'main', commitMsg = null, existingSha = null) {
      // PUT /repos/:owner/:repo/contents/:path
      // Body: { message, content (base64), branch, sha? }
      const isText = typeof content === 'string';
      let base64;
      if (isText) {
        const bytes = new TextEncoder().encode(content);
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        base64 = btoa(bin);
      } else {
        // Blob/arraybuffer
        const buf = content instanceof ArrayBuffer ? content : await content.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        base64 = btoa(bin);
      }
      const body = {
        message: commitMsg || `Update ${path}`,
        content: base64,
        branch
      };
      if (existingSha) body.sha = existingSha;
      return httpFetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `token ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        }
      );
    },

    async getExistingSha(token, owner, repo, path, branch = 'main') {
      try {
        const json = await httpFetch(
          `https://api.github.com/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${branch}`,
          { headers: { 'Authorization': `token ${token}` } }
        );
        return json.sha || null;
      } catch (e) {
        return null; // probably doesn't exist
      }
    },

    async deleteFile(token, owner, repo, path, sha, branch = 'main') {
      return httpFetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`,
        {
          method: 'DELETE',
          headers: {
            'Authorization': `token ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ message: `Delete ${path}`, sha, branch })
        }
      );
    },

    async deleteRepo(token, owner, repo) {
      return httpFetch(`https://api.github.com/repos/${owner}/${repo}`, {
        method: 'DELETE',
        headers: { 'Authorization': `token ${token}` }
      });
    },

    // ----- Device Flow (optional, requires user-provided client_id) -----

    async requestDeviceCode(clientId) {
      const params = new URLSearchParams({
        client_id: clientId,
        scope: PROVIDERS.github.scopes.join(' ')
      });
      const res = await fetch('https://github.com/login/device/code', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
      });
      if (!res.ok) throw new Error(`Device code request failed: ${res.status}`);
      return res.json();
    },

    async pollDeviceFlow(clientId, deviceCode, interval = 5) {
      const params = new URLSearchParams({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
      });
      const res = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
      });
      const json = await res.json();
      return json; // { access_token, error, error_description, interval }
    }
  };

  // ============================================
  // High-level operations
  // ============================================

  async function connect(provider, token) {
    if (!token || !token.trim()) {
      throw new Error('Token is required');
    }
    const trimmed = token.trim();
    let info;
    if (provider === 'huggingface') {
      info = await HF.validate(trimmed);
    } else if (provider === 'github') {
      info = await GH.validate(trimmed);
    } else {
      throw new Error(`Unknown provider: ${provider}`);
    }
    await setToken(provider, trimmed);
    state.status[provider] = {
      connected: true,
      username: info.username,
      name: info.name,
      avatar: info.avatar
    };
    // Invalidate cache
    state.cache[provider] = { repos: null, fetchedAt: 0 };
    notifyStatusChange();
    log(`Connected to ${PROVIDERS[provider].name} as ${info.username}`);
    return info;
  }

  async function disconnect(provider) {
    await clearToken(provider);
    state.status[provider] = { connected: false, username: null, name: null, avatar: null };
    state.cache[provider] = { repos: null, fetchedAt: 0 };
    notifyStatusChange();
    log(`Disconnected from ${PROVIDERS[provider].name}`);
  }

  async function loadStatusFromStorage() {
    for (const p of Object.keys(PROVIDERS)) {
      const token = await getToken(p);
      if (token) {
        // We have a stored token. We trust it without re-validating (faster).
        // If it turns out invalid, the next API call will surface a 401 and we can
        // disconnect then.
        const meta = JSON.parse(localStorage.getItem(STORAGE_KEYS.githubMeta) || '{}');
        if (p === 'github' && meta.username) {
          state.status.github = { connected: true, username: meta.username, name: meta.name, avatar: meta.avatar };
        } else {
          // For HF, we don't cache user info — flag as connected but unknown username.
          // The listRepos call will reveal the username.
          state.status[p] = { connected: true, username: null, name: null, avatar: null };
        }
      }
    }
    notifyStatusChange();
  }

  async function listRepos(provider, { force = false } = {}) {
    const token = await getToken(provider);
    if (!token) throw new Error(`Not connected to ${PROVIDERS[provider].name}`);
    const cache = state.cache[provider];
    const now = Date.now();
    const TTL = 60 * 1000; // 1 minute
    if (!force && cache.repos && (now - cache.fetchedAt) < TTL) {
      return cache.repos;
    }
    let repos;
    if (provider === 'huggingface') {
      // If we don't know the username yet, validate now to get it
      if (!state.status.huggingface.username) {
        const info = await HF.validate(token);
        state.status.huggingface = { connected: true, ...info };
        notifyStatusChange();
      }
      repos = await HF.listRepos(token, state.status.huggingface.username);
    } else {
      repos = await GH.listRepos(token);
      // Cache user meta
      if (!state.status.github.username) {
        const info = await GH.validate(token);
        state.status.github = { connected: true, ...info };
        localStorage.setItem(STORAGE_KEYS.githubMeta, JSON.stringify(info));
        notifyStatusChange();
      }
    }
    state.cache[provider] = { repos, fetchedAt: now };
    return repos;
  }

  async function createRepo(provider, opts) {
    const token = await getToken(provider);
    if (!token) throw new Error(`Not connected to ${PROVIDERS[provider].name}`);
    let result;
    if (provider === 'huggingface') {
      result = await HF.createRepo(token, opts);
    } else {
      result = await GH.createRepo(token, opts);
    }
    // Invalidate cache so next listRepos call refetches
    state.cache[provider] = { repos: null, fetchedAt: 0 };
    return result;
  }

  async function deleteRepo(provider, repoId, opts = {}) {
    const token = await getToken(provider);
    if (!token) throw new Error(`Not connected to ${PROVIDERS[provider].name}`);
    if (provider === 'huggingface') {
      const type = opts.type || 'model';
      return HF.deleteRepo(token, repoId, type);
    } else {
      const [owner, repo] = repoId.split('/');
      return GH.deleteRepo(token, owner, repo);
    }
  }

  /**
   * Push the current IDE project's files to a remote repo.
   * For HuggingFace: pushes to a model repo by default (or space/dataset if opts.type is set)
   * For GitHub: pushes to a regular repo (creates if missing).
   *
   * opts: { repoId, type?, branch?, commitMsg? }
   */
  async function pushProject(provider, opts) {
    const token = await getToken(provider);
    if (!token) throw new Error(`Not connected to ${PROVIDERS[provider].name}`);

    // Get current IDE project + files
    const ideState = window.IDEState ? IDEState.getState() : null;
    if (!ideState || !ideState.currentProject) {
      throw new Error('No active project in the IDE. Open or create a project first.');
    }
    const projectName = ideState.currentProject.name;
    const files = await IDEStorage.Files.getByProject(projectName);
    const fileEntries = files.filter(f => f.type === 'file' && f.path);

    if (fileEntries.length === 0) {
      throw new Error(`Project "${projectName}" has no files to push.`);
    }

    let { repoId, branch = 'main', commitMsg = `Push from IDE — ${new Date().toISOString()}` } = opts;

    if (provider === 'huggingface') {
      const type = opts.type || 'model';
      if (!repoId) {
        // Default to {username}/{projectName-slug}
        const username = state.status.huggingface.username;
        if (!username) throw new Error('HuggingFace username unknown — re-connect to refresh.');
        repoId = `${username}/${slugify(projectName)}`;
      }
      // Push each file
      const results = [];
      for (const f of fileEntries) {
        try {
          await HF.uploadFile(token, repoId, type, f.path, f.content || '', branch, commitMsg);
          results.push({ path: f.path, ok: true });
        } catch (e) {
          results.push({ path: f.path, ok: false, error: e.message });
        }
      }
      return { repoId, type, branch, pushed: results };
    } else {
      // GitHub
      if (!repoId) throw new Error('repoId required for GitHub push (use "owner/repo")');
      const [owner, repo] = repoId.split('/');
      if (!owner || !repo) throw new Error('repoId must be in "owner/repo" form');
      const results = [];
      for (const f of fileEntries) {
        try {
          const existingSha = await GH.getExistingSha(token, owner, repo, f.path, branch);
          await GH.uploadFile(token, owner, repo, f.path, f.content || '', branch, commitMsg, existingSha);
          results.push({ path: f.path, ok: true });
        } catch (e) {
          results.push({ path: f.path, ok: false, error: e.message });
        }
      }
      return { repoId, branch, pushed: results };
    }
  }

  /**
   * Pull a remote repo into the IDE as a new project.
   * opts: { repoId, type?, branch?, projectName? }
   */
  async function pullProject(provider, opts) {
    const token = await getToken(provider);
    if (!token) throw new Error(`Not connected to ${PROVIDERS[provider].name}`);

    let { repoId, branch = 'main', projectName } = opts;
    if (!repoId) throw new Error('repoId required');

    if (provider === 'huggingface') {
      const type = opts.type || 'model';
      const tree = await HF.listFiles(token, repoId, type, branch);
      const files = (tree || []).filter(n => n.type === 'file');
      if (!projectName) projectName = repoId.split('/').pop();

      // Create IDE project
      const existing = await IDEStorage.Projects.get(projectName);
      if (existing) {
        throw new Error(`Project "${projectName}" already exists. Pick a different name.`);
      }
      const project = await IDEStorage.Projects.create(projectName);

      // Pull each file
      const pulled = [];
      for (const f of files) {
        try {
          const content = await HF.downloadFile(token, repoId, type, f.path, branch);
          await IDEStorage.Files.create({
            id: IDEStorage.generateId(),
            project: projectName,
            name: f.path.split('/').pop(),
            path: f.path,
            type: 'file',
            content,
            size: new Blob([content]).size,
            updatedAt: Date.now()
          });
          // Mirror to OfflineKit (OPFS)
          if (window.OfflineKit) {
            try { await OfflineKit.write(projectName, f.path, content); } catch (_) {}
          }
          pulled.push({ path: f.path, ok: true });
        } catch (e) {
          pulled.push({ path: f.path, ok: false, error: e.message });
        }
      }
      await IDEStorage.Projects.updateFileCount(projectName);
      return { projectName, repoId, type, branch, pulled };
    } else {
      const [owner, repo] = repoId.split('/');
      if (!owner || !repo) throw new Error('repoId must be "owner/repo"');
      const files = await GH.listFiles(token, owner, repo, branch);
      if (!projectName) projectName = repo;

      const existing = await IDEStorage.Projects.get(projectName);
      if (existing) {
        throw new Error(`Project "${projectName}" already exists. Pick a different name.`);
      }
      const project = await IDEStorage.Projects.create(projectName);

      const pulled = [];
      for (const f of files) {
        // Skip large files > 1MB to avoid blowing up memory
        if (f.size > 1_000_000) {
          pulled.push({ path: f.path, ok: false, error: 'Skipped (>1MB)' });
          continue;
        }
        try {
          const content = await GH.downloadFile(token, owner, repo, f.path, branch);
          await IDEStorage.Files.create({
            id: IDEStorage.generateId(),
            project: projectName,
            name: f.path.split('/').pop(),
            path: f.path,
            type: 'file',
            content,
            size: new Blob([content]).size,
            updatedAt: Date.now()
          });
          if (window.OfflineKit) {
            try { await OfflineKit.write(projectName, f.path, content); } catch (_) {}
          }
          pulled.push({ path: f.path, ok: true });
        } catch (e) {
          pulled.push({ path: f.path, ok: false, error: e.message });
        }
      }
      await IDEStorage.Projects.updateFileCount(projectName);
      return { projectName, repoId, branch, pulled };
    }
  }

  function slugify(name) {
    return String(name || '').toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-')
      .slice(0, 64);
  }

  // ============================================
  // Status subscriptions
  // ============================================

  function onStatusChange(cb) {
    state.statusListeners.add(cb);
    cb(getStatus());
    return () => state.statusListeners.delete(cb);
  }

  function notifyStatusChange() {
    const s = getStatus();
    state.statusListeners.forEach(cb => {
      try { cb(s); } catch (e) { err('Status listener error', e); }
    });
    // Update the header button dot
    updateHeaderButton();
  }

  function getStatus() {
    return JSON.parse(JSON.stringify(state.status));
  }

  function isConnected(provider) {
    return !!(state.status[provider] && state.status[provider].connected);
  }

  function updateHeaderButton() {
    const btn = document.getElementById('connections-btn');
    if (!btn) return;
    const dot = btn.querySelector('.connections-dot');
    if (!dot) return;
    const any = isConnected('huggingface') || isConnected('github');
    btn.classList.toggle('is-connected', any);
    if (dot) {
      dot.classList.toggle('active', any);
    }
  }

  // ============================================
  // Modal UI
  // ============================================

  function injectModal() {
    if (document.getElementById('connections-modal')) return;

    const overlay = document.createElement('div');
    overlay.id = 'connections-modal';
    overlay.className = 'modal-overlay hidden connections-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'connections-modal-title');

    overlay.innerHTML = `
      <div class="modal connections-modal">
        <div class="modal-header">
          <h2 id="connections-modal-title" class="modal-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -3px; margin-right: 6px;">
              <path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"/>
            </svg>
            Connections
          </h2>
          <button id="connections-close-btn" class="icon-btn" aria-label="Close connections">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div class="modal-body connections-modal-body">
          <!-- Tabs -->
          <div class="connections-tabs" role="tablist">
            <button class="connections-tab active" data-tab="huggingface" role="tab" aria-selected="true">
              <span class="provider-icon provider-icon-hf">🤗</span>
              HuggingFace
              <span class="connections-tab-status" data-status-for="huggingface"></span>
            </button>
            <button class="connections-tab" data-tab="github" role="tab" aria-selected="false">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="vertical-align: -2px;"><path d="M12 .3a12 12 0 00-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.9 1.2 1.9 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.3-3.2-.2-.3-.6-1.6.1-3.2 0 0 1-.3 3.4 1.2a11.5 11.5 0 016 0c2.3-1.5 3.3-1.2 3.3-1.2.7 1.6.3 2.9.1 3.2.9.8 1.3 1.9 1.3 3.2 0 4.6-2.8 5.6-5.5 5.9.5.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0012 .3"/></svg>
              GitHub
              <span class="connections-tab-status" data-status-for="github"></span>
            </button>
          </div>

          <!-- HuggingFace Panel -->
          <div id="conn-panel-huggingface" class="connections-panel active" data-panel="huggingface">
            <!-- Disconnected view -->
            <div class="conn-disconnected-view" data-view="disconnected">
              <div class="conn-provider-headline">
                <span class="provider-icon-lg">🤗</span>
                <div>
                  <h3>Connect to HuggingFace</h3>
                  <p>Upload, import, and manage your Spaces, models, and datasets — directly from the IDE.</p>
                </div>
              </div>
              <div class="form-group">
                <label class="form-label" for="hf-token-input">Access Token</label>
                <input type="password" id="hf-token-input" class="input" placeholder="hf_..." autocomplete="off" spellcheck="false" />
                <p class="form-hint">
                  Create a token at
                  <a href="https://huggingface.co/settings/tokens" target="_blank" rel="noopener">huggingface.co/settings/tokens</a>
                  with "Read" + "Write" permissions.
                </p>
              </div>
              <div class="conn-security-note">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                <span>Stored locally in your browser (OPFS when available). Never sent anywhere except HuggingFace's API.</span>
              </div>
              <button id="hf-connect-btn" class="btn btn-primary" disabled>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
                Connect
              </button>
            </div>
            <!-- Connected view -->
            <div class="conn-connected-view hidden" data-view="connected">
              <div class="conn-account-card">
                <img class="conn-avatar" data-avatar-for="huggingface" alt="" src="" />
                <div class="conn-account-info">
                  <div class="conn-account-name" data-name-for="huggingface"></div>
                  <div class="conn-account-username" data-username-for="huggingface"></div>
                </div>
                <button class="btn btn-ghost btn-xs" data-action="disconnect" data-provider="huggingface">Disconnect</button>
              </div>
              <div class="conn-repos-section">
                <div class="conn-repos-header">
                  <h4>Your Repositories</h4>
                  <div class="conn-repos-actions">
                    <button class="btn btn-ghost btn-xs" data-action="refresh" data-provider="huggingface" title="Refresh list">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
                    </button>
                    <button class="btn btn-outline btn-xs" data-action="new-repo" data-provider="huggingface">+ New</button>
                  </div>
                </div>
                <div class="conn-repos-list" data-repos-for="huggingface"></div>
              </div>
              <div class="conn-push-current">
                <button class="btn btn-primary btn-sm" data-action="push-current" data-provider="huggingface">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  Push Current Project
                </button>
              </div>
            </div>
          </div>

          <!-- GitHub Panel -->
          <div id="conn-panel-github" class="connections-panel hidden" data-panel="github">
            <!-- Disconnected view -->
            <div class="conn-disconnected-view" data-view="disconnected">
              <div class="conn-provider-headline">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .3a12 12 0 00-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.9 1.2 1.9 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.3-3.2-.2-.3-.6-1.6.1-3.2 0 0 1-.3 3.4 1.2a11.5 11.5 0 016 0c2.3-1.5 3.3-1.2 3.3-1.2.7 1.6.3 2.9.1 3.2.9.8 1.3 1.9 1.3 3.2 0 4.6-2.8 5.6-5.5 5.9.5.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0012 .3"/></svg>
                <div>
                  <h3>Connect to GitHub</h3>
                  <p>Push, pull, and manage your repositories — directly from the IDE.</p>
                </div>
              </div>

              <details class="conn-device-flow-toggle">
                <summary>Use Device Flow (real OAuth) instead of a token</summary>
                <div class="form-group" style="margin-top: 8px;">
                  <label class="form-label" for="gh-client-id-input">GitHub OAuth App Client ID</label>
                  <input type="text" id="gh-client-id-input" class="input" placeholder="Iv1.1234567890abcdef" autocomplete="off" spellcheck="false" />
                  <p class="form-hint">
                    Register an OAuth App at
                    <a href="https://github.com/settings/developers" target="_blank" rel="noopener">github.com/settings/developers</a>
                    (Authorization type: <em>Device flow</em>).
                  </p>
                  <button id="gh-device-start-btn" class="btn btn-outline btn-sm" disabled>Start Device Flow</button>
                  <div id="gh-device-status" class="conn-device-status hidden"></div>
                </div>
              </details>

              <div class="form-group">
                <label class="form-label" for="gh-token-input">…or use a Personal Access Token</label>
                <input type="password" id="gh-token-input" class="input" placeholder="ghp_..." autocomplete="off" spellcheck="false" />
                <p class="form-hint">
                  Create a token at
                  <a href="https://github.com/settings/tokens/new?scopes=repo,read:user" target="_blank" rel="noopener">github.com/settings/tokens</a>
                  with <code>repo</code> + <code>read:user</code> scopes.
                </p>
              </div>
              <div class="conn-security-note">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                <span>Stored locally in your browser (OPFS when available). Never sent anywhere except GitHub's API.</span>
              </div>
              <button id="gh-connect-btn" class="btn btn-primary" disabled>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
                Connect
              </button>
            </div>
            <!-- Connected view -->
            <div class="conn-connected-view hidden" data-view="connected">
              <div class="conn-account-card">
                <img class="conn-avatar" data-avatar-for="github" alt="" src="" />
                <div class="conn-account-info">
                  <div class="conn-account-name" data-name-for="github"></div>
                  <div class="conn-account-username" data-username-for="github"></div>
                </div>
                <button class="btn btn-ghost btn-xs" data-action="disconnect" data-provider="github">Disconnect</button>
              </div>
              <div class="conn-repos-section">
                <div class="conn-repos-header">
                  <h4>Your Repositories</h4>
                  <div class="conn-repos-actions">
                    <button class="btn btn-ghost btn-xs" data-action="refresh" data-provider="github" title="Refresh list">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
                    </button>
                    <button class="btn btn-outline btn-xs" data-action="new-repo" data-provider="github">+ New</button>
                  </div>
                </div>
                <div class="conn-repos-list" data-repos-for="github"></div>
              </div>
              <div class="conn-push-current">
                <button class="btn btn-primary btn-sm" data-action="push-current" data-provider="github">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  Push Current Project
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button id="connections-done-btn" class="btn btn-primary">Done</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Wire events
    wireModalEvents(overlay);
  }

  function wireModalEvents(overlay) {
    // Close
    overlay.querySelector('#connections-close-btn').addEventListener('click', closeModal);
    overlay.querySelector('#connections-done-btn').addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape' && !overlay.classList.contains('hidden')) {
        closeModal();
      }
    });

    // Tabs
    overlay.querySelectorAll('.connections-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        overlay.querySelectorAll('.connections-tab').forEach(b => {
          const active = b === btn;
          b.classList.toggle('active', active);
          b.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        overlay.querySelectorAll('.connections-panel').forEach(p => {
          p.classList.toggle('active', p.dataset.panel === tab);
          p.classList.toggle('hidden', p.dataset.panel !== tab);
        });
      });
    });

    // HF token input
    const hfInput = overlay.querySelector('#hf-token-input');
    const hfBtn = overlay.querySelector('#hf-connect-btn');
    hfInput.addEventListener('input', () => {
      hfBtn.disabled = !hfInput.value.trim();
    });
    hfInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && hfInput.value.trim()) {
        hfBtn.click();
      }
    });
    hfBtn.addEventListener('click', async () => {
      hfBtn.disabled = true;
      const original = hfBtn.innerHTML;
      hfBtn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;"></div> Connecting...';
      try {
        await connect('huggingface', hfInput.value.trim());
        hfInput.value = '';
        if (window.IDEUtils && IDEUtils.showToast) {
          IDEUtils.showToast(`Connected to HuggingFace as ${state.status.huggingface.username}`, 'success');
        }
        renderConnectedView('huggingface');
      } catch (e) {
        err(e);
        if (window.IDEUtils && IDEUtils.showToast) {
          IDEUtils.showToast(`Failed: ${e.message}`, 'error', 8000);
        }
      } finally {
        hfBtn.disabled = false;
        hfBtn.innerHTML = original;
      }
    });

    // GH token input
    const ghInput = overlay.querySelector('#gh-token-input');
    const ghBtn = overlay.querySelector('#gh-connect-btn');
    ghInput.addEventListener('input', () => {
      ghBtn.disabled = !ghInput.value.trim();
    });
    ghInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && ghInput.value.trim()) {
        ghBtn.click();
      }
    });
    ghBtn.addEventListener('click', async () => {
      ghBtn.disabled = true;
      const original = ghBtn.innerHTML;
      ghBtn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;"></div> Connecting...';
      try {
        await connect('github', ghInput.value.trim());
        ghInput.value = '';
        if (window.IDEUtils && IDEUtils.showToast) {
          IDEUtils.showToast(`Connected to GitHub as ${state.status.github.username}`, 'success');
        }
        renderConnectedView('github');
      } catch (e) {
        err(e);
        if (window.IDEUtils && IDEUtils.showToast) {
          IDEUtils.showToast(`Failed: ${e.message}`, 'error', 8000);
        }
      } finally {
        ghBtn.disabled = false;
        ghBtn.innerHTML = original;
      }
    });

    // GH device flow
    const ghClientIdInput = overlay.querySelector('#gh-client-id-input');
    const ghDeviceStartBtn = overlay.querySelector('#gh-device-start-btn');
    // Restore saved client_id
    ghClientIdInput.value = localStorage.getItem(PROVIDERS.github.clientIdKey) || '';
    ghDeviceStartBtn.disabled = !ghClientIdInput.value.trim();
    ghClientIdInput.addEventListener('input', () => {
      const v = ghClientIdInput.value.trim();
      ghDeviceStartBtn.disabled = !v;
      if (v) localStorage.setItem(PROVIDERS.github.clientIdKey, v);
    });
    ghDeviceStartBtn.addEventListener('click', () => startGitHubDeviceFlow(ghClientIdInput.value.trim()));

    // Action delegation for connected views
    overlay.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const provider = btn.dataset.provider;
      if (!provider) return;

      if (action === 'disconnect') {
        if (!confirm(`Disconnect from ${PROVIDERS[provider].name}? Your local token will be deleted.`)) return;
        await disconnect(provider);
        renderDisconnectedView(provider);
        if (window.IDEUtils && IDEUtils.showToast) {
          IDEUtils.showToast(`Disconnected from ${PROVIDERS[provider].name}`, 'info');
        }
      } else if (action === 'refresh') {
        await refreshRepos(provider);
      } else if (action === 'new-repo') {
        showNewRepoForm(provider);
      } else if (action === 'push-current') {
        await pushCurrentProject(provider);
      } else if (action === 'pull') {
        const repoId = btn.dataset.repoId;
        const type = btn.dataset.repoType;
        await pullRepoIntoIDE(provider, repoId, type);
      } else if (action === 'open') {
        const url = btn.dataset.url;
        if (url) window.open(url, '_blank', 'noopener');
      } else if (action === 'delete-repo') {
        const repoId = btn.dataset.repoId;
        const type = btn.dataset.repoType;
        if (!confirm(`Delete ${repoId}? This cannot be undone.`)) return;
        try {
          btn.disabled = true;
          await deleteRepo(provider, repoId, { type });
          if (window.IDEUtils && IDEUtils.showToast) {
            IDEUtils.showToast(`Deleted ${repoId}`, 'success');
          }
          await refreshRepos(provider, { force: true });
        } catch (e) {
          if (window.IDEUtils && IDEUtils.showToast) {
            IDEUtils.showToast(`Failed: ${e.message}`, 'error', 8000);
          }
          btn.disabled = false;
        }
      }
    });
  }

  // ============================================
  // Render helpers
  // ============================================

  function renderConnectedView(provider) {
    const overlay = document.getElementById('connections-modal');
    if (!overlay) return;
    const panel = overlay.querySelector(`#conn-panel-${provider}`);
    if (!panel) return;
    const discView = panel.querySelector('[data-view="disconnected"]');
    const connView = panel.querySelector('[data-view="connected"]');
    discView.classList.add('hidden');
    connView.classList.remove('hidden');
    const s = state.status[provider];
    const nameEl = connView.querySelector(`[data-name-for="${provider}"]`);
    const userEl = connView.querySelector(`[data-username-for="${provider}"]`);
    const avatarEl = connView.querySelector(`[data-avatar-for="${provider}"]`);
    if (nameEl) nameEl.textContent = s.name || s.username || 'Connected';
    if (userEl) userEl.textContent = s.username ? `@${s.username}` : '';
    if (avatarEl && s.avatar) {
      avatarEl.src = s.avatar;
      avatarEl.style.display = '';
    } else if (avatarEl) {
      avatarEl.style.display = 'none';
    }
    updateTabStatus(provider);
    refreshRepos(provider).catch(() => {});
  }

  function renderDisconnectedView(provider) {
    const overlay = document.getElementById('connections-modal');
    if (!overlay) return;
    const panel = overlay.querySelector(`#conn-panel-${provider}`);
    if (!panel) return;
    const discView = panel.querySelector('[data-view="disconnected"]');
    const connView = panel.querySelector('[data-view="connected"]');
    discView.classList.remove('hidden');
    connView.classList.add('hidden');
    updateTabStatus(provider);
  }

  function updateTabStatus(provider) {
    const overlay = document.getElementById('connections-modal');
    if (!overlay) return;
    const badge = overlay.querySelector(`[data-status-for="${provider}"]`);
    if (!badge) return;
    const connected = isConnected(provider);
    badge.classList.toggle('connected', connected);
    badge.textContent = connected ? '●' : '';
    badge.title = connected ? 'Connected' : 'Not connected';
  }

  async function refreshRepos(provider, { force = false } = {}) {
    const overlay = document.getElementById('connections-modal');
    if (!overlay) return;
    const list = overlay.querySelector(`[data-repos-for="${provider}"]`);
    if (!list) return;
    list.innerHTML = '<div class="conn-repos-loading"><div class="spinner"></div><span>Loading repositories...</span></div>';
    try {
      const repos = await listRepos(provider, { force });
      renderRepoList(provider, list, repos);
    } catch (e) {
      if (e.status === 401 || e.message.includes('401')) {
        // Token invalid — disconnect
        await disconnect(provider);
        renderDisconnectedView(provider);
        if (window.IDEUtils && IDEUtils.showToast) {
          IDEUtils.showToast('Token invalid or expired. Please reconnect.', 'warning', 6000);
        }
      } else {
        list.innerHTML = `<div class="conn-repos-empty">Failed to load: ${escapeHtml(e.message)}</div>`;
      }
    }
  }

  function renderRepoList(provider, container, repos) {
    if (!repos || repos.length === 0) {
      container.innerHTML = '<div class="conn-repos-empty">No repositories found.</div>';
      return;
    }
    container.innerHTML = repos.map(r => {
      const typeLabel = provider === 'huggingface' ? r.type : 'repo';
      const privateLabel = r.private ? '<span class="badge badge-warning">private</span>' : '';
      const updated = r.updatedAt ? formatRelative(r.updatedAt) : '';
      return `
        <div class="conn-repo-item">
          <div class="conn-repo-main">
            <div class="conn-repo-title">
              <span class="badge badge-outline">${escapeHtml(typeLabel)}</span>
              ${privateLabel}
              <span class="conn-repo-name">${escapeHtml(r.id || r.name)}</span>
            </div>
            <div class="conn-repo-meta">
              ${updated ? `<span>Updated ${escapeHtml(updated)}</span>` : ''}
              ${r.size ? `<span>${formatSize(r.size)}</span>` : ''}
            </div>
          </div>
          <div class="conn-repo-actions">
            <button class="btn btn-outline btn-xs" data-action="pull" data-provider="${provider}" data-repo-id="${escapeHtml(r.id)}" data-repo-type="${escapeHtml(r.type || 'model')}" title="Import into IDE">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Import
            </button>
            <button class="btn btn-ghost btn-xs" data-action="open" data-url="${escapeHtml(r.url)}" title="Open in browser">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            </button>
            <button class="btn btn-ghost btn-xs conn-danger-btn" data-action="delete-repo" data-provider="${provider}" data-repo-id="${escapeHtml(r.id)}" data-repo-type="${escapeHtml(r.type || 'model')}" title="Delete repo">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  function showNewRepoForm(provider) {
    const name = prompt(`New ${PROVIDERS[provider].name} repository name:`, 'my-new-project');
    if (!name) return;
    const isPrivate = confirm('Make this repository private? Click OK for private, Cancel for public.');
    const description = prompt('Short description (optional):', '') || '';
    (async () => {
      try {
        if (provider === 'huggingface') {
          const type = prompt('Repo type — type "model", "space", or "dataset":', 'model');
          if (!['model', 'space', 'dataset'].includes(type)) {
            alert('Invalid type. Must be model, space, or dataset.');
            return;
          }
          await createRepo('huggingface', { name: slugify(name), type, private: isPrivate, description });
        } else {
          await createRepo('github', { name: slugify(name), private: isPrivate, description });
        }
        if (window.IDEUtils && IDEUtils.showToast) {
          IDEUtils.showToast(`Created ${name}`, 'success');
        }
        await refreshRepos(provider, { force: true });
      } catch (e) {
        if (window.IDEUtils && IDEUtils.showToast) {
          IDEUtils.showToast(`Failed: ${e.message}`, 'error', 8000);
        }
      }
    })();
  }

  async function pushCurrentProject(provider) {
    const ideState = window.IDEState ? IDEState.getState() : null;
    if (!ideState || !ideState.currentProject) {
      if (window.IDEUtils && IDEUtils.showToast) {
        IDEUtils.showToast('Open a project in the IDE first.', 'warning');
      }
      return;
    }
    let repoId;
    if (provider === 'huggingface') {
      const username = state.status.huggingface.username;
      const suggested = username ? `${username}/${slugify(ideState.currentProject.name)}` : '';
      repoId = prompt('HuggingFace repo ID (user/repo):', suggested);
      if (!repoId) return;
      const type = prompt('Repo type (model / space / dataset):', 'model');
      if (!['model', 'space', 'dataset'].includes(type)) {
        alert('Invalid type.');
        return;
      }
      const commitMsg = prompt('Commit message (optional):', `Push ${ideState.currentProject.name} from IDE`) || undefined;
      try {
        if (window.IDEUtils && IDEUtils.showToast) {
          IDEUtils.showToast('Pushing files...', 'info');
        }
        const result = await pushProject('huggingface', { repoId, type, commitMsg });
        const ok = result.pushed.filter(p => p.ok).length;
        const fail = result.pushed.filter(p => !p.ok).length;
        if (window.IDEUtils && IDEUtils.showToast) {
          IDEUtils.showToast(`Pushed ${ok} file(s)${fail ? `, ${fail} failed` : ''}.`, fail ? 'warning' : 'success', 6000);
        }
      } catch (e) {
        if (window.IDEUtils && IDEUtils.showToast) {
          IDEUtils.showToast(`Push failed: ${e.message}`, 'error', 8000);
        }
      }
    } else {
      const username = state.status.github.username;
      const suggested = username ? `${username}/${slugify(ideState.currentProject.name)}` : '';
      repoId = prompt('GitHub repo (owner/repo):', suggested);
      if (!repoId) return;
      const commitMsg = prompt('Commit message (optional):', `Push ${ideState.currentProject.name} from IDE`) || undefined;
      try {
        if (window.IDEUtils && IDEUtils.showToast) {
          IDEUtils.showToast('Pushing files...', 'info');
        }
        const result = await pushProject('github', { repoId, commitMsg });
        const ok = result.pushed.filter(p => p.ok).length;
        const fail = result.pushed.filter(p => !p.ok).length;
        if (window.IDEUtils && IDEUtils.showToast) {
          IDEUtils.showToast(`Pushed ${ok} file(s)${fail ? `, ${fail} failed` : ''}.`, fail ? 'warning' : 'success', 6000);
        }
      } catch (e) {
        if (window.IDEUtils && IDEUtils.showToast) {
          IDEUtils.showToast(`Push failed: ${e.message}`, 'error', 8000);
        }
      }
    }
  }

  async function pullRepoIntoIDE(provider, repoId, type) {
    let projectName;
    if (provider === 'huggingface') {
      projectName = prompt(`Import ${repoId} as IDE project named:`, repoId.split('/').pop());
    } else {
      projectName = prompt(`Import ${repoId} as IDE project named:`, repoId.split('/').pop());
    }
    if (!projectName) return;
    try {
      if (window.IDEUtils && IDEUtils.showToast) {
        IDEUtils.showToast('Importing files...', 'info');
      }
      const result = await pullProject(provider, { repoId, projectName, type });
      const ok = result.pulled.filter(p => p.ok).length;
      const fail = result.pulled.filter(p => !p.ok).length;
      if (window.IDEUtils && IDEUtils.showToast) {
        IDEUtils.showToast(`Imported ${ok} file(s) into "${projectName}"${fail ? `, ${fail} skipped` : ''}.`, fail ? 'warning' : 'success', 6000);
      }
      // Optionally switch to the new project
      if (window.SidebarComponent && SidebarComponent.refresh) {
        SidebarComponent.refresh();
      }
    } catch (e) {
      if (window.IDEUtils && IDEUtils.showToast) {
        IDEUtils.showToast(`Import failed: ${e.message}`, 'error', 8000);
      }
    }
  }

  async function startGitHubDeviceFlow(clientId) {
    const overlay = document.getElementById('connections-modal');
    if (!overlay) return;
    const status = overlay.querySelector('#gh-device-status');
    const startBtn = overlay.querySelector('#gh-device-start-btn');
    status.classList.remove('hidden');
    startBtn.disabled = true;
    try {
      const code = await GH.requestDeviceCode(clientId);
      status.innerHTML = `
        <div class="conn-device-active">
          <p>1. Visit <a href="${code.verification_uri}" target="_blank" rel="noopener">${escapeHtml(code.verification_uri)}</a></p>
          <p>2. Enter code: <code class="conn-device-code">${escapeHtml(code.user_code)}</code></p>
          <p class="muted">Waiting for authorization...</p>
        </div>
      `;
      const interval = (code.interval || 5) * 1000;
      const expiresAt = Date.now() + (code.expires_in || 900) * 1000;
      const poll = async () => {
        if (Date.now() > expiresAt) {
          status.innerHTML = '<p class="error">Device flow expired. Try again.</p>';
          startBtn.disabled = false;
          return;
        }
        try {
          const r = await GH.pollDeviceFlow(clientId, code.device_code);
          if (r.access_token) {
            status.innerHTML = '<p class="success">Authorized! Connecting...</p>';
            await connect('github', r.access_token);
            status.classList.add('hidden');
            if (window.IDEUtils && IDEUtils.showToast) {
              IDEUtils.showToast(`Connected to GitHub as ${state.status.github.username}`, 'success');
            }
            renderConnectedView('github');
            startBtn.disabled = false;
            return;
          }
          if (r.error === 'authorization_pending') {
            // Continue polling
            setTimeout(poll, interval);
          } else if (r.error === 'slow_down') {
            setTimeout(poll, interval + 5000);
          } else if (r.error === 'expired_token') {
            status.innerHTML = '<p class="error">Code expired. Try again.</p>';
            startBtn.disabled = false;
          } else {
            status.innerHTML = `<p class="error">${escapeHtml(r.error_description || r.error || 'Unknown error')}</p>`;
            startBtn.disabled = false;
          }
        } catch (e) {
          status.innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`;
          startBtn.disabled = false;
        }
      };
      setTimeout(poll, interval);
    } catch (e) {
      status.innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`;
      startBtn.disabled = false;
    }
  }

  // ============================================
  // Modal open/close
  // ============================================

  function openModal() {
    injectModal();
    const overlay = document.getElementById('connections-modal');
    overlay.classList.remove('hidden');
    // Refresh both views to current state
    for (const p of Object.keys(PROVIDERS)) {
      if (isConnected(p)) {
        renderConnectedView(p);
      } else {
        renderDisconnectedView(p);
      }
    }
  }

  function closeModal() {
    const overlay = document.getElementById('connections-modal');
    if (overlay) overlay.classList.add('hidden');
  }

  // ============================================
  // Misc helpers
  // ============================================

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatRelative(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    const now = Date.now();
    const diff = now - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    return `${Math.floor(months / 12)}y ago`;
  }

  function formatSize(bytes) {
    if (bytes == null) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  }

  // ============================================
  // Initialization
  // ============================================

  async function init() {
    if (window.__connectionsInit) return;
    window.__connectionsInit = true;

    log('Initializing...');

    // Wire header button
    const btn = document.getElementById('connections-btn');
    if (btn) {
      btn.addEventListener('click', openModal);
    } else {
      warn('Header button #connections-btn not found — modal can still be opened via Connections.openModal()');
    }

    // Load saved status
    await loadStatusFromStorage();
    updateHeaderButton();

    log('Ready. Status:', getStatus());
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
    openModal,
    closeModal,
    getStatus,
    isConnected,
    onStatusChange,
    // Storage
    getToken, setToken, clearToken,
    // Provider clients (for advanced use)
    HF, GH,
    // High-level ops
    connect, disconnect,
    listRepos, createRepo, deleteRepo,
    pushProject, pullProject,
    // Constants
    PROVIDERS,
  };
})();

window.Connections = Connections;
