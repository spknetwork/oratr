// Renderer process JavaScript
const { ipcRenderer } = require('electron');

// Current state
let currentTab = 'upload';
let selectedVideo = null;
let uploadInProgress = false;
let ipfsRunning = false;
let storageRunning = false;
let currentAccount = null;
let ffmpegAvailable = false;
// Make currentAccount globally accessible
window.currentAccount = null;
let isAuthenticated = false;
let ipfsAutoDetected = false;
let storageRefreshInterval = null;

// Test function to verify onclick works
window.testClick = () => {
    console.log('Test click works!');
    alert('Button clicked!');
};

// Network browser instance
let networkBrowser = null;

// Initialize app
window.addEventListener('DOMContentLoaded', async () => {
    // Initialize auth component
    const authContainer = document.getElementById('auth-container');
    authContainer.style.display = 'block';
    await window.authComponent.init(authContainer);
    
    // Listen for authentication events
    window.addEventListener('active-account-changed', (event) => {
        currentAccount = event.detail.username;
        window.currentAccount = currentAccount;
        updateAccountDisplay();
        showApp();
    });
    
    // Listen for unlock events
    window.api.on('spk:accounts-unlocked', () => {
        isAuthenticated = true;
        updateWalletLockStatus(false);
        refreshBalance();
        showNotification('Wallet unlocked', 'success');
    });
    
    // Listen for lock events
    window.api.on('spk:accounts-locked', () => {
        // Don't hide app, just update wallet status
        isAuthenticated = false;
        updateWalletLockStatus(true);
        
        // Show notice
        showNotification('Wallet locked. Unlock to perform wallet operations.', 'info');
        
        // Storage services continue running
        if (storageRunning) {
            console.log('Storage services continue running in background');
        }
    });
    
    // Listen for transaction signing modal requests from main process
    ipcRenderer.on('show-signing-modal', async (event, data) => {
        const { requestId, transaction, keyType, username } = data;
        
        try {
            // Show the signing modal
            if (window.signingModal) {
                await window.signingModal.requestSignature(transaction, keyType, username);
                // User approved
                ipcRenderer.send(`signing-response-${requestId}`, true);
            } else {
                console.error('Signing modal not initialized');
                ipcRenderer.send(`signing-response-${requestId}`, false);
            }
        } catch (error) {
            // User rejected
            ipcRenderer.send(`signing-response-${requestId}`, false);
        }
    });
    
    // Listen for message signing modal requests from main process  
    ipcRenderer.on('show-message-signing-modal', async (event, data) => {
        console.log('Received message signing request:', data);
        // The setupMessageSigningModal function will handle this
    });
    
    // Check if already unlocked
    const activeAccount = await window.api.account.getActive();
    if (activeAccount) {
        currentAccount = activeAccount.username;
        window.currentAccount = currentAccount;
        isAuthenticated = true;
    }
    
    // Always show the app - wallet lock only affects wallet functions
    updateAccountDisplay();
    document.getElementById('app').style.display = 'block';
    updateWalletLockStatus(!isAuthenticated);
    
    // Auto-detect external IPFS on startup - delay to ensure DOM is ready
    setTimeout(async () => {
        await checkExternalIPFS();
        // Also check FFmpeg availability
        await checkFFmpegAvailability();
    }, 500);
});

// Show main app
function showApp() {
    document.getElementById('auth-container').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    isAuthenticated = true;
    updateWalletLockStatus(false);
    refreshBalance();
    
    // If we're on the drive tab, refresh the files
    const driveTab = document.getElementById('drive-tab');
    if (driveTab && driveTab.classList.contains('active')) {
        console.log('[showApp] Refreshing drive tab for:', window.currentAccount);
        if (window.refreshFiles) {
            window.refreshFiles();
        }
    }
}

// Hide main app (only used for initial setup)
function hideApp() {
    document.getElementById('app').style.display = 'none';
    isAuthenticated = false;
    currentAccount = null;
    window.currentAccount = null;
}

// Update wallet lock status in UI
function updateWalletLockStatus(locked) {
    const accountBtn = document.getElementById('account-btn');
    const accountName = document.getElementById('account-name');
    
    if (locked) {
        accountBtn.innerHTML = '🔒 Unlock';
        accountBtn.classList.add('locked');
        if (accountName) {
            accountName.style.opacity = '0.5';
        }
        // Disable wallet-specific buttons
        document.querySelectorAll('.wallet-action').forEach(btn => {
            btn.disabled = true;
            btn.title = 'Wallet locked - click Unlock to continue';
        });
    } else {
        accountBtn.innerHTML = 'Accounts';
        accountBtn.classList.remove('locked');
        if (accountName) {
            accountName.style.opacity = '1';
        }
        // Enable wallet-specific buttons
        document.querySelectorAll('.wallet-action').forEach(btn => {
            btn.disabled = false;
            btn.title = '';
        });
    }
}

// Update account display
function updateAccountDisplay() {
    const accountName = document.getElementById('account-name');
    const accountBalance = document.getElementById('account-balance');
    
    if (currentAccount) {
        accountName.textContent = currentAccount;
        // Balance will be updated by refreshBalance()
    } else {
        accountName.textContent = 'No account';
        accountBalance.innerHTML = '';
    }
}

// Show account manager
function showAccountManager() {
    // Don't hide the app - just show the auth container with account manager
    const authContainer = document.getElementById('auth-container');
    const app = document.getElementById('app');
    
    // Keep app visible but blur it
    app.style.opacity = '0.3';
    app.style.pointerEvents = 'none';
    
    // Show auth container as overlay
    authContainer.style.display = 'block';
    authContainer.style.position = 'fixed';
    authContainer.style.top = '0';
    authContainer.style.left = '0';
    authContainer.style.right = '0';
    authContainer.style.bottom = '0';
    authContainer.style.zIndex = '1000';
    authContainer.style.background = 'rgba(26, 26, 26, 0.95)';
    
    window.authComponent.showAccountManager();
}

// Create IPC API bridge
window.api = {
    auth: {
        hasPinSetup: () => ipcRenderer.invoke('auth:hasPinSetup'),
        setupPin: (pin) => ipcRenderer.invoke('auth:setupPin', pin),
        unlock: (pin) => ipcRenderer.invoke('auth:unlock', pin),
        lock: () => ipcRenderer.invoke('auth:lock'),
        resetAll: () => ipcRenderer.invoke('auth:resetAll')
    },
    account: {
        add: (username, keys) => ipcRenderer.invoke('account:add', username, keys),
        importFromMaster: (username, masterPassword) => 
            ipcRenderer.invoke('account:importFromMaster', username, masterPassword),
        remove: (username) => ipcRenderer.invoke('account:remove', username),
        setActive: (username) => ipcRenderer.invoke('account:setActive', username),
        list: () => ipcRenderer.invoke('account:list'),
        getActive: () => ipcRenderer.invoke('account:getActive'),
        export: (username, exportPin) => ipcRenderer.invoke('account:export', username, exportPin),
        import: (exportData, importPin) => ipcRenderer.invoke('account:import', exportData, importPin)
    },
    balance: {
        get: (refresh) => ipcRenderer.invoke('balance:get', refresh)
    },
    video: {
        analyze: (path) => ipcRenderer.invoke('video:analyze', path),
        upload: (path, options) => ipcRenderer.invoke('video:upload', path, options),
        cancelUpload: () => ipcRenderer.invoke('video:cancelUpload')
    },
    ipfs: {
        start: () => ipcRenderer.invoke('ipfs:start'),
        stop: () => ipcRenderer.invoke('ipfs:stop'),
        getNodeInfo: () => ipcRenderer.invoke('ipfs:getNodeInfo'),
        getPeers: () => ipcRenderer.invoke('ipfs:getPeers'),
        getConfig: () => ipcRenderer.invoke('ipfs:getConfig'),
        updateConfig: (config) => ipcRenderer.invoke('ipfs:updateConfig', config),
        getRepoStats: () => ipcRenderer.invoke('ipfs:getRepoStats'),
        runGC: () => ipcRenderer.invoke('ipfs:runGC'),
        getBandwidth: () => ipcRenderer.invoke('ipfs:getBandwidth'),
        testConnection: (host, port) => ipcRenderer.invoke('ipfs:testConnection', host, port),
        checkPubSub: () => ipcRenderer.invoke('ipfs:checkPubSub'),
        enablePubSub: () => ipcRenderer.invoke('ipfs:enablePubSub')
    },
    storage: {
        start: () => ipcRenderer.invoke('storage:start'),
        stop: () => ipcRenderer.invoke('storage:stop'),
        getStats: () => ipcRenderer.invoke('storage:getStats'),
        getEarnings: () => ipcRenderer.invoke('storage:getEarnings'),
        checkBinary: () => ipcRenderer.invoke('storage:checkBinary'),
        installPOA: () => ipcRenderer.invoke('storage:installPOA'),
        updateConfig: (config) => ipcRenderer.invoke('storage:updateConfig', config),
        getStatus: () => ipcRenderer.invoke('storage:getStatus'),
        validateRegistration: (ipfsId, regInfo) => ipcRenderer.invoke('storage:validateRegistration', ipfsId, regInfo),
        getRecentLogs: (lines) => ipcRenderer.invoke('storage:getRecentLogs', lines)
    },
    spk: {
        registerStorage: (ipfsId, domain, price) => 
            ipcRenderer.invoke('spk:registerStorage', ipfsId, domain, price),
        registerValidator: (amount) => 
            ipcRenderer.invoke('spk:registerValidator', amount),
        registerAuthority: (publicKey) => 
            ipcRenderer.invoke('spk:registerAuthority', publicKey),
        checkRegistration: (username) => 
            ipcRenderer.invoke('spk:checkRegistration', username),
        getNetworkStats: () => ipcRenderer.invoke('spk:getNetworkStats'),
        generateKeyPair: () => ipcRenderer.invoke('spk:generateKeyPair'),
        getExistingContract: (broker) => ipcRenderer.invoke('spk:getExistingContract', broker),
        createStorageContract: (contractData, options) => ipcRenderer.invoke('spk:createStorageContract', contractData, options),
        uploadToPublicNode: (files, contract, options) => ipcRenderer.invoke('spk:uploadToPublicNode', files, contract, options),
        calculateBrocaCost: (size, options) => ipcRenderer.invoke('spk:calculateBrocaCost', size, options),
        // Provider selection is now handled internally by spk-js
        upload: (files, options) => ipcRenderer.invoke('spk:upload', files, options),
        uploadFromPaths: (uploadData) => ipcRenderer.invoke('spk:uploadFromPaths', uploadData)
    },
    broca: {
        calculateStorageCost: (size, days) => ipcRenderer.invoke('broca:calculateStorageCost', size, days)
    },
    contracts: {
        start: () => ipcRenderer.invoke('contracts:start'),
        stop: () => ipcRenderer.invoke('contracts:stop'),
        getStatus: () => ipcRenderer.invoke('contracts:getStatus'),
        getContracts: () => ipcRenderer.invoke('contracts:getContracts'),
        getPinnedCIDs: () => ipcRenderer.invoke('contracts:getPinnedCIDs'),
        checkNow: () => ipcRenderer.invoke('contracts:checkNow')
    },
    // Generic invoke method for all IPC calls
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    on: (channel, callback) => {
        ipcRenderer.on(channel, (event, ...args) => callback(...args));
    },
    off: (channel, callback) => {
        ipcRenderer.removeListener(channel, callback);
    }
};

// FFmpeg availability check
async function checkFFmpegAvailability() {
    try {
        const result = await window.api.invoke('ffmpeg:getVersion');
        if (result.success) {
            ffmpegAvailable = true;
            console.log('FFmpeg detected:', result.version);
            // Hide install notice if shown
            const installNotice = document.getElementById('ffmpeg-install-notice');
            if (installNotice) installNotice.style.display = 'none';
            return true;
        }
    } catch (error) {
        console.error('FFmpeg check failed:', error);
    }
    
    ffmpegAvailable = false;
    showFFmpegInstallNotice();
    return false;
}

function showFFmpegInstallNotice() {
    // Check if notice already exists
    let notice = document.getElementById('ffmpeg-install-notice');
    if (!notice) {
        // Create install notice
        const uploadTab = document.getElementById('upload-tab');
        notice = document.createElement('div');
        notice.id = 'ffmpeg-install-notice';
        notice.className = 'install-notice warning-notice';
        notice.innerHTML = `
            <div class="notice-icon">⚠️</div>
            <div class="notice-content">
                <h3>FFmpeg Not Found</h3>
                <p>FFmpeg is required for video processing and transcoding.</p>
                <div class="install-instructions">
                    <h4>To install FFmpeg:</h4>
                    <div class="command-box">
                        <code>sudo apt update && sudo apt install ffmpeg</code>
                        <button onclick="copyToClipboard('sudo apt update && sudo apt install ffmpeg')" class="copy-btn">📋 Copy</button>
                    </div>
                    <p>After installation, click "Check Again" to verify.</p>
                </div>
                <div class="notice-actions">
                    <button onclick="checkFFmpegAgain()" class="btn btn-primary">Check Again</button>
                    <a href="https://ffmpeg.org/download.html" target="_blank" class="btn btn-secondary">Download FFmpeg</a>
                </div>
            </div>
        `;
        
        // Insert at the beginning of upload tab
        uploadTab.insertBefore(notice, uploadTab.firstChild);
    }
    
    notice.style.display = 'block';
}

