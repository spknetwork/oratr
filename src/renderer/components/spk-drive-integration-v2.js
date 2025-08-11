/**
 * SPK Drive Integration v2 - With Enhanced Honeygraph Support
 * 
 * This module integrates the enhanced SPK Drive with spk-js filesystem wrapper
 */

import { EnhancedSPKDrive, createEnhancedSPKDrive } from './spk-drive-enhanced.js';
import './spk-drive-integration.css';

// Global variables
let spkInstance = null;
let driveInstance = null;
let currentDriveAccount = null;
let isInitialized = false;

// UI State
let currentPath = '';
let selectedFiles = new Set();
let selectedFolders = new Set();
let viewMode = 'grid';
let isDragging = false;
let contextTarget = null;
let searchMode = false;
let searchResults = [];

// Initialize SPK Drive when account changes
async function initializeSPKDrive(username) {
    try {
        console.log('Initializing Enhanced SPK Drive for:', username);
        
        // Get or create SPK instance
        if (!spkInstance || spkInstance.account.username !== username) {
            // Initialize SPK with Honeygraph support
            const SPK = window.SPK || (await import('@disregardfiat/spk-js')).default;
            spkInstance = new SPK(username, {
                node: window.spkNode || 'https://spkinstant.hivehoneycomb.com',
                honeygraphUrl: 'https://honeygraph.dlux.io',
                enableHoneygraphCache: true,
                honeygraphCacheTTL: 300000 // 5 minutes
            });
            
            await spkInstance.init();
        }
        
        // Create enhanced drive instance
        driveInstance = await createEnhancedSPKDrive(spkInstance);
        
        // Load the drive
        const stats = await driveInstance.loadDrive();
        
        // Render the drive UI
        renderDriveUI();
        
        // Handle the loaded event
        handleDriveLoaded(stats);
        
        currentDriveAccount = username;
        isInitialized = true;
        
        // Show notification about API source
        if (stats.source === 'honeygraph') {
            showNotification('Connected to Honeygraph for enhanced features', 'success');
        } else if (stats.source === 'spk-api') {
            showNotification('Using SPK API (Honeygraph unavailable)', 'info');
        }
    } catch (error) {
        console.error('Failed to initialize SPK Drive:', error);
        showDriveError(error.message);
    }
}

