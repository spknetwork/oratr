/**
 * SPK Drive Advanced Component
 * Enhanced file viewer with virtual filesystem, folders, and advanced UI
 */

// For now, we'll include the metadata parsing functions inline
// In production, these would come from spk-js

// Preset folder indices from dlux (index -> name mapping)
const PRESET_FOLDERS = {
  '2': 'Documents',
  '3': 'Images',
  '4': 'Videos',
  '5': 'Music',
  '6': 'Archives',
  '7': 'Code',
  '8': 'Trash',
  '9': 'Misc'
};

// Import the parseMetadataString from spk-js
// Note: In production, this would be imported from the spk-js module
// For now, we'll implement a compatible version here
function parseMetadataString(metadataString, cids) {
  console.log('[SPK Drive] Parsing metadata:', metadataString);
  
  if (!metadataString) {
    return {
      version: '1',
      encryptionKeys: '',
      folders: [],
      folderMap: new Map(),
      files: new Map()
    };
  }

  // Split by comma to get all parts
  const parts = metadataString.split(',');
  
  // First part is contract header
  const contractHeader = parts[0] || '';
  
  // Split header to get flags/encryption and folders
  const pipeIndex = contractHeader.indexOf('|');
  let contractFlagsAndEnc = contractHeader;
  let folderString = '';
  
  if (pipeIndex !== -1) {
    contractFlagsAndEnc = contractHeader.substring(0, pipeIndex);
    folderString = contractHeader.substring(pipeIndex + 1);
  }
  
  console.log('[SPK Drive] Contract header:', contractHeader);
  console.log('[SPK Drive] Folder string:', folderString);
  
  // Parse contract flags and encryption
  const [contractFlags = '1', encryptionKeys = ''] = contractFlagsAndEnc.split('#');
  const version = contractFlags.charAt(0) || '1';

  // Parse folders
  const folders = [];
  const folderMap = new Map();
  
  // Add preset folders
  Object.entries(PRESET_FOLDERS).forEach(([index, name]) => {
    folderMap.set(index, { index, name, parent: '', fullPath: name });
  });
  
  // Custom folder index sequence: 1, A, B, C, ...
  const getCustomFolderIndex = (position) => {
    if (position === 0) return '1';
    // After '1', we use A-Z, a-z
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    return alphabet[position - 1] || '';
  };
  
  // Parse custom folders from folder string
  if (folderString) {
    const folderDefs = folderString.split('|');
    let customFolderPosition = 0;
    
    for (const folderDef of folderDefs) {
      if (!folderDef) continue;
      
      // Check if it's a simple folder name (top-level custom folder)
      if (!folderDef.includes('/')) {
        // This is a top-level custom folder
        const folderIndex = getCustomFolderIndex(customFolderPosition);
        const folderInfo = {
          index: folderIndex,
          name: folderDef,
          parent: '0', // Root parent
          fullPath: folderDef
        };
        
        folders.push(folderInfo);
        folderMap.set(folderIndex, folderInfo);
        console.log(`[SPK Drive] Added custom folder: ${folderDef} with index ${folderIndex}`);
        customFolderPosition++;
        continue;
      }
      
      // Handle subfolder format: parentIndex/folderName
      const slashIndex = folderDef.indexOf('/');
      const parentIndex = folderDef.substring(0, slashIndex);
      const folderName = folderDef.substring(slashIndex + 1);
      
      // For subfolders, we need to generate a new index
      const folderIndex = getCustomFolderIndex(customFolderPosition);
      
      // Build full path based on parent
      let fullPath = folderName;
      if (parentIndex === '0') {
        fullPath = folderName; // Root level
      } else if (folderMap.has(parentIndex)) {
        const parent = folderMap.get(parentIndex);
        fullPath = `${parent.fullPath}/${folderName}`;
      } else {
        console.log(`[SPK Drive] Warning: Parent index ${parentIndex} not found for ${folderName}`);
      }
      
      const folderInfo = {
        index: folderIndex,
        name: folderName,
        parent: parentIndex,
        fullPath
      };
      
      folders.push(folderInfo);
      folderMap.set(folderIndex, folderInfo);
      console.log(`[SPK Drive] Added subfolder: ${fullPath} with index ${folderIndex}`);
      customFolderPosition++;
    }
  }

  // Parse files
  const files = new Map();
  const sortedCids = [...cids].sort();
  
  // Each file has 4 parts: name, ext.folderindex, thumb, flags-license-labels
  const partsPerFile = 4;
  for (let i = 0; i < sortedCids.length; i++) {
    const cid = sortedCids[i];
    const baseIndex = i * partsPerFile + 1; // +1 to skip header
    
    if (baseIndex + 3 < parts.length) {
      const name = parts[baseIndex] || '';
      const extAndPath = parts[baseIndex + 1] || '';
      const thumb = parts[baseIndex + 2] || '';
      const flagsData = parts[baseIndex + 3] || '0--';
      
      // Parse extension and folder index
      let ext = extAndPath;
      let pathIndex = '1';
      
      const lastDotIndex = extAndPath.lastIndexOf('.');
      if (lastDotIndex !== -1) {
        ext = extAndPath.substring(0, lastDotIndex);
        pathIndex = extAndPath.substring(lastDotIndex + 1) || '1';
      }
      
      // Parse flags-license-labels
      const [flags = '0', license = '', labels = ''] = flagsData.split('-');
      
      // Check if auxiliary
      const flagsNum = parseInt(flags) || 0;
      const isAuxiliary = (flagsNum & 2) !== 0; // Bit 2 = thumbnail/auxiliary
      
      const fileObj = {
        name,
        type: ext, // For compatibility with existing code
        ext,
        pathIndex,
        thumb,
        flags,
        license,
        labels,
        isAuxiliary,
        folder: folderMap.has(pathIndex) ? folderMap.get(pathIndex).fullPath : ''
      };
      
      console.log(`[SPK Drive] Parsed file: ${name}.${ext}, pathIndex: ${pathIndex}, folder: ${fileObj.folder}`);
      files.set(cid, fileObj);
    }
  }
  
  console.log('[SPK Drive] Parsed files:', files.size);
  console.log('[SPK Drive] Folder map:', Array.from(folderMap.entries()));
  console.log('[SPK Drive] Folders array:', folders);
  
  return {
    version,
    encryptionKeys,
    folders,
    folderMap,
    files
  };
}