async function checkFFmpegAgain() {
    showNotification('Checking for FFmpeg...', 'info');
    const available = await checkFFmpegAvailability();
    if (available) {
        showNotification('FFmpeg detected! You can now process videos.', 'success');
    } else {
        showNotification('FFmpeg not found. Please install it and try again.', 'error');
    }
}

// Make function available globally
window.checkFFmpegAgain = checkFFmpegAgain;

// Refresh drive
function refreshDrive() {
    window.dispatchEvent(new Event('spk-drive-refresh'));
}
window.refreshDrive = refreshDrive;
window.showNotification = showNotification;

// Copy to clipboard function
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showNotification('Copied to clipboard!', 'success', 2000);
    }).catch(err => {
        console.error('Failed to copy:', err);
        showNotification('Failed to copy to clipboard', 'error');
    });
}
window.copyToClipboard = copyToClipboard;

// Tab switching
function showTab(tabName) {
    // Hide all tabs
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelectorAll('.tab').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Show selected tab
    document.getElementById(`${tabName}-tab`).classList.add('active');
    document.querySelector(`[onclick="showTab('${tabName}')"]`).classList.add('active');
    
    currentTab = tabName;
    
    // Run tab-specific initialization
    if (tabName === 'storage' && currentAccount) {
        checkPOABinary();
        checkRegistration();
        updateStorageInfo(); // Check IPFS status and update controls
        initializeNetworkBrowser(); // Initialize network browser
    } else if (tabName === 'ipfs') {
        // If IPFS was auto-detected and running, just update info
        if (ipfsRunning) {
            updateIPFSInfo();
        } else {
            // Otherwise check status
            checkIPFSStatus();
        }
    } else if (tabName === 'drive' && currentAccount) {
        refreshFiles();
    }
}

// Wallet operations
let currentWalletTab = 'spk';

function showWalletTab(tabName) {
    // Hide all wallet tabs
    document.querySelectorAll('.wallet-tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelectorAll('.wallet-tab').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Show selected wallet tab
    document.getElementById(`${tabName}-wallet-tab`).classList.add('active');
    document.querySelector(`[onclick="showWalletTab('${tabName}')"]`).classList.add('active');
    
    currentWalletTab = tabName;
    
    // Load appropriate data
    if (tabName === 'spk') {
        refreshSPKBalance();
    } else if (tabName === 'hive') {
        refreshHiveBalance();
    }
}

function showDelegationTab(tabName) {
    // Hide all delegation tabs
    document.querySelectorAll('.delegation-tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelectorAll('.del-tab').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Show selected delegation tab
    document.getElementById(`${tabName}-delegations`).classList.add('active');
    document.querySelector(`[onclick="showDelegationTab('${tabName}')"]`).classList.add('active');
}

// SPK Network functions
async function toggleTestnet(enabled) {
    // TODO: Implement testnet toggle
    console.log('Testnet mode:', enabled);
}

async function refreshSPKBalance() {
    if (!currentAccount || !isAuthenticated) return;
    
    try {
        const result = await window.api.balance.get(true);
        
        if (result.success) {
            const balances = result.balances;
            
            // Update SPK balance
            const spkBalance = balances.spk || 0;
            const spkEl = document.getElementById('spk-balance');
            if (spkEl) spkEl.textContent = spkBalance.toFixed(3);
            
            // Update LARYNX balance
            const larynxBalance = balances.larynx || 0;
            const larynxEl = document.getElementById('larynx-balance');
            if (larynxEl) larynxEl.textContent = larynxBalance.toFixed(3);
            
            // For now, set staked to 0 until we get proper data
            const larynxPowerEl = document.getElementById('larynx-power-balance');
            if (larynxPowerEl) larynxPowerEl.textContent = '0.000';
            
            // Update delegation summary (set to 0 for now)
            const delegationReceivedEl = document.getElementById('delegation-received');
            const delegationSentEl = document.getElementById('delegation-sent');
            if (delegationReceivedEl) delegationReceivedEl.textContent = '0.000';
            if (delegationSentEl) delegationSentEl.textContent = '0.000';
            
            // Update BROCA
            const brocaBalance = balances.broca || 0;
            const brocaAvailableEl = document.getElementById('broca-available');
            const brocaRegenEl = document.getElementById('broca-regen');
            
            if (brocaAvailableEl) brocaAvailableEl.textContent = brocaBalance.toFixed(0);
            if (brocaRegenEl) brocaRegenEl.textContent = '0.0'; // Set to 0 for now
            
            // Update BROCA bar (assume max 1000 BROCA for percentage)
            const brocaPercentage = Math.min(brocaBalance / 1000 * 100, 100);
            const brocaFill = document.getElementById('broca-fill');
            if (brocaFill) {
                brocaFill.style.width = brocaPercentage + '%';
            }
            
            // Update mini balance in header
            const accountBalance = document.getElementById('account-balance');
            if (accountBalance) {
                accountBalance.innerHTML = `
                    <span class="balance-item">BROCA: ${brocaBalance.toFixed(0)}</span>
                `;
            }
            
            // Update delegation info
            await updateDelegationInfo();
            
            // Update rewards
            await updateRewardsInfo();
            
            // Calculate USD value (placeholder prices)
            const totalValue = (balances.spk || 0) * 0.01 + (balances.larynx || 0) * 0.001;
            const totalUsd = document.getElementById('total-usd-value');
            if (totalUsd) {
                totalUsd.textContent = `$${totalValue.toFixed(2)}`;
            }
            
            // Update network status
            updateNetworkStatus();
        } else {
            console.error('Failed to get balance:', result.error);
            const errorMsg = result.error?.message || result.error || 'Unknown error';
            showNotification(`Failed to load SPK balances: ${errorMsg}`, 'error');
            
            // Show error in UI
            const larynxEl = document.getElementById('larynx-balance');
            const spkEl = document.getElementById('spk-balance');
            const brocaEl = document.getElementById('broca-balance');
            
            if (larynxEl) larynxEl.textContent = 'Error';
            if (spkEl) spkEl.textContent = 'Error';
            if (brocaEl) brocaEl.textContent = 'Error';
        }
    } catch (error) {
        console.error('Failed to refresh SPK balance:', error);
        const errorMsg = error.message || 'Unknown error';
        showNotification(`Error loading SPK wallet: ${errorMsg}`, 'error');
        
        // Show error in UI
        document.getElementById('larynx-balance').textContent = 'Error';
        document.getElementById('spk-balance').textContent = 'Error';
        document.getElementById('broca-balance').textContent = 'Error';
    }
}

function calculateBrocaRegen(larynxPower) {
    // Simplified calculation: 1 LP = ~0.1 BROCA/hour
    const regenRate = (larynxPower || 0) * 0.1;
    return regenRate.toFixed(1);
}

async function updateNetworkStatus() {
    try {
        const networkStats = await window.api.spk.getNetworkStats();
        if (networkStats.success) {
            const blocksBehind = networkStats.stats?.blocksBehind || 0;
            const statusEl = document.getElementById('blocks-behind');
            if (statusEl) {
                statusEl.textContent = blocksBehind === 0 ? 'Synced' : `${blocksBehind} blocks behind`;
            }
        }
    } catch (error) {
        console.log('Network status not available');
    }
}

async function refreshHiveBalance() {
    if (!currentAccount || !isAuthenticated) return;
    
    try {
        // For now, use a mock Hive API call
        // In a real implementation, you would call the Hive API
        const hiveBalances = await getHiveBalances(currentAccount);
        
        // Update HIVE balance
        document.getElementById('hive-balance').textContent = hiveBalances.hive.toFixed(3);
        
        // Update HIVE Power
        document.getElementById('hive-power-balance').textContent = hiveBalances.hivePower.toFixed(3);
        
        // Update effective HP display
        const effectiveHp = document.getElementById('effective-hp');
        if (effectiveHp) {
            const effectiveAmount = hiveBalances.hivePower + hiveBalances.delegatedIn - hiveBalances.delegatedOut;
            effectiveHp.textContent = `(${effectiveAmount.toFixed(3)} effective)`;
        }
        
        // Update delegation summary
        document.getElementById('hp-delegation-received').textContent = hiveBalances.delegatedIn.toFixed(3);
        document.getElementById('hp-delegation-sent').textContent = hiveBalances.delegatedOut.toFixed(3);
        
        // Update HBD balances
        document.getElementById('hbd-balance').textContent = hiveBalances.hbd.toFixed(3);
        document.getElementById('hbd-savings-balance').textContent = hiveBalances.hbdSavings.toFixed(3);
        
        // Update pending rewards
        document.getElementById('pending-hbd').textContent = hiveBalances.pendingHbd.toFixed(3);
        document.getElementById('pending-hive').textContent = hiveBalances.pendingHive.toFixed(3);
        document.getElementById('pending-hp').textContent = hiveBalances.pendingHp.toFixed(3);
        
        // Update RC mana
        const rcPercentage = hiveBalances.rcMana;
        document.getElementById('rc-percentage').textContent = rcPercentage.toFixed(1);
        const rcManaFill = document.getElementById('rc-mana-fill');
        if (rcManaFill) {
            rcManaFill.style.width = rcPercentage + '%';
        }
        
        // Update mini balance in header
        const accountBalance = document.getElementById('account-balance');
        if (accountBalance) {
            accountBalance.innerHTML = `
                <span class="balance-item">HIVE: ${hiveBalances.hive.toFixed(2)}</span>
                <span class="balance-item">HP: ${hiveBalances.hivePower.toFixed(0)}</span>
            `;
        }
        
    } catch (error) {
        console.error('Failed to refresh Hive balance:', error);
        const errorMsg = error.message || 'Unknown error';
        showNotification(`Error loading Hive wallet: ${errorMsg}`, 'error');
        
        // Show error in UI
        document.getElementById('hive-balance').textContent = 'Error';
        document.getElementById('hive-power-balance').textContent = 'Error';
        document.getElementById('hbd-balance').textContent = 'Error';
        document.getElementById('hbd-savings-balance').textContent = 'Error';
        document.getElementById('rc-mana').textContent = 'Error';
    }
}

// Get real Hive balances from Hive API
async function getHiveBalances(username) {
    try {
        // Fetch account data from Hive API
        const response = await fetch('https://api.hive.blog', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'condenser_api.get_accounts',
                params: [[username]],
                id: 1
            })
        });
        
        const data = await response.json();
        if (!data.result || !data.result[0]) {
            throw new Error('Account not found');
        }
        
        const account = data.result[0];
        
        // Helper function to parse Hive balance strings
        const parseBalance = (balance) => {
            if (!balance || typeof balance !== 'string') return 0;
            return parseFloat(balance.split(' ')[0]) || 0;
        };
        
        // Parse balances
        const hiveBalance = parseBalance(account.balance);
        const hbdBalance = parseBalance(account.hbd_balance);
        const hbdSavings = parseBalance(account.savings_hbd_balance);
        const hiveSavings = parseBalance(account.savings_balance);
        
        // Calculate Hive Power from vesting shares
        const vestingShares = parseFloat(account.vesting_shares.split(' ')[0]);
        const delegatedVestingShares = parseFloat(account.delegated_vesting_shares.split(' ')[0]);
        const receivedVestingShares = parseFloat(account.received_vesting_shares.split(' ')[0]);
        
        // Get dynamic global properties for VESTS to HP conversion
        const globalResponse = await fetch('https://api.hive.blog', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'condenser_api.get_dynamic_global_properties',
                params: [],
                id: 1
            })
        });
        
        const globalData = await globalResponse.json();
        const totalVestingShares = parseFloat(globalData.result.total_vesting_shares.split(' ')[0]);
        const totalVestingFund = parseFloat(globalData.result.total_vesting_fund_hive.split(' ')[0]);
        const vestsToHp = totalVestingFund / totalVestingShares;
        
        const hivePower = (vestingShares - delegatedVestingShares) * vestsToHp;
        const delegatedIn = receivedVestingShares * vestsToHp;
        const delegatedOut = delegatedVestingShares * vestsToHp;
        
        // Calculate RC Mana percentage
        const rcMana = account.rc_manabar ? (account.rc_manabar.current_mana / account.rc_manabar.max_mana * 100) : 100;
        
        // Parse pending rewards
        const pendingHbd = parseBalance(account.reward_hbd_balance);
        const pendingHive = parseBalance(account.reward_hive_balance);
        const pendingVests = parseFloat(account.reward_vesting_balance.split(' ')[0]);
        const pendingHp = pendingVests * vestsToHp;
        
        return {
            hive: hiveBalance,
            hivePower: hivePower,
            hbd: hbdBalance,
            hbdSavings: hbdSavings,
            hiveSavings: hiveSavings,
            delegatedIn: delegatedIn,
            delegatedOut: delegatedOut,
            pendingHbd: pendingHbd,
            pendingHive: pendingHive,
            pendingHp: pendingHp,
            rcMana: rcMana
        };
    } catch (error) {
        console.error('Failed to fetch Hive balances:', error);
        throw error;
    }
}

async function refreshAllBalances() {
    if (currentWalletTab === 'spk') {
        await refreshSPKBalance();
    } else {
        await refreshHiveBalance();
    }
}

// Legacy balance refresh for compatibility
async function refreshBalance() {
    await refreshSPKBalance();
}

