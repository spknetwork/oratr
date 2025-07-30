/**
 * Simple SPK Drive Integration
 * 
 * This provides a cleaner integration with the existing spk-desktop file system
 */

console.log('SPK Drive Simple Integration loading...');

// Store the original refreshFiles function
const originalRefreshFiles = window.refreshFiles;

// Override refreshFiles to use SPK Drive
window.refreshFiles = async function() {
    console.log('SPK Drive refreshFiles called');
    
    if (!window.currentAccount || !window.isAuthenticated) {
        if (window.showNotification) {
            window.showNotification('Please unlock your account first', 'error');
        }
        return;
    }
    
    const driveTab = document.getElementById('drive-tab');
    if (!driveTab) {
        console.error('Drive tab not found');
        return;
    }
    
    // Show loading state
    driveTab.innerHTML = `
        <div style="text-align: center; padding: 50px;">
            <div class="spinner-border" role="status">
                <span class="sr-only">Loading SPK Drive...</span>
            </div>
            <p style="margin-top: 20px;">Loading files from SPK Network...</p>
        </div>
    `;
    
    try {
        // Fetch data from SPK API
        const response = await fetch(`https://spktest.dlux.io/@${window.currentAccount}`);
        const data = await response.json();
        
        console.log('SPK API Response:', data);
        
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
                            name: cid,
                            type: 'unknown'
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
        
        console.log('Processed files:', files);
        
        // Render the drive UI
        renderDriveUI(driveTab, files, data);
        
    } catch (error) {
        console.error('Failed to load SPK Drive:', error);
        driveTab.innerHTML = `
            <div style="text-align: center; padding: 50px; color: #f87171;">
                <h3>Error Loading Files</h3>
                <p>${error.message}</p>
                <button onclick="refreshFiles()" class="btn btn-primary">Retry</button>
            </div>
        `;
    }
};

// Parse contract metadata
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

// Render the drive UI
function renderDriveUI(container, files, userData) {
    // Calculate storage stats
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    const availableSize = (userData.pow_broca || 0) * 1000 * 1024 * 6; // 6KB per BROCA
    const usedPercentage = availableSize > 0 ? (totalSize / availableSize * 100).toFixed(1) : 0;
    
    container.innerHTML = `
        <h2>SPK Drive</h2>
        
        <!-- Storage Stats -->
        <div class="drive-stats mb-4">
            <div class="d-flex justify-content-between align-items-center">
                <span>${files.length} files</span>
                <div class="storage-bar" style="width: 200px; height: 20px; background: #333; border-radius: 10px; overflow: hidden;">
                    <div style="width: ${usedPercentage}%; height: 100%; background: linear-gradient(90deg, #3b82f6, #2563eb);"></div>
                </div>
                <span>${formatBytes(totalSize)} / ${formatBytes(availableSize)}</span>
            </div>
        </div>
        
        <!-- Actions -->
        <div class="drive-actions mb-3">
            <button onclick="showUploadDialog()" class="btn btn-primary">
                <i class="fas fa-upload"></i> Upload Files
            </button>
            <button onclick="refreshFiles()" class="btn btn-secondary">
                <i class="fas fa-sync"></i> Refresh
            </button>
        </div>
        
        <!-- Files Grid -->
        <div class="files-grid">
            ${files.length === 0 ? `
                <div class="empty-state text-center p-5">
                    <i class="fas fa-folder-open fa-4x mb-3" style="opacity: 0.5;"></i>
                    <p>No files uploaded yet</p>
                    <p class="text-muted">Upload files to start using SPK Drive</p>
                </div>
            ` : files.map(file => `
                <div class="file-item" onclick="openFile('${file.cid}')">
                    ${file.thumbnail ? 
                        `<img src="https://ipfs.dlux.io/ipfs/${file.thumbnail}" alt="${file.name}" style="width: 100%; height: 120px; object-fit: cover;">` :
                        `<div class="file-icon" style="height: 120px; display: flex; align-items: center; justify-content: center; background: #2a2a2a;">
                            <i class="fas fa-file fa-3x" style="color: #6b7280;"></i>
                        </div>`
                    }
                    <div class="file-info p-2">
                        <div class="file-name" style="font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            ${file.name}
                        </div>
                        <div class="file-size" style="font-size: 12px; color: #999;">
                            ${formatBytes(file.size)}
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>
        
        <style>
            .drive-stats {
                padding: 20px;
                background: #1a1a1a;
                border-radius: 8px;
            }
            
            .files-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
                gap: 15px;
                padding: 20px;
            }
            
            .file-item {
                background: #2a2a2a;
                border-radius: 8px;
                overflow: hidden;
                cursor: pointer;
                transition: transform 0.2s, box-shadow 0.2s;
            }
            
            .file-item:hover {
                transform: translateY(-2px);
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
            }
            
            .empty-state {
                grid-column: 1 / -1;
            }
        </style>
    `;
}

// Helper functions
window.formatBytes = function(bytes) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    
    return `${size.toFixed(2)} ${units[unitIndex]}`;
};

window.openFile = function(cid) {
    window.open(`https://ipfs.dlux.io/ipfs/${cid}`, '_blank');
};

window.showUploadDialog = function() {
    alert('File upload functionality coming soon!\n\nFor now, use the Upload tab for video files.');
};

console.log('SPK Drive Simple Integration loaded successfully');

// Auto-refresh if we're on the drive tab and authenticated
setTimeout(() => {
    const driveTab = document.getElementById('drive-tab');
    if (driveTab && driveTab.classList.contains('active') && window.currentAccount && window.isAuthenticated) {
        console.log('Auto-refreshing drive tab');
        window.refreshFiles();
    }
}, 1000);