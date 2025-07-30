/**
 * SPK Drive Patch
 * This script patches the existing refreshFiles function to load files from SPK Network
 */

console.log('[SPK Drive] Patching file system...');

// Wait for the original refreshFiles to be defined
const patchInterval = setInterval(() => {
    if (window.refreshFiles && !window.refreshFiles._patched) {
        console.log('[SPK Drive] Original refreshFiles found, applying patch...');
        
        // Store the original function
        const originalRefreshFiles = window.refreshFiles;
        
        // Create the new implementation
        window.refreshFiles = async function() {
            console.log('[SPK Drive] Patched refreshFiles called');
            
            // Check if we're on the drive tab
            const driveTab = document.getElementById('drive-tab');
            if (!driveTab || !driveTab.classList.contains('active')) {
                // Not on drive tab, call original
                return originalRefreshFiles.call(this);
            }
            
            // Just check if we have an account - no auth needed for public data
            if (!window.currentAccount) {
                console.log('[SPK Drive] No account selected');
                driveTab.innerHTML = `
                    <h2>SPK Drive</h2>
                    <div style="text-align: center; padding: 50px;">
                        <p>Please select an account to view files</p>
                    </div>
                `;
                return;
            }
            
            const accountName = window.currentAccount;
            console.log('[SPK Drive] Loading files for account:', accountName);
            
            // Show loading state
            driveTab.innerHTML = `
                <h2>SPK Drive</h2>
                <div style="text-align: center; padding: 50px;">
                    <div class="spinner-border" role="status">
                        <span class="sr-only">Loading files...</span>
                    </div>
                    <p style="margin-top: 20px;">Loading files from SPK Network...</p>
                </div>
            `;
            
            try {
                // Fetch data from SPK API
                console.log(`[SPK Drive] Fetching from: https://spktest.dlux.io/@${accountName}`);
                const response = await fetch(`https://spktest.dlux.io/@${accountName}`);
                const data = await response.json();
                
                console.log('[SPK Drive] API Response:', data);
                
                // Process files
                const files = [];
                let totalSize = 0;
                
                if (data.file_contracts) {
                    for (const contractId in data.file_contracts) {
                        const contract = data.file_contracts[contractId];
                        if (contract.df) {
                            // Parse metadata
                            const metadata = parseContractMetadata(contract);
                            
                            for (const cid in contract.df) {
                                const fileMeta = metadata[cid] || {
                                    name: cid.substring(0, 8) + '...',
                                    type: 'file'
                                };
                                
                                files.push({
                                    cid: cid,
                                    contractId: contractId,
                                    name: fileMeta.name,
                                    type: fileMeta.type,
                                    size: contract.df[cid],
                                    owner: contract.t,
                                    expiration: contract.e,
                                    thumbnail: fileMeta.thumb
                                });
                                
                                totalSize += contract.df[cid];
                            }
                        }
                    }
                }
                
                console.log(`[SPK Drive] Found ${files.length} files`);
                
                // Render the UI
                renderSPKDriveUI(driveTab, files, data, totalSize);
                
            } catch (error) {
                console.error('[SPK Drive] Error:', error);
                driveTab.innerHTML = `
                    <h2>SPK Drive</h2>
                    <div style="text-align: center; padding: 50px; color: #f87171;">
                        <h3>Error Loading Files</h3>
                        <p>${error.message}</p>
                        <button onclick="refreshFiles()" class="btn btn-primary">Retry</button>
                    </div>
                `;
            }
        };
        
        // Mark as patched
        window.refreshFiles._patched = true;
        
        // Clear the interval
        clearInterval(patchInterval);
        console.log('[SPK Drive] Patch applied successfully');
        
        // If we're already on the drive tab, refresh
        const driveTab = document.getElementById('drive-tab');
        if (driveTab && driveTab.classList.contains('active')) {
            // Check if we have an account displayed
            const accountElement = document.getElementById('account-name');
            if (accountElement && accountElement.textContent !== 'No account') {
                console.log('[SPK Drive] Auto-refreshing drive tab');
                window.refreshFiles();
            }
        }
    }
}, 100);

// Helper functions
function parseContractMetadata(contract) {
    const result = {};
    
    if (!contract.m) return result;
    
    const parts = contract.m.split(',');
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
                labels: flagParts[2] || ''
            };
        }
    });
    
    return result;
}

