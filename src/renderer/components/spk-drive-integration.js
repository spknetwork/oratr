/**
 * SPK Drive Integration for SPK Desktop
 * 
 * This module integrates the SPK Drive component into the existing spk-desktop application
 */

// SPK Drive Integration - we'll load SPK from the API
// Since we're in Electron, we need to handle imports differently

// Helper function for notifications
function showNotification(message, type = 'info') {
    console.log(`[${type.toUpperCase()}] ${message}`);
    // You can implement a proper notification UI here
    if (type === 'error') {
        alert('Error: ' + message);
    }
}

let spkInstance = null;
let driveInstance = null;
let currentDriveAccount = null;
let isInitialized = false;

// We'll create a simplified drive implementation that works with the existing SPK API

// Create a simplified SPK Drive implementation
class SimpleSPKDrive {
    constructor(username) {
        this.username = username;
        this.files = new Map();
        this.folders = new Map();
        this.contracts = new Map();
        this.metadata = new Map();
        this.virtualFS = new Map();
        this.api = 'https://spkinstant.hivehoneycomb.com';
        this.initializePresetFolders();
    }
    
    initializePresetFolders() {
        const presetFolders = ['Documents', 'Images', 'Videos', 'Music', 'Trash'];
        presetFolders.forEach(name => {
            this.folders.set(name, {
                name,
                path: name,
                parent: '',
                created: Date.now(),
                modified: Date.now(),
                isPreset: true
            });
            this.virtualFS.set(name, new Set());
        });
        this.virtualFS.set('', new Set()); // Root folder
    }
    
    async loadDrive() {
        try {
            console.log('Loading drive for:', this.username);
            
            // Fetch user data from SPK API
            const response = await fetch(`${this.api}/@${this.username}`);
            const data = await response.json();
            
            console.log('SPK API Response:', data);
            
            // Clear existing data
            this.files.clear();
            this.contracts.clear();
            this.metadata.clear();
            
            // Process file contracts
            if (data.file_contracts) {
                for (const contractId in data.file_contracts) {
                    const contract = data.file_contracts[contractId];
                    this.processContract(contract);
                }
            }
            
            // Process shared contracts
            if (data.channels) {
                for (const user in data.channels) {
                    for (const contractId in data.channels[user]) {
                        const contract = data.channels[user][contractId];
                        this.processContract(contract);
                    }
                }
            }
            
            console.log('Files loaded:', this.files.size);
            return { contracts: this.contracts.size, files: this.files.size };
        } catch (error) {
            console.error('Failed to load drive:', error);
            throw error;
        }
    }
    
    processContract(contract) {
        this.contracts.set(contract.i, contract);
        
        // Parse metadata
        const parsedMeta = this.parseContractMetadata(contract);
        
        // Process files in contract
        if (contract.df) {
            const sortedCIDs = Object.keys(contract.df).sort();
            sortedCIDs.forEach((cid, index) => {
                const fileMeta = parsedMeta[cid] || {
                    name: `File ${index + 1}`,
                    type: 'unknown',
                    size: contract.df[cid]
                };
                
                const file = {
                    f: cid,
                    i: contract.i,
                    o: contract.t,
                    s: contract.df[cid],
                    e: contract.e,
                    t: Date.now(),
                    metadata: fileMeta,
                    folder: this.extractFolderFromMetadata(fileMeta)
                };
                
                this.files.set(cid, file);
                this.metadata.set(`${contract.i}:${cid}`, fileMeta);
                
                // Add to virtual file system
                const folder = file.folder || '';
                if (!this.virtualFS.has(folder)) {
                    this.virtualFS.set(folder, new Set());
                }
                this.virtualFS.get(folder).add(cid);
            });
        }
    }
    
