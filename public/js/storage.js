/**
 * SBIDE - IndexedDB Storage Layer
 * Provides persistent storage for projects, files, and application state
 * Uses IndexedDB for large file storage + localStorage for settings
 */

const IDEStorage = (() => {
  const DB_NAME = 'ide-agent-platform';
  const DB_VERSION = 1;
  
  let db = null;
  
  // Store names
  const STORES = {
    PROJECTS: 'projects',
    FILES: 'files',
    VERSIONS: 'versions',
    MEMORY: 'memory',
    MEETINGS: 'meetings',
    CONTEXT: 'context'
  };

  /**
   * Initialize the database connection
   * @returns {Promise<IDBDatabase>}
   */
  /* === In-memory fallback (used when IndexedDB is unavailable) ===
     Triggered by browser extensions, sandboxed iframes, quota issues, or
     profile corruption. The fallback provides the same public API surface
     (Projects/Files/Versions/Memory/Meetings/Context/exportAll/restoreAll/
     clearAll) so the rest of the app keeps working. Data does NOT persist
     across reloads in fallback mode. */
  let fallbackMode = false;
  let fallbackStores = null;

  function initFallbackStores() {
    const stores = {};
    Object.values(STORES).forEach(name => { stores[name] = new Map(); });
    return stores;
  }

  function fallbackGetAll(storeName) {
    return Promise.resolve(Array.from(fallbackStores[storeName].values()));
  }
  function fallbackGet(storeName, key) {
    return Promise.resolve(fallbackStores[storeName].get(key) || null);
  }
  function fallbackPut(storeName, data) {
    // Determine the key from the store's keyPath
    const keyPath = FALLBACK_KEY_PATHS[storeName];
    const key = keyPath ? (Array.isArray(keyPath) ? keyPath.map(k => data[k]).join('\u0000') : data[keyPath]) : data.id;
    fallbackStores[storeName].set(key, data);
    return Promise.resolve(data);
  }
  function fallbackRemove(storeName, key) {
    fallbackStores[storeName].delete(key);
    return Promise.resolve();
  }
  function fallbackClear(storeName) {
    fallbackStores[storeName].clear();
    return Promise.resolve();
  }
  function fallbackGetByIndex(storeName, indexName, value) {
    // Linear scan; fine for in-memory fallback
    const keyPath = FALLBACK_INDEX_KEY_PATHS[storeName]?.[indexName];
    if (!keyPath) return Promise.resolve([]);
    const result = [];
    for (const item of fallbackStores[storeName].values()) {
      const itemVal = Array.isArray(keyPath) ? keyPath.map(k => item[k]).join('\u0000') : item[keyPath];
      if (itemVal === value) result.push(item);
    }
    return Promise.resolve(result);
  }

  const FALLBACK_KEY_PATHS = {
    [STORES.PROJECTS]: 'name',
    [STORES.FILES]: 'id',
    [STORES.VERSIONS]: 'id',
    [STORES.MEMORY]: 'projectName',
    [STORES.MEETINGS]: 'id',
    [STORES.CONTEXT]: 'projectName'
  };
  const FALLBACK_INDEX_KEY_PATHS = {
    [STORES.PROJECTS]: { updatedAt: 'updatedAt' },
    [STORES.FILES]: { project: 'project', path: 'path', ['project,path']: ['project', 'path'] },
    [STORES.VERSIONS]: { projectName: 'projectName' },
    [STORES.MEETINGS]: { projectName: 'projectName' }
  };

  async function init() {
    // If already in fallback mode, just resolve.
    if (fallbackMode) return null;
    if (db) return db;

    // Detect if IndexedDB is even available. Some sandboxed contexts throw
    // on access; others return undefined.
    let indexedDBAvailable = false;
    try {
      indexedDBAvailable = typeof indexedDB !== 'undefined' && indexedDB !== null;
    } catch (e) {
      indexedDBAvailable = false;
    }

    if (!indexedDBAvailable) {
      console.warn('IndexedDB unavailable — switching to in-memory fallback. Data will not persist.');
      fallbackMode = true;
      fallbackStores = initFallbackStores();
      return null;
    }

    return new Promise((resolve, reject) => {
      let request;
      try {
        request = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        console.warn('indexedDB.open threw — switching to in-memory fallback:', e);
        fallbackMode = true;
        fallbackStores = initFallbackStores();
        resolve(null);
        return;
      }

      request.onerror = () => {
        console.warn('Failed to open IndexedDB — switching to in-memory fallback. Data will not persist.', request.error);
        fallbackMode = true;
        fallbackStores = initFallbackStores();
        resolve(null);  // resolve (not reject) so app can continue
      };

      request.onsuccess = () => {
        db = request.result;

        db.onclose = () => { db = null; };
        db.onversionchange = () => { db.close(); db = null; };

        resolve(db);
      };

      request.onupgradeneeded = (event) => {
        const database = event.target.result;

        if (!database.objectStoreNames.contains(STORES.PROJECTS)) {
          const projectStore = database.createObjectStore(STORES.PROJECTS, { keyPath: 'name' });
          projectStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        }

        if (!database.objectStoreNames.contains(STORES.FILES)) {
          const fileStore = database.createObjectStore(STORES.FILES, { keyPath: 'id' });
          fileStore.createIndex('project', 'project', { unique: false });
          fileStore.createIndex('path', 'path', { unique: false });
          fileStore.createIndex(['project', 'path'], ['project', 'path'], { unique: true });
        }

        if (!database.objectStoreNames.contains(STORES.VERSIONS)) {
          const versionStore = database.createObjectStore(STORES.VERSIONS, { keyPath: 'id' });
          versionStore.createIndex('projectName', 'projectName', { unique: false });
        }

        if (!database.objectStoreNames.contains(STORES.MEMORY)) {
          database.createObjectStore(STORES.MEMORY, { keyPath: 'projectName' });
        }

        if (!database.objectStoreNames.contains(STORES.MEETINGS)) {
          const meetingStore = database.createObjectStore(STORES.MEETINGS, { keyPath: 'id' });
          meetingStore.createIndex('projectName', 'projectName', { unique: false });
        }

        if (!database.objectStoreNames.contains(STORES.CONTEXT)) {
          database.createObjectStore(STORES.CONTEXT, { keyPath: 'projectName' });
        }
      };
    });
  }

  /**
   * Generic transaction helper
   */
  function withTransaction(storeName, mode, callback) {
    return new Promise(async (resolve, reject) => {
      try {
        if (fallbackMode) {
          // In-memory fallback: synthesize a minimal store-like object
          // with get/put/delete/getAll/clear/index methods that operate
          // on the fallback Map. This lets the existing callback code work
          // unchanged.
          const fakeStore = {
            get: (key) => {
              const req = { onsuccess: null, onerror: null, result: fallbackStores[storeName].get(key) || null };
              // Fire callbacks asynchronously to mimic IDB semantics
              Promise.resolve().then(() => req.onsuccess && req.onsuccess());
              return req;
            },
            getAll: () => {
              const req = { onsuccess: null, onerror: null, result: Array.from(fallbackStores[storeName].values()) };
              Promise.resolve().then(() => req.onsuccess && req.onsuccess());
              return req;
            },
            put: (data) => {
              const keyPath = FALLBACK_KEY_PATHS[storeName];
              const key = keyPath ? (Array.isArray(keyPath) ? keyPath.map(k => data[k]).join('\u0000') : data[keyPath]) : data.id;
              fallbackStores[storeName].set(key, data);
              const req = { onsuccess: null, onerror: null, result: key };
              Promise.resolve().then(() => req.onsuccess && req.onsuccess());
              return req;
            },
            delete: (key) => {
              fallbackStores[storeName].delete(key);
              const req = { onsuccess: null, onerror: null };
              Promise.resolve().then(() => req.onsuccess && req.onsuccess());
              return req;
            },
            clear: () => {
              fallbackStores[storeName].clear();
              const req = { onsuccess: null, onerror: null };
              Promise.resolve().then(() => req.onsuccess && req.onsuccess());
              return req;
            },
            index: (indexName) => {
              const keyPath = FALLBACK_INDEX_KEY_PATHS[storeName]?.[indexName];
              return {
                getAll: (value) => {
                  const result = [];
                  if (keyPath) {
                    for (const item of fallbackStores[storeName].values()) {
                      const itemVal = Array.isArray(keyPath) ? keyPath.map(k => item[k]).join('\u0000') : item[keyPath];
                      if (itemVal === value) result.push(item);
                    }
                  }
                  const req = { onsuccess: null, onerror: null, result };
                  Promise.resolve().then(() => req.onsuccess && req.onsuccess());
                  return req;
                }
              };
            }
          };
          const result = await callback(fakeStore);
          // In fallback mode there's no transaction lifecycle — resolve immediately.
          resolve(result);
          return;
        }

        const database = await init();
        if (!database) {
          // Should not happen (fallbackMode should be true), but guard anyway.
          resolve(null);
          return;
        }
        const transaction = database.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);

        const result = await callback(store);

        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Generate a unique ID
   */
  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Get all items from a store
   */
  async function getAll(storeName) {
    return withTransaction(storeName, 'readonly', (store) => {
      return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    });
  }

  /**
   * Get a single item by key
   */
  async function get(storeName, key) {
    return withTransaction(storeName, 'readonly', (store) => {
      return new Promise((resolve, reject) => {
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    });
  }

  /**
   * Put or update an item
   */
  async function put(storeName, data) {
    return withTransaction(storeName, 'readwrite', (store) => {
      return new Promise((resolve, reject) => {
        const request = store.put(data);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    });
  }

  /**
   * Delete an item by key
   */
  async function remove(storeName, key) {
    return withTransaction(storeName, 'readwrite', (store) => {
      return new Promise((resolve, reject) => {
        const request = store.delete(key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    });
  }

  /**
   * Clear all items in a store
   */
  async function clear(storeName) {
    return withTransaction(storeName, 'readwrite', (store) => {
      return new Promise((resolve, reject) => {
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    });
  }

  /**
   * Get items by index
   */
  async function getByIndex(storeName, indexName, value) {
    return withTransaction(storeName, 'readonly', (store) => {
      return new Promise((resolve, reject) => {
        const index = store.index(indexName);
        const request = index.getAll(value);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    });
  }

  // ============================================
  // Project Operations
  // ============================================

  const Projects = {
    /**
     * Get all projects
     */
    async getAll() {
      const projects = await getAll(STORES.PROJECTS);
      return projects.sort((a, b) => b.updatedAt - a.updatedAt);
    },

    /**
     * Get a single project
     */
    async get(name) {
      return get(STORES.PROJECTS, name);
    },

    /**
     * Create a new project
     */
    async create(name) {
      const now = Date.now();
      const project = {
        name,
        path: `/projects/${name}`,
        createdAt: now,
        updatedAt: now,
        currentVersion: 'v0.1',
        files: []
      };
      
      await put(STORES.PROJECTS, project);
      
      // Create root directory entry
      await Files.create({
        id: generateId(),
        project: name,
        name: '',
        path: '',
        type: 'folder',
        children: [],
        updatedAt: now
      });
      
      return project;
    },

    /**
     * Update a project
     */
    async update(name, updates) {
      const project = await this.get(name);
      if (!project) throw new Error(`Project "${name}" not found`);
      
      const updatedProject = {
        ...project,
        ...updates,
        updatedAt: Date.now()
      };
      
      await put(STORES.PROJECTS, updatedProject);
      return updatedProject;
    },

    /**
     * Delete a project and all its files
     */
    async delete(name) {
      // Delete all project files
      const files = await Files.getByProject(name);
      for (const file of files) {
        await remove(STORES.FILES, file.id);
      }
      
      // Delete versions
      const versions = await Versions.getByProject(name);
      for (const version of versions) {
        await remove(STORES.VERSIONS, version.id);
      }
      
      // Delete memory
      await remove(STORES.MEMORY, name);
      
      // Delete context
      await remove(STORES.CONTEXT, name);
      
      // Delete meetings
      const meetings = await Meetings.getByProject(name);
      for (const meeting of meetings) {
        await remove(STORES.MEETINGS, meeting.id);
      }
      
      // Delete the project itself
      await remove(STORES.PROJECTS, name);
    },

    /**
     * Update project's file count
     */
    async updateFileCount(name) {
      const files = await Files.getByProject(name);
      const count = files.filter(f => f.type === 'file').length;
      
      return this.update(name, {
        files: buildFileTree(files)
      });
    }
  };

  // ============================================
  // File Operations
  // ============================================

  const Files = {
    /**
     * Get all files for a project
     */
    async getByProject(projectName) {
      return getByIndex(STORES.FILES, 'project', projectName);
    },

    /**
     * Get a specific file
     */
    async get(projectName, path) {
      const files = await this.getByProject(projectName);
      return files.find(f => f.path === path) || null;
    },

    /**
     * Create a new file or folder
     */
    async create(fileData) {
      const file = {
        ...fileData,
        id: fileData.id || generateId(),
        updatedAt: Date.now()
      };
      
      await put(STORES.FILES, file);
      return file;
    },

    /**
     * Update file content
     */
    async update(projectName, path, updates) {
      const file = await this.get(projectName, path);
      if (!file) throw new Error(`File "${path}" not found`);
      
      const updatedFile = {
        ...file,
        ...updates,
        updatedAt: Date.now()
      };
      
      await put(STORES.FILES, updatedFile);
      return updatedFile;
    },

    /**
     * Delete a file or folder (and children)
     */
    async delete(projectName, path) {
      const file = await this.get(projectName, path);
      if (!file) return;

      // If it's a folder, delete all children
      if (file.type === 'folder' && file.children) {
        for (const childPath of file.children) {
          await this.delete(projectName, childPath);
        }
      }

      await remove(STORES.FILES, file.id);

      // Mirror delete to OfflineKit (OPFS + filesystem + sync queue)
      if (window.OfflineKit) {
        try { await OfflineKit.remove(projectName, path); }
        catch (e) { /* non-fatal */ }
      }
    },

    /**
     * Move a file or folder (and all descendants) into a target folder.
     *
     * @param {string} projectName
     * @param {string} sourcePath  - path of the file/folder being moved
     * @param {string} targetFolderPath - path of the destination FOLDER
     *        (use '' or null to move to project root)
     * @returns {Object} the moved source (with updated path)
     * @throws if source equals target, source is an ancestor of target,
     *         or a same-named item already exists at the destination.
     */
    async move(projectName, sourcePath, targetFolderPath) {
      const srcSlash = sourcePath.endsWith('/') ? sourcePath.slice(0, -1) : sourcePath;
      const tgtSlash = (targetFolderPath || '').endsWith('/')
        ? targetFolderPath.slice(0, -1) : (targetFolderPath || '');

      // Validate: can't move into itself
      if (srcSlash === tgtSlash) {
        throw new Error('Cannot move a file/folder into itself.');
      }
      // Validate: can't move a folder into one of its own descendants
      if (tgtSlash.startsWith(srcSlash + '/')) {
        throw new Error('Cannot move a folder into one of its own subfolders.');
      }

      const source = await this.get(projectName, srcSlash);
      if (!source) throw new Error(`Source "${srcSlash}" not found.`);

      // Compute new path
      const newName = source.name;
      const newPath = tgtSlash ? `${tgtSlash}/${newName}` : newName;

      // Reject if an item with the same path already exists at the destination
      const existing = await this.get(projectName, newPath);
      if (existing) {
        throw new Error(`An item named "${newName}" already exists in the destination folder.`);
      }

      // Collect ALL files for this project so we can find descendants of source
      // (descendants are any items whose path starts with `srcSlash + '/'`).
      const allFiles = await this.getByProject(projectName);
      const descendants = allFiles.filter(f =>
        f.path === srcSlash || f.path.startsWith(srcSlash + '/')
      );

      // Rewrite each descendant's path by replacing the srcSlash prefix
      // with newPath. Use a transaction-like loop — best-effort atomic.
      const updates = [];
      for (const f of descendants) {
        const suffix = f.path === srcSlash ? '' : f.path.slice(srcSlash.length); // includes leading '/'
        const movedPath = newPath + suffix;
        updates.push({ file: f, newPath: movedPath });
      }

      // Apply: update path on each, then re-put
      for (const { file, newPath: movedPath } of updates) {
        const updated = {
          ...file,
          path: movedPath,
          // name stays the same (only the directory chain changes)
          updatedAt: Date.now()
        };
        await put(STORES.FILES, updated);
      }

      // Mirror to OfflineKit (best-effort): delete at old path, write at new path.
      // We can't easily enumerate OfflineKit's per-file content here, so we just
      // delete the old source path; the next content write will create the new path.
      if (window.OfflineKit) {
        try { await OfflineKit.remove(projectName, srcSlash); }
        catch (e) { /* non-fatal */ }
      }

      // Return the moved source (with its new path)
      return { ...source, path: newPath };
    },

    /**
     * Copy a file or folder (and all descendants) into a target folder.
     * If an item with the same name exists at the destination, " (copy)"
     * (then " (copy 2)", " (copy 3)"…) is appended to the name.
     *
     * @param {string} projectName
     * @param {string} sourcePath  - path of the file/folder being copied
     * @param {string} targetFolderPath - destination FOLDER ('' = root)
     * @returns {Object} the copied root item (with its new path)
     */
    async copy(projectName, sourcePath, targetFolderPath) {
      const srcSlash = sourcePath.endsWith('/') ? sourcePath.slice(0, -1) : sourcePath;
      const tgtSlash = (targetFolderPath || '').endsWith('/')
        ? targetFolderPath.slice(0, -1) : (targetFolderPath || '');

      const source = await this.get(projectName, srcSlash);
      if (!source) throw new Error(`Source "${srcSlash}" not found.`);

      // Find a non-colliding name at the destination
      let baseName = source.name;
      let candidateName = baseName;
      let counter = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const candidatePath = tgtSlash ? `${tgtSlash}/${candidateName}` : candidateName;
        const clash = await this.get(projectName, candidatePath);
        if (!clash) break;
        counter += 1;
        candidateName = counter === 1
          ? `${baseName} (copy)`
          : `${baseName} (copy ${counter})`;
      }

      const newPath = tgtSlash ? `${tgtSlash}/${candidateName}` : candidateName;

      // Collect descendants of source (including source itself)
      const allFiles = await this.getByProject(projectName);
      const descendants = allFiles.filter(f =>
        f.path === srcSlash || f.path.startsWith(srcSlash + '/')
      );

      // Create copies with rewritten paths
      for (const f of descendants) {
        const suffix = f.path === srcSlash ? '' : f.path.slice(srcSlash.length);
        const copiedPath = newPath + suffix;
        const copy = {
          ...f,
          id: generateId(),
          path: copiedPath,
          // Keep original name for descendants (only root copy gets the "(copy)" suffix)
          name: f.path === srcSlash ? candidateName : f.name,
          updatedAt: Date.now()
        };
        await put(STORES.FILES, copy);
        // Mirror to OfflineKit if the file has content
        if (window.OfflineKit && typeof f.content === 'string') {
          try { await OfflineKit.write(projectName, copiedPath, f.content); }
          catch (e) { /* non-fatal */ }
        }
      }

      return { ...source, id: undefined, name: candidateName, path: newPath };
    },

    /**
     * Write/update file content
     */
    async writeContent(projectName, path, content) {
      const result = await this.update(projectName, path, {
        content,
        size: new Blob([content]).size
      });
      // Mirror to OfflineKit (OPFS + filesystem + sync queue) if available.
      // Best-effort: don't let it block or fail the primary write.
      if (window.OfflineKit) {
        try { await OfflineKit.write(projectName, path, content); }
        catch (e) { /* non-fatal — primary write already succeeded */ }
      }
      return result;
    },

    /**
     * Read file content
     */
    async readContent(projectName, path) {
      const file = await this.get(projectName, path);
      if (file && file.content != null) return file.content;
      // Fallback: if primary store is missing the file (e.g. fresh session
      // after IndexedDB was cleared but OPFS still has it), try OfflineKit.
      if (window.OfflineKit) {
        try {
          const text = await OfflineKit.read(projectName, path);
          if (text !== null) return text;
        } catch (e) { /* non-fatal */ }
      }
      return null;
    },

    /**
     * List all files as tree structure
     */
    async listAsTree(projectName) {
      const files = await this.getByProject(projectName);
      return buildFileTree(files);
    },

    /**
     * Import files from a flat structure
     */
    async importFiles(projectName, files, basePath = '') {
      const created = [];
      
      for (const [filePath, content] of Object.entries(files)) {
        const fullPath = basePath ? `${basePath}/${filePath}` : filePath;
        const parts = fullPath.split('/');
        const fileName = parts.pop();
        const dirPath = parts.join('/');
        
        // Ensure parent directories exist
        if (parts.length > 0) {
          await this.ensureDirectory(projectName, parts);
        }
        
        // Create the file
        const file = await this.create({
          project: projectName,
          name: fileName,
          path: fullPath,
          type: 'file',
          content: typeof content === 'string' ? content : JSON.stringify(content),
          size: typeof content === 'string' ? content.length : JSON.stringify(content).length
        });
        
        created.push(file);
      }
      
      return created;
    },

    /**
     * Ensure directory exists, creating if needed
     */
    async ensureDirectory(projectName, pathParts) {
      let currentPath = '';
      
      for (const part of pathParts) {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        
        const existing = await this.get(projectName, currentPath);
        if (!existing) {
          await this.create({
            project: projectName,
            name: part,
            path: currentPath,
            type: 'folder',
            children: []
          });
        }
      }
    },

    /**
     * Export all files as a flat object
     */
    async exportAsObject(projectName) {
      const files = await this.getByProject(projectName);
      const exportObj = {};
      
      for (const file of files) {
        if (file.type === 'file' && file.content !== undefined) {
          exportObj[file.path] = file.content;
        }
      }
      
      return exportObj;
    }
  };

  // ============================================
  // Version Operations
  // ============================================

  const Versions = {
    /**
     * Get all versions for a project
     */
    async getByProject(projectName) {
      return getByIndex(STORES.VERSIONS, 'projectName', projectName);
    },

    /**
     * Create a new version checkpoint
     */
    async create(projectData, options = {}) {
      const now = Date.now();
      const existingVersions = await this.getByProject(projectData.name);
      const nextVersionNum = existingVersions.length + 1;
      const versionNumber = `v${nextVersionNum}.${options.suffix || '1'}`;
      
      // Get all project files
      const files = await Files.exportAsObject(projectData.name);
      
      const version = {
        id: generateId(),
        projectName: projectData.name,
        versionNumber,
        createdAt: now,
        description: options.description || `Checkpoint ${versionNumber}`,
        archivePath: undefined, // Would be blob URL in real implementation
        fileCount: Object.keys(files).length,
        size: JSON.stringify(files).length,
        hasArchive: !!options.createArchive,
        files: options.createArchive ? files : undefined
      };
      
      await put(STORES.VERSIONS, version);
      
      // Update project version
      await Projects.update(projectData.name, {
        currentVersion: versionNumber
      });
      
      return version;
    },

    /**
     * Get a specific version
     */
    async get(id) {
      return get(STORES.VERSIONS, id);
    },

    /**
     * Delete a version
     */
    async delete(id) {
      return remove(STORES.VERSIONS, id);
    },

    /**
     * Export version as ZIP-like object
     */
    async exportAsZip(versionId) {
      const version = await this.get(versionId);
      if (!version || !version.files) {
        throw new Error('Version not found or has no archived files');
      }
      return version.files;
    }
  };

  // ============================================
  // Memory Operations
  // ============================================

  const Memory = {
    /**
     * Get memory for a project
     */
    async get(projectName) {
      return get(STORES.MEMORY, projectName);
    },

    /**
     * Update memory for a project
     */
    async save(memoryData) {
      await put(STORES.MEMORY, memoryData);
      return memoryData;
    },

    /**
     * Add an anchor to memory
     */
    async addAnchor(projectName, anchor) {
      let memory = await this.get(projectName) || {
        projectName,
        anchors: [],
        keyDecisions: [],
        context: ''
      };
      
      // Check if similar anchor exists
      const exists = memory.anchors.some(a => 
        a.content === anchor.content && a.type === anchor.type
      );
      
      if (!exists) {
        memory.anchors.push({
          id: generateId(),
          timestamp: Date.now(),
          relevance: 1,
          ...anchor
        });
        
        await this.save(memory);
      }
      
      return memory;
    },

    /**
     * Add a key decision
     */
    async addDecision(projectName, decision) {
      let memory = await this.get(projectName) || {
        projectName,
        anchors: [],
        keyDecisions: [],
        context: ''
      };
      
      if (!memory.keyDecisions.includes(decision)) {
        memory.keyDecisions.push(decision);
        await this.save(memory);
      }
      
      return memory;
    }
  };

  // ============================================
  // Meeting Operations
  // ============================================

  const Meetings = {
    /**
     * Get all meetings for a project
     */
    async getByProject(projectName) {
      return getByIndex(STORES.MEETINGS, 'projectName', projectName);
    },

    /**
     * Create a new meeting note
     */
    async create(meetingData) {
      const meeting = {
        id: generateId(),
        createdAt: Date.now(),
        consensusReached: false,
        decisions: [],
        actionItems: [],
        concernsRaised: [],
        expertsPresent: [],
        debateTranscript: [],
        ...meetingData
      };
      
      await put(STORES.MEETINGS, meeting);
      return meeting;
    },

    /**
     * Get a specific meeting
     */
    async get(id) {
      return get(STORES.MEETINGS, id);
    },

    /**
     * Delete a meeting
     */
    async delete(id) {
      return remove(STORES.MEETINGS, id);
    }
  };

  // ============================================
  // Context Operations
  // ============================================

  const Context = {
    /**
     * Get context for a project
     */
    async get(projectName) {
      return get(STORES.CONTEXT, projectName);
    },

    /**
     * Save context for a project
     */
    async save(contextData) {
      await put(STORES.CONTEXT, contextData);
      return contextData;
    }
  };

  // ============================================
  // Utility Functions
  // ============================================

  /**
   * Build file tree from flat array
   */
  function buildFileTree(files) {
    const root = [];
    const map = new Map();
    
    // First pass: create map of all items
    for (const file of files) {
      map.set(file.path, { ...file, children: [] });
    }
    
    // Second pass: build hierarchy
    for (const file of files) {
      const node = map.get(file.path);
      if (!file.path || file.path === '') {
        root.push(node);
      } else {
        const parentPath = file.path.substring(0, file.path.lastIndexOf('/'));
        const parent = map.get(parentPath);
        if (parent) {
          parent.children.push(node);
        } else {
          root.push(node);
        }
      }
    }
    
    // Sort: folders first, then alphabetically
    const sortNodes = (nodes) => {
      nodes.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'folder' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
      for (const node of nodes) {
        if (node.children) {
          sortNodes(node.children);
        }
      }
    };
    
    sortNodes(root);
    
    // Return only children of root (if root is empty string)
    return root.length === 1 && root[0].path === '' ? root[0].children : root;
  }

  /**
   * Export all data (for backup)
   */
  async function exportAll() {
    const data = {
      projects: await Projects.getAll(),
      files: await getAll(STORES.FILES),
      versions: await getAll(STORES.VERSIONS),
      memories: await getAll(STORES.MEMORY),
      meetings: await getAll(STORES.MEETINGS),
      contexts: await getAll(STORES.CONTEXT),
      exportedAt: Date.now()
    };
    return data;
  }

  /**
   * Import all data (from backup)
   */
  const restoreAll = async function(data) {
    if (data.projects) {
      for (const project of data.projects) {
        await put(STORES.PROJECTS, project);
      }
    }
    if (data.files) {
      for (const file of data.files) {
        await put(STORES.FILES, file);
      }
    }
    if (data.versions) {
      for (const version of data.versions) {
        await put(STORES.VERSIONS, version);
      }
    }
    if (data.memories) {
      for (const memory of data.memories) {
        await put(STORES.MEMORY, memory);
      }
    }
    if (data.meetings) {
      for (const meeting of data.meetings) {
        await put(STORES.MEETINGS, meeting);
      }
    }
    if (data.contexts) {
      for (const context of data.contexts) {
        await put(STORES.CONTEXT, context);
      }
    }
  }

  /**
   * Clear all data
   */
  async function clearAll() {
    await clear(STORES.PROJECTS);
    await clear(STORES.FILES);
    await clear(STORES.VERSIONS);
    await clear(STORES.MEMORY);
    await clear(STORES.MEETINGS);
    await clear(STORES.CONTEXT);
  }

  // Public API
  return {
    init,
    generateId,
    Projects,
    Files,
    Versions,
    Memory,
    Meetings,
    Context,
    exportAll,
    restoreAll,
    clearAll,
    STORES,
    isFallbackMode: () => fallbackMode
  };
})();

// Export for use in other modules
window.IDEStorage = IDEStorage;