function renderSPKDriveUI(container, files, userData, totalSize) {
    // Calculate storage stats
    const availableSize = (userData.pow_broca || 0) * 1000 * 1024 * 6; // 6KB per BROCA
    const usedPercentage = availableSize > 0 ? (totalSize / availableSize * 100).toFixed(1) : 0;
    
    // Get current username
    const currentUser = userData.name || window.currentAccount || 'unknown';
    
    // Build HTML
    let html = `
        <h2>SPK Drive - @${currentUser}</h2>
        
        <!-- Storage Stats -->
        <div class="storage-stats">
            <div class="stats-row">
                <span>${files.length} files stored</span>
                <div class="storage-bar">
                    <div class="storage-fill" style="width: ${usedPercentage}%"></div>
                </div>
                <span>${formatBytes(totalSize)} / ${formatBytes(availableSize)}</span>
            </div>
        </div>
        
        <!-- Actions -->
        <div class="drive-actions">
            <button onclick="alert('Upload files using the Upload tab')" class="btn btn-primary">
                <span>📤 Upload Files</span>
            </button>
            <button onclick="refreshFiles()" class="btn btn-secondary">
                <span>🔄 Refresh</span>
            </button>
        </div>
        
        <!-- Files -->
        <div class="files-container">
    `;
    
    if (files.length === 0) {
        html += `
            <div class="empty-state">
                <p>📁</p>
                <h3>No files uploaded yet</h3>
                <p>Upload videos using the Upload tab to see them here</p>
            </div>
        `;
    } else {
        html += '<div class="files-grid">';
        
        files.forEach(file => {
            const fileIcon = getFileIcon(file.type);
            const thumbnailUrl = file.thumbnail ? `https://ipfs.dlux.io/ipfs/${file.thumbnail}` : null;
            
            html += `
                <div class="file-card" onclick="window.open('https://ipfs.dlux.io/ipfs/${file.cid}', '_blank')">
                    <div class="file-preview">
                        ${thumbnailUrl ? 
                            `<img src="${thumbnailUrl}" alt="${file.name}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                             <div class="file-icon-fallback" style="display:none;">${fileIcon}</div>` :
                            `<div class="file-icon-fallback">${fileIcon}</div>`
                        }
                    </div>
                    <div class="file-info">
                        <div class="file-name" title="${file.name}">${file.name}</div>
                        <div class="file-meta">
                            <span>${formatBytes(file.size)}</span>
                            <span>•</span>
                            <span>${file.type}</span>
                        </div>
                    </div>
                </div>
            `;
        });
        
        html += '</div>';
    }
    
    html += '</div>';
    
    // Add styles
    html += `
        <style>
            .storage-stats {
                background: #1e1e1e;
                padding: 20px;
                border-radius: 8px;
                margin: 20px 0;
            }
            
            .stats-row {
                display: flex;
                align-items: center;
                gap: 20px;
            }
            
            .storage-bar {
                flex: 1;
                height: 10px;
                background: #333;
                border-radius: 5px;
                overflow: hidden;
            }
            
            .storage-fill {
                height: 100%;
                background: linear-gradient(90deg, #3b82f6, #2563eb);
                transition: width 0.3s ease;
            }
            
            .drive-actions {
                display: flex;
                gap: 10px;
                margin-bottom: 30px;
            }
            
            .files-container {
                min-height: 400px;
            }
            
            .empty-state {
                text-align: center;
                padding: 100px 20px;
                color: #666;
            }
            
            .empty-state p:first-child {
                font-size: 72px;
                margin: 0;
                opacity: 0.5;
            }
            
            .empty-state h3 {
                margin: 20px 0 10px;
                font-weight: normal;
            }
            
            .files-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
                gap: 20px;
                padding: 20px 0;
            }
            
            .file-card {
                background: #2a2a2a;
                border-radius: 8px;
                overflow: hidden;
                cursor: pointer;
                transition: transform 0.2s, box-shadow 0.2s;
            }
            
            .file-card:hover {
                transform: translateY(-4px);
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
            }
            
            .file-preview {
                width: 100%;
                height: 150px;
                background: #1e1e1e;
                position: relative;
                overflow: hidden;
            }
            
            .file-preview img {
                width: 100%;
                height: 100%;
                object-fit: cover;
            }
            
            .file-icon-fallback {
                width: 100%;
                height: 100%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 48px;
                color: #666;
            }
            
            .file-info {
                padding: 15px;
            }
            
            .file-name {
                font-weight: 500;
                margin-bottom: 5px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            
            .file-meta {
                font-size: 12px;
                color: #999;
                display: flex;
                gap: 8px;
            }
        </style>
    `;
    
    container.innerHTML = html;
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

function getFileIcon(type) {
    const iconMap = {
        'mp4': '🎬',
        'webm': '🎬',
        'avi': '🎬',
        'mov': '🎬',
        'mkv': '🎬',
        'jpg': '🖼️',
        'jpeg': '🖼️',
        'png': '🖼️',
        'gif': '🖼️',
        'webp': '🖼️',
        'mp3': '🎵',
        'wav': '🎵',
        'ogg': '🎵',
        'pdf': '📄',
        'doc': '📝',
        'docx': '📝',
        'txt': '📝',
        'zip': '📦',
        'rar': '📦'
    };
    
    return iconMap[type?.toLowerCase()] || '📎';
}

console.log('[SPK Drive] Patch script loaded, waiting for refreshFiles...');