    parseContractMetadata(contract) {
        const result = {};
        
        if (!contract.m) return result;
        
        const parts = contract.m.split(',');
        const encData = parts[0] || '';
        
        // Extract encryption and auto-renew info
        if (encData) {
            const encParts = encData.split('#');
            contract.autoRenew = (this.base64ToNumber(encParts[0]) & 1) ? true : false;
        }
        
        // Process file metadata
        const sortedCIDs = contract.df ? Object.keys(contract.df).sort() : [];
        sortedCIDs.forEach((cid, index) => {
            const baseIdx = index * 4 + 1;
            if (baseIdx + 3 < parts.length) {
                const flags = parts[baseIdx + 3] || '';
                const flagParts = flags.split('-');
                
                result[cid] = {
                    name: parts[baseIdx] || `File ${index + 1}`,
                    type: parts[baseIdx + 1] || 'unknown',
                    thumb: parts[baseIdx + 2] || '',
                    flags: flagParts[0] || '0',
                    license: flagParts[1] || '',
                    labels: flagParts[2] || '',
                    encrypted: !!(this.base64ToNumber(flagParts[0]) & 1),
                    is_thumb: !!(this.base64ToNumber(flagParts[0]) & 2),
                    nsfw: !!(this.base64ToNumber(flagParts[0]) & 4)
                };
            }
        });
        
        return result;
    }
    
    extractFolderFromMetadata(metadata) {
        // Check if file name contains a path
        if (metadata.name && metadata.name.includes('/')) {
            const parts = metadata.name.split('/');
            parts.pop(); // Remove filename
            return parts.join('/');
        }
        
        // Check labels for folder info
        if (metadata.labels) {
            const folderLabel = metadata.labels.split(',').find(l => l.startsWith('folder:'));
            if (folderLabel) {
                return folderLabel.substring(7);
            }
        }
        
        // Auto-categorize by type
        const typeMap = {
            'jpg': 'Images', 'jpeg': 'Images', 'png': 'Images', 'gif': 'Images', 'webp': 'Images',
            'mp4': 'Videos', 'webm': 'Videos', 'avi': 'Videos', 'mov': 'Videos',
            'mp3': 'Music', 'wav': 'Music', 'ogg': 'Music', 'flac': 'Music',
            'pdf': 'Documents', 'doc': 'Documents', 'docx': 'Documents', 'txt': 'Documents'
        };
        
        const ext = metadata.type.toLowerCase();
        return typeMap[ext] || '';
    }
    
    base64ToNumber(chars) {
        const glyphs = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz+=";
        let result = 0;
        for (const char of (chars || '')) {
            result = result * 64 + glyphs.indexOf(char);
        }
        return result;
    }
    
    getFiles(folderPath = '') {
        const filesInFolder = this.virtualFS.get(folderPath) || new Set();
        return Array.from(filesInFolder)
            .map(cid => this.files.get(cid))
            .filter(file => file !== undefined);
    }
    
    getSubfolders(parentPath = '') {
        const subfolders = [];
        
        // Add preset folders at root
        if (parentPath === '') {
            this.folders.forEach(folder => {
                if (folder.parent === '') {
                    subfolders.push(folder);
                }
            });
        }
        
        // Find dynamic folders
        this.virtualFS.forEach((files, path) => {
            if (path && path !== parentPath) {
                const parts = path.split('/');
                const parentParts = parentPath ? parentPath.split('/') : [];
                
                // Check if this is a direct subfolder
                if (parts.length === parentParts.length + 1) {
                    const matches = parentParts.every((part, i) => parts[i] === part);
                    if (matches) {
                        const folderName = parts[parts.length - 1];
                        if (!this.folders.has(path)) {
                            this.folders.set(path, {
                                name: folderName,
                                path: path,
                                parent: parentPath,
                                created: Date.now(),
                                modified: Date.now()
                            });
                        }
                        subfolders.push(this.folders.get(path));
                    }
                }
            }
        });
        
        return subfolders;
    }
    
    getStorageStats() {
        let usedSize = 0;
        this.files.forEach(file => {
            usedSize += file.s;
        });
        
        // Calculate available size based on BROCA (simplified)
        const availableSize = 1000 * 1024 * 1024 * 6; // 6GB for demo
        
        return {
            totalSize: availableSize,
            usedSize,
            availableSize: availableSize - usedSize,
            fileCount: this.files.size,
            contractCount: this.contracts.size
        };
    }
    
    searchFiles(query, options = {}) {
        let results = Array.from(this.files.values());
        
        if (query) {
            const lowerQuery = query.toLowerCase();
            results = results.filter(file => 
                file.metadata?.name.toLowerCase().includes(lowerQuery) ||
                file.metadata?.type.toLowerCase().includes(lowerQuery)
            );
        }
        
        if (options.folder !== undefined) {
            if (options.folder === '') {
                results = results.filter(file => !file.folder || file.folder === '');
            } else {
                results = results.filter(file => 
                    file.folder === options.folder || 
                    file.folder?.startsWith(options.folder + '/')
                );
            }
        }
        
        return results;
    }
    