function clearBalances() {
    // Clear SPK balances
    document.getElementById('spk-balance').textContent = '--';
    document.getElementById('larynx-balance').textContent = '--';
    document.getElementById('larynx-power-balance').textContent = '--';
    document.getElementById('locked-larynx-balance').textContent = '--';
    document.getElementById('broca-available').textContent = '--';
    document.getElementById('broca-regen').textContent = '--';
    document.getElementById('account-balance').innerHTML = '';
    
    // Clear Hive balances
    document.getElementById('hive-balance').textContent = '--';
    document.getElementById('hive-power-balance').textContent = '--';
    document.getElementById('hbd-balance').textContent = '--';
    document.getElementById('hbd-savings-balance').textContent = '--';
}

// Modal operations
let currentTokenForModal = '';

async function sendToken(tokenType) {
    if (!currentAccount) {
        showNotification('Please select an account first', 'error');
        return;
    }
    
    currentTokenForModal = tokenType;
    document.getElementById('send-token-type').textContent = tokenType;
    document.getElementById('send-modal').style.display = 'block';
    
    // Clear form
    document.getElementById('send-form').reset();
}

function closeSendModal() {
    document.getElementById('send-modal').style.display = 'none';
}

// Notification system
function showNotification(message, type = 'info') {
    // Create notification element if it doesn't exist
    let notification = document.getElementById('notification');
    if (!notification) {
        notification = document.createElement('div');
        notification.id = 'notification';
        notification.className = 'notification';
        document.body.appendChild(notification);
    }
    
    notification.textContent = message;
    notification.className = `notification ${type} show`;
    
    // Auto-hide after 3 seconds
    setTimeout(() => {
        notification.classList.remove('show');
    }, 3000);
}

// Form handlers
document.addEventListener('DOMContentLoaded', () => {
    // Send form handler
    const sendForm = document.getElementById('send-form');
    sendForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const recipient = document.getElementById('send-to').value;
        const amount = parseFloat(document.getElementById('send-amount').value);
        const memo = document.getElementById('send-memo').value || '';
        
        try {
            const result = await window.api.token.transfer(recipient, amount, currentTokenForModal, memo);
            if (result.success) {
                showNotification(`Successfully sent ${amount} ${currentTokenForModal} to ${recipient}`, 'success');
                closeSendModal();
                refreshAllBalances();
            } else {
                showNotification(`Transfer failed: ${result.error}`, 'error');
            }
        } catch (error) {
            showNotification(`Transfer failed: ${error.message}`, 'error');
        }
    });

    // Power up form handler
    const powerupForm = document.getElementById('powerup-form');
    powerupForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const amount = parseFloat(document.getElementById('powerup-amount').value);
        
        try {
            const result = await window.api.token.powerUp(amount);
            if (result.success) {
                showNotification(`Successfully powered up ${amount} LARYNX`, 'success');
                closePowerUpModal();
                refreshSPKBalance();
            } else {
                showNotification(`Power up failed: ${result.error}`, 'error');
            }
        } catch (error) {
            showNotification(`Power up failed: ${error.message}`, 'error');
        }
    });

    // Power down form handler
    const powerdownForm = document.getElementById('powerdown-form');
    powerdownForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const amount = parseFloat(document.getElementById('powerdown-amount').value);
        
        try {
            const result = await window.api.token.powerDown(amount);
            if (result.success) {
                showNotification(`Started power down of ${amount} LP (4 week schedule)`, 'success');
                closePowerDownModal();
                refreshSPKBalance();
            } else {
                showNotification(`Power down failed: ${result.error}`, 'error');
            }
        } catch (error) {
            showNotification(`Power down failed: ${error.message}`, 'error');
        }
    });

    // Delegate form handler
    const delegateForm = document.getElementById('delegate-form');
    delegateForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const delegatee = document.getElementById('delegate-to').value;
        const amount = parseFloat(document.getElementById('delegate-amount').value);
        
        // TODO: Implement actual delegation API call
        showNotification('Delegation functionality coming soon', 'info');
        closeDelegateModal();
    });

    // Close modals when clicking outside
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            e.target.style.display = 'none';
        }
    });
});

async function powerUpLarynx() {
    if (!currentAccount) {
        showNotification('Please select an account first', 'error');
        return;
    }
    
    // Get current balance for display
    const result = await window.api.balance.get();
    const available = result.success ? (result.balances.larynx || 0).toFixed(3) : '--';
    
    document.getElementById('powerup-available').textContent = available;
    document.getElementById('powerup-modal').style.display = 'block';
    document.getElementById('powerup-form').reset();
}

function closePowerUpModal() {
    document.getElementById('powerup-modal').style.display = 'none';
}

async function powerDownLarynx() {
    if (!currentAccount) {
        showNotification('Please select an account first', 'error');
        return;
    }
    
    // Get current balance for display
    const result = await window.api.balance.get();
    const available = result.success ? (result.balances.larynxPower || 0).toFixed(3) : '--';
    
    document.getElementById('powerdown-available').textContent = available;
    document.getElementById('powerdown-modal').style.display = 'block';
    document.getElementById('powerdown-form').reset();
}

function closePowerDownModal() {
    document.getElementById('powerdown-modal').style.display = 'none';
}

async function delegateLarynx() {
    if (!currentAccount) {
        showNotification('Please select an account first', 'error');
        return;
    }
    
    // Get current balance for display
    const result = await window.api.balance.get();
    const available = result.success ? (result.balances.larynxPower || 0).toFixed(3) : '--';
    
    document.getElementById('delegate-available').textContent = available;
    document.getElementById('delegate-modal').style.display = 'block';
    document.getElementById('delegate-form').reset();
}

function closeDelegateModal() {
    document.getElementById('delegate-modal').style.display = 'none';
}

async function lockLiquidity() {
    showNotification('Lock Liquidity functionality coming soon', 'info');
}

function openMarket(token) {
    // Open external DEX market
    const marketUrls = {
        'LARYNX': 'https://dex.dlux.io/#/market/LARYNX',
        'HIVE': 'https://blocktrades.us/'
    };
    
    if (marketUrls[token]) {
        window.open(marketUrls[token], '_blank');
    } else {
        showNotification(`Market for ${token} not available`, 'info');
    }
}

async function claimRewards() {
    // TODO: Implement rewards claiming
    showNotification('Claim Rewards functionality coming soon', 'info');
}

// Hive operations
async function powerUpHive() {
    showNotification('HIVE Power Up functionality coming soon', 'info');
}

async function convertToHBD() {
    showNotification('Convert to HBD functionality coming soon', 'info');
}

async function transferToSavings(token) {
    showNotification(`Transfer ${token} to Savings functionality coming soon`, 'info');
}

async function delegateHP() {
    showNotification('Delegate HP functionality coming soon', 'info');
}

async function delegateRC() {
    showNotification('Delegate RC functionality coming soon', 'info');
}

async function powerDownHive() {
    showNotification('HIVE Power Down functionality coming soon', 'info');
}

async function setWithdrawalRoute() {
    showNotification('Set Withdrawal Route functionality coming soon', 'info');
}

async function claimAccount() {
    showNotification('Claim Account Creation Token functionality coming soon', 'info');
}

async function withdrawFromSavings() {
    showNotification('Withdraw from Savings functionality coming soon', 'info');
}

async function claimHiveRewards() {
    showNotification('Claim Hive Rewards functionality coming soon', 'info');
}

function showTransactionHistory() {
    showNotification('Transaction History functionality coming soon', 'info');
}

// Helper functions
async function updateDelegationInfo() {
    // TODO: Fetch actual delegation data from SPK API
    try {
        // Placeholder data - replace with actual API calls
        const delegationReceived = 0;
        const delegationSent = 0;
        
        const receivedEl = document.getElementById('delegation-received');
        const sentEl = document.getElementById('delegation-sent');
        
        if (receivedEl) receivedEl.textContent = delegationReceived.toFixed(3);
        if (sentEl) sentEl.textContent = delegationSent.toFixed(3);
        
        // Update Hive delegations if on Hive tab
        const hpReceivedEl = document.getElementById('hp-delegation-received');
        const hpSentEl = document.getElementById('hp-delegation-sent');
        
        if (hpReceivedEl) hpReceivedEl.textContent = '0.000';
        if (hpSentEl) hpSentEl.textContent = '0.000';
    } catch (error) {
        console.error('Failed to update delegation info:', error);
    }
}

async function updateRewardsInfo() {
    // TODO: Fetch actual rewards data from SPK API
    try {
        // Placeholder data - replace with actual API calls
        const pendingRewards = 0;
        
        const rewardsEl = document.getElementById('pending-rewards');
        if (rewardsEl) {
            rewardsEl.textContent = pendingRewards.toFixed(3);
        }
        
        // Update Hive pending rewards if on Hive tab
        const pendingHbd = document.getElementById('pending-hbd');
        const pendingHive = document.getElementById('pending-hive');
        const pendingHp = document.getElementById('pending-hp');
        
        if (pendingHbd) pendingHbd.textContent = '0.000';
        if (pendingHive) pendingHive.textContent = '0.000';
        if (pendingHp) pendingHp.textContent = '0.000';
    } catch (error) {
        console.error('Failed to update rewards info:', error);
    }
}

// Video operations
async function selectVideo(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    if (!currentAccount) {
        showNotification('Please add an account first', 'error');
        event.target.value = '';
        return;
    }
    
    selectedVideo = {
        file: file,
        path: file.path || null,
        name: file.name,
        size: file.size
    };
    // Make it globally accessible
    window.selectedVideo = selectedVideo;
    
    try {
        // Show analyzing state
        document.getElementById('video-info').style.display = 'block';
        document.getElementById('video-details').innerHTML = `
            <div class="analyzing">
                <div class="spinner"></div>
                <p>Analyzing video file...</p>
            </div>
        `;
        
        // Analyze video (this will be mocked for now since we don't have FFmpeg in Electron)
        const info = await analyzeVideoFile(file);
        
        if (info) {
            document.getElementById('video-details').innerHTML = `
                <p><strong>File:</strong> ${file.name}</p>
                <p><strong>Size:</strong> ${formatBytes(file.size)}</p>
                <p><strong>Duration:</strong> ${info.duration || 'Unknown'}</p>
                <p><strong>Resolution:</strong> ${info.width || 'Unknown'}x${info.height || 'Unknown'}</p>
                <p><strong>Type:</strong> ${file.type || 'video/*'}</p>
            `;
            
            // Calculate storage cost based on file size
            const days = 30;
            const brocaCost = await calculateStorageCost(file.size);
            
            document.getElementById('video-details').innerHTML += `
                <p><strong>Estimated Storage Cost:</strong> ${brocaCost.toLocaleString()} BROCA (${days} days)</p>
            `;
            
            // Update upload options based on video info
            await updateVideoUploadOptions(info, brocaCost);
            document.getElementById('upload-options').style.display = 'block';
        }
    } catch (error) {
        console.error('Video analysis failed:', error);
        document.getElementById('video-details').innerHTML = `
            <p style="color: #ff6b6b;">⚠️ Failed to analyze video: ${error.message}</p>
            <p>You can still upload the file, but some features may not work properly.</p>
        `;
        
        // Show basic options even if analysis fails
        await updateVideoUploadOptions({ width: 1920, height: 1080 }, 0);
        document.getElementById('upload-options').style.display = 'block';
    }
}

async function startUpload() {
    if (!selectedVideo || !currentAccount) {
        showNotification('Please select a video and add an account first', 'error');
        return;
    }
    
    const uploadChoice = document.querySelector('input[name="upload-choice"]:checked')?.value;
    const directUpload = document.getElementById('direct-upload')?.checked || false;
    
    if (!uploadChoice) {
        showNotification('Please select an upload option', 'error');
        return;
    }
    
    // Check BROCA balance if direct upload is enabled
    if (directUpload) {
        const balance = await getCurrentBrocaBalance();
        const requiredBroca = await calculateStorageCost(selectedVideo.size);
        
        if (balance < requiredBroca) {
            showNotification(`Insufficient BROCA balance. Required: ${requiredBroca.toLocaleString()}, Available: ${balance.toFixed(0)}`, 'error');
            return;
        }
    }
    
    const options = {
        uploadChoice: uploadChoice,
        directUpload: directUpload,
        generateThumbnail: document.getElementById('gen-thumbnail')?.checked || true,
        resolutions: []
    };
    
    // Get selected resolutions if transcoding
    if (uploadChoice === 'transcode' || uploadChoice === 'both') {
        // Check if FFmpeg is available for transcoding
        if (!ffmpegAvailable) {
            showNotification('FFmpeg is required for video transcoding. Please install it first.', 'error');
            showFFmpegInstallNotice();
            return;
        }
        
        const resOptions = document.querySelectorAll('input[name="resolution"]:checked');
        resOptions.forEach(input => {
            options.resolutions.push(input.value);
        });
        
        if (options.resolutions.length === 0) {
            showNotification('Please select at least one resolution for transcoding', 'error');
            return;
        }
    }
    
    uploadInProgress = true;
    document.getElementById('upload-options').style.display = 'none';
    document.getElementById('upload-progress').style.display = 'block';
    
    // Reset progress
    updateUploadProgress(0, 'Preparing upload...');
    
    try {
        await processVideoUpload(selectedVideo, options);
    } catch (error) {
        console.error('Upload failed:', error);
        showNotification('Upload failed: ' + error.message, 'error');
        resetUpload();
    }
}

async function cancelUpload() {
    await window.api.video.cancelUpload();
    resetUpload();
}

function resetUpload() {
    uploadInProgress = false;
    document.getElementById('upload-progress').style.display = 'none';
    document.getElementById('upload-options').style.display = 'block';
    updateUploadProgress(0, 'Preparing...');
}

