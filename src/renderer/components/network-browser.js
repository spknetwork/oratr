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
        this.filters = {
            minSize: 0,
            maxSize: Infinity,
            minEarnings: 0,
            sortBy: 'earnings' // earnings, size, needed
        };
        
        this.init();
    }
    
    async init() {
        this.render();
        this.attachEventListeners();
        await this.loadOpportunities();
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
                        <button class="view-tab" data-view="search">
                            Search Files
                        </button>
                        <button class="view-tab" data-view="recent">
                            Recent Uploads
                        </button>
                    </div>
                </div>
                
                <div class="browser-controls">
                    <div class="filter-controls">
                        <div class="filter-group">
                            <label>Min Size:</label>
                            <select id="min-size-filter">
                                <option value="0">Any</option>
                                <option value="1048576">1 MB</option>
                                <option value="10485760">10 MB</option>
                                <option value="104857600">100 MB</option>
                                <option value="1073741824">1 GB</option>
                            </select>
                        </div>
                        
                        <div class="filter-group">
                            <label>Max Size:</label>
                            <select id="max-size-filter">
                                <option value="Infinity">Any</option>
                                <option value="10485760">10 MB</option>
                                <option value="104857600">100 MB</option>
                                <option value="1073741824">1 GB</option>
                                <option value="10737418240">10 GB</option>
                            </select>
                        </div>
                        
                        <div class="filter-group">
                            <label>Sort By:</label>
                            <select id="sort-filter">
                                <option value="earnings">Earnings</option>
                                <option value="size">Size</option>
                                <option value="needed">Providers Needed</option>
                                <option value="expiry">Time to Expiry</option>
                            </select>
                        </div>
                        
                        <button class="btn btn-sm" onclick="window.networkBrowser.applyFilters()">
                            Apply Filters
                        </button>
                    </div>
                    
                    <div class="search-controls" style="display: none;">
                        <input type="text" id="search-query" placeholder="Search files by name, tag, or owner...">
                        <select id="search-type">
                            <option value="all">All</option>
                            <option value="name">By Name</option>
                            <option value="tag">By Tag</option>
                            <option value="owner">By Owner</option>
                        </select>
                        <button class="btn btn-sm" onclick="window.networkBrowser.searchFiles()">
                            Search
                        </button>
                    </div>
                    
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
                    </div>
                </div>
                
                <div class="browser-stats">
                    <div class="stat-item">
                        <span class="stat-label">Total Files:</span>
                        <span class="stat-value" id="total-files">0</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Total Size:</span>
                        <span class="stat-value" id="total-size">0 MB</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Potential Earnings:</span>
                        <span class="stat-value" id="total-earnings">0 BROCA/month</span>
                    </div>
                </div>
                
                <div class="browser-content">
                    <div id="file-list" class="file-list">
                        <div class="loading">Loading...</div>
                    </div>
                </div>
                
                <div class="browser-pagination">
                    <button class="btn btn-sm" onclick="window.networkBrowser.loadMore()">
                        Load More
                    </button>
                </div>
            </div>
        `;
        
        // Store reference globally for onclick handlers
        window.networkBrowser = this;
    }
    
    attachEventListeners() {
        // View tabs
        this.container.querySelectorAll('.view-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                this.switchView(e.target.dataset.view);
            });
        });
        
        // Filter changes
        ['min-size-filter', 'max-size-filter', 'sort-filter'].forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener('change', () => this.applyFilters());
            }
        });
        
        // Search on enter
        const searchInput = document.getElementById('search-query');
        if (searchInput) {
            searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.searchFiles();
                }
            });
        }
    }
    
    async setStorageManager(manager) {
        this.storageManager = manager;
        await this.refresh();
    }
    
    switchView(view) {
        this.currentView = view;
        this.selectedContracts.clear();
        this.updateSelectionUI();
        
        // Update tabs
        this.container.querySelectorAll('.view-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.view === view);
        });
        
        // Show/hide controls
        const filterControls = this.container.querySelector('.filter-controls');
        const searchControls = this.container.querySelector('.search-controls');
        
        if (view === 'search') {
            filterControls.style.display = 'none';
            searchControls.style.display = 'flex';
        } else {
            filterControls.style.display = 'flex';
            searchControls.style.display = 'none';
        }
        
        // Load data
        this.refresh();
    }
    
    async refresh() {
        if (!this.storageManager) return;
        
        switch (this.currentView) {
            case 'opportunities':
                await this.loadOpportunities();
                break;
            case 'search':
                // Don't auto-search, wait for user input
                this.renderFiles([]);
                break;
            case 'recent':
                await this.loadRecentFiles();
                break;
        }
    }
    
    async loadOpportunities() {
        this.showLoading();
        
        try {
            const opportunities = await this.storageManager.getAvailableContracts(100);
            const filtered = this.filterContracts(opportunities);
            this.renderFiles(filtered);
        } catch (error) {
            console.error('Failed to load opportunities:', error);
            this.showError('Failed to load storage opportunities');
        }
    }
    
    async loadRecentFiles() {
        this.showLoading();
        
        try {
            const recent = await this.storageManager.getRecentFiles(50);
            this.renderFiles(recent);
        } catch (error) {
            console.error('Failed to load recent files:', error);
            this.showError('Failed to load recent files');
        }
    }
    
    async searchFiles() {
        const query = document.getElementById('search-query').value.trim();
        const type = document.getElementById('search-type').value;
        
        if (!query) return;
        
        this.showLoading();
        
        try {
            let results = [];
            
            switch (type) {
                case 'tag':
                    results = await this.storageManager.getFilesByTags([query]);
                    break;
                case 'owner':
                    results = await this.storageManager.searchFiles({ owner: query });
                    break;
                case 'name':
                case 'all':
                default:
                    results = await this.storageManager.searchFiles({ query });
                    break;
            }
            
            this.renderFiles(results);
        } catch (error) {
            console.error('Failed to search files:', error);
            this.showError('Failed to search files');
        }
    }
    
    filterContracts(contracts) {
        return contracts.filter(contract => {
            if (contract.size < this.filters.minSize) return false;
            if (contract.size > this.filters.maxSize) return false;
            if (contract.earnings && contract.earnings.monthlyBroca < this.filters.minEarnings) return false;
            return true;
        }).sort((a, b) => {
            switch (this.filters.sortBy) {
                case 'earnings':
                    return (b.earnings?.monthlyBroca || 0) - (a.earnings?.monthlyBroca || 0);
                case 'size':
                    return b.size - a.size;
                case 'needed':
                    return (b.needed || 0) - (a.needed || 0);
                case 'expiry':
                    return (a.expiryBlock || 0) - (b.expiryBlock || 0);
                default:
                    return 0;
            }
        });
    }
    
    renderFiles(files) {
        const fileList = document.getElementById('file-list');
        
        if (!files || files.length === 0) {
            fileList.innerHTML = '<div class="no-files">No files found</div>';
            this.updateStats(files);
            return;
        }
        
        const isOpportunityView = this.currentView === 'opportunities';
        
        fileList.innerHTML = files.map(file => {
            const isSelected = this.selectedContracts.has(file.id || file.cid);
            const earnings = file.earnings || {};
            
            return `
                <div class="file-item ${isSelected ? 'selected' : ''}" 
                     data-id="${file.id || file.cid}">
                    <div class="file-checkbox">
                        <input type="checkbox" 
                               ${isSelected ? 'checked' : ''}
                               onchange="window.networkBrowser.toggleSelection('${file.id || file.cid}')">
                    </div>
                    
                    <div class="file-info">
                        <div class="file-name">${file.name || file.id || file.cid}</div>
                        <div class="file-meta">
                            <span class="file-size">${file.sizeFormatted || this.formatBytes(file.size)}</span>
                            ${file.owner ? `<span class="file-owner">by ${file.owner}</span>` : ''}
                            ${file.uploadedFormatted ? `<span class="file-date">${file.uploadedFormatted}</span>` : ''}
                        </div>
                    </div>
                    
                    <div class="file-stats">
                        ${isOpportunityView ? `
                            <div class="stat-group">
                                <span class="stat-label">Providers:</span>
                                <span class="stat-value">${file.providers || 0}/${file.targetProviders || 3}</span>
                            </div>
                            <div class="stat-group">
                                <span class="stat-label">Needed:</span>
                                <span class="stat-value">${file.needed || 0}</span>
                            </div>
                        ` : ''}
                        
                        ${earnings.monthlyBroca ? `
                            <div class="stat-group">
                                <span class="stat-label">Monthly:</span>
                                <span class="stat-value">${earnings.monthlyBroca} BROCA</span>
                            </div>
                        ` : ''}
                        
                        ${file.expiresIn ? `
                            <div class="stat-group">
                                <span class="stat-label">Expires:</span>
                                <span class="stat-value">${file.expiresIn}</span>
                            </div>
                        ` : ''}
                    </div>
                    
                    <div class="file-actions">
                        <button class="btn btn-sm" onclick="window.networkBrowser.viewDetails('${file.id || file.cid}')">
                            Details
                        </button>
                        ${isOpportunityView ? `
                            <button class="btn btn-sm btn-primary" 
                                    onclick="window.networkBrowser.storeFile('${file.id}')">
                                Store
                            </button>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');
        
        this.updateStats(files);
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
        const fileItems = this.container.querySelectorAll('.file-item');
        fileItems.forEach(item => {
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
        const fileItems = this.container.querySelectorAll('.file-item');
        fileItems.forEach(item => {
            const id = item.dataset.id;
            const checkbox = item.querySelector('input[type="checkbox"]');
            const isSelected = this.selectedContracts.has(id);
            
            item.classList.toggle('selected', isSelected);
            if (checkbox) {
                checkbox.checked = isSelected;
            }
        });
        
        // Update selection count
        const count = this.selectedContracts.size;
        document.getElementById('selected-count').textContent = count;
        document.getElementById('store-selected-btn').disabled = count === 0;
    }
    
    async storeSelected() {
        if (this.selectedContracts.size === 0) return;
        
        const contractIds = Array.from(this.selectedContracts);
        
        if (!confirm(`Store ${contractIds.length} selected contracts?`)) {
            return;
        }
        
        try {
            this.showLoading();
            
            let result;
            if (contractIds.length > 10) {
                // Use batch store for many contracts
                result = await this.storageManager.batchStore(contractIds, 10);
                alert(`Batch store complete!\nStored: ${result.stored.length}\nFailed: ${result.failed.length}`);
            } else {
                // Regular store for few contracts
                result = await this.storageManager.storeFiles(contractIds);
                alert(`Successfully stored ${result.stored.length} contracts!`);
            }
            
            // Clear selection and refresh
            this.selectedContracts.clear();
            await this.refresh();
            
        } catch (error) {
            console.error('Failed to store contracts:', error);
            alert(`Failed to store contracts: ${error.message}`);
        }
    }
    
    async storeFile(contractId) {
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
    
    async viewDetails(id) {
        // TODO: Implement detailed view modal
        console.log('View details for:', id);
    }
    
    applyFilters() {
        this.filters.minSize = parseInt(document.getElementById('min-size-filter').value);
        this.filters.maxSize = document.getElementById('max-size-filter').value === 'Infinity' 
            ? Infinity 
            : parseInt(document.getElementById('max-size-filter').value);
        this.filters.sortBy = document.getElementById('sort-filter').value;
        
        this.refresh();
    }
    
    updateStats(files) {
        let totalSize = 0;
        let totalEarnings = 0;
        
        files.forEach(file => {
            totalSize += file.size || 0;
            if (file.earnings) {
                totalEarnings += file.earnings.monthlyBroca || 0;
            }
        });
        
        document.getElementById('total-files').textContent = files.length;
        document.getElementById('total-size').textContent = this.formatBytes(totalSize);
        document.getElementById('total-earnings').textContent = `${totalEarnings} BROCA/month`;
    }
    
    showLoading() {
        const fileList = document.getElementById('file-list');
        fileList.innerHTML = '<div class="loading">Loading...</div>';
    }
    
    showError(message) {
        const fileList = document.getElementById('file-list');
        fileList.innerHTML = `<div class="error">${message}</div>`;
    }
    
    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    async loadMore() {
        // TODO: Implement pagination
        console.log('Load more files...');
    }
}

// Export for use in other modules
window.NetworkBrowser = NetworkBrowser;