    async createFolder(path) {
        if (this.folders.has(path)) {
            throw new Error('Folder already exists');
        }
        
        const parts = path.split('/');
        const name = parts[parts.length - 1];
        const parent = parts.slice(0, -1).join('/');
        
        const folder = {
            name,
            path,
            parent,
            created: Date.now(),
            modified: Date.now()
        };
        
        this.folders.set(path, folder);
        this.virtualFS.set(path, new Set());
        
        return folder;
    }
    
    async moveFile(cid, targetFolder) {
        const file = this.files.get(cid);
        if (!file) {
            throw new Error('File not found');
        }
        
        // Remove from current folder
        const currentFolder = file.folder || '';
        this.virtualFS.get(currentFolder)?.delete(cid);
        
        // Add to target folder
        if (!this.virtualFS.has(targetFolder)) {
            this.virtualFS.set(targetFolder, new Set());
        }
        this.virtualFS.get(targetFolder).add(cid);
        
        // Update file record
        file.folder = targetFolder;
    }
    
    async deleteFile(cid) {
        await this.moveFile(cid, 'Trash');
        const file = this.files.get(cid);
        if (file && file.metadata) {
            file.metadata.labels = (file.metadata.labels || '') + `,deleted:${Date.now()}`;
        }
    }
}

// Initialize SPK Drive when account changes
async function initializeSPKDrive(username) {
    try {
        console.log('Initializing SPK Drive for:', username);
        
        // Create drive instance
        driveInstance = new SimpleSPKDrive(username);
        
        // Load the drive
        const stats = await driveInstance.loadDrive();
        
        // Render the drive UI
        renderDriveUI();
        
        // Handle the loaded event
        handleDriveLoaded(stats);
        
        currentDriveAccount = username;
        isInitialized = true;
    } catch (error) {
        console.error('Failed to initialize SPK Drive:', error);
        showDriveError(error.message);
    }
}

// Render the drive UI
function renderDriveUI() {
    const driveTab = document.getElementById('drive-tab');
    if (!driveTab) return;
    
    driveTab.innerHTML = `
        <div class="spk-drive-container">
            <!-- Header -->
            <div class="drive-header">
                <h2>SPK Drive</h2>
                <div class="drive-stats" id="drive-stats">
                    <span class="loading">Loading...</span>
                </div>
            </div>
            
            <!-- Search and Actions -->
            <div class="drive-toolbar">
                <div class="search-container">
                    <i class="fas fa-search"></i>
                    <input type="search" id="drive-search" placeholder="Search files..." onkeyup="searchDriveFiles()">
                </div>
                
                <div class="drive-actions">
                    <button onclick="createNewDriveFolder()" class="btn btn-secondary">
                        <i class="fas fa-folder-plus"></i> New Folder
                    </button>
                    <button onclick="uploadToSPKDrive()" class="btn btn-primary">
                        <i class="fas fa-upload"></i> Upload Files
                    </button>
                    <button onclick="refreshSPKDrive()" class="btn btn-secondary">
                        <i class="fas fa-sync"></i>
                    </button>
                    
                    <div class="view-toggle">
                        <button onclick="setDriveView('grid')" id="grid-view-btn" class="active">
                            <i class="fas fa-th"></i>
                        </button>
                        <button onclick="setDriveView('list')" id="list-view-btn">
                            <i class="fas fa-list"></i>
                        </button>
                    </div>
                </div>
            </div>
            
            <!-- Breadcrumb -->
            <nav class="drive-breadcrumb" id="drive-breadcrumb">
                <span onclick="navigateDriveTo('')">My Drive</span>
            </nav>
            
            <!-- File Area -->
            <div id="drive-files" class="drive-files" 
                ondrop="handleDriveDrop(event)" 
                ondragover="handleDriveDragOver(event)"
                ondragenter="handleDriveDragEnter(event)"
                ondragleave="handleDriveDragLeave(event)">
                <div class="loading-spinner">
                    <i class="fas fa-spinner fa-spin"></i>
                    <p>Loading files...</p>
                </div>
            </div>
            
            <!-- Upload Progress -->
            <div id="upload-progress" class="upload-progress" style="display: none;">
                <div class="upload-header">
                    <h4>Uploading Files</h4>
                    <button onclick="hideUploadProgress()">×</button>
                </div>
                <div id="upload-items"></div>
            </div>
            
            <!-- Context Menu -->
            <div id="drive-context-menu" class="context-menu" style="display: none;">
                <button onclick="openSelectedFile()"><i class="fas fa-external-link-alt"></i> Open</button>
                <button onclick="downloadSelectedFile()"><i class="fas fa-download"></i> Download</button>
                <button onclick="renameSelectedFile()"><i class="fas fa-edit"></i> Rename</button>
                <button onclick="deleteSelectedFile()"><i class="fas fa-trash"></i> Delete</button>
            </div>
        </div>
    `;
}