// IPFS operations
function updateIPFSMode(mode) {
    const internalConfig = document.getElementById('ipfs-internal-config');
    const externalConfig = document.getElementById('ipfs-external-config');
    
    if (mode === 'internal') {
        internalConfig.style.display = 'block';
        externalConfig.style.display = 'none';
    } else {
        internalConfig.style.display = 'none';
        externalConfig.style.display = 'block';
    }
}

async function chooseIPFSPath() {
    // In a real app, this would open a directory picker
    alert('Directory picker not implemented. Using default path.');
}

async function saveIPFSConfig() {
    const mode = document.querySelector('input[name="ipfs-mode"]:checked').value;
    const config = {
        externalNode: mode === 'external'
    };
    
    if (mode === 'external') {
        config.host = document.getElementById('ipfs-host').value;
        config.port = parseInt(document.getElementById('ipfs-port').value);
    } else {
        // Data path would be set via directory picker
        // For now, using default path
    }
    
    const result = await window.api.ipfs.updateConfig(config);
    if (result.success) {
        alert('IPFS configuration saved!');
    } else {
        alert('Failed to save configuration: ' + result.error);
    }
}

async function runIPFSGC() {
    const result = await window.api.ipfs.runGC();
    if (result) {
        alert('Garbage collection completed!');
        await refreshIPFSInfo();
    }
}

async function refreshIPFSInfo() {
    await updateIPFSInfo();
    
    try {
        // Update repo stats
        const repoStats = await window.api.ipfs.getRepoStats();
        if (repoStats) {
            document.getElementById('ipfs-repo-size').textContent = formatBytes(repoStats.repoSize);
            document.getElementById('ipfs-num-objects').textContent = repoStats.numObjects;
        }
        
        // Update bandwidth stats
        const bwStats = await window.api.ipfs.getBandwidth();
        if (bwStats) {
            document.getElementById('ipfs-bw-in').textContent = formatBytes(bwStats.totalIn);
            document.getElementById('ipfs-bw-out').textContent = formatBytes(bwStats.totalOut);
        }
    } catch (error) {
        // IPFS not running, ignore
        if (ipfsRunning) {
            console.error('Failed to refresh IPFS info:', error);
        }
    }
}

async function toggleIPFS() {
    if (ipfsRunning) {
        await window.api.ipfs.stop();
        ipfsRunning = false;
        document.getElementById('ipfs-status').textContent = 'Stopped';
        document.getElementById('ipfs-toggle').textContent = 'Start IPFS';
        document.getElementById('ipfs-info').style.display = 'none';
    } else {
        await window.api.ipfs.start();
        ipfsRunning = true;
        document.getElementById('ipfs-status').textContent = 'Running';
        document.getElementById('ipfs-toggle').textContent = 'Stop IPFS';
        document.getElementById('ipfs-info').style.display = 'block';
        updateIPFSInfo();
    }
}

// Check if external IPFS is already running
async function checkExternalIPFS() {
    try {
        console.log('Checking for external IPFS at 127.0.0.1:5001...');
        
        // Try to connect to external IPFS at default location
        const testResult = await window.api.ipfs.testConnection('127.0.0.1', 5001);
        
        if (testResult.success) {
            console.log('External IPFS detected! Configuring...');
            
            // Update config to use external node
            await window.api.ipfs.updateConfig({
                externalNode: true,
                host: '127.0.0.1',
                port: 5001
            });
            
            // Update UI to reflect external mode if elements exist
            const ipfsModeInput = document.querySelector('input[name="ipfs-mode"][value="external"]');
            if (ipfsModeInput) {
                ipfsModeInput.checked = true;
                updateIPFSMode('external');
                document.getElementById('ipfs-host').value = '127.0.0.1';
                document.getElementById('ipfs-port').value = '5001';
            }
            
            // Try to auto-start connection
            try {
                console.log('Auto-starting IPFS connection...');
                await window.api.ipfs.start();
                ipfsRunning = true;
                ipfsAutoDetected = true;
                
                // Update UI regardless of current tab
                const statusEl = document.getElementById('ipfs-status');
                const toggleEl = document.getElementById('ipfs-toggle');
                const infoEl = document.getElementById('ipfs-info');
                
                if (statusEl) statusEl.textContent = 'Running';
                if (toggleEl) toggleEl.textContent = 'Stop IPFS';
                if (infoEl) infoEl.style.display = 'block';
                
                // Update info if on IPFS tab
                if (currentTab === 'ipfs') {
                    await updateIPFSInfo();
                }
                
                console.log('IPFS auto-connected successfully!');
            } catch (startError) {
                console.error('Failed to auto-start IPFS:', startError);
            }
        } else {
            console.log('No external IPFS detected, will use internal mode');
        }
    } catch (error) {
        console.error('Error checking for external IPFS:', error);
    }
}

// Check IPFS connection status
async function checkIPFSStatus() {
    try {
        // Try to get node info to check if connected
        const info = await window.api.ipfs.getNodeInfo();
        if (info) {
            ipfsRunning = true;
            document.getElementById('ipfs-status').textContent = 'Running';
            document.getElementById('ipfs-toggle').textContent = 'Stop IPFS';
            document.getElementById('ipfs-info').style.display = 'block';
            await updateIPFSInfo();
        }
    } catch (error) {
        // Not connected
        ipfsRunning = false;
        document.getElementById('ipfs-status').textContent = 'Stopped';
        document.getElementById('ipfs-toggle').textContent = 'Start IPFS';
        document.getElementById('ipfs-info').style.display = 'none';
    }
}

async function updateIPFSInfo() {
    try {
        const info = await window.api.ipfs.getNodeInfo();
        console.log('IPFS Node Info received:', info); // Debug log
        
        if (info) {
            // Extract and display peer ID - kubo client returns lowercase keys
            const peerId = info.id || 'Unknown';
            document.getElementById('ipfs-id').textContent = peerId;
            
            // Extract and display version
            const versionEl = document.getElementById('ipfs-version');
            if (versionEl) {
                const version = info.agentVersion || 'Unknown';
                versionEl.textContent = version;
            }
            
            // Extract and display addresses - already converted to strings by getNodeInfo
            const addresses = info.addresses || [];
            if (addresses && addresses.length > 0) {
                const addressesHtml = addresses.map(addr => {
                    return `<code>${addr}</code>`;
                }).join('<br>');
                
                document.getElementById('ipfs-addresses').innerHTML = 
                    '<strong>Addresses:</strong><br>' + addressesHtml;
            } else {
                document.getElementById('ipfs-addresses').innerHTML = 
                    '<strong>Addresses:</strong><br><code>No addresses available</code>';
            }
        }
        
        // Get peer count
        try {
            const peers = await window.api.ipfs.getPeers();
            document.getElementById('ipfs-peers').textContent = peers.length;
        } catch (error) {
            console.error('Failed to get peers:', error);
            document.getElementById('ipfs-peers').textContent = '0';
        }
        
        // Get repository stats
        try {
            const repoStats = await window.api.ipfs.getRepoStats();
            if (repoStats) {
                document.getElementById('ipfs-repo-size').textContent = formatBytes(repoStats.repoSize);
                document.getElementById('ipfs-num-objects').textContent = repoStats.numObjects.toLocaleString();
            }
        } catch (error) {
            console.error('Failed to get repo stats:', error);
            document.getElementById('ipfs-repo-size').textContent = '--';
            document.getElementById('ipfs-num-objects').textContent = '--';
        }
        
        // Get bandwidth stats
        try {
            const bwStats = await window.api.ipfs.getBandwidth();
            if (bwStats) {
                document.getElementById('ipfs-bw-in').textContent = formatBytes(bwStats.totalIn);
                document.getElementById('ipfs-bw-out').textContent = formatBytes(bwStats.totalOut);
            }
        } catch (error) {
            console.error('Failed to get bandwidth stats:', error);
            document.getElementById('ipfs-bw-in').textContent = '--';
            document.getElementById('ipfs-bw-out').textContent = '--';
        }
        
    } catch (error) {
        // IPFS not started yet, ignore
        if (ipfsRunning) {
            console.error('Failed to get IPFS info:', error);
        }
    }
    
    // Load current config (this should work even if IPFS isn't running)
    try {
        const config = await window.api.ipfs.getConfig();
        if (config) {
            document.getElementById('ipfs-data-path').value = config.dataPath || '';
            if (config.externalNode) {
                document.querySelector('input[name="ipfs-mode"][value="external"]').checked = true;
                updateIPFSMode('external');
                document.getElementById('ipfs-host').value = config.host || '127.0.0.1';
                document.getElementById('ipfs-port').value = config.port || 5001;
            } else {
                document.querySelector('input[name="ipfs-mode"][value="internal"]').checked = true;
                updateIPFSMode('internal');
            }
        }
    } catch (error) {
        console.error('Failed to get IPFS config:', error);
    }
}

// Storage node operations
async function checkPOABinary() {
    const hasPoA = await window.api.storage.checkBinary();
    const statusEl = document.getElementById('poa-binary-status');
    const installBtn = document.getElementById('install-poa-btn');
    
    if (hasPoA) {
        statusEl.textContent = 'Installed';
        statusEl.style.color = 'green';
        installBtn.style.display = 'none';
    } else {
        statusEl.textContent = 'Not installed';
        statusEl.style.color = 'red';
        installBtn.style.display = 'inline-block';
    }
}

async function installPOA() {
    const btn = document.getElementById('install-poa-btn');
    btn.disabled = true;
    btn.textContent = 'Installing...';
    
    // Show logs area to see installation progress
    document.getElementById('storage-info').style.display = 'block';
    document.getElementById('poa-logs').innerHTML = '<div style="color: #ff0;">Installing ProofOfAccess...</div>';
    
    const result = await window.api.storage.installPOA();
    if (result.success) {
        await checkPOABinary();
        showNotification('POA installed successfully!', 'success');
    } else {
        // Show installation error modal with manual download option
        showPOAInstallError(result.error);
        btn.disabled = false;
        btn.textContent = 'Install POA';
    }
}