function isAuxiliaryFile(metadata) {
  return metadata.flags === '2' || 
         metadata.name.startsWith('_') ||
         metadata.name.endsWith('.ts') ||
         metadata.name.endsWith('_thumb.m3u8');
}

function getAuxiliaryFileDescription(file) {
  const fullName = file.name + (file.ext ? '.' + file.ext : '');
  
  if (fullName.includes('_poster.')) return 'Video poster/thumbnail';
  if (fullName.endsWith('.ts')) return 'Video segment';
  
  if (fullName.startsWith('_')) {
    const videoExtensions = ['.mov', '.mp4', '.avi', '.webm', '.mkv', '.m4v'];
    if (videoExtensions.some(ext => fullName.toLowerCase().endsWith(ext))) {
      return 'Video thumbnail/preview';
    }
    if (fullName.endsWith('.jpg') || fullName.endsWith('.png')) {
      return 'Generated thumbnail';
    }
  }
  
  if (fullName.startsWith('thumb') && (fullName.endsWith('.jpg') || fullName.endsWith('.png'))) {
    return 'Thumbnail';
  }
  
  return 'Supporting file';
}

export default {
  name: 'SPKDriveAdvanced',
  data() {
    return {
      // View state
      viewMode: 'grid', // 'grid' or 'list'
      currentPath: '',
      breadcrumbs: [],
      showAuxiliary: false,
      
      // Search and filter
      searchQuery: '',
      filterTags: [],
      filterLabels: [],
      sortBy: 'name', // 'name', 'size', 'date', 'type'
      sortDirection: 'asc',
      
      // Selection
      selectedFiles: new Set(),
      lastSelectedIndex: -1,
      
      // Data
      contracts: {},
      files: [],
      folders: [],
      auxiliaryFiles: [],
      virtualFS: new Map(), // folder path -> file list
      
      // UI state
      loading: false,
      error: null,
      contextMenu: null,
      draggedFiles: [],
      dropTarget: null,
      
      // Storage stats
      totalSize: 0,
      usedSize: 0,
      availableSize: 0
    };
  },
  
  computed: {
    displayFiles() {
      let files = this.currentFolderFiles;
      
      // Apply search filter
      if (this.searchQuery) {
        const query = this.searchQuery.toLowerCase();
        files = files.filter(file => 
          file.name.toLowerCase().includes(query) ||
          file.type.toLowerCase().includes(query) ||
          (file.labels && file.labels.toLowerCase().includes(query))
        );
      }
      
      // Apply tag/label filters
      if (this.filterTags.length > 0) {
        files = files.filter(file => {
          const fileTags = (file.labels || '').split(',').map(l => l.trim());
          return this.filterTags.some(tag => fileTags.includes(tag));
        });
      }
      
      // Sort files
      files.sort((a, b) => {
        let aVal, bVal;
        
        switch (this.sortBy) {
          case 'size':
            aVal = a.size;
            bVal = b.size;
            break;
          case 'date':
            aVal = a.timestamp || 0;
            bVal = b.timestamp || 0;
            break;
          case 'type':
            aVal = a.type;
            bVal = b.type;
            break;
          default:
            aVal = a.name.toLowerCase();
            bVal = b.name.toLowerCase();
        }
        
        const result = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
        return this.sortDirection === 'asc' ? result : -result;
      });
      
      return files;
    },
    
    currentFolderFiles() {
      const folderFiles = this.virtualFS.get(this.currentPath) || [];
      return folderFiles.filter(file => !file.isAuxiliary || this.showAuxiliary);
    },
    
    currentFolderFolders() {
      const subfolders = [];
      
      this.folders.forEach(folder => {
        // For root level, show all top-level folders
        if (!this.currentPath) {
          if (!folder.path.includes('/')) {
            subfolders.push(folder);
          }
        } else {
          // For non-root, check if folder is a direct child
          if (folder.path.startsWith(this.currentPath + '/')) {
            const relativePath = folder.path.substring(this.currentPath.length + 1);
            // Only include if there's no additional slash (direct child)
            if (!relativePath.includes('/')) {
              subfolders.push(folder);
            }
          }
        }
      });
      
      return subfolders;
    },
    
    storagePercentage() {
      return this.availableSize > 0 ? (this.usedSize / this.availableSize * 100) : 0;
    },
    
    hasSelection() {
      return this.selectedFiles.size > 0;
    }
  },
  
  methods: {
    async loadDrive() {
      if (!window.currentAccount) {
        this.error = 'No account selected';
        return;
      }
      
      this.loading = true;
      this.error = null;
      
      try {
        const response = await fetch(`https://spktest.dlux.io/@${window.currentAccount}`);
        const data = await response.json();
        
        this.processContracts(data);
        this.calculateStorage(data);
        this.buildVirtualFS();
        
      } catch (error) {
        console.error('[SPK Drive] Error loading files:', error);
        this.error = error.message;
      } finally {
        this.loading = false;
      }
    },
    
    processContracts(data) {
      this.contracts = {};
      this.files = [];
      this.auxiliaryFiles = [];
      this.folders = new Map();
      
      // Initialize preset folders
      const presetFolders = ['Documents', 'Images', 'Videos', 'Music', 'Archives', 'Code', 'Trash', 'Misc'];
      presetFolders.forEach(name => {
        this.folders.set(name, {
          name,
          path: name,
          parent: '',
          fileCount: 0,
          size: 0,
          isPreset: true
        });
      });
      
      if (data.file_contracts) {
        for (const contractId in data.file_contracts) {
          const contract = data.file_contracts[contractId];
          this.contracts[contractId] = contract;
          
          if (contract.df && contract.m) {
            const cids = Object.keys(contract.df);
            console.log('[SPK Drive] Parsing metadata:', contract.m);
            const metadataInfo = parseMetadataString(contract.m, cids);
            console.log('[SPK Drive] Parsed metadata:', metadataInfo);
            console.log('[SPK Drive] Folders found:', metadataInfo.folders);
            console.log('[SPK Drive] Folder map entries:', Array.from(metadataInfo.folderMap.entries()));
            
            // Process folders from metadata
            metadataInfo.folders.forEach(folder => {
              if (!this.folders.has(folder.fullPath)) {
                this.folders.set(folder.fullPath, {
                  name: folder.name,
                  path: folder.fullPath,
                  parent: folder.parent,
                  fileCount: 0,
                  size: 0,
                  isPreset: false
                });
              }
            });
            
            // Process files with the updated parsing
            metadataInfo.files.forEach((fileMeta, cid) => {
              // Use folder from metadata
              const folder = fileMeta.folder || '';
              console.log(`[SPK Drive] File ${fileMeta.name}.${fileMeta.type} in folder: ${folder}`);
              
              const fileData = {
                cid,
                contractId,
                name: fileMeta.name || cid.substring(0, 8) + '...',
                type: fileMeta.type || 'unknown',
                size: contract.df[cid] || 0,
                owner: contract.t,
                expiration: contract.e,
                timestamp: contract.c || Date.now(),
                thumbnail: fileMeta.thumb || null,
                thumbnailData: null,
                thumbnailLoaded: false,
                thumbnailLoading: false,
                flags: fileMeta.flags,
                license: fileMeta.license,
                labels: fileMeta.labels,
                isAuxiliary: fileMeta.isAuxiliary,
                folder
              };
              
              // Load thumbnail if it exists
              if (fileData.thumbnail) {
                this.loadThumbnail(fileData);
              }
              
              console.log(`[SPK Drive] Final file: ${fileData.name}.${fileData.type} in folder: ${folder}`);
              
              if (fileData.isAuxiliary) {
                this.auxiliaryFiles.push(fileData);
              } else {
                this.files.push(fileData);
              }
            });
          }
        }
      }
    },
    
    buildVirtualFS() {
      this.virtualFS.clear();
      this.virtualFS.set('', []); // Root folder
      
      // Initialize all folders from the folders map
      this.folders.forEach((folder, path) => {
        this.virtualFS.set(path, []);
      });
      
      // Distribute files to folders
      [...this.files, ...(this.showAuxiliary ? this.auxiliaryFiles : [])].forEach(file => {
        const folder = file.folder || '';
        
        // Ensure the folder exists in virtualFS
        if (!this.virtualFS.has(folder)) {
          console.log(`[SPK Drive] Creating missing folder in virtualFS: ${folder}`);
          this.virtualFS.set(folder, []);
        }
        
        this.virtualFS.get(folder).push(file);
        
        // Update folder stats
        const folderInfo = this.folders.get(folder);
        if (folderInfo) {
          folderInfo.fileCount++;
          folderInfo.size += file.size;
        }
      });
    },
    
    getFolderByIndex(index) {
      // Map folder indices to preset folder names
      const indexMap = {
        '2': 'Documents',
        '3': 'Images',
        '4': 'Videos',
        '5': 'Music',
        '6': 'Archives',
        '7': 'Code',
        '8': 'Trash',
        '9': 'Misc'
      };
      
      return indexMap[index] || 'Misc';
    },
    
    suggestFolder(filename, type) {
      const ext = type?.toLowerCase() || '';
      
      const typeMap = {
        'jpg': 'Images', 'jpeg': 'Images', 'png': 'Images', 'gif': 'Images', 'webp': 'Images',
        'mp4': 'Videos', 'webm': 'Videos', 'avi': 'Videos', 'mov': 'Videos', 'mkv': 'Videos',
        'mp3': 'Music', 'wav': 'Music', 'ogg': 'Music', 'flac': 'Music',
        'pdf': 'Documents', 'doc': 'Documents', 'docx': 'Documents', 'txt': 'Documents',
        'zip': 'Archives', 'rar': 'Archives', '7z': 'Archives', 'tar': 'Archives',
        'js': 'Code', 'ts': 'Code', 'py': 'Code', 'java': 'Code', 'cpp': 'Code'
      };
      
      return typeMap[ext] || 'Misc';
    },
    
    calculateStorage(data) {
      this.totalSize = 0;
      this.usedSize = 0;
      
      if (data.file_contracts) {
        for (const contractId in data.file_contracts) {
          const contract = data.file_contracts[contractId];
          if (contract.df) {
            for (const cid in contract.df) {
              this.usedSize += contract.df[cid];
            }
          }
        }
      }
      
      // Calculate available from BROCA
      const brocaPower = data.pow_broca || 0;
      this.availableSize = brocaPower * 1000 * 1024 * 6; // 6KB per BROCA
      this.totalSize = Math.max(this.availableSize, this.usedSize);
    },
    
    navigateToFolder(path) {
      this.currentPath = path;
      this.selectedFiles.clear();
      this.updateBreadcrumbs();
      
      // Load thumbnails for files in this folder
      this.$nextTick(() => {
        const folderFiles = this.virtualFS.get(path) || [];
        console.log(`[SPK Drive] Loading thumbnails for ${folderFiles.length} files in ${path || 'root'}`);
        folderFiles.forEach(file => {
          if (file.thumbnail && !file.thumbnailLoaded) {
            this.loadThumbnail(file);
          }
        });
      });
    },
    
    updateBreadcrumbs() {
      this.breadcrumbs = [{ name: 'Home', path: '' }];
      
      if (this.currentPath) {
        const parts = this.currentPath.split('/');
        let accumPath = '';
        
        parts.forEach(part => {
          accumPath = accumPath ? `${accumPath}/${part}` : part;
          this.breadcrumbs.push({ name: part, path: accumPath });
        });
      }
    },
    
    selectFile(file, event) {
      const fileKey = file.cid;
      
      if (event.ctrlKey || event.metaKey) {
        // Toggle selection
        if (this.selectedFiles.has(fileKey)) {
          this.selectedFiles.delete(fileKey);
        } else {
          this.selectedFiles.add(fileKey);
        }
      } else if (event.shiftKey && this.lastSelectedIndex >= 0) {
        // Range selection
        const currentIndex = this.displayFiles.indexOf(file);
        const start = Math.min(this.lastSelectedIndex, currentIndex);
        const end = Math.max(this.lastSelectedIndex, currentIndex);
        
        for (let i = start; i <= end; i++) {
          this.selectedFiles.add(this.displayFiles[i].cid);
        }
      } else {
        // Single selection
        this.selectedFiles.clear();
        this.selectedFiles.add(fileKey);
      }
      
      this.lastSelectedIndex = this.displayFiles.indexOf(file);
    },
    
    openFile(file) {
      const url = `https://ipfs.dlux.io/ipfs/${file.cid}`;
      window.open(url, '_blank');
    },
    
    showContextMenu(event, file) {
      event.preventDefault();
      
      if (!this.selectedFiles.has(file.cid)) {
        this.selectedFiles.clear();
        this.selectedFiles.add(file.cid);
      }
      
      this.contextMenu = {
        x: event.clientX,
        y: event.clientY,
        items: this.getContextMenuItems(file)
      };
    },
    
    getContextMenuItems(file) {
      const items = [
        { label: 'Open', icon: '📂', action: () => this.openFile(file) },
        { label: 'Download', icon: '💾', action: () => this.downloadFile(file) },
        { divider: true },
        { label: 'Copy Link', icon: '🔗', action: () => this.copyLink(file) },
        { label: 'Share', icon: '🔄', action: () => this.shareFile(file) },
        { divider: true },
        { label: 'Move to...', icon: '📁', action: () => this.moveFiles() },
        { label: 'Rename', icon: '✏️', action: () => this.renameFile(file) },
        { divider: true },
        { label: 'Delete', icon: '🗑️', action: () => this.deleteFiles() }
      ];
      
      return items;
    },
    
    async downloadFile(file) {
      const url = `https://ipfs.dlux.io/ipfs/${file.cid}`;
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name + (file.type ? '.' + file.type : '');
      a.click();
    },
    
    async copyLink(file) {
      const url = `https://ipfs.dlux.io/ipfs/${file.cid}`;
      await navigator.clipboard.writeText(url);
      this.showNotification('Link copied to clipboard');
    },
    
    formatBytes(bytes) {
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let size = bytes;
      let unitIndex = 0;
      
      while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
      }
      
      return `${size.toFixed(2)} ${units[unitIndex]}`;
    },
    
    getFileIcon(file) {
      // Return SVG icon with file type text
      const fileType = (file.type || 'file').toUpperCase().substring(0, 4);
      return `
        <svg version="1.1" xmlns="http://www.w3.org/2000/svg"
             xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" viewBox="0 0 800 800"
             style="enable-background:new 0 0 800 800;" xml:space="preserve" width="48" height="48">
          <g>
            <path class="st0"
                d="M650,210H500c-5.5,0-10-4.5-10-10V50c0-5.5,4.5-10,10-10s10,4.5,10,10v140h140c5.5,0,10,4.5,10,10S655.5,210,650,210z" fill="#ccc" />
            <path class="st0" d="M650,309.7c-5.5,0-10-4.5-10-10v-95.5L495.9,60H200c-22.1,0-40,17.9-40,40v196.3c0,5.5-4.5,10-10,10 s-10-4.5-10-10V100c0-33.1,26.9-60,60-60h300c2.7,0,5.2,1,7.1,2.9l150,150c1.9,1.9,2.9,4.4,2.9,7.1v99.7 C660,305.2,655.5,309.7,650,309.7z" fill="#ccc" />
            <path class="st0"
                d="M600,760H200c-33.1,0-60-26.9-60-60V550c0-5.5,4.5-10,10-10s10,4.5,10,10v150c0,22.1,17.9,40,40,40h400 c22.1,0,40-17.9,40-40V550c0-5.5,4.5-10,10-10s10,4.5,10,10v150C660,733.1,633.1,760,600,760z" fill="#ccc" />
            <path class="st0"
                d="M550,560H250c-5.5,0-10-4.5-10-10s4.5-10,10-10h300c5.5,0,10,4.5,10,10S555.5,560,550,560z" fill="#ccc" />
            <path class="st0"
                d="M400,660H250c-5.5,0-10-4.5-10-10s4.5-10,10-10h150c5.5,0,10,4.5,10,10S405.5,660,400,660z" fill="#ccc" />
            <path class="st0"
                d="M400,460H250c-5.5,0-10-4.5-10-10s4.5-10,10-10h150c5.5,0,10,4.5,10,10S405.5,460,400,460z" fill="#ccc" />
          </g>
          <text x="400" y="450" text-anchor="middle" font-family="Arial, sans-serif" font-size="140" font-weight="bold" fill="#999">${fileType}</text>
        </svg>
      `;
    },
    
    // Add isValidThumb function like spkdrive
    isValidThumb(thumbData) {
      if (typeof thumbData === 'string') {
        if (thumbData.startsWith("data:image/")) return thumbData;
        if (thumbData.startsWith("https://")) return thumbData;
        else if (thumbData.startsWith("Qm")) return `https://ipfs.dlux.io/ipfs/${thumbData}`;
      }
      return false;
    },
    
    // Add thumbnail loading function like spkdrive
    async loadThumbnail(file) {
      if (!file.thumbnail || file.thumbnailLoaded) return;
      
      console.log(`[SPK Drive] Loading thumbnail for ${file.name}:`, file.thumbnail);
      
      try {
        // Mark as loading - in Vue 3, direct assignment works with reactive objects
        file.thumbnailLoading = true;
        
        if (file.thumbnail.startsWith('Qm')) {
          // IPFS thumbnail - fetch and convert to data URL
          const response = await fetch(`https://ipfs.dlux.io/ipfs/${file.thumbnail}`);
          const blob = await response.blob();
          
          const reader = new FileReader();
          reader.onload = () => {
            file.thumbnailData = reader.result;
            file.thumbnailLoaded = true;
            file.thumbnailLoading = false;
            console.log(`[SPK Drive] Thumbnail loaded for ${file.name}`);
            // Force update to ensure Vue detects the change
            this.$forceUpdate();
          };
          reader.onerror = () => {
            file.thumbnailLoading = false;
            console.error(`[SPK Drive] Failed to load thumbnail for ${file.name}`);
          };
          reader.readAsDataURL(blob);
        } else if (file.thumbnail.startsWith('data:image/') || file.thumbnail.startsWith('https://')) {
          // Already a valid URL
          file.thumbnailData = file.thumbnail;
          file.thumbnailLoaded = true;
          file.thumbnailLoading = false;
          // Force update to ensure Vue detects the change
          this.$forceUpdate();
        }
      } catch (error) {
        console.error(`[SPK Drive] Error loading thumbnail for ${file.name}:`, error);
        file.thumbnailLoading = false;
      }
    },
    
    getThumbnailUrl(file) {
      if (file.thumbnail && file.thumbnail.includes('Qm')) {
        return `https://ipfs.dlux.io/ipfs/${file.thumbnail}`;
      }
      return null;
    },
    
    handleDragStart(event, file) {
      this.draggedFiles = this.selectedFiles.has(file.cid) ? 
        Array.from(this.selectedFiles).map(cid => this.files.find(f => f.cid === cid)) :
        [file];
      
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', JSON.stringify(this.draggedFiles));
    },
    
    handleDragOver(event, folder) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      this.dropTarget = folder.path;
    },
    
    handleDrop(event, folder) {
      event.preventDefault();
      this.dropTarget = null;
      
      // Move files to folder
      this.draggedFiles.forEach(file => {
        file.folder = folder.path;
      });
      
      this.buildVirtualFS();
      this.draggedFiles = [];
    },
    
    showNotification(message) {
      // Simple notification - could be enhanced with a proper notification system
      const notification = document.createElement('div');
      notification.className = 'notification';
      notification.textContent = message;
      document.body.appendChild(notification);
      
      setTimeout(() => {
        notification.remove();
      }, 3000);
    },
    
    openUploadModal() {
      // Open the file upload modal
      if (window.fileUploadModal) {
        window.fileUploadModal.open();
      } else {
        this.showNotification('Upload modal not available. Please refresh the page.');
      }
    },
    
    // Add the missing methods
    getAuxiliaryFileDescription(file) {
      return getAuxiliaryFileDescription(file);
    },
    
    getAuxiliaryDescription(file) {
      return getAuxiliaryFileDescription({
        name: file.name,
        ext: file.type
      });
    }
  },
  
  mounted() {
    this.loadDrive().then(() => {
      // Load thumbnails for initial view
      this.$nextTick(() => {
        const folderFiles = this.virtualFS.get(this.currentPath) || [];
        console.log(`[SPK Drive] Initial thumbnail load for ${folderFiles.length} files`);
        folderFiles.forEach(file => {
          if (file.thumbnail && !file.thumbnailLoaded) {
            this.loadThumbnail(file);
          }
        });
      });
    });
    this.updateBreadcrumbs();
    
    // Close context menu on click outside
    document.addEventListener('click', () => {
      this.contextMenu = null;
    });
    
    // Listen for refresh events from the old UI
    window.addEventListener('spk-drive-refresh', () => {
      this.loadDrive();
    });
    
    // Listen for upload events
    window.addEventListener('spk-drive-upload', () => {
      this.openUploadModal();
    });
  },
  
  beforeUnmount() {
    // Clean up event listeners
    window.removeEventListener('spk-drive-refresh', this.loadDrive);
    window.removeEventListener('spk-drive-upload', () => {});
  },
  
  template: `
    <div class="spk-drive-advanced">
      <!-- Header -->
      <div class="drive-header">
        <h2>SPK Drive</h2>
        <div class="storage-indicator">
          <span>{{ formatBytes(usedSize) }} / {{ formatBytes(availableSize) }}</span>
          <div class="storage-bar">
            <div class="storage-fill" :style="{ width: storagePercentage + '%' }"></div>
          </div>
        </div>
      </div>
      
      <!-- Toolbar -->
      <div class="drive-toolbar">
        <div class="toolbar-left">
          <button class="btn btn-primary" @click="openUploadModal">
            <span>📤 Upload</span>
          </button>
          <button class="btn btn-secondary" @click="loadDrive">
            <span>🔄 Refresh</span>
          </button>
          <button v-if="hasSelection" class="btn btn-secondary" @click="deleteFiles">
            <span>🗑️ Delete</span>
          </button>
        </div>
        
        <div class="toolbar-center">
          <input 
            v-model="searchQuery"
            type="search"
            placeholder="Search files..."
            class="search-input"
          >
        </div>
        
        <div class="toolbar-right">
          <button 
            class="btn btn-icon"
            :class="{ active: showAuxiliary }"
            @click="showAuxiliary = !showAuxiliary"
            title="Show auxiliary files"
          >
            <span>👁️</span>
          </button>
          <div class="view-toggle">
            <button 
              class="btn btn-icon"
              :class="{ active: viewMode === 'grid' }"
              @click="viewMode = 'grid'"
            >
              <span>⚏</span>
            </button>
            <button 
              class="btn btn-icon"
              :class="{ active: viewMode === 'list' }"
              @click="viewMode = 'list'"
            >
              <span>☰</span>
            </button>
          </div>
        </div>
      </div>
      
      <!-- Breadcrumbs -->
      <div class="breadcrumbs">
        <span 
          v-for="(crumb, index) in breadcrumbs"
          :key="index"
          class="breadcrumb"
          :class="{ active: index === breadcrumbs.length - 1 }"
          @click="navigateToFolder(crumb.path)"
        >
          {{ crumb.name }}
          <span v-if="index < breadcrumbs.length - 1" class="separator">/</span>
        </span>
      </div>
      
      <!-- Main Content -->
      <div class="drive-content" v-if="!loading && !error">
        <!-- Folders -->
        <div v-if="currentFolderFolders.length > 0" class="folders-section">
          <div class="section-header">Folders</div>
          <div class="folders-grid">
            <div
              v-for="folder in currentFolderFolders"
              :key="folder.path"
              class="folder-item"
              @click="navigateToFolder(folder.path)"
              @dragover.prevent="handleDragOver($event, folder)"
              @drop="handleDrop($event, folder)"
              :class="{ 'drop-target': dropTarget === folder.path }"
            >
              <div class="folder-icon">📁</div>
              <div class="folder-name">{{ folder.name }}</div>
              <div class="folder-meta">{{ folder.fileCount }} files</div>
            </div>
          </div>
        </div>
        
        <!-- Files -->
        <div class="files-section">
          <div v-if="displayFiles.length === 0" class="empty-state">
            <p>📁</p>
            <h3>No files in this folder</h3>
            <p>Upload files or move them here</p>
          </div>
          
          <!-- Grid View -->
          <div v-else-if="viewMode === 'grid'" class="files-grid">
            <div
              v-for="file in displayFiles"
              :key="file.cid"
              class="file-card"
              :class="{ selected: selectedFiles.has(file.cid) }"
              @click="selectFile(file, $event)"
              @dblclick="openFile(file)"
              @contextmenu="showContextMenu($event, file)"
              draggable="true"
              @dragstart="handleDragStart($event, file)"
            >
              <div class="file-preview">
                <!-- Debug info -->
                <div v-if="false" style="position: absolute; top: 0; left: 0; font-size: 10px; background: rgba(0,0,0,0.8); color: white; padding: 2px; z-index: 10;">
                  thumb: {{ !!file.thumbnail }}<br>
                  loading: {{ file.thumbnailLoading }}<br>
                  loaded: {{ file.thumbnailLoaded }}<br>
                  data: {{ !!file.thumbnailData }}
                </div>
                <!-- Thumbnail loading state -->
                <div v-if="file.thumbnail && file.thumbnailLoading" 
                     class="thumbnail-loading d-flex align-items-center justify-content-center">
                  <div class="spinner-border spinner-border-sm text-light" role="status">
                    <span class="visually-hidden">Loading...</span>
                  </div>
                </div>
                <!-- Loaded thumbnail -->
                <img v-else-if="file.thumbnailData && isValidThumb(file.thumbnailData)"
                     :src="file.thumbnailData"
                     :alt="file.name"
                     class="thumbnail-image"
                     @error="$event.target.style.display='none'">
                <!-- SVG file icon fallback -->
                <div v-else class="file-icon-fallback" v-html="getFileIcon(file)"></div>
              </div>
              <div class="file-info">
                <div class="file-name" :title="file.name">{{ file.name }}</div>
                <div class="file-meta">
                  <span>{{ formatBytes(file.size) }}</span>
                  <span v-if="file.isAuxiliary" class="aux-badge">aux</span>
                </div>
              </div>
            </div>
          </div>
          
          <!-- List View -->
          <table v-else class="files-list">
            <thead>
              <tr>
                <th @click="sortBy = 'name'; sortDirection = sortDirection === 'asc' ? 'desc' : 'asc'">
                  Name {{ sortBy === 'name' ? (sortDirection === 'asc' ? '↑' : '↓') : '' }}
                </th>
                <th @click="sortBy = 'size'; sortDirection = sortDirection === 'asc' ? 'desc' : 'asc'">
                  Size {{ sortBy === 'size' ? (sortDirection === 'asc' ? '↑' : '↓') : '' }}
                </th>
                <th @click="sortBy = 'type'; sortDirection = sortDirection === 'asc' ? 'desc' : 'asc'">
                  Type {{ sortBy === 'type' ? (sortDirection === 'asc' ? '↑' : '↓') : '' }}
                </th>
                <th @click="sortBy = 'date'; sortDirection = sortDirection === 'asc' ? 'desc' : 'asc'">
                  Modified {{ sortBy === 'date' ? (sortDirection === 'asc' ? '↑' : '↓') : '' }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="file in displayFiles"
                :key="file.cid"
                class="file-row"
                :class="{ selected: selectedFiles.has(file.cid) }"
                @click="selectFile(file, $event)"
                @dblclick="openFile(file)"
                @contextmenu="showContextMenu($event, file)"
              >
                <td>
                  <!-- Thumbnail or icon in list view -->
                  <div class="d-flex align-items-center">
                    <div class="file-icon-container me-2" style="width: 32px; height: 32px;">
                      <div v-if="file.thumbnail && file.thumbnailLoading" 
                           class="d-flex align-items-center justify-content-center h-100">
                        <div class="spinner-border spinner-border-sm text-light" role="status" style="width: 16px; height: 16px;">
                          <span class="visually-hidden">Loading...</span>
                        </div>
                      </div>
                      <img v-else-if="file.thumbnailData && isValidThumb(file.thumbnailData)"
                           :src="file.thumbnailData"
                           :alt="file.name"
                           class="img-fluid"
                           style="max-width: 32px; max-height: 32px; object-fit: contain;"
                           @error="$event.target.style.display='none'">
                      <div v-else class="file-icon-small" v-html="getFileIcon(file)" style="width: 24px; height: 24px;"></div>
                    </div>
                    <div>
                      {{ file.name }}
                      <span v-if="file.isAuxiliary" class="aux-badge ms-1">aux</span>
                    </div>
                  </div>
                </td>
                <td>{{ formatBytes(file.size) }}</td>
                <td>{{ file.type }}</td>
                <td>{{ new Date(file.timestamp).toLocaleDateString() }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        
        <!-- Auxiliary Files Section -->
        <div v-if="showAuxiliary && auxiliaryFiles.length > 0" class="auxiliary-section">
          <div class="section-header">
            Auxiliary Files ({{ auxiliaryFiles.length }})
          </div>
          <div class="auxiliary-list">
            <div 
              v-for="aux in auxiliaryFiles"
              :key="aux.cid"
              class="auxiliary-item"
            >
              <span class="file-icon">{{ getFileIcon(aux) }}</span>
              <span class="file-name">{{ aux.name }}.{{ aux.type }}</span>
              <span class="file-desc">{{ getAuxiliaryDescription(aux) }}</span>
              <span class="file-size">{{ formatBytes(aux.size) }}</span>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Loading State -->
      <div v-else-if="loading" class="loading-state">
        <div class="spinner"></div>
        <p>Loading files...</p>
      </div>
      
      <!-- Error State -->
      <div v-else-if="error" class="error-state">
        <p>❌</p>
        <h3>Error loading files</h3>
        <p>{{ error }}</p>
        <button class="btn btn-primary" @click="loadDrive">Retry</button>
      </div>
      
      <!-- Context Menu -->
      <div 
        v-if="contextMenu"
        class="context-menu"
        :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
      >
        <div
          v-for="(item, index) in contextMenu.items"
          :key="index"
          class="context-menu-item"
          :class="{ divider: item.divider }"
          @click="item.action && item.action()"
        >
          <span v-if="!item.divider">
            <span class="icon">{{ item.icon }}</span>
            {{ item.label }}
          </span>
        </div>
      </div>
    </div>
  `
};