// Global variables for UI state
let currentPath = '';
let selectedFiles = new Set();
let selectedFolders = new Set();
let viewMode = 'grid';
let isDragging = false;
let contextTarget = null;

// Drive event handlers
function handleDriveLoaded(stats) {
    console.log('Drive loaded:', stats);
    updateDriveStats();
    renderFileList();
}

function handleDriveError(error) {
    console.error('Drive error:', error);
    showDriveError(error.message || 'Unknown error occurred');
}

function handleFilesDropped(event) {
    const { files, targetFolder } = event;
    uploadFiles(files, targetFolder);
}

// Update drive statistics
function updateDriveStats() {
    if (!driveInstance) return;
    
    const stats = driveInstance.getStorageStats();
    const statsElement = document.getElementById('drive-stats');
    
    if (statsElement) {
        const percentage = ((stats.usedSize / stats.totalSize) * 100).toFixed(1);
        statsElement.innerHTML = `
            <span>${stats.fileCount} files</span>
            <div class="storage-bar">
                <div class="storage-used" style="width: ${percentage}%"></div>
            </div>
            <span>${formatBytes(stats.usedSize)} / ${formatBytes(stats.totalSize)}</span>
        `;
    }
}

// Render file list
function renderFileList() {
    if (!driveInstance) return;
    
    const filesArea = document.getElementById('drive-files');
    if (!filesArea) return;
    
    const files = driveInstance.getFiles(currentPath);
    const folders = driveInstance.getSubfolders(currentPath);
    
    if (files.length === 0 && folders.length === 0) {
        filesArea.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-folder-open fa-4x"></i>
                <p>This folder is empty</p>
                <p class="text-muted">Drag and drop files here or click Upload</p>
            </div>
        `;
        return;
    }
    
    if (viewMode === 'grid') {
        renderGridView(filesArea, folders, files);
    } else {
        renderListView(filesArea, folders, files);
    }
}

// Render grid view
function renderGridView(container, folders, files) {
    let html = '<div class="file-grid">';
    
    // Render folders
    folders.forEach(folder => {
        const isSelected = selectedFolders.has(folder.path);
        html += `
            <div class="file-item folder ${isSelected ? 'selected' : ''}" 
                data-path="${folder.path}"
                draggable="true"
                ondragstart="handleItemDragStart(event, '${folder.path}', 'folder')"
                onclick="handleFolderClick(event, '${folder.path}')"
                oncontextmenu="showDriveContextMenu(event, 'folder', '${folder.path}')">
                <i class="fas fa-folder fa-3x"></i>
                <span class="file-name">${folder.name}</span>
            </div>
        `;
    });
    
    // Render files
    files.forEach(file => {
        const isSelected = selectedFiles.has(file.f);
        const icon = getFileIcon(file);
        html += `
            <div class="file-item ${isSelected ? 'selected' : ''}" 
                data-cid="${file.f}"
                draggable="true"
                ondragstart="handleItemDragStart(event, '${file.f}', 'file')"
                onclick="handleFileClick(event, '${file.f}')"
                oncontextmenu="showDriveContextMenu(event, 'file', '${file.f}')">
                ${icon}
                <span class="file-name">${file.metadata?.name || file.f}</span>
                <span class="file-size">${formatBytes(file.s)}</span>
            </div>
        `;
    });
    
    html += '</div>';
    container.innerHTML = html;
}

// Render list view
function renderListView(container, folders, files) {
    let html = `
        <table class="file-list">
            <thead>
                <tr>
                    <th>Name</th>
                    <th>Size</th>
                    <th>Type</th>
                    <th>Modified</th>
                </tr>
            </thead>
            <tbody>
    `;
    
    // Render folders
    folders.forEach(folder => {
        const isSelected = selectedFolders.has(folder.path);
        html += `
            <tr class="folder-row ${isSelected ? 'selected' : ''}"
                onclick="handleFolderClick(event, '${folder.path}')"
                oncontextmenu="showDriveContextMenu(event, 'folder', '${folder.path}')">
                <td><i class="fas fa-folder"></i> ${folder.name}</td>
                <td>-</td>
                <td>Folder</td>
                <td>${new Date(folder.modified).toLocaleDateString()}</td>
            </tr>
        `;
    });
    
    // Render files
    files.forEach(file => {
        const isSelected = selectedFiles.has(file.f);
        html += `
            <tr class="${isSelected ? 'selected' : ''}"
                onclick="handleFileClick(event, '${file.f}')"
                oncontextmenu="showDriveContextMenu(event, 'file', '${file.f}')">
                <td><i class="fas fa-file"></i> ${file.metadata?.name || file.f}</td>
                <td>${formatBytes(file.s)}</td>
                <td>${file.metadata?.type || 'Unknown'}</td>
                <td>${file.t ? new Date(file.t * 1000).toLocaleDateString() : '-'}</td>
            </tr>
        `;
    });
    
    html += '</tbody></table>';
    container.innerHTML = html;
}

// UI Event Handlers
window.searchDriveFiles = function() {
    const query = document.getElementById('drive-search').value;
    if (driveInstance) {
        const results = driveInstance.searchFiles(query, { folder: currentPath });
        // Re-render with search results
        renderSearchResults(results);
    }
};

window.createNewDriveFolder = async function() {
    const name = prompt('Enter folder name:');
    if (name && driveInstance) {
        try {
            const path = currentPath ? `${currentPath}/${name}` : name;
            await driveInstance.createFolder(path);
            renderFileList();
        } catch (error) {
            alert('Failed to create folder: ' + error.message);
        }
    }
};

window.uploadToSPKDrive = function() {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = (e) => {
        const files = e.target.files;
        if (files.length > 0) {
            uploadFiles(files, currentPath);
        }
    };
    input.click();
};

window.refreshSPKDrive = async function() {
    if (driveInstance) {
        try {
            await driveInstance.loadDrive();
            renderFileList();
        } catch (error) {
            console.error('Failed to refresh drive:', error);
        }
    }
};

window.setDriveView = function(mode) {
    viewMode = mode;
    document.getElementById('grid-view-btn').classList.toggle('active', mode === 'grid');
    document.getElementById('list-view-btn').classList.toggle('active', mode === 'list');
    renderFileList();
};

window.navigateDriveTo = function(path) {
    currentPath = path;
    selectedFiles.clear();
    selectedFolders.clear();
    updateBreadcrumb();
    renderFileList();
};

// File/Folder selection
window.handleFileClick = function(event, cid) {
    event.preventDefault();
    
    if (event.ctrlKey || event.metaKey) {
        // Multi-select
        if (selectedFiles.has(cid)) {
            selectedFiles.delete(cid);
        } else {
            selectedFiles.add(cid);
        }
    } else {
        // Single select
        selectedFiles.clear();
        selectedFolders.clear();
        selectedFiles.add(cid);
    }
    
    updateSelection();
};

window.handleFolderClick = function(event, path) {
    event.preventDefault();
    
    if (event.detail === 2) {
        // Double click - navigate
        navigateDriveTo(path);
    } else {
        // Single click - select
        selectedFiles.clear();
        selectedFolders.clear();
        selectedFolders.add(path);
        updateSelection();
    }
};

// Drag and Drop
window.handleDriveDrop = async function(event) {
    event.preventDefault();
    isDragging = false;
    updateDragState();
    
    // Handle external files
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
        uploadFiles(event.dataTransfer.files, currentPath);
        return;
    }
    
    // Handle internal drag
    try {
        const data = JSON.parse(event.dataTransfer.getData('application/json'));
        if (data.type === 'file' && driveInstance) {
            await driveInstance.moveFile(data.id, currentPath);
            renderFileList();
        }
    } catch (error) {
        console.error('Drop error:', error);
    }
};

window.handleDriveDragOver = function(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
};

window.handleDriveDragEnter = function(event) {
    event.preventDefault();
    isDragging = true;
    updateDragState();
};

window.handleDriveDragLeave = function(event) {
    if (event.target === document.getElementById('drive-files')) {
        isDragging = false;
        updateDragState();
    }
};

window.handleItemDragStart = function(event, id, type) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/json', JSON.stringify({ id, type }));
};

// Context Menu
window.showDriveContextMenu = function(event, type, target) {
    event.preventDefault();
    
    const menu = document.getElementById('drive-context-menu');
    menu.style.display = 'block';
    menu.style.left = event.clientX + 'px';
    menu.style.top = event.clientY + 'px';
    
    contextTarget = { type, id: target };
};

// Context menu actions
window.openSelectedFile = async function() {
    if (contextTarget && contextTarget.type === 'file') {
        const file = driveInstance.files.get(contextTarget.id);
        if (file) {
            window.open(`https://ipfs.dlux.io/ipfs/${file.f}`, '_blank');
        }
    }
    hideContextMenu();
};