// Helper function to show POA installation error
function showPOAInstallError(error) {
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
    `;
    
    const content = document.createElement('div');
    content.style.cssText = `
        background: #2a2a2a;
        padding: 30px;
        border-radius: 8px;
        max-width: 600px;
        color: #fff;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
    `;
    
    const isGitError = error.includes('Git clone failed') || error.includes('git');
    const isGoError = error.includes('Go is not installed') || error.includes('go');
    
    let instructions = '';
    if (isGitError) {
        instructions = `
            <p>Git clone failed. This could be due to:</p>
            <ul style="margin: 10px 0 20px 20px; color: #ccc;">
                <li>Network connectivity issues</li>
                <li>Git not being installed</li>
                <li>GitHub access restrictions</li>
            </ul>
            <p>You can manually download POA from:</p>
        `;
    } else if (isGoError) {
        instructions = `
            <p>Go is required to build POA from source.</p>
            <p>Please install Go from <a href="https://golang.org" target="_blank" style="color: #4CAF50;">https://golang.org</a></p>
            <p>Or download a pre-built binary:</p>
        `;
    } else {
        instructions = `<p>Installation failed: ${error}</p><p>You can manually download POA from:</p>`;
    }
    
    content.innerHTML = `
        <h3 style="margin-top: 0; color: #ff5252;">⚠️ POA Installation Failed</h3>
        ${instructions}
        
        <div style="background: #1a1a1a; padding: 15px; border-radius: 4px; margin: 20px 0;">
            <a href="https://github.com/spknetwork/proofofaccess/releases" target="_blank" 
               style="color: #4CAF50; text-decoration: none; font-size: 16px;">
                🔗 GitHub Releases Page
            </a>
        </div>
        
        <p style="color: #999; font-size: 14px;">
            Download the appropriate binary for your system and place it at:<br>
            <code style="background: #333; padding: 4px 8px; border-radius: 4px;">~/.spk-desktop/poa/proofofaccess</code>
        </p>
        
        <div style="text-align: right; margin-top: 20px;">
            <button id="close-poa-error" style="
                background: #555;
                color: white;
                border: none;
                padding: 10px 20px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 16px;
            ">Close</button>
        </div>
    `;
    
    modal.appendChild(content);
    document.body.appendChild(modal);
    
    document.getElementById('close-poa-error').addEventListener('click', () => {
        document.body.removeChild(modal);
    });
    
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    });
}

async function checkRegistration() {
    if (!currentAccount) {
        alert('Please add an account first');
        return;
    }
    
    const result = await window.api.spk.checkRegistration(currentAccount);
    const statusEl = document.getElementById('spk-registration-status');
    const registerForm = document.getElementById('register-form');
    
    if (!result.success) {
        statusEl.innerHTML = `<span style="color: red">Error: ${result.error}</span>`;
        registerForm.style.display = 'none';
        return;
    }
    
    if (result.registered) {
        statusEl.innerHTML = `<span style="color: green">✓ Service Registered</span>`;
        registerForm.style.display = 'none';
        
        // Get IPFS info to validate registration
        try {
            const ipfsInfo = await window.api.ipfs.getNodeInfo();
            if (ipfsInfo && result.data) {
                const validation = await window.api.storage.validateRegistration(
                    ipfsInfo.id, 
                    result.data
                );
                
                if (!validation.valid) {
                    statusEl.innerHTML += `<br><span style="color: orange">⚠️ IPFS ID mismatch!</span>`;
                    statusEl.innerHTML += `<br><small>Current: ${ipfsInfo.id}</small>`;
                    statusEl.innerHTML += `<br><small>Registered: ${validation.registeredId || 'Unknown'}</small>`;
                    statusEl.innerHTML += `<br><small style="color: #888">You may need to update your registration or use the registered IPFS node</small>`;
                } else {
                    statusEl.innerHTML += `<br><span style="color: green">✓ IPFS ID matches</span>`;
                }
                
                // Show registration details
                if (result.data.domain) {
                    statusEl.innerHTML += `<br><small>Domain: ${result.data.domain}</small>`;
                }
                if (result.data.price) {
                    statusEl.innerHTML += `<br><small>Price: ${result.data.price} BROCA/GB/month</small>`;
                }
            }
        } catch (error) {
            console.error('Failed to validate registration:', error);
            statusEl.innerHTML += `<br><small style="color: orange">Could not validate IPFS ID (IPFS may not be running)</small>`;
        }
    } else {
        statusEl.innerHTML = '<span style="color: orange">No storage service registered</span>';
        statusEl.innerHTML += '<br><small style="color: #888">Register your IPFS node to earn storage rewards</small>';
        registerForm.style.display = 'block';
    }
}

async function registerStorageNode() {
    const domain = document.getElementById('storage-domain').value.trim();
    const price = 2000; // Fixed registration fee
    
    // Check if wallet is locked
    if (!isAuthenticated) {
        showNotification('Please unlock your wallet first', 'warning');
        showAccountManager();
        return;
    }
    
    // Get IPFS node ID
    const ipfsInfo = await window.api.ipfs.getNodeInfo();
    if (!ipfsInfo || !ipfsInfo.id) {
        alert('IPFS node must be running to register storage node');
        return;
    }
    
    // Use empty string for domain if not provided (P2P only node)
    const nodeDomain = domain || '';
    
    const confirmMsg = domain 
        ? `Register storage node with domain ${domain}\n\nRegistration fee: ${price} BROCA (one-time)`
        : `Register P2P storage node (no public gateway)\n\nRegistration fee: ${price} BROCA (one-time)\n\nNote: P2P nodes work behind NAT and earn rewards for storing files.`;
    
    if (!confirm(confirmMsg)) return;
    
    const result = await window.api.spk.registerStorage(ipfsInfo.id, nodeDomain, price);
    if (result.success) {
        showNotification('Storage node registered successfully!', 'success');
        await checkRegistration();
    } else {
        alert('Registration failed: ' + result.error);
    }
}


async function saveStorageConfig() {
    const maxStorage = parseInt(document.getElementById('max-storage').value);
    const unit = document.getElementById('storage-unit').value;
    const pricing = parseInt(document.getElementById('storage-pricing').value);
    
    // Convert to bytes
    const multiplier = unit === 'TB' ? 1024 * 1024 * 1024 * 1024 : 1024 * 1024 * 1024;
    const maxStorageBytes = maxStorage * multiplier;
    
    const config = {
        nodeType: 2, // Always storage node
        maxStorage: maxStorageBytes,
        pricing: pricing
    };
    
    const result = await window.api.storage.updateConfig(config);
    if (result.success) {
        showNotification('Storage configuration saved!', 'success');
    } else {
        showNotification(`Failed to save configuration: ${result.error}`, 'error');
    }
}

async function toggleStorage() {
    if (!currentAccount) {
        alert('Please add an account first');
        return;
    }
    
    const toggleBtn = document.getElementById('storage-toggle');
    toggleBtn.disabled = true;
    
    if (storageRunning) {
        toggleBtn.textContent = 'Stopping...';
        try {
            await window.api.storage.stop();
            storageRunning = false;
            document.getElementById('storage-status').textContent = 'Stopped';
            document.getElementById('storage-toggle').textContent = 'Start Storage Node';
            document.getElementById('storage-info').style.display = 'none';
            document.getElementById('storage-persistent-notice').style.display = 'none';
            
            // Clear logs
            document.getElementById('poa-logs').innerHTML = '<div style="color: #666;">Waiting for logs...</div>';
        } catch (error) {
            alert('Failed to stop storage node: ' + error.message);
        }
        toggleBtn.disabled = false;
    } else {
        toggleBtn.textContent = 'Starting...';
        document.getElementById('storage-status').textContent = 'Starting...';
        
        // Check if IPFS is running and PubSub is enabled
        if (!ipfsRunning) {
            alert('IPFS must be running to start the storage node');
            toggleBtn.textContent = 'Start Storage Node';
            toggleBtn.disabled = false;
            document.getElementById('storage-status').textContent = 'Stopped';
            return;
        }
        
        // Check if IPFS is local
        const ipfsConfig = await window.api.ipfs.getConfig();
        if (ipfsConfig.host && ipfsConfig.host !== '127.0.0.1' && ipfsConfig.host !== 'localhost') {
            showNotification('POA only supports local IPFS nodes. Please switch to internal IPFS mode or connect to a local IPFS instance.', 'error');
            toggleBtn.textContent = 'Start Storage Node';
            toggleBtn.disabled = false;
            document.getElementById('storage-status').textContent = 'External IPFS not supported';
            return;
        }
        
        // Check PubSub
        const pubsubCheck = await window.api.ipfs.checkPubSub();
        if (pubsubCheck.success && !pubsubCheck.enabled) {
            const enable = await showPubSubPrompt();
            
            if (enable) {
                const enableResult = await window.api.ipfs.enablePubSub();
                if (!enableResult.success) {
                    showPubSubInstructions();
                    toggleBtn.textContent = 'Start Storage Node';
                    toggleBtn.disabled = false;
                    document.getElementById('storage-status').textContent = 'Stopped';
                    return;
                }
                alert('PubSub enabled. Please restart IPFS for changes to take effect.');
                toggleBtn.textContent = 'Start Storage Node';
                toggleBtn.disabled = false;
                document.getElementById('storage-status').textContent = 'Stopped';
                return;
            } else {
                toggleBtn.textContent = 'Start Storage Node';
                toggleBtn.disabled = false;
                document.getElementById('storage-status').textContent = 'Stopped';
                return;
            }
        }
        
        // Show info panel immediately to see logs
        document.getElementById('storage-info').style.display = 'block';
        document.getElementById('poa-logs').innerHTML = '<div style="color: #ff0;">Starting POA node...</div>';
        
        const result = await window.api.storage.start();
        if (result.success) {
            storageRunning = true;
            document.getElementById('storage-status').textContent = 'Running';
            document.getElementById('storage-toggle').textContent = 'Stop Storage Node';
            
            // Start auto-refresh
            updateStorageInfo();
            storageRefreshInterval = setInterval(updateStorageInfo, 5000);
        } else {
            document.getElementById('storage-status').textContent = 'Failed';
            document.getElementById('storage-toggle').textContent = 'Start Storage Node';
            document.getElementById('poa-logs').innerHTML += 
                `<div style="color: #f00;">Error: ${escapeHtml(result.error)}</div>`;
            alert('Failed to start storage node: ' + result.error);
        }
        toggleBtn.disabled = false;
    }
}

async function updateStorageInfo() {
    try {
        // Check IPFS status and configuration
        const storageTab = document.getElementById('storage-tab');
        if (storageTab && storageTab.classList.contains('active')) {
            const ipfsConfig = await window.api.ipfs.getConfig();
            const isLocalIPFS = ipfsRunning && ipfsConfig.host && 
                               (ipfsConfig.host === '127.0.0.1' || ipfsConfig.host === 'localhost');
            
            // Disable/enable POA controls based on local IPFS availability
            const storageToggle = document.getElementById('storage-toggle');
            const installPOABtn = document.getElementById('install-poa-btn');
            const checkRegBtn = document.querySelector('[onclick="checkRegistration()"]');
            const regStorageBtn = document.querySelector('[onclick="registerStorageNode()"]');
            const saveConfigBtn = document.querySelector('[onclick="saveStorageConfig()"]');
            
            if (!isLocalIPFS) {
                // Disable all POA controls
                if (storageToggle) {
                    storageToggle.disabled = true;
                    storageToggle.title = 'Requires local IPFS node';
                }
                if (installPOABtn) {
                    installPOABtn.disabled = true;
                    installPOABtn.title = 'Requires local IPFS node';
                }
                if (checkRegBtn) {
                    checkRegBtn.disabled = true;
                    checkRegBtn.title = 'Requires local IPFS node';
                }
                if (regStorageBtn) {
                    regStorageBtn.disabled = true;
                    regStorageBtn.title = 'Requires local IPFS node';
                }
                if (saveConfigBtn) {
                    saveConfigBtn.disabled = true;
                    saveConfigBtn.title = 'Requires local IPFS node';
                }
                
                // Show warning banner
                const warningBanner = document.getElementById('storage-external-warning');
                if (!warningBanner) {
                    const setupPanel = document.getElementById('storage-setup');
                    const warning = document.createElement('div');
                    warning.id = 'storage-external-warning';
                    warning.style.cssText = 'background: #ff5252; color: #fff; padding: 15px; border-radius: 4px; margin: 10px 0; text-align: center;';
                    
                    if (!ipfsRunning) {
                        warning.innerHTML = `
                            <strong>⚠️ IPFS Not Running</strong><br>
                            POA requires a local IPFS node to function.<br>
                            Please start IPFS from the IPFS Node tab.
                        `;
                    } else {
                        warning.innerHTML = `
                            <strong>⚠️ External IPFS Detected</strong><br>
                            POA requires a local IPFS node. Current: ${ipfsConfig.host}:${ipfsConfig.port}<br>
                            Please switch to internal IPFS mode or connect to localhost.
                        `;
                    }
                    setupPanel.insertBefore(warning, setupPanel.firstChild);
                }
                
                // Update status
                document.getElementById('storage-status').innerHTML = 
                    '<span style="color: #ff5252">Local IPFS Required</span>';
            } else {
                // Enable POA controls
                if (storageToggle && !storageRunning) {
                    storageToggle.disabled = false;
                    storageToggle.title = '';
                }
                if (installPOABtn) {
                    installPOABtn.disabled = false;
                    installPOABtn.title = '';
                }
                if (checkRegBtn) {
                    checkRegBtn.disabled = false;
                    checkRegBtn.title = '';
                }
                if (regStorageBtn) {
                    regStorageBtn.disabled = false;
                    regStorageBtn.title = '';
                }
                if (saveConfigBtn) {
                    saveConfigBtn.disabled = false;
                    saveConfigBtn.title = '';
                }
                
                // Remove warning if present
                const warningBanner = document.getElementById('storage-external-warning');
                if (warningBanner) {
                    warningBanner.remove();
                }
                
                // Update status if not running
                if (!storageRunning) {
                    document.getElementById('storage-status').textContent = 'Stopped';
                }
            }
        }
        
        if (!storageRunning) return;
        
        const stats = await window.api.storage.getStats();
        if (stats) {
            document.getElementById('storage-used').textContent = formatBytes(stats.spaceUsed);
            document.getElementById('storage-available').textContent = formatBytes(stats.spaceAvailable);
            document.getElementById('storage-files').textContent = stats.filesStored;
        }
        
        const earnings = await window.api.storage.getEarnings();
        if (earnings) {
            document.getElementById('storage-earned').textContent = earnings.totalEarned.toFixed(3);
            document.getElementById('storage-validations').textContent = earnings.validations;
            if (earnings.lastValidation) {
                const date = new Date(earnings.lastValidation);
                document.getElementById('last-validation').textContent = date.toLocaleString();
            }
        }
        
        const status = await window.api.storage.getStatus();
        if (status) {
            document.getElementById('spk-connected').textContent = status.connected ? 'Yes' : 'No';
            document.getElementById('ws-status').textContent = status.connected ? 'Connected' : 'Disconnected';
            document.getElementById('storage-contracts').textContent = status.stats?.filesStored || 0;
            document.getElementById('poa-version').textContent = status.version || 'Unknown';
            
            // Show update notification
            if (status.updateAvailable) {
                document.getElementById('update-available').innerHTML = 
                    '<a href="#" onclick="alert(\'New version available! Please update POA.\')">Update available!</a>';
            }
            
            // Update logs
            if (status.logs && status.logs.length > 0) {
                const logsEl = document.getElementById('poa-logs');
                logsEl.innerHTML = status.logs.map(log => 
                    `<div style="color: ${log.includes('ERROR') ? '#f00' : '#0f0'}">${escapeHtml(log)}</div>`
                ).join('');
                logsEl.scrollTop = logsEl.scrollHeight;
            }
        }
        
        // Update contract monitor status
        await updateContractMonitorStatus();
    } catch (error) {
        console.error('Failed to update storage info:', error);
    }
}

// Helper function to escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Helper function to check wallet status before actions
function requireWallet() {
    if (!isAuthenticated) {
        showNotification('Please unlock your wallet to continue', 'warning');
        showAccountManager();
        return false;
    }
    return true;
}

async function refreshStorageInfo() {
    await updateStorageInfo();
}

async function viewContracts() {
    document.getElementById('contracts-modal').style.display = 'block';
    document.getElementById('contracts-list').innerHTML = '<p>Loading contracts...</p>';
    
    try {
        const contracts = await window.api.contracts.getContracts();
        
        if (contracts && contracts.length > 0) {
            let html = '<table style="width: 100%; border-collapse: collapse;">';
            html += '<tr><th>Contract ID</th><th>Type</th><th>CIDs</th><th>Size</th></tr>';
            
            for (const contract of contracts) {
                const cids = contract.cid || contract.meta?.cids || '-';
                const size = contract.size ? `${(contract.size / 1024 / 1024).toFixed(2)} MB` : '-';
                html += `<tr>`;
                html += `<td>${contract.id}</td>`;
                html += `<td>${contract.type}</td>`;
                html += `<td style="font-family: monospace; font-size: 11px;">${cids}</td>`;
                html += `<td>${size}</td>`;
                html += `</tr>`;
            }
            
            html += '</table>';
            document.getElementById('contracts-list').innerHTML = html;
        } else {
            document.getElementById('contracts-list').innerHTML = '<p>No active contracts</p>';
        }
    } catch (error) {
        document.getElementById('contracts-list').innerHTML = `<p style="color: red;">Error loading contracts: ${error.message}</p>`;
    }
}

function closeContractsModal() {
    document.getElementById('contracts-modal').style.display = 'none';
}

async function viewFullLogs() {
    try {
        const logs = await window.api.storage.getRecentLogs(500);
        const logsWindow = window.open('', 'POA Logs', 'width=800,height=600');
        logsWindow.document.write(`
            <html>
            <head>
                <title>POA Storage Node Logs</title>
                <style>
                    body { 
                        background: #000; 
                        color: #0f0; 
                        font-family: monospace; 
                        padding: 20px;
                        margin: 0;
                    }
                    pre { 
                        white-space: pre-wrap; 
                        word-wrap: break-word; 
                    }
                    .error { color: #f00; }
                    .warn { color: #ff0; }
                    .info { color: #0f0; }
                </style>
            </head>
            <body>
                <h2>POA Storage Node Logs</h2>
                <pre>${logs.map(log => {
                    const colorClass = log.includes('ERROR') ? 'error' : 
                                      log.includes('WARN') ? 'warn' : 'info';
                    return `<span class="${colorClass}">${escapeHtml(log)}</span>`;
                }).join('\n')}</pre>
            </body>
            </html>
        `);
    } catch (error) {
        alert('Failed to load logs: ' + error.message);
    }
}

// Contract monitoring functions
async function checkContractsNow() {
    const btn = event.target;
    btn.disabled = true;
    btn.textContent = 'Checking...';
    
    try {
        const result = await window.api.contracts.checkNow();
        if (result.success) {
            showNotification('Contract check completed', 'success');
            await updateContractMonitorStatus();
        } else {
            showNotification('Contract check failed: ' + result.error, 'error');
        }
    } catch (error) {
        showNotification('Failed to check contracts: ' + error.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Check Now';
    }
}

async function viewPinnedCIDs() {
    try {
        const cids = await window.api.contracts.getPinnedCIDs();
        
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.display = 'block';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 800px; max-height: 600px; overflow: auto;">
                <h3>Pinned CIDs (${cids.length})</h3>
                <div style="font-family: monospace; font-size: 12px;">
                    ${cids.length > 0 ? cids.map(cid => `<div>${cid}</div>`).join('') : '<p>No CIDs pinned</p>'}
                </div>
                <button onclick="this.parentElement.parentElement.remove()" class="btn btn-sm" style="margin-top: 20px;">Close</button>
            </div>
        `;
        document.body.appendChild(modal);
        
        // Close on click outside
        modal.onclick = (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        };
    } catch (error) {
        showNotification('Failed to load pinned CIDs: ' + error.message, 'error');
    }
}

async function updateContractMonitorStatus() {
    try {
        const status = await window.api.contracts.getStatus();
        
        document.getElementById('monitor-status').textContent = status.monitoring ? 'Running' : 'Not running';
        document.getElementById('monitor-contracts').textContent = status.contracts || 0;
        document.getElementById('monitor-pinned').textContent = status.pinnedCIDs || 0;
        
        // Update storage info as well
        const storageStats = await window.api.storage.getStats();
        document.getElementById('storage-contracts').textContent = status.contracts || 0;
    } catch (error) {
        console.error('Failed to update contract monitor status:', error);
    }
}

// Update resolution options based on video info
// Video analysis functions
async function analyzeVideoFile(file) {
    return new Promise((resolve) => {
        const video = document.createElement('video');
        video.onloadedmetadata = () => {
            resolve({
                width: video.videoWidth || 1920,
                height: video.videoHeight || 1080,
                duration: formatDuration(video.duration || 0)
            });
        };
        video.onerror = () => {
            // Fallback for unsupported formats
            resolve({
                width: 1920,
                height: 1080,
                duration: 'Unknown'
            });
        };
        video.src = URL.createObjectURL(file);
    });
}

async function calculateStorageCost(bytes, options = {}) {
    try {
        // Use SPK client to calculate with live network stats
        const result = await window.api.invoke('spk:calculateBrocaCost', bytes, options);
        if (result.success) {
            return result.data.broca || result.data.cost || 0;
        } else {
            // Fallback to default calculation if API fails
            console.warn('Failed to get live BROCA cost, using fallback:', result.error);
            return Math.ceil(bytes / 1024);
        }
    } catch (error) {
        console.error('Error calculating BROCA cost:', error);
        // Fallback calculation: 1 BROCA per 1024 bytes
        return Math.ceil(bytes / 1024);
    }
}

async function getCurrentBrocaBalance() {
    try {
        const balance = await window.api.balance.get(false);
        return parseFloat(balance?.broca || 0);
    } catch (error) {
        console.error('Failed to get BROCA balance:', error);
        return 0;
    }
}

async function checkDirectUploadAvailability() {
    try {
        // Check if IPFS is running (try to get node info)
        let ipfsRunning = false;
        try {
            const ipfsInfo = await window.api.ipfs.getNodeInfo();
            ipfsRunning = !!ipfsInfo && !!ipfsInfo.id;
        } catch (e) {
            ipfsRunning = false;
        }
        
        if (!ipfsRunning) {
            return { available: false, reason: 'IPFS node not running or accessible' };
        }
        
        // Check if POA storage node is running
        const storageStatus = await window.api.storage.getStatus();
        if (!storageStatus || !storageStatus.running) {
            return { available: false, reason: 'Storage node not running' };
        }
        
        // Check if registered with SPK network
        if (!currentAccount) {
            return { available: false, reason: 'No account selected' };
        }
        
        const registration = await window.api.spk.checkRegistration(currentAccount);
        if (!registration || !registration.registered) {
            return { available: false, reason: 'Storage node not registered with SPK Network' };
        }
        
        return { available: true };
    } catch (error) {
        console.error('Failed to check direct upload availability:', error);
        return { available: false, reason: 'Unable to check prerequisites: ' + error.message };
    }
}

async function updateVideoUploadOptions(videoInfo, brocaCost) {
    const optionsContainer = document.getElementById('upload-options');
    const height = videoInfo.height || 1080;
    
    // Define available resolutions
    const resolutions = [
        { name: '2160p (4K)', value: '2160p', height: 2160 },
        { name: '1440p', value: '1440p', height: 1440 },
        { name: '1080p (Full HD)', value: '1080p', height: 1080 },
        { name: '720p (HD)', value: '720p', height: 720 },
        { name: '480p', value: '480p', height: 480 },
        { name: '360p', value: '360p', height: 360 },
        { name: '240p', value: '240p', height: 240 }
    ];
    
    // Filter resolutions that are lower than or equal to source
    const availableResolutions = resolutions.filter(res => res.height <= height);
    
    // If source is already low res, add at least one option
    if (availableResolutions.length === 0) {
        availableResolutions.push({ name: `${height}p (Original)`, value: `${height}p`, height: height });
    }
    
    // Generate resolution checkboxes
    const resolutionCheckboxes = availableResolutions.map((res, index) => `
        <label class="resolution-option">
            <input type="checkbox" name="resolution" value="${res.value}" ${index === 0 ? 'checked' : ''}> 
            ${res.name}
        </label>
    `).join('');
    
    // Check direct upload availability
    const directUploadCheck = await checkDirectUploadAvailability();
    const directUploadSection = directUploadCheck.available ? `
        <div class="direct-upload-section">
            <label class="direct-upload-option">
                <input type="checkbox" id="direct-upload"> 
                <strong>Direct Upload to Storage Network</strong>
                <small>Upload directly to your storage node and earn rewards</small>
            </label>
            <div class="direct-upload-info">
                ✓ IPFS node running<br>
                ✓ Storage node registered<br>
                ✓ Ready to earn storage rewards
            </div>
        </div>
    ` : `
        <div class="direct-upload-section disabled">
            <label class="direct-upload-option disabled">
                <input type="checkbox" id="direct-upload" disabled> 
                <strong>Direct Upload to Storage Network</strong>
                <small>Prerequisites not met</small>
            </label>
            <div class="direct-upload-info error">
                ⚠️ ${directUploadCheck.reason}
            </div>
        </div>
    `;
    
    // Update the options panel
    optionsContainer.innerHTML = `
        <h3>Upload Options</h3>
        
        <div class="upload-choice-section">
            <h4>What would you like to upload?</h4>
            <div class="upload-choices">
                <label class="upload-choice">
                    <input type="radio" name="upload-choice" value="original" checked>
                    <strong>Original File Only</strong>
                    <small>Upload the video as-is without transcoding</small>
                </label>
                <label class="upload-choice">
                    <input type="radio" name="upload-choice" value="transcode">
                    <strong>Transcoded Streaming Version</strong>
                    <small>Convert to HLS format for better streaming (recommended)</small>
                </label>
                <label class="upload-choice">
                    <input type="radio" name="upload-choice" value="both">
                    <strong>Both Original and Transcoded</strong>
                    <small>Upload both versions (uses more storage)</small>
                </label>
            </div>
        </div>
        
        <div class="transcoding-section" id="transcoding-section" style="display: none;">
            <h4>Transcoding Options</h4>
            <div class="resolution-info">
                <p>Source Resolution: ${videoInfo.width || 'Unknown'}x${videoInfo.height || 'Unknown'}</p>
                <p>Select output resolutions (will not upscale):</p>
            </div>
            <div class="resolution-options">
                ${resolutionCheckboxes}
            </div>
        </div>
        
        ${directUploadSection}
        
        <div class="additional-options">
            <label>
                <input type="checkbox" id="gen-thumbnail" checked> Generate Thumbnail
            </label>
        </div>
        
        <div class="upload-actions">
            <button onclick="startUpload()" class="btn btn-primary">Start Upload</button>
            <button onclick="cancelVideoSelection()" class="btn btn-secondary">Cancel</button>
        </div>
    `;
    
    // Add event listeners for dynamic sections
    document.querySelectorAll('input[name="upload-choice"]').forEach(radio => {
        radio.addEventListener('change', function() {
            const transcodingSection = document.getElementById('transcoding-section');
            if (this.value === 'transcode' || this.value === 'both') {
                transcodingSection.style.display = 'block';
            } else {
                transcodingSection.style.display = 'none';
            }
        });
    });
}

function cancelVideoSelection() {
    selectedVideo = null;
    document.getElementById('video-input').value = '';
    document.getElementById('video-info').style.display = 'none';
    document.getElementById('upload-options').style.display = 'none';
    document.getElementById('upload-progress').style.display = 'none';
}

function updateUploadProgress(percent, message, stage = null) {
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');
    
    if (progressFill) {
        progressFill.style.width = percent + '%';
    }
    
    if (progressText) {
        progressText.textContent = stage ? `${stage}: ${message}` : message;
    }
}

// Safe addLog function that checks if the real one exists
function safeAddLog(message, type = 'info') {
    if (typeof window.addLog === 'function') {
        window.addLog(message, type);
    } else {
        console.log(`[${type.toUpperCase()}] ${message}`);
    }
}

async function processVideoUpload(video, options) {
    // Store options for later use
    window.currentUploadOptions = options;
    
    // Change progress title
    document.getElementById('progress-title').textContent = 'Processing Video';
    
    // Clear previous logs
    const logsContainer = document.getElementById('processing-logs');
    if (logsContainer) {
        logsContainer.innerHTML = '';
    }
    
    try {
        if (options.uploadChoice === 'original') {
            // Skip transcoding, go directly to preview
            updateUploadProgress(100, 'Original file ready for upload', 'Processing');
            
            setTimeout(() => {
                showOriginalVideoPreview(video);
            }, 1000);
            
        } else {
            // Transcode the video using FFmpeg
            safeAddLog('Starting video transcoding...', 'info');
            
            try {
                // Wait for video processing functions to be available
                let attempts = 0;
                while (typeof window.transcodeToHLS !== 'function' && attempts < 20) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    attempts++;
                }
                
                if (typeof window.transcodeToHLS !== 'function') {
                    throw new Error('Video processing functions failed to load. Please refresh the page.');
                }
                
                const result = await window.transcodeToHLS(video.file, options);
                
                if (result.success) {
                    updateUploadProgress(100, 'Transcoding completed successfully!', 'Processing');
                    safeAddLog('Transcoding completed! Generated HLS files', 'info');
                    
                    // Show preview after a short delay
                    setTimeout(() => {
                        if (typeof window.showVideoPreview === 'function') {
                            window.showVideoPreview(result);
                        } else {
                            throw new Error('showVideoPreview function not loaded');
                        }
                    }, 1500);
                } else {
                    throw new Error('Transcoding failed');
                }
                
            } catch (transcodingError) {
                safeAddLog(`Transcoding error: ${transcodingError.message}`, 'error');
                throw new Error(`Video transcoding failed: ${transcodingError.message}`);
            }
        }
        
    } catch (error) {
        console.error('Video processing failed:', error);
        safeAddLog(`Processing failed: ${error.message}`, 'error');
        throw error;
    }
}

// Show preview for original video without transcoding
function showOriginalVideoPreview(video) {
    // Hide processing panel, show preview panel
    document.getElementById('upload-progress').style.display = 'none';
    document.getElementById('video-preview').style.display = 'block';
    
    // Set up simple video preview for original file
    const videoPlayer = document.getElementById('preview-player');
    const fileUrl = URL.createObjectURL(video.file);
    videoPlayer.src = fileUrl;
    
    // Show file info
    const filesList = document.getElementById('generated-files-list');
    filesList.innerHTML = `
        <div class="file-item">
            <span class="filename">${video.file.name}</span>
            <span class="filesize">${formatBytes(video.file.size)}</span>
        </div>
    `;
    
    // Show message instead of m3u8
    document.getElementById('m3u8-content').textContent = 
        'Original video file - no transcoding performed.\nFile will be uploaded as-is.';
    
    safeAddLog('Original video ready for preview', 'info');
}
function updateResolutionOptions(videoInfo) {
    // Legacy function - now handled by updateVideoUploadOptions
    updateVideoUploadOptions(videoInfo, 0);
}

// Additional CSS for video upload UI
function addVideoUploadStyles() {
    const style = document.createElement('style');
    style.textContent = `
        .video-transcoder {
            background: #2a2a2a;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
        }
        
        .upload-choice-section {
            margin-bottom: 20px;
        }
        
        .upload-choices {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        
        .upload-choice {
            display: flex;
            flex-direction: column;
            padding: 15px;
            border: 2px solid #3a3a3a;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s;
        }
        
        .upload-choice:hover {
            border-color: #4CAF50;
            background: rgba(76, 175, 80, 0.1);
        }
        
        .upload-choice input[type="radio"] {
            margin-right: 10px;
        }
        
        .upload-choice small {
            color: #999;
            margin-top: 5px;
        }
        
        .transcoding-section {
            background: #1a1a1a;
            padding: 15px;
            border-radius: 8px;
            margin: 20px 0;
        }
        
        .resolution-options {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 10px;
            margin: 10px 0;
        }
        
        .resolution-option {
            padding: 8px;
            border: 1px solid #3a3a3a;
            border-radius: 4px;
            cursor: pointer;
            transition: background 0.2s;
        }
        
        .resolution-option:hover {
            background: rgba(76, 175, 80, 0.1);
        }
        
        .direct-upload-section {
            background: #1a3a1a;
            border: 2px solid #4CAF50;
            padding: 15px;
            border-radius: 8px;
            margin: 20px 0;
        }
        
        .direct-upload-section.disabled {
            background: #3a1a1a;
            border-color: #666;
            opacity: 0.6;
        }
        
        .direct-upload-option {
            display: flex;
            flex-direction: column;
            cursor: pointer;
        }
        
        .direct-upload-option.disabled {
            cursor: not-allowed;
        }
        
        .direct-upload-info {
            font-size: 12px;
            margin-top: 8px;
            padding: 8px;
            background: rgba(0, 0, 0, 0.3);
            border-radius: 4px;
        }
        
        .direct-upload-info.error {
            color: #ff6b6b;
        }
        
        .upload-actions {
            display: flex;
            gap: 10px;
            margin-top: 20px;
        }
        
        .analyzing {
            display: flex;
            align-items: center;
            gap: 10px;
            color: #999;
        }
        
        .spinner {
            width: 20px;
            height: 20px;
            border: 2px solid #3a3a3a;
            border-top: 2px solid #4CAF50;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        .progress-panel {
            background: #1a1a1a;
            padding: 20px;
            border-radius: 8px;
            margin: 20px 0;
        }
        
        .progress-bar {
            width: 100%;
            height: 20px;
            background: #3a3a3a;
            border-radius: 10px;
            overflow: hidden;
            margin: 10px 0;
        }
        
        .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #4CAF50, #45a049);
            transition: width 0.3s ease;
            border-radius: 10px;
        }
    `;
    document.head.appendChild(style);
}

// Initialize video upload styles when DOM loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addVideoUploadStyles);
} else {
    addVideoUploadStyles();
}