// Render the enhanced drive UI
function renderDriveUI() {
    const driveTab = document.getElementById('drive-tab');
    if (!driveTab) return;
    
    driveTab.innerHTML = `
        <div class="spk-drive-container enhanced">
            <!-- Header -->
            <div class="drive-header">
                <h2>SPK Drive</h2>
                <div class="drive-stats" id="drive-stats">
                    <span class="loading">Loading...</span>
                </div>
                <div class="api-status" id="api-status"></div>
            </div>
            
            <!-- Search and Actions -->
            <div class="drive-toolbar">
                <div class="search-container">
                    <i class="fas fa-search"></i>
                    <input type="search" id="drive-search" placeholder="Search files, tags, or folders..." 
                           onkeyup="searchDriveFiles(event)">
                    <div class="search-filters" id="search-filters" style="display: none;">
                        <label><input type="checkbox" id="search-name" checked> Name</label>
                        <label><input type="checkbox" id="search-tags"> Tags</label>
                        <label><input type="checkbox" id="search-type"> Type</label>
                    </div>
                </div>
                
                <div class="drive-actions">
                    <button onclick="createNewDriveFolder()" class="btn btn-secondary">
                        <i class="fas fa-folder-plus"></i> New Folder
                    </button>
                    <button onclick="uploadToSPKDrive()" class="btn btn-primary">
                        <i class="fas fa-upload"></i> Upload Files
                    </button>
                    <button onclick="showAdvancedSearch()" class="btn btn-secondary">
                        <i class="fas fa-filter"></i> Filter
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
            
            <!-- File Details Panel -->
            <div id="file-details-panel" class="file-details-panel" style="display: none;">
                <div class="panel-header">
                    <h3>File Details</h3>
                    <button onclick="hideFileDetails()">×</button>
                </div>
                <div id="file-details-content"></div>
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
                <button onclick="showFileDetails()"><i class="fas fa-info-circle"></i> Details</button>
                <button onclick="shareSelectedFile()"><i class="fas fa-share"></i> Share</button>
                <button onclick="renameSelectedFile()"><i class="fas fa-edit"></i> Rename</button>
                <button onclick="addTagsToFile()"><i class="fas fa-tags"></i> Add Tags</button>
                <div class="separator"></div>
                <button onclick="deleteSelectedFile()"><i class="fas fa-trash"></i> Delete</button>
            </div>
            
            <!-- Advanced Search Modal -->
            <div id="advanced-search-modal" class="modal" style="display: none;">
                <div class="modal-content">
                    <h3>Advanced Search & Filter</h3>
                    <div class="search-form">
                        <input type="text" id="adv-search-query" placeholder="Search query...">
                        <select id="adv-search-type">
                            <option value="">All Types</option>
                            <option value="image">Images</option>
                            <option value="video">Videos</option>
                            <option value="audio">Audio</option>
                            <option value="document">Documents</option>
                        </select>
                        <input type="text" id="adv-search-tags" placeholder="Tags (comma separated)">
                        <label>
                            Size: 
                            <input type="number" id="adv-search-min-size" placeholder="Min (MB)">
                            -
                            <input type="number" id="adv-search-max-size" placeholder="Max (MB)">
                        </label>
                        <label>
                            <input type="checkbox" id="adv-search-recent"> Recent uploads only
                        </label>
                    </div>
                    <div class="modal-actions">
                        <button onclick="executeAdvancedSearch()" class="btn btn-primary">Search</button>
                        <button onclick="hideAdvancedSearch()" class="btn btn-secondary">Cancel</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Add enhanced styles
    addEnhancedStyles();
}

// Add enhanced styles for new features
function addEnhancedStyles() {
    if (document.getElementById('enhanced-drive-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'enhanced-drive-styles';
    style.textContent = `
        .spk-drive-container.enhanced {
            position: relative;
        }
        
        .api-status {
            display: inline-flex;
            align-items: center;
            margin-left: 1rem;
            font-size: 0.85rem;
            color: #666;
        }
        
        .api-status.honeygraph::before {
            content: '●';
            color: #4CAF50;
            margin-right: 0.25rem;
        }
        
        .api-status.fallback::before {
            content: '●';
            color: #FF9800;
            margin-right: 0.25rem;
        }
        
        .search-filters {
            display: flex;
            gap: 1rem;
            padding: 0.5rem;
            background: #f5f5f5;
            border-radius: 4px;
            margin-top: 0.5rem;
        }
        
        .file-details-panel {
            position: absolute;
            right: 0;
            top: 0;
            bottom: 0;
            width: 300px;
            background: white;
            border-left: 1px solid #ddd;
            box-shadow: -2px 0 5px rgba(0,0,0,0.1);
            z-index: 10;
            overflow-y: auto;
        }
        
        .panel-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 1rem;
            border-bottom: 1px solid #ddd;
        }
        
        .file-details-content {
            padding: 1rem;
        }
        
        .file-details-content .detail-row {
            margin-bottom: 1rem;
        }
        
        .file-details-content .detail-label {
            font-weight: bold;
            color: #666;
            font-size: 0.85rem;
            margin-bottom: 0.25rem;
        }
        
        .file-item.has-providers::after {
            content: '✓';
            position: absolute;
            bottom: 5px;
            right: 5px;
            color: #4CAF50;
            font-weight: bold;
        }
        
        .provider-list {
            margin-top: 0.5rem;
            font-size: 0.85rem;
        }
        
        .provider-item {
            padding: 0.25rem 0;
            color: #666;
        }
        
        .provider-item.active {
            color: #4CAF50;
        }
        
        .tag-list {
            display: flex;
            flex-wrap: wrap;
            gap: 0.25rem;
            margin-top: 0.5rem;
        }
        
        .tag {
            background: #e0e0e0;
            padding: 0.125rem 0.5rem;
            border-radius: 12px;
            font-size: 0.75rem;
        }
        
        .modal {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
        }
        
        .modal-content {
            background: white;
            padding: 2rem;
            border-radius: 8px;
            max-width: 500px;
            width: 90%;
        }
        
        .search-form {
            display: flex;
            flex-direction: column;
            gap: 1rem;
            margin: 1rem 0;
        }
        
        .separator {
            height: 1px;
            background: #ddd;
            margin: 0.5rem 0;
        }
    `;
    document.head.appendChild(style);
}

// Drive event handlers
function handleDriveLoaded(stats) {
    console.log('Drive loaded:', stats);
    updateDriveStats();
    updateAPIStatus(stats.source);
    renderFileList();
}

function handleDriveError(error) {
    console.error('Drive error:', error);
    showDriveError(error.message || 'Unknown error occurred');
}

// Update API status indicator
function updateAPIStatus(source) {
    const statusEl = document.getElementById('api-status');
    if (statusEl) {
        if (source === 'honeygraph') {
            statusEl.className = 'api-status honeygraph';
            statusEl.textContent = 'Honeygraph Connected';
        } else if (source === 'spk-api') {
            statusEl.className = 'api-status fallback';
            statusEl.textContent = 'SPK API (Fallback)';
        } else {
            statusEl.className = 'api-status';
            statusEl.textContent = 'Cached Data';
        }
    }
}

// Update drive statistics
async function updateDriveStats() {
    if (!driveInstance) return;
    
    const stats = await driveInstance.getStorageStats();
    const statsElement = document.getElementById('drive-stats');
    
    if (statsElement) {
        const percentage = ((stats.usedSize / stats.totalSize) * 100).toFixed(1);
        statsElement.innerHTML = `
            <span>${stats.fileCount} files</span>
            <div class="storage-bar">
                <div class="storage-used" style="width: ${percentage}%"></div>
            </div>
            <span>${formatBytes(stats.usedSize)} / ${formatBytes(stats.totalSize)}</span>
            ${stats.brocaBalance ? `<span class="broca-balance">${stats.brocaBalance} BROCA</span>` : ''}
        `;
    }
}

// Enhanced search functionality
window.searchDriveFiles = async function(event) {
    const query = event.target.value;
    
    if (!query) {
        searchMode = false;
        renderFileList();
        return;
    }
    
    if (event.key === 'Enter' || query.length >= 3) {
        searchMode = true;
        
        try {
            // Use enhanced search
            const results = await driveInstance.searchFiles(query, {
                folder: currentPath || undefined
            });
            
            searchResults = results;
            renderSearchResults(results);
        } catch (error) {
            console.error('Search failed:', error);
            showNotification('Search failed: ' + error.message, 'error');
        }
    }
};

// Show advanced search modal
window.showAdvancedSearch = function() {
    document.getElementById('advanced-search-modal').style.display = 'flex';
};

window.hideAdvancedSearch = function() {
    document.getElementById('advanced-search-modal').style.display = 'none';
};

// Execute advanced search
window.executeAdvancedSearch = async function() {
    const query = document.getElementById('adv-search-query').value;
    const type = document.getElementById('adv-search-type').value;
    const tags = document.getElementById('adv-search-tags').value
        .split(',')
        .map(t => t.trim())
        .filter(Boolean);
    const minSize = parseFloat(document.getElementById('adv-search-min-size').value) * 1024 * 1024 || undefined;
    const maxSize = parseFloat(document.getElementById('adv-search-max-size').value) * 1024 * 1024 || undefined;
    const recentOnly = document.getElementById('adv-search-recent').checked;
    
    hideAdvancedSearch();
    
    try {
        let results = await driveInstance.searchFiles(query, {
            type,
            tags,
            filters: {
                minSize,
                maxSize
            }
        });
        
        // Filter by recent if needed
        if (recentOnly) {
            const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
            results = results.filter(file => file.t > weekAgo);
        }
        
        searchMode = true;
        searchResults = results;
        renderSearchResults(results);
    } catch (error) {
        console.error('Advanced search failed:', error);
        showNotification('Search failed: ' + error.message, 'error');
    }
};

// Show file details panel
window.showFileDetails = async function() {
    if (!contextTarget || contextTarget.type !== 'file') return;
    
    const cid = contextTarget.id;
    const metadata = await driveInstance.getFileMetadata(cid);
    
    if (!metadata) return;
    
    const panel = document.getElementById('file-details-panel');
    const content = document.getElementById('file-details-content');
    
    // Get providers info
    let providersHtml = '';
    try {
        const providers = await driveInstance.getFileProviders(cid);
        if (providers.providers && providers.providers.length > 0) {
            providersHtml = `
                <div class="detail-row">
                    <div class="detail-label">Storage Providers (${providers.totalProviders})</div>
                    <div class="provider-list">
                        ${providers.providers.map(p => `
                            <div class="provider-item ${p.status === 'active' ? 'active' : ''}">
                                ${p.username} ${p.status ? `(${p.status})` : ''}
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }
    } catch (error) {
        console.warn('Failed to get providers:', error);
    }
    
    content.innerHTML = `
        <div class="detail-row">
            <div class="detail-label">Name</div>
            <div>${metadata.name}</div>
        </div>
        <div class="detail-row">
            <div class="detail-label">Type</div>
            <div>${metadata.type}</div>
        </div>
        <div class="detail-row">
            <div class="detail-label">Size</div>
            <div>${formatBytes(metadata.size)}</div>
        </div>
        <div class="detail-row">
            <div class="detail-label">CID</div>
            <div style="word-break: break-all; font-family: monospace; font-size: 0.85em;">
                ${metadata.cid}
            </div>
        </div>
        <div class="detail-row">
            <div class="detail-label">Uploaded</div>
            <div>${new Date(metadata.uploadedAt).toLocaleString()}</div>
        </div>
        <div class="detail-row">
            <div class="detail-label">Expires</div>
            <div>${metadata.expires ? new Date(metadata.expires * 1000).toLocaleDateString() : 'Never'}</div>
        </div>
        ${metadata.tags && metadata.tags.length > 0 ? `
            <div class="detail-row">
                <div class="detail-label">Tags</div>
                <div class="tag-list">
                    ${metadata.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}
                </div>
            </div>
        ` : ''}
        ${providersHtml}
        <div class="detail-row">
            <div class="detail-label">Contract ID</div>
            <div style="word-break: break-all; font-family: monospace; font-size: 0.85em;">
                ${metadata.contractId}
            </div>
        </div>
    `;
    
    panel.style.display = 'block';
    hideContextMenu();
};

window.hideFileDetails = function() {
    document.getElementById('file-details-panel').style.display = 'none';
};

// Share file functionality
window.shareSelectedFile = async function() {
    if (!contextTarget || contextTarget.type !== 'file') return;
    
    const file = driveInstance.files.get(contextTarget.id);
    if (!file) return;
    
    const shareUrl = `https://ipfs.dlux.io/ipfs/${file.f}`;
    
    // Copy to clipboard
    try {
        await navigator.clipboard.writeText(shareUrl);
        showNotification('Share link copied to clipboard!', 'success');
    } catch (error) {
        // Fallback
        prompt('Share this link:', shareUrl);
    }
    
    hideContextMenu();
};

// Add tags to file
window.addTagsToFile = async function() {
    if (!contextTarget || contextTarget.type !== 'file') return;
    
    const file = driveInstance.files.get(contextTarget.id);
    if (!file) return;
    
    const currentTags = file.metadata?.tags || [];
    const newTags = prompt('Add tags (comma separated):', currentTags.join(', '));
    
    if (newTags !== null) {
        const tags = newTags.split(',').map(t => t.trim()).filter(Boolean);
        
        // Update local metadata
        if (!file.metadata) file.metadata = {};
        file.metadata.tags = tags;
        
        // TODO: Update on chain
        showNotification('Tags updated locally. Chain update coming soon.', 'info');
        
        // Refresh view if in search mode
        if (searchMode) {
            renderSearchResults(searchResults);
        } else {
            renderFileList();
        }
    }
    
    hideContextMenu();
};

// Render file list with enhanced features
function renderFileList() {
    if (!driveInstance) return;
    
    const filesArea = document.getElementById('drive-files');
    if (!filesArea) return;
    
    if (searchMode) {
        renderSearchResults(searchResults);
        return;
    }
    
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

// Render search results
function renderSearchResults(results) {
    const filesArea = document.getElementById('drive-files');
    if (!filesArea) return;
    
    if (results.length === 0) {
        filesArea.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-search fa-4x"></i>
                <p>No files found</p>
                <p class="text-muted">Try different search terms or filters</p>
                <button onclick="clearSearch()" class="btn btn-secondary">Clear Search</button>
            </div>
        `;
        return;
    }
    
    // Group results by folder for better organization
    const grouped = {};
    results.forEach(file => {
        const folder = file.folder || 'Root';
        if (!grouped[folder]) grouped[folder] = [];
        grouped[folder].push(file);
    });
    
    let html = '<div class="search-results">';
    
    Object.entries(grouped).forEach(([folder, files]) => {
        html += `
            <div class="result-group">
                <h4>${folder}</h4>
                <div class="file-grid">
        `;
        
        files.forEach(file => {
            const isSelected = selectedFiles.has(file.f);
            const icon = getFileIcon(file);
            const tags = file.metadata?.tags || [];
            
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
                    ${tags.length > 0 ? `
                        <div class="file-tags">
                            ${tags.slice(0, 3).map(tag => `<span class="tag">${tag}</span>`).join('')}
                            ${tags.length > 3 ? `<span class="tag">+${tags.length - 3}</span>` : ''}
                        </div>
                    ` : ''}
                </div>
            `;
        });
        
        html += '</div></div>';
    });
    
    html += '</div>';
    filesArea.innerHTML = html;
}