window.downloadSelectedFile = async function() {
    if (contextTarget && contextTarget.type === 'file') {
        const file = driveInstance.files.get(contextTarget.id);
        if (file) {
            const a = document.createElement('a');
            a.href = `https://ipfs.dlux.io/ipfs/${file.f}`;
            a.download = file.metadata?.name || file.f;
            a.click();
        }
    }
    hideContextMenu();
};

window.deleteSelectedFile = async function() {
    if (contextTarget && confirm('Move this file to trash?')) {
        try {
            if (contextTarget.type === 'file') {
                await driveInstance.deleteFile(contextTarget.id);
            }
            renderFileList();
        } catch (error) {
            alert('Failed to delete: ' + error.message);
        }
    }
    hideContextMenu();
};

// Upload files using the Electron API
async function uploadFiles(files, folder) {
    const uploadProgress = document.getElementById('upload-progress');
    const uploadItems = document.getElementById('upload-items');
    
    uploadProgress.style.display = 'block';
    uploadItems.innerHTML = '';
    
    for (const file of files) {
        const itemId = 'upload-' + Date.now() + '-' + Math.random();
        
        uploadItems.innerHTML += `
            <div id="${itemId}" class="upload-item">
                <div class="upload-info">
                    <span class="file-name">${file.name}</span>
                    <span class="file-size">${formatBytes(file.size)}</span>
                </div>
                <div class="upload-progress-bar">
                    <div class="progress-fill" style="width: 0%"></div>
                </div>
                <span class="upload-status">Preparing...</span>
            </div>
        `;
        
        try {
            // For Electron, we need to handle file uploads differently
            // We'll use the existing video upload API as a reference
            if (window.api && window.api.video) {
                // Calculate storage cost
                const storageCost = await window.api.broca.calculateStorageCost(file.size, 30);
                console.log('Storage cost:', storageCost);
                
                // For now, show a message about using the video upload
                // In a full implementation, we'd extend the API to handle all file types
                if (file.type.startsWith('video/')) {
                    updateUploadProgress(itemId, 50, 'Use Upload tab for videos');
                } else {
                    updateUploadProgress(itemId, 100, 'File upload coming soon');
                }
                
                // Simulate adding to virtual file system
                const mockFile = {
                    f: 'Qm' + Math.random().toString(36).substring(2, 15),
                    i: 'mock-contract-' + Date.now(),
                    o: currentDriveAccount,
                    s: file.size,
                    metadata: {
                        name: file.name,
                        type: file.name.split('.').pop() || 'unknown',
                        folder: folder
                    },
                    folder: folder
                };
                
                // Add to drive instance for demo
                if (driveInstance) {
                    driveInstance.files.set(mockFile.f, mockFile);
                    const folderSet = driveInstance.virtualFS.get(folder) || new Set();
                    folderSet.add(mockFile.f);
                    driveInstance.virtualFS.set(folder, folderSet);
                }
            }
            
            // Refresh file list
            setTimeout(() => {
                renderFileList();
            }, 1000);
            
        } catch (error) {
            updateUploadProgress(itemId, 0, 'Failed: ' + error.message);
        }
    }
}