// Utility functions
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function formatBitrate(bitrate) {
    if (bitrate > 1000000) {
        return (bitrate / 1000000).toFixed(2) + ' Mbps';
    }
    return (bitrate / 1000).toFixed(2) + ' Kbps';
}

// Notification system
function showNotification(message, type = 'info', duration = 5000) {
    // Remove existing notifications
    const existingNotifications = document.querySelectorAll('.notification');
    existingNotifications.forEach(n => n.remove());
    
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : '#2196F3'};
        color: white;
        padding: 15px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        z-index: 10000;
        max-width: 400px;
        word-wrap: break-word;
        opacity: 0;
        transform: translateX(100%);
        transition: all 0.3s ease;
    `;
    
    notification.textContent = message;
    document.body.appendChild(notification);
    
    // Animate in
    setTimeout(() => {
        notification.style.opacity = '1';
        notification.style.transform = 'translateX(0)';
    }, 10);
    
    // Auto remove
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, duration);
    
    // Click to dismiss
    notification.addEventListener('click', () => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    });
}

// IPC event listeners (legacy - kept for compatibility)
if (window.api && window.api.on) {
    window.api.on('upload:progress', (progress) => {
        updateUploadProgress(progress.percent, progress.stage);
        
        if (progress.stage === 'completed') {
            showNotification('Upload completed successfully!', 'success');
            resetUpload();
            cancelVideoSelection();
        }
    });
    
    window.api.on('upload:error', (error) => {
        showNotification('Upload error: ' + error.message, 'error');
        resetUpload();
    });
}

window.api.on('ipfs:peer:connect', (peer) => {
    if (ipfsRunning) {
        updateIPFSInfo();
    }
});

window.api.on('ipfs:peer:disconnect', (peer) => {
    if (ipfsRunning) {
        updateIPFSInfo();
    }
});

window.api.on('storage:validation', (validation) => {
    console.log('Storage validation:', validation);
    if (storageRunning) {
        // Update validation count
        const validationsEl = document.getElementById('storage-validations');
        if (validationsEl) {
            const current = parseInt(validationsEl.textContent) || 0;
            validationsEl.textContent = current + 1;
        }
        document.getElementById('last-validation').textContent = new Date().toLocaleString();
    }
});

window.api.on('storage:contract', (contract) => {
    console.log('New storage contract:', contract);
    if (storageRunning) {
        updateStorageInfo();
    }
});

// Helper function to show PubSub prompt modal
function showPubSubPrompt() {
    return new Promise((resolve) => {
        // Create modal overlay
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;
        
        // Create modal content
        const content = document.createElement('div');
        content.style.cssText = `
            background: #2a2a2a;
            padding: 30px;
            border-radius: 8px;
            max-width: 500px;
            color: #fff;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        `;
        
        content.innerHTML = `
            <h3 style="margin-top: 0; color: #ff9800;">⚠️ IPFS PubSub Required</h3>
            <p>The POA storage node requires IPFS PubSub to be enabled for proper communication with the SPK Network.</p>
            
            <div style="background: #1a1a1a; padding: 15px; border-radius: 4px; margin: 20px 0;">
                <p style="margin: 0; color: #999;">PubSub allows your node to:</p>
                <ul style="margin: 10px 0 0 20px; color: #ccc;">
                    <li>Receive validation requests</li>
                    <li>Communicate with other storage nodes</li>
                    <li>Participate in the consensus network</li>
                </ul>
            </div>
            
            <p style="color: #999; font-size: 14px;">Would you like to enable PubSub now? You may need to restart IPFS after enabling.</p>
            
            <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
                <button id="pubsub-cancel" style="
                    background: #555;
                    color: white;
                    border: none;
                    padding: 10px 20px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 16px;
                ">Cancel</button>
                <button id="pubsub-enable" style="
                    background: #4CAF50;
                    color: white;
                    border: none;
                    padding: 10px 20px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 16px;
                ">Enable PubSub</button>
            </div>
        `;
        
        modal.appendChild(content);
        document.body.appendChild(modal);
        
        // Add event listeners
        document.getElementById('pubsub-enable').addEventListener('click', () => {
            document.body.removeChild(modal);
            resolve(true);
        });
        
        document.getElementById('pubsub-cancel').addEventListener('click', () => {
            document.body.removeChild(modal);
            resolve(false);
        });
        
        // Close on backdrop click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
                resolve(false);
            }
        });
    });
}