// Clear search
window.clearSearch = function() {
    document.getElementById('drive-search').value = '';
    searchMode = false;
    searchResults = [];
    renderFileList();
};

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
        const tags = file.metadata?.tags || [];
        
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
                ${tags.length > 0 ? `
                    <div class="file-tags">
                        ${tags.slice(0, 2).map(tag => `<span class="tag">${tag}</span>`).join('')}
                    </div>
                ` : ''}
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
                    <th>Tags</th>
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
                <td>-</td>
            </tr>
        `;
    });
    
    // Render files
    files.forEach(file => {
        const isSelected = selectedFiles.has(file.f);
        const tags = file.metadata?.tags || [];
        html += `
            <tr class="${isSelected ? 'selected' : ''}"
                onclick="handleFileClick(event, '${file.f}')"
                oncontextmenu="showDriveContextMenu(event, 'file', '${file.f}')">
                <td><i class="fas fa-file"></i> ${file.metadata?.name || file.f}</td>
                <td>${formatBytes(file.s)}</td>
                <td>${file.metadata?.type || 'Unknown'}</td>
                <td>${file.t ? new Date(file.t).toLocaleDateString() : '-'}</td>
                <td>${tags.length > 0 ? tags.join(', ') : '-'}</td>
            </tr>
        `;
    });
    
    html += '</tbody></table>';
    container.innerHTML = html;
}

// UI Event Handlers (keeping most from original)
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
            // Clear cache first
            driveInstance.cacheEnabled = false;
            const stats = await driveInstance.loadDrive();
            driveInstance.cacheEnabled = true;
            
            handleDriveLoaded(stats);
            showNotification('Drive refreshed successfully', 'success');
        } catch (error) {
            console.error('Failed to refresh drive:', error);
            showNotification('Failed to refresh: ' + error.message, 'error');
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
    searchMode = false;
    document.getElementById('drive-search').value = '';
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
    } else if (event.detail === 2) {
        // Double click - open file
        openFile(cid);
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
            showNotification('File moved successfully', 'success');
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
        openFile(contextTarget.id);
    }
    hideContextMenu();
};

function openFile(cid) {
    const file = driveInstance.files.get(cid);
    if (file) {
        window.open(`https://ipfs.dlux.io/ipfs/${file.f}`, '_blank');
    }
}

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