// Helper functions
function updateUploadProgress(itemId, progress, status) {
    const item = document.getElementById(itemId);
    if (item) {
        const progressBar = item.querySelector('.progress-fill');
        const statusText = item.querySelector('.upload-status');
        
        progressBar.style.width = progress + '%';
        statusText.textContent = status || `${progress}%`;
    }
}

function updateBreadcrumb() {
    const breadcrumb = document.getElementById('drive-breadcrumb');
    if (!breadcrumb) return;
    
    let html = '<span onclick="navigateDriveTo(\'\')">My Drive</span>';
    
    if (currentPath) {
        const parts = currentPath.split('/').filter(Boolean);
        parts.forEach((part, index) => {
            const path = parts.slice(0, index + 1).join('/');
            html += ` / <span onclick="navigateDriveTo('${path}')">${part}</span>`;
        });
    }
    
    breadcrumb.innerHTML = html;
}

function updateSelection() {
    document.querySelectorAll('.file-item, tr').forEach(el => {
        const cid = el.dataset.cid;
        const path = el.dataset.path;
        
        if (cid) {
            el.classList.toggle('selected', selectedFiles.has(cid));
        } else if (path) {
            el.classList.toggle('selected', selectedFolders.has(path));
        }
    });
}

function updateDragState() {
    const filesArea = document.getElementById('drive-files');
    if (filesArea) {
        filesArea.classList.toggle('dragging', isDragging);
    }
}