// Helper function to show PubSub instructions with copy button
function showPubSubInstructions() {
    // Create modal overlay
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
    `;
    
    // Create modal content
    const content = document.createElement('div');
    content.style.cssText = `
        background: #2a2a2a;
        padding: 30px;
        border-radius: 8px;
        max-width: 500px;
        color: #fff;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
    `;
    
    const command = 'ipfs config --json Pubsub.Enabled true';
    
    content.innerHTML = `
        <h3 style="margin-top: 0; color: #ff9800;">Enable IPFS PubSub</h3>
        <p>Failed to enable PubSub automatically. Please run this command manually:</p>
        
        <div style="background: #1a1a1a; padding: 15px; border-radius: 4px; margin: 20px 0; font-family: monospace; position: relative;">
            <code id="pubsub-command" style="color: #4CAF50; word-break: break-all;">${command}</code>
            <button id="copy-pubsub-cmd" style="
                position: absolute;
                top: 10px;
                right: 10px;
                background: #4CAF50;
                color: white;
                border: none;
                padding: 5px 10px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 12px;
            ">Copy</button>
        </div>
        
        <p style="color: #999; font-size: 14px;">After running the command, restart IPFS for changes to take effect.</p>
        
        <div style="text-align: right; margin-top: 20px;">
            <button id="close-pubsub-modal" style="
                background: #555;
                color: white;
                border: none;
                padding: 10px 20px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 16px;
            ">Close</button>
        </div>
    `;
    
    modal.appendChild(content);
    document.body.appendChild(modal);
    
    // Add event listeners
    document.getElementById('copy-pubsub-cmd').addEventListener('click', () => {
        navigator.clipboard.writeText(command).then(() => {
            const btn = document.getElementById('copy-pubsub-cmd');
            btn.textContent = 'Copied!';
            btn.style.background = '#2196F3';
            setTimeout(() => {
                btn.textContent = 'Copy';
                btn.style.background = '#4CAF50';
            }, 2000);
        }).catch(err => {
            console.error('Failed to copy:', err);
            alert('Failed to copy command. Please select and copy manually.');
        });
    });
    
    document.getElementById('close-pubsub-modal').addEventListener('click', () => {
        document.body.removeChild(modal);
    });
    
    // Close on backdrop click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    });
}

window.api.on('storage:log', (log) => {
    if (!storageRunning) return;
    
    const logsEl = document.getElementById('poa-logs');
    if (logsEl) {
        // Remove "waiting for logs" message if present
        if (logsEl.innerHTML.includes('Waiting for logs')) {
            logsEl.innerHTML = '';
        }
        
        // Add new log entry
        const color = log.level === 'error' ? '#f00' : 
                     log.level === 'warn' ? '#ff0' : '#0f0';
        const logDiv = document.createElement('div');
        logDiv.style.color = color;
        logDiv.textContent = `[${new Date().toLocaleTimeString()}] ${log.message}`;
        logsEl.appendChild(logDiv);
        
        // Keep only last 100 logs
        while (logsEl.children.length > 100) {
            logsEl.removeChild(logsEl.firstChild);
        }
        
        // Scroll to bottom
        logsEl.scrollTop = logsEl.scrollHeight;
    }
});

window.api.on('storage:update-available', (updateInfo) => {
    console.log('POA update available:', updateInfo);
    const updateEl = document.getElementById('update-available');
    if (updateEl) {
        updateEl.innerHTML = `<a href="${updateInfo.downloadUrl}" target="_blank">Update to ${updateInfo.latest}!</a>`;
    }
});

// Contract monitor event listeners
window.api.on('contracts:log', (log) => {
    console.log('[Contract Monitor]', log.message);
});

window.api.on('contracts:cid-pinned', (data) => {
    console.log('[Contract Monitor] Pinned CID:', data.cid);
    showNotification(`Pinned CID: ${data.cid.substring(0, 8)}...`, 'success');
});

window.api.on('contracts:cid-unpinned', (data) => {
    console.log('[Contract Monitor] Unpinned CID:', data.cid);
});

window.api.on('contracts:check-complete', (data) => {
    console.log('[Contract Monitor] Check complete:', data);
    // Update UI if on storage tab
    const storageTab = document.getElementById('storage-tab');
    if (storageTab && storageTab.classList.contains('active')) {
        updateContractMonitorStatus();
    }
});

// Drive Tab Functions
let currentFiles = [];
let selectedFile = null;

async function refreshFiles() {
    // The new Vue component handles its own refresh
    // This function is now just a placeholder for compatibility
    // The actual refresh is handled by the SPKDriveAdvanced component
    
    // Emit a custom event that the Vue component can listen to
    const event = new CustomEvent('spk-drive-refresh');
    window.dispatchEvent(event);
}

function displayFiles(files) {
    // This function is no longer used - the Vue component handles display
    // Kept for compatibility
}

// Placeholder functions for compatibility
function uploadNewFile() {
    // Emit event for Vue component
    const event = new CustomEvent('spk-drive-upload');
    window.dispatchEvent(event);
}

function updateDriveStats() {
    // Stats are handled by the Vue component
}

function filterFiles() {
    // Filtering is handled by the Vue component
}

function searchFiles() {
    // Search is handled by the Vue component
}

function getFileIcon(mimeType) {
    if (!mimeType) return '📄';
    
    if (mimeType.startsWith('image/')) return '🖼️';
    if (mimeType.startsWith('video/')) return '🎥';
    if (mimeType.startsWith('audio/')) return '🎵';
    if (mimeType.includes('pdf')) return '📑';
    if (mimeType.includes('zip') || mimeType.includes('tar')) return '🗜️';
    if (mimeType.includes('text')) return '📝';
    
    return '📄';
}

function formatFileSize(bytes) {
    if (!bytes) return '0 B';
    
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + units[i];
}

function formatDate(dateString) {
    if (!dateString) return 'Unknown';
    
    const date = new Date(dateString);
    return date.toLocaleDateString();
}

async function updateDriveStats() {
    const totalFiles = currentFiles.length;
    const totalSize = currentFiles.reduce((sum, file) => sum + (file.size || 0), 0);
    
    document.getElementById('total-files').textContent = totalFiles;
    document.getElementById('storage-used').textContent = formatFileSize(totalSize);
    
    // Get active contracts count
    try {
        const contractResult = await window.api.contract.list();
        if (contractResult.success) {
            const activeContracts = contractResult.contracts?.filter(c => c.active).length || 0;
            document.getElementById('active-contracts').textContent = activeContracts;
        }
    } catch (error) {
        console.error('Error getting contracts:', error);
    }
}

function filterFiles() {
    const filterType = document.getElementById('file-filter').value;
    let filtered = currentFiles;
    
    if (filterType !== 'all') {
        filtered = currentFiles.filter(file => {
            const mimeType = file.type || file.mimeType || '';
            switch (filterType) {
                case 'images': return mimeType.startsWith('image/');
                case 'videos': return mimeType.startsWith('video/');
                case 'documents': return mimeType.includes('pdf') || mimeType.includes('text');
                case 'other': return !mimeType.startsWith('image/') && 
                                    !mimeType.startsWith('video/') && 
                                    !mimeType.includes('pdf') && 
                                    !mimeType.includes('text');
                default: return true;
            }
        });
    }
    
    displayFiles(filtered);
}

function searchFiles() {
    const searchTerm = document.getElementById('file-search').value.toLowerCase();
    
    if (!searchTerm) {
        displayFiles(currentFiles);
        return;
    }
    
    const filtered = currentFiles.filter(file => {
        const name = (file.name || file.cid || '').toLowerCase();
        return name.includes(searchTerm);
    });
    
    displayFiles(filtered);
}

function uploadNewFile() {
    document.getElementById('file-upload-modal').style.display = 'block';
    document.getElementById('file-upload-form').reset();
    document.getElementById('file-preview').style.display = 'none';
    document.getElementById('upload-btn').disabled = true;
}

function closeFileUploadModal() {
    document.getElementById('file-upload-modal').style.display = 'none';
    selectedFile = null;
}

async function selectFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    selectedFile = file;
    
    // Show file preview
    document.getElementById('file-name').textContent = file.name;
    document.getElementById('file-size').textContent = formatFileSize(file.size);
    document.getElementById('file-type').textContent = file.type || 'Unknown';
    document.getElementById('file-preview').style.display = 'block';
    
    // Enable upload button
    document.getElementById('upload-btn').disabled = false;
    
    // Calculate cost
    await updateStorageCost();
}

async function updateStorageCost() {
    if (!selectedFile) return;
    
    const duration = parseInt(document.getElementById('storage-duration').value) || 30;
    
    try {
        const cost = await window.api.broca.calculateStorageCost(selectedFile.size, duration);
        document.getElementById('estimated-cost').textContent = cost.toFixed(2);
    } catch (error) {
        console.error('Error calculating cost:', error);
        document.getElementById('estimated-cost').textContent = '--';
    }
}

async function showFileDetails(cid) {
    const file = currentFiles.find(f => f.cid === cid);
    if (!file) return;
    
    const content = `
        <p><strong>CID:</strong> ${file.cid}</p>
        <p><strong>Name:</strong> ${file.name || 'Unnamed'}</p>
        <p><strong>Size:</strong> ${formatFileSize(file.size)}</p>
        <p><strong>Type:</strong> ${file.type || file.mimeType || 'Unknown'}</p>
        <p><strong>Uploaded:</strong> ${formatDate(file.uploadDate || file.created)}</p>
        <p><strong>Expires:</strong> ${formatDate(file.expiryDate || file.expires) || 'Never'}</p>
        <div class="actions">
            <button onclick="viewFile('${file.cid}')" class="btn btn-primary">View</button>
            <button onclick="downloadFile('${file.cid}')" class="btn btn-secondary">Download</button>
            <button onclick="renewContract('${file.cid}')" class="btn btn-secondary">Renew</button>
        </div>
    `;
    
    document.getElementById('file-details-content').innerHTML = content;
    document.getElementById('file-details-modal').style.display = 'block';
}

function closeFileDetailsModal() {
    document.getElementById('file-details-modal').style.display = 'none';
}

function viewFile(cid) {
    // Open file in IPFS gateway
    window.open(`https://ipfs.io/ipfs/${cid}`, '_blank');
}

