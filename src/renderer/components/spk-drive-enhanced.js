/**
 * Enhanced SPK Drive Integration with Honeygraph
 * 
 * This module integrates the SPK Drive component with the new spk-js filesystem wrapper
 * that includes Honeygraph support with automatic fallback to the original API
 */

import './spk-drive-integration.css';

// Enhanced SPK Drive implementation with Honeygraph integration
class EnhancedSPKDrive {
    constructor(spkInstance) {
        this.spk = spkInstance;
        this.username = spkInstance.account.username;
        this.files = new Map();
        this.folders = new Map();
        this.contracts = new Map();
        this.metadata = new Map();
        this.virtualFS = new Map();
        
        // Track Honeygraph availability
        this.honeygraphAvailable = false;
        this.lastHoneygraphCheck = 0;
        this.honeygraphCheckInterval = 60000; // Check every minute
        
        // Cache settings
        this.cacheEnabled = true;
        this.cacheExpiry = 300000; // 5 minutes
        this.lastLoadTime = 0;
        
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
    
    /**
     * Check if Honeygraph is available
     */
    async checkHoneygraphAvailability() {
        const now = Date.now();
        if (now - this.lastHoneygraphCheck < this.honeygraphCheckInterval) {
            return this.honeygraphAvailable;
        }
        
        try {
            // Try to fetch health status
            const health = await this.spk.honeygraph.get('/health').catch(() => null);
            this.honeygraphAvailable = health && health.status === 'healthy';
            this.lastHoneygraphCheck = now;
            
            if (this.honeygraphAvailable) {
                console.log('✓ Honeygraph API is available');
            } else {
                console.log('✗ Honeygraph API is unavailable, using fallback');
            }
        } catch (error) {
            this.honeygraphAvailable = false;
            console.warn('Honeygraph health check failed:', error.message);
        }
        
        return this.honeygraphAvailable;
    }
    
    /**
     * Load drive data with Honeygraph integration and fallback
     */
    async loadDrive() {
        try {
            console.log('Loading enhanced drive for:', this.username);
            
            // Check if we should use cache
            if (this.cacheEnabled && Date.now() - this.lastLoadTime < this.cacheExpiry) {
                console.log('Using cached drive data');
                return { 
                    contracts: this.contracts.size, 
                    files: this.files.size,
                    source: 'cache'
                };
            }
            
            // Check Honeygraph availability
            const useHoneygraph = await this.checkHoneygraphAvailability();
            
            let data = null;
            let source = 'unknown';
            
            if (useHoneygraph) {
                // Try Honeygraph first
                try {
                    data = await this.loadFromHoneygraph();
                    source = 'honeygraph';
                } catch (error) {
                    console.warn('Honeygraph load failed, falling back:', error.message);
                }
            }
            
            // Fallback to original API if needed
            if (!data) {
                data = await this.loadFromSPKAPI();
                source = 'spk-api';
            }
            
            // Process the data
            this.processLoadedData(data);
            
            this.lastLoadTime = Date.now();
            
            console.log(`Files loaded from ${source}:`, this.files.size);
            return { 
                contracts: this.contracts.size, 
                files: this.files.size,
                source
            };
        } catch (error) {
            console.error('Failed to load drive:', error);
            throw error;
        }
    }
    
    /**
     * Load data from Honeygraph
     */
    async loadFromHoneygraph() {
        console.log('Loading from Honeygraph...');
        
        // Get user profile with contracts
        const profile = await this.spk.getUserProfile(this.username, {
            include: ['contracts', 'files']
        });
        
        // Get user's files
        const userFiles = await this.spk.users.getUserFiles(this.username, {
            limit: 1000,
            includeMetadata: true
        });
        
        // Get user's contracts with detailed info
        const contracts = await this.spk.getUserContracts(this.username);
        
        return {
            file_contracts: contracts.owned || {},
            channels: contracts.storing ? { [this.username]: contracts.storing } : {},
            files: userFiles,
            profile
        };
    }
    
    /**
     * Load data from original SPK API
     */
    async loadFromSPKAPI() {
        console.log('Loading from SPK API (fallback)...');
        
        const response = await fetch(`${this.spk.account.node}/@${this.username}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch from SPK API: ${response.status}`);
        }
        
        return await response.json();
    }
    