window.renameSelectedFile = async function() {
    if (contextTarget && contextTarget.type === 'file') {
        const file = driveInstance.files.get(contextTarget.id);
        if (file) {
            const newName = prompt('Enter new name:', file.metadata?.name);
            if (newName && newName !== file.metadata?.name) {
                // Update local metadata
                if (!file.metadata) file.metadata = {};
                file.metadata.name = newName;
                
                // TODO: Update on chain
                showNotification('File renamed locally. Chain update coming soon.', 'info');
                renderFileList();
            }
        }
    }
    hideContextMenu();
};

window.deleteSelectedFile = async function() {
    if (contextTarget && confirm('Move this file to trash?')) {
        try {
            if (contextTarget.type === 'file') {
                await driveInstance.deleteFile(contextTarget.id);
                showNotification('File moved to trash', 'success');
            }
            renderFileList();
        } catch (error) {
            alert('Failed to delete: ' + error.message);
        }
    }
    hideContextMenu();
};

// Upload files using spk-js
async function uploadFiles(files, folder) {
    const uploadProgress = document.getElementById('upload-progress');
    const uploadItems = document.getElementById('upload-items');
    
    uploadProgress.style.display = 'block';
    uploadItems.innerHTML = '';
    
    // Convert FileList to Array
    const fileArray = Array.from(files);
    
    try {
        // Check if we have enough BROCA
        let totalSize = 0;
        fileArray.forEach(file => totalSize += file.size);
        
        // Calculate BROCA cost via main process for accurate current rules
        const brocaCalc = await window.api.invoke('spk:calculateBrocaCost', totalSize, { duration: 30 });
        if (!brocaCalc?.success) {
            showNotification('Failed to calculate BROCA cost: ' + (brocaCalc?.error || 'Unknown error'), 'error');
            hideUploadProgress();
            return;
        }
        const requiredBroca = brocaCalc.data?.broca ?? brocaCalc.data?.cost ?? 0;
        // Fetch current BROCA balance
        let availableBroca = 0;
        try {
            const bal = await window.api.balance.get(false);
            availableBroca = parseFloat(bal?.broca || 0);
        } catch (_) {}
        if (availableBroca < requiredBroca) {
            showNotification(`Insufficient BROCA. Need ${Math.ceil(requiredBroca)}, have ${Math.floor(availableBroca)}`, 'error');
            hideUploadProgress();
            return;
        }
        
        // Create upload items UI
        const uploadTrackers = fileArray.map(file => {
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
            
            return { file, itemId };
        });
        
        // Upload files using spk-js
        for (const tracker of uploadTrackers) {
            try {
                updateUploadProgress(tracker.itemId, 10, 'Calculating cost...');
                
                // Set metadata including folder
                const metadata = {
                    folder: folder || '',
                    tags: []
                };
                
                updateUploadProgress(tracker.itemId, 30, 'Uploading...');
                
                // Upload using spk-js
                // Prefer streamlined direct upload through main process for consistency
                const arrayBuffer = await tracker.file.arrayBuffer();
                const resp = await window.api.invoke('upload:direct-simple', {
                    files: [{ name: tracker.file.name, size: tracker.file.size, buffer: Array.from(new Uint8Array(arrayBuffer)) }],
                    options: { metadata }
                });
                if (!resp?.success) throw new Error(resp?.error || 'Upload failed');
                const result = Array.isArray(resp.data?.files) ? resp.data.files[0] : resp.data?.files || resp.data;
                
                updateUploadProgress(tracker.itemId, 90, 'Creating contract...');
                
                // Add to drive instance
                const fileData = {
                    f: result.cid,
                    i: result.contractId || 'pending',
                    o: spkInstance.account.username,
                    s: tracker.file.size,
                    metadata: {
                        name: tracker.file.name,
                        type: tracker.file.type || tracker.file.name.split('.').pop(),
                        folder: folder,
                        ...metadata
                    },
                    folder: folder,
                    t: Date.now()
                };
                
                driveInstance.files.set(result.cid, fileData);
                const folderSet = driveInstance.virtualFS.get(folder) || new Set();
                folderSet.add(result.cid);
                driveInstance.virtualFS.set(folder, folderSet);
                
                updateUploadProgress(tracker.itemId, 100, 'Complete');
                
            } catch (error) {
                updateUploadProgress(tracker.itemId, 0, 'Failed: ' + error.message);
                console.error('Upload failed:', error);
            }
        }
        
        // Refresh file list
        setTimeout(() => {
            renderFileList();
            hideUploadProgress();
        }, 2000);
        
    } catch (error) {
        console.error('Upload error:', error);
        showNotification('Upload failed: ' + error.message, 'error');
        hideUploadProgress();
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

function showNotification(message, type = 'info') {
    // You can implement a proper notification UI here
    console.log(`[${type.toUpperCase()}] ${message}`);
    
    // Simple notification implementation
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 1rem 1.5rem;
        background: ${type === 'error' ? '#f44336' : type === 'success' ? '#4CAF50' : '#2196F3'};
        color: white;
        border-radius: 4px;
        z-index: 1000;
        animation: slideIn 0.3s ease-out;
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

function getFileIcon(file) {
    if (file.metadata?.thumb) {
        return `<div class="file-icon"><img src="https://ipfs.dlux.io/ipfs/${file.metadata.thumb}" alt="${file.metadata.name}"></div>`;
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

// Listen for account changes
window.addEventListener('active-account-changed', (event) => {
    const username = event.detail.username;
    if (username !== currentDriveAccount) {
        initializeSPKDrive(username);
    }
});

// Initialize on load if account is already active
window.addEventListener('DOMContentLoaded', async () => {
    // Add keyframes for notifications
    if (!document.getElementById('notification-styles')) {
        const style = document.createElement('style');
        style.id = 'notification-styles';
        style.textContent = `
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
            @keyframes slideOut {
                from { transform: translateX(0); opacity: 1; }
                to { transform: translateX(100%); opacity: 0; }
            }
        `;
        document.head.appendChild(style);
    }
    
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