function downloadFile(cid) {
    // Download from IPFS gateway
    window.open(`https://ipfs.io/ipfs/${cid}?download=true`, '_blank');
}

async function renewContract(cid) {
    showNotification('Contract renewal coming soon', 'info');
}

// Setup file upload form handler
document.addEventListener('DOMContentLoaded', () => {
    // Add existing event listeners...
    
    // File upload form
    const fileUploadForm = document.getElementById('file-upload-form');
    if (fileUploadForm) {
        fileUploadForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            if (!selectedFile) {
                showNotification('Please select a file', 'error');
                return;
            }
            
            const duration = parseInt(document.getElementById('storage-duration').value) || 30;
            
            try {
                showNotification('Uploading file...', 'info');
                
                // For now, just show a message since full upload isn't implemented
                showNotification('File upload functionality coming soon', 'info');
                
                // In a real implementation, you would:
                // 1. Read the file
                // 2. Calculate CID
                // 3. Upload to IPFS
                // 4. Create storage contract on SPK
                // 5. Update the file list
                
                closeFileUploadModal();
            } catch (error) {
                console.error('Upload error:', error);
                showNotification('Upload failed', 'error');
            }
        });
    }
    
    // Storage duration change handler
    const storageDurationInput = document.getElementById('storage-duration');
    if (storageDurationInput) {
        storageDurationInput.addEventListener('change', updateStorageCost);
    }
    
    // Drag and drop support
    const dropZone = document.getElementById('file-drop-zone');
    if (dropZone) {
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('drag-over');
        });
        
        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('drag-over');
        });
        
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                document.getElementById('file-input').files = files;
                selectFile({ target: { files } });
            }
        });
    }
});

// Add preview and logging styles
function addPreviewStyles() {
    const previewStyle = document.createElement('style');
    previewStyle.textContent = `
        .logs-section {
            margin: 20px 0;
        }
        
        .logs-container {
            background: #000;
            color: #0f0;
            padding: 15px;
            border-radius: 8px;
            font-family: 'Courier New', monospace;
            font-size: 12px;
            height: 200px;
            overflow-y: auto;
            border: 1px solid #333;
        }
        
        .file-item {
            display: flex;
            justify-content: space-between;
            padding: 5px 0;
            border-bottom: 1px solid #333;
        }
        
        .filename {
            font-family: monospace;
            color: #4CAF50;
        }
        
        .filesize {
            color: #999;
            font-size: 12px;
        }
        
        .log-entry {
            margin: 2px 0;
            padding: 2px 0;
        }
        
        .log-info { color: #4CAF50; }
        .log-warn { color: #ff9800; }
        .log-error { color: #f44336; }
        .log-debug { color: #999; }
    `;
    document.head.appendChild(previewStyle);
}

// Initialize preview styles
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addPreviewStyles);
} else {
    addPreviewStyles();
}

// Setup message signing modal handler
function setupMessageSigningModal() {
    console.log('Setting up message signing modal handler');
    // Listen for signing requests from main process
    window.api.on('show-message-signing-modal', (data) => {
        console.log('Message signing modal triggered:', data);
        const { requestId, message, keyType, username, purpose } = data;
        
        // Create modal HTML using existing styles
        const modalHtml = `
            <div class="modal" id="messageSigningModal" style="display: none;">
                <div class="modal-content" style="max-width: 600px;">
                    <h3>🔐 Signature Request</h3>
                    
                    <div style="background: #1a1a1a; padding: 1rem; border-radius: 4px; margin-bottom: 1rem;">
                        <strong style="color: #4CAF50;">${purpose || 'Authorization Required'}</strong>
                    </div>
                    
                    <div class="form-group">
                        <label>Account:</label>
                        <div style="padding: 0.5rem 0;"><strong style="color: #4CAF50;">@${username}</strong></div>
                    </div>
                    
                    <div class="form-group">
                        <label>Key Type:</label>
                        <div style="padding: 0.5rem 0;">
                            <span style="background: #4CAF50; color: white; padding: 0.25rem 0.5rem; border-radius: 3px; font-size: 0.9rem;">
                                ${keyType}
                            </span>
                        </div>
                    </div>
                    
                    <div class="form-group">
                        <label>Message to Sign:</label>
                        <div class="message-preview">
                            <code>${escapeHtml(message)}</code>
                        </div>
                    </div>
                    
                    <div style="background: #ff980030; border: 1px solid #ff9800; padding: 1rem; border-radius: 4px; margin-bottom: 1.5rem;">
                        <small style="color: #ff9800;">This signature authorizes file uploads to the SPK Network. Only approve if you initiated this action.</small>
                    </div>
                    
                    <div class="modal-actions" style="display: flex; gap: 1rem; justify-content: flex-end;">
                        <button class="secondary-btn" onclick="rejectMessageSigning('${requestId}')">Cancel</button>
                        <button onclick="approveMessageSigning('${requestId}')">
                            Sign Message
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        // Remove any existing modal
        const existingModal = document.getElementById('messageSigningModal');
        if (existingModal) {
            existingModal.remove();
        }
        
        // Add modal to body
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        
        // Show modal
        const modal = document.getElementById('messageSigningModal');
        modal.style.display = 'flex';
        
        // Close modal on backdrop click (modal background)
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                window.rejectMessageSigning(requestId);
            }
        });
    });
}

// Helper function to escape HTML
function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Approve message signing
window.approveMessageSigning = async function(requestId) {
    console.log('Approving message signing:', requestId);
    
    // Hide modal
    const modal = document.getElementById('messageSigningModal');
    if (modal) modal.remove();
    
    // Send approval to main process
    await window.api.invoke('signing:respond', requestId, true);
};

// Reject message signing
window.rejectMessageSigning = async function(requestId) {
    console.log('Rejecting message signing:', requestId);
    
    // Hide modal
    const modal = document.getElementById('messageSigningModal');
    if (modal) modal.remove();
    
    // Send rejection to main process
    await window.api.invoke('signing:respond', requestId, false);
};

// Initialize signing modal on startup
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        setupMessageSigningModal();
    });
} else {
    setupMessageSigningModal();
}

// Initialize network browser
async function initializeNetworkBrowser() {
    if (!currentAccount) return;
    
    const container = document.getElementById('network-browser-container');
    if (!container) return;
    
    // Create network browser if not exists
    if (!networkBrowser) {
        networkBrowser = new NetworkBrowser(container);
        
        // Wait for storage API to be ready
        if (window.storageAPI) {
            await networkBrowser.setStorageManager(window.storageAPI);
        }
    } else {
        // Refresh data
        await networkBrowser.refresh();
    }
}

// Storage node management functions using new API
async function checkStorageNodeStatus() {
    try {
        const status = await window.storageAPI.checkNodeStatus();
        console.log('Storage node status:', status);
        return status;
    } catch (error) {
        console.error('Failed to check storage node status:', error);
        return { registered: false };
    }
}

async function getStoredContracts() {
    try {
        const contracts = await window.storageAPI.getStoredContracts();
        console.log('Stored contracts:', contracts);
        return contracts;
    } catch (error) {
        console.error('Failed to get stored contracts:', error);
        return [];
    }
}

async function refreshStorageNodeInfo() {
    try {
        const stats = await window.storageAPI.getNodeStats();
        
        // Update UI with stats
        if (stats) {
            document.getElementById('storage-contracts').textContent = stats.contractsStored || 0;
            document.getElementById('storage-used').textContent = stats.totalSizeFormatted || '0 MB';
            
            if (stats.estimatedMonthlyEarnings) {
                document.getElementById('storage-earned').textContent = 
                    `${stats.estimatedMonthlyEarnings} (est/month)`;
            }
        }
    } catch (error) {
        console.error('Failed to refresh storage node info:', error);
    }
}

// Auto-refresh balance and storage info
setInterval(() => {
    if (currentAccount && !isAuthenticated) {
        updateWalletLockStatus(true);
    }
    
    // Refresh balance if on balance tab
    if (currentTab === 'balance' && currentAccount) {
        refreshBalance();
        refreshDelegations();
    }
    
    // Refresh storage info if storage is running
    if (storageRunning && currentTab === 'storage') {
        updateStorageStats();
        refreshStorageNodeInfo();
    }
}, 30000); // Every 30 seconds