    /**
     * Process loaded data (works with both Honeygraph and SPK API formats)
     */
    processLoadedData(data) {
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
        
        // Process files array (Honeygraph format)
        if (data.files && Array.isArray(data.files)) {
            data.files.forEach(file => {
                this.processHoneygraphFile(file);
            });
        }
    }
    
    /**
     * Process a file from Honeygraph format
     */
    processHoneygraphFile(file) {
        // Check if this is an auxiliary/hidden file
        const isAuxiliary = this.isAuxiliaryFile(file);
        
        const fileData = {
            f: file.cid,
            i: file.contractId || 'unknown',
            o: file.owner || this.username,
            s: file.size,
            e: file.expires,
            t: file.uploadedAt ? new Date(file.uploadedAt).getTime() : Date.now(),
            metadata: {
                name: file.name,
                type: file.type || file.extension || 'unknown',
                thumb: file.thumbnail,
                encrypted: file.encrypted || false,
                nsfw: file.nsfw || false,
                tags: file.tags || [],
                labels: file.labels ? file.labels.join(',') : '',
                isAuxiliary: isAuxiliary,
                ...file.metadata
            },
            folder: this.extractFolderFromFile(file),
            isAuxiliary: isAuxiliary
        };
        
        this.files.set(file.cid, fileData);
        this.metadata.set(`${fileData.i}:${file.cid}`, fileData.metadata);
        
        // Don't add auxiliary files to virtual file system folders
        if (!isAuxiliary) {
            const folder = fileData.folder || '';
            if (!this.virtualFS.has(folder)) {
                this.virtualFS.set(folder, new Set());
            }
            this.virtualFS.get(folder).add(file.cid);
        }
    }
    
    /**
     * Check if a file is auxiliary/hidden
     */
    isAuxiliaryFile(file) {
        const name = (file.name || '').toLowerCase();
        const ext = (file.type || file.extension || '').toLowerCase();
        
        // Check file flags if available
        if (file.flags) {
            const flagsNum = parseInt(file.flags) || 0;
            if ((flagsNum & 2) !== 0) return true; // Bit 2 = auxiliary
        }
        
        // Check by name patterns
        if (name.includes('_thumb') || name.includes('thumbnail')) return true;
        if (name.includes('_poster')) return true;
        if (name.startsWith('_')) return true;
        
        // Check by extension
        if (ext === 'ts') return true; // Video segments
        if (name.endsWith('.m3u8')) return true; // Playlists
        
        // Check if it's a thumbnail for a video
        if (file.metadata?.isThumb || file.metadata?.is_thumb) return true;
        
        return false;
    }
    
    /**
     * Check if a filename indicates auxiliary file
     */
    isAuxiliaryFileName(name, type) {
        const fullName = name + (type ? '.' + type : '');
        const lowerName = fullName.toLowerCase();
        
        // Video segments and playlists
        if (lowerName.endsWith('.ts')) return true;
        if (lowerName.endsWith('.m3u8')) return true;
        
        // Thumbnails and posters
        if (lowerName.includes('_thumb')) return true;
        if (lowerName.includes('_poster')) return true;
        if (lowerName.includes('thumbnail')) return true;
        
        // Hidden files
        if (name.startsWith('_')) return true;
        
        return false;
    }
    
    /**
     * Extract folder from Honeygraph file data
     */
    extractFolderFromFile(file) {
        // Check metadata for folder
        if (file.metadata?.folder) {
            return file.metadata.folder;
        }
        
        // Check if file name contains a path
        if (file.name && file.name.includes('/')) {
            const parts = file.name.split('/');
            parts.pop(); // Remove filename
            return parts.join('/');
        }
        
        // Check tags for folder info
        if (file.tags && Array.isArray(file.tags)) {
            const folderTag = file.tags.find(tag => tag.startsWith('folder:'));
            if (folderTag) {
                return folderTag.substring(7);
            }
        }
        
        // Auto-categorize by type
        return this.autoCategorizByType(file.type || file.extension);
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
                
                // Check if auxiliary
                const isAuxiliary = fileMeta.isAuxiliary || 
                    (fileMeta.is_thumb) || 
                    this.isAuxiliaryFileName(fileMeta.name, fileMeta.type);
                
                const file = {
                    f: cid,
                    i: contract.i,
                    o: contract.t,
                    s: contract.df[cid],
                    e: contract.e,
                    t: Date.now(),
                    metadata: fileMeta,
                    folder: this.extractFolderFromMetadata(fileMeta),
                    isAuxiliary: isAuxiliary
                };
                
                this.files.set(cid, file);
                this.metadata.set(`${contract.i}:${cid}`, fileMeta);
                
                // Only add non-auxiliary files to virtual file system folders
                if (!isAuxiliary) {
                    const folder = file.folder || '';
                    if (!this.virtualFS.has(folder)) {
                        this.virtualFS.set(folder, new Set());
                    }
                    this.virtualFS.get(folder).add(cid);
                }
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
        return this.autoCategorizByType(metadata.type);
    }
    