function hideContextMenu() {
    document.getElementById('drive-context-menu').style.display = 'none';
    contextTarget = null;
}

function hideUploadProgress() {
    document.getElementById('upload-progress').style.display = 'none';
}

function showDriveError(message) {
    const filesArea = document.getElementById('drive-files');
    if (filesArea) {
        filesArea.innerHTML = `
            <div class="error-state">
                <i class="fas fa-exclamation-triangle fa-3x"></i>
                <p>Error loading drive</p>
                <p class="text-muted">${message}</p>
                <button onclick="refreshSPKDrive()" class="btn btn-primary">Retry</button>
            </div>
        `;
    }
}

function getFileIcon(file) {
    if (file.metadata?.thumb_data) {
        return `<div class="file-icon"><img src="${file.metadata.thumb_data}" alt="${file.metadata.name}"></div>`;
    }
    
    const ext = file.metadata?.type?.toLowerCase() || '';
    let iconClass = 'fa-file';
    
    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
        iconClass = 'fa-file-image';
    } else if (['mp4', 'webm', 'avi', 'mov'].includes(ext)) {
        iconClass = 'fa-file-video';
    } else if (['mp3', 'wav', 'ogg'].includes(ext)) {
        iconClass = 'fa-file-audio';
    } else if (['pdf', 'doc', 'docx', 'txt'].includes(ext)) {
        iconClass = 'fa-file-alt';
    } else if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
        iconClass = 'fa-file-archive';
    }
    
    return `<div class="file-icon"><i class="fas ${iconClass} fa-3x"></i></div>`;
}

function formatBytes(bytes) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    
    return `${size.toFixed(2)} ${units[unitIndex]}`;
}

// Event listeners
document.addEventListener('click', (e) => {
    if (!e.target.closest('.context-menu')) {
        hideContextMenu();
    }
});

// Export functions for integration
window.initializeSPKDrive = initializeSPKDrive;
window.refreshFiles = refreshSPKDrive;

// Override the existing refreshFiles to ensure SPK Drive is used
if (window.refreshFiles) {
    console.log('Overriding refreshFiles with SPK Drive');
    const originalRefreshFiles = window.refreshFiles;
    window.refreshFiles = async function() {
        // Check if we're on the drive tab
        const driveTab = document.getElementById('drive-tab');
        if (driveTab && driveTab.classList.contains('active')) {
            // Use SPK Drive
            await refreshSPKDrive();
        } else {
            // Call original for other tabs
            if (typeof originalRefreshFiles === 'function') {
                await originalRefreshFiles();
            }
        }
    };
}

// Listen for account changes
window.addEventListener('active-account-changed', (event) => {
    const username = event.detail.username;
    if (username !== currentDriveAccount) {
        initializeSPKDrive(username);
    }
});

// Initialize on load if account is already active
window.addEventListener('DOMContentLoaded', async () => {
    // Wait a bit for the main app to initialize
    setTimeout(async () => {
        if (window.api && window.api.account) {
            const activeAccount = await window.api.account.getActive();
            if (activeAccount && activeAccount.username) {
                console.log('Active account found on load:', activeAccount.username);
                currentDriveAccount = activeAccount.username;
                // Check if we're on the drive tab
                const driveTab = document.getElementById('drive-tab');
                if (driveTab && driveTab.classList.contains('active')) {
                    await initializeSPKDrive(activeAccount.username);
                }
            }
        }
    }, 1000);
});