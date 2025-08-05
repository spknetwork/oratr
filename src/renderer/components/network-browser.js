/**
 * Network Browser Component
 * Browse and search for files on the SPK Network to store
 */
class NetworkBrowser {
    constructor(container) {
        this.container = container;
        this.storageManager = null;
        this.currentView = 'opportunities'; // opportunities, search, recent
        this.selectedContracts = new Set();
        this.currentFiles = [];
        this.username = '';
        
        this.init();
    }
    
    async init() {
        try {
            const poaConfig = await window.api.poa.getConfig();
            if (poaConfig && poaConfig.account) {
                this.username = poaConfig.account;
            }
        } catch (e) {
            console.error('Could not get poa config', e);
        }

        this.render();
        this.attachEventListeners();
        // Only load data if storageManager is available
        if (this.storageManager) {
            await this.loadOpportunities();
        } else {
            this.showMessage('Waiting for storage service to initialize...');
        }
    }
    
    render() {
        this.container.innerHTML = `
            <div class="network-browser">
                <div class="browser-header">
                    <h3>Network File Browser</h3>
                    <div class="view-tabs">
                        <button class="view-tab active" data-view="opportunities">
                            Storage Opportunities
                        </button>
                        <button class="view-tab" data-view="stored">
                            My Stored Files
                        </button>
                    </div>
                </div>

                <div class="browser-controls">
                    <div class="bulk-actions">
                        <button class="btn btn-sm" onclick="window.networkBrowser.selectAll()">
                            Select All
                        </button>
                        <button class="btn btn-sm" onclick="window.networkBrowser.clearSelection()">
                            Clear Selection
                        </button>
                        <button class="btn btn-primary" onclick="window.networkBrowser.storeSelected()" 
                                id="store-selected-btn" disabled>
                            Store Selected (<span id="selected-count">0</span>)
                        </button>
                        <button class="btn btn-danger" onclick="window.networkBrowser.removeSelected()"
                                id="remove-selected-btn" disabled style="display: none;">
                            Remove Selected (<span id="selected-count-remove">0</span>)
                        </button>
                    </div>
                </div>
                
                <div class="browser-stats">
                    <div class="stat-item">
                        <span class="stat-label">Selected Files:</span>
                        <span class="stat-value" id="selected-files">0</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Selected Size:</span>
                        <span class="stat-value" id="selected-size">0 Bytes</span>
                    </div>
                </div>
                
                <div class="browser-content">
                    <div class="contracts-header">
                        <div class="contract-col-checkbox"></div>
                        <div class="contract-col-utilized">Size</div>
                        <div class="contract-col-owner">Owner</div>
                        <div class="contract-col-nodes">Nodes</div>
                        <div class="contract-col-actions">Action</div>
                    </div>
                    <div id="file-list" class="contracts-list">
                        <div class="loading">Loading...</div>
                    </div>
                </div>
            </div>
        `;
        
        // Store reference globally for onclick handlers
        window.networkBrowser = this;
        
        // Add CSS styles for contract layout
        this.addContractStyles();
    }
    