    autoCategorizByType(type) {
        const typeMap = {
            'jpg': 'Images', 'jpeg': 'Images', 'png': 'Images', 'gif': 'Images', 'webp': 'Images',
            'mp4': 'Videos', 'webm': 'Videos', 'avi': 'Videos', 'mov': 'Videos',
            'mp3': 'Music', 'wav': 'Music', 'ogg': 'Music', 'flac': 'Music',
            'pdf': 'Documents', 'doc': 'Documents', 'docx': 'Documents', 'txt': 'Documents'
        };
        
        const ext = (type || '').toLowerCase();
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
    
    /**
     * Enhanced file search using Honeygraph when available
     */
    async searchFiles(query, options = {}) {
        // Try Honeygraph search first if available
        if (this.honeygraphAvailable) {
            try {
                const results = await this.spk.searchFiles({
                    q: query,
                    limit: options.limit || 100,
                    filters: {
                        owner: this.username,
                        ...options.filters
                    }
                });
                
                // Convert to internal format
                return results.map(file => this.convertHoneygraphToInternal(file));
            } catch (error) {
                console.warn('Honeygraph search failed, using local search:', error.message);
            }
        }
        
        // Fallback to local search
        return this.localSearchFiles(query, options);
    }
    
    /**
     * Local file search (fallback)
     */
    localSearchFiles(query, options = {}) {
        let results = Array.from(this.files.values());
        
        if (query) {
            const lowerQuery = query.toLowerCase();
            results = results.filter(file => 
                file.metadata?.name.toLowerCase().includes(lowerQuery) ||
                file.metadata?.type.toLowerCase().includes(lowerQuery) ||
                file.metadata?.tags?.some(tag => tag.toLowerCase().includes(lowerQuery))
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
        
        if (options.type) {
            results = results.filter(file => file.metadata?.type === options.type);
        }
        
        if (options.tags && options.tags.length > 0) {
            results = results.filter(file => {
                const fileTags = file.metadata?.tags || [];
                return options.tags.some(tag => fileTags.includes(tag));
            });
        }
        
        return results;
    }
    
    /**
     * Convert Honeygraph file format to internal format
     */
    convertHoneygraphToInternal(honeygraphFile) {
        return {
            f: honeygraphFile.cid,
            i: honeygraphFile.contractId,
            o: honeygraphFile.owner || this.username,
            s: honeygraphFile.size,
            e: honeygraphFile.expires,
            t: honeygraphFile.uploadedAt ? new Date(honeygraphFile.uploadedAt).getTime() : Date.now(),
            metadata: {
                name: honeygraphFile.name,
                type: honeygraphFile.type || honeygraphFile.extension,
                thumb: honeygraphFile.thumbnail,
                tags: honeygraphFile.tags || [],
                ...honeygraphFile.metadata
            },
            folder: this.extractFolderFromFile(honeygraphFile)
        };
    }
    
    /**
     * Get file storage providers
     */
    async getFileProviders(cid) {
        if (this.honeygraphAvailable) {
            try {
                return await this.spk.getFileStorageProviders(cid);
            } catch (error) {
                console.warn('Failed to get providers from Honeygraph:', error.message);
            }
        }
        
        // Fallback - get from contract info
        const file = this.files.get(cid);
        if (file && file.i) {
            const contract = this.contracts.get(file.i);
            if (contract && contract.s) {
                return {
                    cid,
                    totalProviders: Object.keys(contract.s).length,
                    providers: Object.entries(contract.s).map(([node, info]) => ({
                        username: node,
                        status: info.status || 'unknown'
                    }))
                };
            }
        }
        
        return { cid, totalProviders: 0, providers: [] };
    }
    
    /**
     * Get file metadata with enhanced info
     */
    async getFileMetadata(cid) {
        const file = this.files.get(cid);
        if (!file) return null;
        
        const metadata = {
            ...file.metadata,
            cid,
            size: file.s,
            owner: file.o,
            contractId: file.i,
            expires: file.e,
            uploadedAt: file.t
        };
        
        // Try to get enhanced metadata from Honeygraph
        if (this.honeygraphAvailable) {
            try {
                const enhanced = await this.spk.files.getFileMetadata(cid);
                return { ...metadata, ...enhanced };
            } catch (error) {
                console.warn('Failed to get enhanced metadata:', error.message);
            }
        }
        
        return metadata;
    }
    
    /**
     * Get storage statistics with enhanced info
     */
    async getStorageStats() {
        let usedSize = 0;
        this.files.forEach(file => {
            usedSize += file.s;
        });
        
        // Try to get accurate stats from SPK
        let availableSize = 1000 * 1024 * 1024 * 6; // Default 6GB
        let brocaBalance = 0;
        
        try {
            const balances = await this.spk.getBalances(true);
            brocaBalance = balances.broca;
            
            // Calculate available storage based on BROCA
            const networkStats = await this.spk.getNetworkStats();
            if (networkStats?.result?.channel_bytes) {
                availableSize = brocaBalance * networkStats.result.channel_bytes;
            }
        } catch (error) {
            console.warn('Failed to get accurate storage stats:', error.message);
        }
        
        return {
            totalSize: availableSize,
            usedSize,
            availableSize: availableSize - usedSize,
            fileCount: this.files.size,
            contractCount: this.contracts.size,
            brocaBalance,
            source: this.honeygraphAvailable ? 'honeygraph' : 'spk-api'
        };
    }
    
    getFiles(folderPath = '') {
        const filesInFolder = this.virtualFS.get(folderPath) || new Set();
        return Array.from(filesInFolder)
            .map(cid => this.files.get(cid))
            .filter(file => file !== undefined && !file.isAuxiliary);
    }
    
    /**
     * Get auxiliary/hidden files
     */
    getAuxiliaryFiles() {
        return Array.from(this.files.values())
            .filter(file => file.isAuxiliary);
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
        
        // Update metadata labels
        const labels = file.metadata.labels ? file.metadata.labels.split(',') : [];
        const folderLabelIndex = labels.findIndex(l => l.startsWith('folder:'));
        if (folderLabelIndex >= 0) {
            labels[folderLabelIndex] = `folder:${targetFolder}`;
        } else {
            labels.push(`folder:${targetFolder}`);
        }
        file.metadata.labels = labels.join(',');
        
        // TODO: Update contract metadata on chain
    }
    
    async deleteFile(cid) {
        await this.moveFile(cid, 'Trash');
        const file = this.files.get(cid);
        if (file && file.metadata) {
            file.metadata.labels = (file.metadata.labels || '') + `,deleted:${Date.now()}`;
        }
        
        // TODO: Cancel contract renewal on chain
    }
    
    /**
     * Get recently uploaded files
     */
    async getRecentFiles(limit = 50) {
        if (this.honeygraphAvailable) {
            try {
                const recent = await this.spk.getRecentFiles(limit);
                return recent.filter(file => file.owner === this.username)
                    .map(file => this.convertHoneygraphToInternal(file));
            } catch (error) {
                console.warn('Failed to get recent files from Honeygraph:', error.message);
            }
        }
        
        // Fallback to local sorting
        return Array.from(this.files.values())
            .sort((a, b) => (b.t || 0) - (a.t || 0))
            .slice(0, limit);
    }
    
    /**
     * Get files by tags
     */
    async getFilesByTags(tags, logic = 'OR') {
        if (this.honeygraphAvailable) {
            try {
                const results = await this.spk.getFilesByTags(tags, logic);
                return results.filter(file => file.owner === this.username)
                    .map(file => this.convertHoneygraphToInternal(file));
            } catch (error) {
                console.warn('Failed to get files by tags from Honeygraph:', error.message);
            }
        }
        
        // Fallback to local filtering
        return Array.from(this.files.values()).filter(file => {
            const fileTags = file.metadata?.tags || [];
            if (logic === 'AND') {
                return tags.every(tag => fileTags.includes(tag));
            } else {
                return tags.some(tag => fileTags.includes(tag));
            }
        });
    }
}

// Export the enhanced drive class
export { EnhancedSPKDrive };

// Also export a factory function that creates and initializes the drive
export async function createEnhancedSPKDrive(spkInstance) {
    const drive = new EnhancedSPKDrive(spkInstance);
    
    // Check Honeygraph availability on creation
    await drive.checkHoneygraphAvailability();
    
    return drive;
}