    attachEventListeners() {
        this.container.querySelectorAll('.view-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                this.switchView(e.target.dataset.view);
            });
        });
    }

    async switchView(view) {
        this.currentView = view;
        this.selectedContracts.clear();
        this.updateSelectionUI();
        
        // Update tabs
        this.container.querySelectorAll('.view-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.view === view);
        });

        const storeBtn = document.getElementById('store-selected-btn');
        const removeBtn = document.getElementById('remove-selected-btn');

        if(view === 'stored') {
            const poaConfig = await window.api.poa.getConfig();
            if (poaConfig && poaConfig.account) {
                this.username = poaConfig.account;
            }
            storeBtn.style.display = 'none';
            removeBtn.style.display = 'inline-block';
        } else {
            storeBtn.style.display = 'inline-block';
            removeBtn.style.display = 'none';
        }

        this.refresh();
    }
    
    async setStorageManager(manager) {
        this.storageManager = manager;
        await this.refresh();
    }
    
    
    async refresh() {
        if (!this.storageManager) return;
        
        if (this.currentView === 'opportunities') {
            await this.loadOpportunities();
        } else {
            await this.loadStoredFiles();
        }
    }
    
    async loadOpportunities() {
        this.showLoading();
        
        try {
            // Fetch understored contracts directly from honeygraph API
            const response = await fetch('https://honeygraph.dlux.io/api/spk/contracts/understored');
            if (!response.ok) {
                throw new Error(`API returned ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            const opportunities = data.contracts || data || [];
            
            console.log('Loaded storage opportunities:', opportunities);
            
            this.renderFiles(opportunities);
        } catch (error) {
            console.error('Failed to load opportunities:', error);
            this.showError('Failed to load storage opportunities: ' + error.message);
        }
    }

    async loadStoredFiles() {
        this.showLoading();
        if (!this.username) {
            this.showError('PoA username not found. Please make sure your storage node is configured and running.');
            return;
        }

        try {
            const response = await fetch(`https://honeygraph.dlux.io/api/spk/contracts/stored-by/${this.username}`);
            if(!response.ok) {
                throw new Error(`API returned ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            const storedFiles = data.contracts || data || [];
            console.log('Loaded stored files:', storedFiles);

            this.renderFiles(storedFiles);
        } catch (error) {
            console.error('Failed to load stored files:', error);
            this.showError('Failed to load stored files: ' + error.message);
        }
    }
    
    
    renderFiles(files) {
        this.currentFiles = files;
        const fileList = document.getElementById('file-list');
        
        if (!files || files.length === 0) {
            fileList.innerHTML = '<div class="no-files">No files found</div>';
            this.updateSelectionUI();
            return;
        }
        
        fileList.innerHTML = files.map(file => {
            const isSelected = this.selectedContracts.has(file.id || file.cid);
            
            return `
                <div class="contract-row ${isSelected ? 'selected' : ''}" 
                     data-id="${file.id || file.cid}">
                    <div class="contract-checkbox">
                        <input type="checkbox" 
                               ${isSelected ? 'checked' : ''}
                               onchange="window.networkBrowser.toggleSelection('${file.id || file.cid}')">
                    </div>
                    
                    <div class="contract-utilized">
                        ${this.formatBytes(file.utilized || file.size || 0)}
                    </div>
                    
                    <div class="contract-owner">
                        ${file.owner?.username || file.owner || 'Unknown'}
                    </div>
                    
                    <div class="contract-nodes">
                        ${file.storageNodes?.length || 0}/${file.power || 3}
                    </div>
                    
                    <div class="contract-actions">
                        ${this.currentView === 'opportunities' ? 
                            `<button class="btn btn-sm btn-primary store-btn" 
                                onclick="window.networkBrowser.storeContract('${file.id || file.cid}')">
                                Store
                            </button>` : 
                            `<button class="btn btn-sm btn-danger remove-btn"
                                onclick="window.networkBrowser.removeContract('${file.id || file.cid}')">
                                Remove
                            </button>`
                        }
                    </div>
                </div>
            `;
        }).join('');
    }
    
    toggleSelection(id) {
        if (this.selectedContracts.has(id)) {
            this.selectedContracts.delete(id);
        } else {
            this.selectedContracts.add(id);
        }
        this.updateSelectionUI();
    }
    
    selectAll() {
        this.container.querySelectorAll('.contract-row').forEach(item => {
            const id = item.dataset.id;
            if (id) {
                this.selectedContracts.add(id);
            }
        });
        this.updateSelectionUI();
    }
    
    clearSelection() {
        this.selectedContracts.clear();
        this.updateSelectionUI();
    }
    
    updateSelectionUI() {
        // Update checkboxes
        this.container.querySelectorAll('.contract-row').forEach(item => {
            const id = item.dataset.id;
            const checkbox = item.querySelector('input[type="checkbox"]');
            const isSelected = this.selectedContracts.has(id);
            
            item.classList.toggle('selected', isSelected);
            if (checkbox) {
                checkbox.checked = isSelected;
            }
        });
        
        // Update selection count and button
        const count = this.selectedContracts.size;
        document.getElementById('selected-count').textContent = count;
        document.getElementById('store-selected-btn').disabled = count === 0;
        document.getElementById('selected-count-remove').textContent = count;
        document.getElementById('remove-selected-btn').disabled = count === 0;

        // Update stats
        let selectedSize = 0;
        const selectedIds = Array.from(this.selectedContracts);
        for(const id of selectedIds) {
            const file = this.currentFiles.find(f => (f.id || f.cid) === id);
            if (file) {
                selectedSize += file.utilized || file.size || 0;
            }
        }
        document.getElementById('selected-files').textContent = count;
        document.getElementById('selected-size').textContent = this.formatBytes(selectedSize);
    }
    
    async storeSelected() {
        if (this.selectedContracts.size === 0) return;
        
        const contractIds = Array.from(this.selectedContracts);
        
        try {
            // Check if window.api.spk is available
            if (!window.api?.spk) {
                alert('SPK API not available. Please ensure you are logged in.');
                return;
            }
            
            console.log('Batch storing contracts:', contractIds);
            
            let response;
            if (contractIds.length > 40) {
                // Use batch store for many contracts (process in chunks of ~40)
                response = await window.api.spk.batchStore(contractIds, 40); // Process 40 at a time to stay under 8KB limit
            } else {
                // Use regular storeFiles for batches up to 40 contracts
                response = await window.api.spk.storeFiles(contractIds);
            }
            
            if (response.success) {
                const result = response.result;
                const storedCount = result.stored?.length || contractIds.length;
                const failedCount = result.failed?.length || 0;
                
                let message = `Successfully stored ${storedCount} contracts!`;
                if (failedCount > 0) {
                    message += `\n${failedCount} contracts failed to store.`;
                }
                message += '\n\nYou are now a storage provider and will earn rewards.';
                
                alert(message);
                
                // Remove stored items from the list and refresh UI
                this.currentFiles = this.currentFiles.filter(file => !contractIds.includes(file.id || file.cid));
                this.selectedContracts.clear();
                this.renderFiles(this.currentFiles);
                this.updateSelectionUI();

            } else {
                throw new Error(response.error || 'Batch store operation failed');
            }
            
        } catch (error) {
            console.error('Failed to store contracts:', error);
            alert(`Failed to store contracts: ${error.message}`);
        }
    }

    async removeSelected() {
        if(this.selectedContracts.size === 0) return;
        if (!confirm(`Are you sure you want to remove ${this.selectedContracts.size} contracts?`)) return;

        const contractIds = Array.from(this.selectedContracts);
        try {
            if (!window.api?.spk) {
                alert('SPK API not available. Please ensure you are logged in.');
                return;
            }

            const response = await window.api.spk.removeFiles(contractIds);
            if (response.success) {
                alert('Successfully removed selected contracts');
                this.currentFiles = this.currentFiles.filter(file => !contractIds.includes(file.id || file.cid));
                this.selectedContracts.clear();
                this.renderFiles(this.currentFiles);
                this.updateSelectionUI();
            } else {
                throw new Error(response.error || 'Batch remove operation failed');
            }
        } catch (error) {
            console.error('Failed to remove contracts:', error);
            alert(`Failed to remove contracts: ${error.message}`);
        }
    }
    
    async storeContract(contractId) {
        if (!confirm('Store this contract?')) return;
        
        try {
            const result = await this.storageManager.storeFiles([contractId]);
            alert('Contract stored successfully!');
            await this.refresh();
        } catch (error) {
            console.error('Failed to store contract:', error);
            alert(`Failed to store contract: ${error.message}`);
        }
    }

    async removeContract(contractId) {
        if(!confirm('Are you sure you want to remove this contract?')) return;
        try {
            const response = await window.api.spk.removeFiles([contractId]);
            if(response.success) {
                alert('Contract removed successfully');
                await this.refresh();
            } else {
                throw new Error(response.error || 'Remove operation failed')
            }
        } catch (error) {
            console.error('Failed to remove contract:', error);
            alert(`Failed to remove contract: ${error.message}`);
        }
    }
    
    showLoading() {
        const fileList = document.getElementById('file-list');
        fileList.innerHTML = '<div class="loading">Loading...</div>';
    }
    
    showError(message) {
        const fileList = document.getElementById('file-list');
        fileList.innerHTML = `<div class="error">${message}</div>`;
    }
    
    showMessage(message) {
        const fileList = document.getElementById('file-list');
        fileList.innerHTML = `<div class="message">${message}</div>`;
    }
    
    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    addContractStyles() {
        if (document.getElementById('network-browser-contract-styles')) {
            return; // Styles already added
        }

        const styles = document.createElement('style');
        styles.id = 'network-browser-contract-styles';
        styles.textContent = `
            .contracts-header {
                display: grid;
                grid-template-columns: 40px 100px 1fr 80px 100px;
                gap: 15px;
                padding: 12px 15px;
                background: #f8f9fa;
                border-bottom: 2px solid #dee2e6;
                font-weight: 600;
                font-size: 14px;
                color: #495057;
            }
            
            .contracts-list {
                max-height: 400px;
                overflow-y: auto;
            }
            
            .contract-row {
                display: grid;
                grid-template-columns: 40px 100px 1fr 80px 100px;
                gap: 15px;
                padding: 12px 15px;
                border-bottom: 1px solid #e9ecef;
                align-items_g: center;
                transition: background-color 0.2s;
            }
            
            .contract-row:hover {
                background: #f8f9fa;
            }
            
            .contract-row.selected {
                background: #e3f2fd;
                border-left: 4px solid #2196f3;
            }
            
            .contract-checkbox input[type="checkbox"] {
                transform: scale(1.2);
            }
            
            .contract-utilized {
                font-weight: 600;
                color: #007bff;
            }
            
            .contract-owner {
                font-family: monospace;
                font-size: 13px;
                color: #6c757d;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            
            .contract-nodes {
                text-align: center;
                font-weight: 500;
            }
            
            .store-btn {
                background: #28a745;
                color: white;
                border: none;
                padding: 6px 12px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 12px;
                font-weight: 500;
            }
            
            .store-btn:hover {
                background: #218838;
            }
            
            .store-btn:disabled {
                background: #6c757d;
                cursor: not-allowed;
            }

            .remove-btn {
                background: #dc3545;
                color: white;
                border: none;
                padding: 6px 12px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 12px;
                font-weight: 500;
            }

            .remove-btn:hover {
                background: #c82333;
            }
            
            .no-files {
                text-align: center;
                padding: 40px;
                color: #6c757d;
                font-style: italic;
            }
            
            .loading {
                text-align: center;
                padding: 40px;
                color: #6c757d;
            }
        `;

        document.head.appendChild(styles);
    }
    
    async storeContract(contractId) {
        try {
            console.log('Storing contract:', contractId);
            
            // Check if window.api is available
            if (!window.api?.spk) {
                alert('SPK API not available. Please ensure you are logged in.');
                return;
            }
            
            // Store the file using the IPC API
            console.log('Calling window.api.spk.storeFiles for contract:', contractId);
            const response = await window.api.spk.storeFiles([contractId]);
            
            if (response.success) {
                console.log('Store result:', response.result);
                alert(`Successfully stored contract ${contractId}!\n\nYou are now a storage provider and will earn rewards.`);
                // Refresh the contract list to update status
                await this.refresh();
            } else {
                throw new Error(response.error || 'Store operation failed');
            }
            
        } catch (error) {
            console.error('Failed to store contract:', error);
            alert(`Failed to store contract: ${error.message}`);
        }
    }
}

// Export for use in other modules
window.NetworkBrowser = NetworkBrowser;
