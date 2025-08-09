/**
 * Authentication UI Component
 * Handles PIN setup, login, and account management
 */
class AuthComponent {
  constructor() {
    this.container = null;
    this.isUnlocked = false;
    this.accounts = [];
    this.activeAccount = null;
    
    // Bind methods to ensure proper context
    this.setActiveAccount = this.setActiveAccount.bind(this);
    this.removeAccount = this.removeAccount.bind(this);
    this.showAddAccount = this.showAddAccount.bind(this);
    this.showExportImport = this.showExportImport.bind(this);
    this.lock = this.lock.bind(this);
    this.showAccountManager = this.showAccountManager.bind(this);
    this.showEditAccount = this.showEditAccount.bind(this);
    this.closeAccountManager = this.closeAccountManager.bind(this);
    this.resetAll = this.resetAll.bind(this);
  }

  /**
   * Initialize the auth component
   */
  async init(container) {
    this.container = container;
    
    // Set up event delegation after DOM is ready
    this.setupEventDelegation();
    
    try {
      // Check if PIN has been set up
      const hasPinSetup = await window.api.auth.hasPinSetup();
      console.log('Has PIN setup:', hasPinSetup);
      
      if (!hasPinSetup) {
        // No PIN setup, show setup screen
        console.log('No PIN setup, showing PIN setup screen');
        this.showPinSetup();
      } else {
        // Has PIN, show unlock
        console.log('PIN exists, showing unlock screen');
        this.showUnlock();
      }
    } catch (error) {
      console.error('Error checking PIN setup:', error);
      // Assume no PIN setup if error
      this.showPinSetup();
    }

    // Listen for SPK events
    this.setupEventListeners();
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    window.api.on('spk:accounts-unlocked', (accounts) => {
      this.isUnlocked = true;
      this.accounts = accounts;
      // Don't automatically show account manager - let the main renderer handle closing the overlay
      // After unlock, prompt for pubkey registration if needed
      setTimeout(() => this.promptRegisterPubKeyIfNeeded().catch(()=>{}), 50);
    });

    window.api.on('spk:accounts-locked', () => {
      this.isUnlocked = false;
      this.accounts = [];
      this.activeAccount = null;
      this.showUnlock();
    });

    window.api.on('spk:session-expired', () => {
      this.showSessionExpired();
    });

    window.api.on('spk:active-account-changed', (username) => {
      this.activeAccount = username;
      this.updateActiveAccountDisplay();
      // Re-check registration on active account change
      setTimeout(() => this.promptRegisterPubKeyIfNeeded().catch(()=>{}), 50);
    });
  }

  async promptRegisterPubKeyIfNeeded() {
    try {
      const active = await window.api.account.getActive();
      if (!active || !active.username) return;
      const res = await window.api.spk.checkRegistration(active.username);
      if (!res || !res.success) return;
      if ((!res.registered) && res.data && res.data.pubKey === 'NA') {
        this.showPubKeyRegistrationPrompt(active.username);
      }
    } catch (_) {}
  }

  showPubKeyRegistrationPrompt(username) {
    const overlay = document.createElement('div');
    overlay.className = 'session-expired-overlay';
    overlay.innerHTML = `
      <div class="session-expired-dialog" style="max-width:520px;">
        <h3>Register Posting Public Key</h3>
        <p>Your Hive account @${username} has no posting public key registered on SPK. Register one now so apps can verify your signatures.</p>
        <div id="pubkey-choice" style="margin: 12px 0;">
          <button class="btn" id="fetch-posting-pubkeys">Fetch available posting pubkeys</button>
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" id="skip-pubkey">Maybe later</button>
          <button class="btn btn-primary" id="register-pubkey" disabled>Register Selected</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const fetchBtn = overlay.querySelector('#fetch-posting-pubkeys');
    const registerBtn = overlay.querySelector('#register-pubkey');
    const skipBtn = overlay.querySelector('#skip-pubkey');
    const choiceDiv = overlay.querySelector('#pubkey-choice');

    const renderChoices = (pubkeys) => {
      if (!pubkeys || pubkeys.length === 0) {
        choiceDiv.innerHTML = '<p style="color:#f44336;">No posting public keys found on-chain for this account.</p>';
        return;
      }
      choiceDiv.innerHTML = `
        <label style="display:block; margin-bottom:6px;">Select posting public key:</label>
        <select id="posting-pubkey-select" style="width:100%; padding:8px; background:#1a1a1a; color:#e0e0e0; border:1px solid #333; border-radius:4px;">
          ${pubkeys.map(k => `<option value="${k}">${k}</option>`).join('')}
        </select>
      `;
      registerBtn.disabled = false;
    };

    fetchBtn.addEventListener('click', async () => {
      try {
        const pubs = await this.fetchHivePostingPubKeys(username);
        renderChoices(pubs);
      } catch (e) {
        choiceDiv.innerHTML = `<p style="color:#f44336;">Failed to fetch pubkeys: ${e.message}</p>`;
      }
    });

    registerBtn.addEventListener('click', async () => {
      const sel = overlay.querySelector('#posting-pubkey-select');
      if (!sel || !sel.value) return;
      try {
        const result = await window.api.invoke('spk:registerPublicKey', username, sel.value);
        if (result && result.success) {
          overlay.remove();
          alert('Public key registered successfully.');
        } else {
          alert(result && result.error ? result.error : 'Failed to register public key');
        }
      } catch (e) {
        alert(e.message || 'Failed to register public key');
      }
    });

    skipBtn.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  }

  async fetchHivePostingPubKeys(username) {
    const response = await fetch('https://api.hive.blog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'condenser_api.get_accounts', params: [[username]], id: 1 })
    });
    const data = await response.json();
    if (!data || !data.result || !data.result[0]) return [];
    const account = data.result[0];
    const auths = (account.posting && account.posting.key_auths) ? account.posting.key_auths : [];
    return auths.map(a => a[0]);
  }

  /**
   * Setup event delegation for dynamic content
   */
  setupEventDelegation() {
    console.log('Setting up event delegation on container:', this.container);
    
    // Comment out event delegation for now to avoid conflicts
    /*
    this.container.addEventListener('click', (e) => {
      console.log('Click detected on:', e.target.tagName, e.target.id || e.target.className);
      
      const target = e.target;
      
      // Check if we're clicking on a button or its parent
      let button = target;
      if (button.tagName !== 'BUTTON') {
        button = target.closest('button');
      }
      
      if (!button) {
        console.log('No button found');
        return;
      }
      
      console.log('Button found:', button.id || button.className);
      
      // Handle different button clicks
      switch (button.id) {
        case 'lock-btn':
          e.preventDefault();
          console.log('Lock button clicked (delegation)');
          this.lock();
          break;
          
        case 'close-btn':
          e.preventDefault();
          console.log('Close button clicked (delegation)');
          this.closeAccountManager();
          break;
          
        case 'add-account-btn':
          e.preventDefault();
          console.log('Add account button clicked (delegation)');
          this.showAddAccount();
          break;
          
        case 'export-import-btn':
          e.preventDefault();
          console.log('Export/Import button clicked (delegation)');
          this.showExportImport();
          break;
          
        case 'reset-btn':
          e.preventDefault();
          console.log('Reset button clicked (delegation)');
          this.resetAll();
          break;
      }
      
      // Handle class-based buttons
      if (button.classList.contains('set-active-btn')) {
        e.preventDefault();
        e.stopPropagation();
        console.log('Set active clicked (delegation) for:', button.dataset.username);
        this.setActiveAccount(button.dataset.username);
      }
      
      if (button.classList.contains('edit-btn')) {
        e.preventDefault();
        e.stopPropagation();
        console.log('Edit clicked (delegation) for:', button.dataset.username);
        this.showEditAccount(button.dataset.username);
      }
      
      if (button.classList.contains('remove-btn')) {
        e.preventDefault();
        e.stopPropagation();
        console.log('Remove clicked (delegation) for:', button.dataset.username);
        this.removeAccount(button.dataset.username);
      }
    }, true); // Use capture phase
    */
  }

  /**
   * Show PIN setup screen
   */
  showPinSetup() {
    this.container.innerHTML = `
      <div class="auth-container">
        <h2>Welcome to Oratr</h2>
        <p>Create a PIN to secure your accounts</p>
        
        <form id="pin-setup-form">
          <div class="form-group">
            <label for="pin">Create PIN (minimum 4 characters)</label>
            <input type="password" id="pin" name="pin" minlength="4" required>
          </div>
          
          <div class="form-group">
            <label for="pin-confirm">Confirm PIN</label>
            <input type="password" id="pin-confirm" name="pin-confirm" minlength="4" required>
          </div>
          
          <button type="submit" class="btn btn-primary">Set PIN</button>
        </form>
        
        <div id="error-message" class="error-message"></div>
      </div>
    `;

    const self = this;
    document.getElementById('pin-setup-form').onsubmit = async function(e) {
      e.preventDefault();
      
      const pin = document.getElementById('pin').value;
      const pinConfirm = document.getElementById('pin-confirm').value;
      const errorDiv = document.getElementById('error-message');
      
      if (pin !== pinConfirm) {
        errorDiv.textContent = 'PINs do not match';
        return;
      }
      
      const result = await window.api.auth.setupPin(pin);
      
      if (result.success) {
        self.isUnlocked = true;
        // PIN setup complete - show account import for first account
        self.showAccountImport();
      } else {
        errorDiv.textContent = result.error || 'Failed to set PIN';
      }
    };
  }

  /**
   * Show unlock screen
   */
  async showUnlock() {
    // Get list of accounts (even when locked, we can see usernames)
    const accounts = await window.api.account.list();
    
    let accountsList = '';
    if (accounts && accounts.length > 0) {
      accountsList = `
        <div class="locked-accounts-info">
          <h3>Locked Accounts</h3>
          <div class="accounts-preview">
            ${accounts.map(account => `
              <div class="account-preview">
                <span class="account-icon">🔒</span>
                <span class="account-name">${account.username}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }
    
    this.container.innerHTML = `
      <div class="auth-container unlock-container">
        <h2>Unlock Oratr</h2>
        
        ${accountsList}
        
        <form id="unlock-form">
          <div class="form-group">
            <label for="pin">Enter PIN</label>
            <input type="password" id="pin" name="pin" required autofocus placeholder="Enter your PIN to unlock">
          </div>
          
          <button type="submit" class="btn btn-primary">🔓 Unlock Wallet</button>
        </form>
        
        <div class="reset-link" style="text-align: center; margin-top: 2rem;">
          <a href="#" id="reset-link" style="color: #999; text-decoration: none; font-size: 0.9rem;">Forgot PIN? Reset all data</a>
        </div>
        
        <div id="error-message" class="error-message"></div>
      </div>
    `;

    document.getElementById('unlock-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const pin = document.getElementById('pin').value;
      const errorDiv = document.getElementById('error-message');
      
      const result = await window.api.auth.unlock(pin);
      
      if (result.success) {
        // Will trigger accounts-unlocked event
      } else {
        errorDiv.textContent = result.error || 'Invalid PIN';
        document.getElementById('pin').value = '';
        document.getElementById('pin').focus();
      }
    });
    
    // Reset link
    document.getElementById('reset-link').addEventListener('click', (e) => {
      e.preventDefault();
      this.resetAll();
    });
  }

  /**
   * Show account import screen
   */
  showAccountImport() {
    // Add unlock button if wallet is locked
    const unlockButton = !this.isUnlocked ? `
      <div class="unlock-notice">
        <p style="color: #ff6b6b;">Wallet is locked. Please unlock first.</p>
        <button class="btn btn-primary" id="unlock-button">🔓 Unlock Wallet</button>
      </div>
    ` : '';
    
    this.container.innerHTML = `
      <div class="auth-container">
        <h2>${this.accounts.length > 0 ? 'Add Account' : 'Add Your First Account'}</h2>
        
        ${unlockButton}
        
        ${this.accounts.length > 0 ? `
          <div class="back-button-container">
            <button class="btn btn-sm" id="back-button">← Back to Accounts</button>
          </div>
        ` : ''}
        
        <div class="tabs">
          <button class="tab active" data-tab="master">Master Password</button>
          <button class="tab" data-tab="keys">Private Keys</button>
        </div>
        
        <div id="master-tab" class="tab-content active">
          <form id="import-master-form">
            <div class="form-group">
              <label for="username">Username</label>
              <input type="text" id="username" name="username" required>
            </div>
            
            <div class="form-group">
              <label for="master-password">Master Password</label>
              <input type="password" id="master-password" name="master-password" required>
            </div>
            
            <button type="submit" class="btn btn-primary">Import Account</button>
          </form>
        </div>
        
        <div id="keys-tab" class="tab-content">
          <form id="import-keys-form">
            <div class="form-group">
              <label for="username-keys">Username</label>
              <input type="text" id="username-keys" name="username" required>
            </div>
            
            <div class="form-group">
              <label for="posting-key">Posting Key (required)</label>
              <input type="password" id="posting-key" name="posting-key" required>
            </div>
            
            <div class="form-group">
              <label for="active-key">Active Key (optional - wallet operations and registering storage node)</label>
              <input type="password" id="active-key" name="active-key">
            </div>
            
            <div class="form-group">
              <label for="memo-key">Memo Key (optional - used for end to end encryption)</label>
              <input type="password" id="memo-key" name="memo-key">
            </div>
            
            <button type="submit" class="btn btn-primary">Add Account</button>
          </form>
        </div>
        
        <div id="error-message" class="error-message"></div>
        <div id="success-message" class="success-message"></div>
      </div>
    `;

    // Back button
    if (this.accounts.length > 0) {
      const self = this;
      document.getElementById('back-button').onclick = function() {
        self.showAccountManager();
      };
    }

    // Unlock button
    if (!this.isUnlocked) {
      const self = this;
      document.getElementById('unlock-button').onclick = function() {
        self.showUnlock();
      };
    }

    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        
        tab.classList.add('active');
        const tabContent = document.getElementById(tab.dataset.tab + '-tab');
        if (tabContent) {
          tabContent.classList.add('active');
        } else {
          console.error('Tab content not found:', tab.dataset.tab + '-tab');
        }
      });
    });

    // Master password import
    document.getElementById('import-master-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      // Require unlocked wallet before importing
      if (!this.isUnlocked) {
        const errorDiv = document.getElementById('error-message');
        errorDiv.textContent = 'Please unlock your wallet before importing an account.';
        return;
      }

      const username = document.getElementById('username').value;
      const masterPassword = document.getElementById('master-password').value;
      const errorDiv = document.getElementById('error-message');
      const successDiv = document.getElementById('success-message');
      
      errorDiv.textContent = '';
      successDiv.textContent = '';
      
      const result = await window.api.account.importFromMaster(username, masterPassword);
      
      if (result.success) {
        successDiv.textContent = `Account ${username} imported successfully!`;
        
        // Auto-set as active account if it's the first account or if explicitly requested
        if (this.accounts.length === 0) {
          try {
            await window.api.account.setActive(username);
            successDiv.textContent += ' (Set as active account)';
            
            // Update current account in renderer
            window.currentAccount = username;
            if (window.updateAccountDisplay) {
              window.updateAccountDisplay();
            }
            
            // Dispatch event to notify the main app
            const event = new CustomEvent('account-activated', { 
              detail: { username } 
            });
            window.dispatchEvent(event);
          } catch (error) {
            console.warn('Failed to auto-set active account:', error);
          }
        }
        
        setTimeout(() => {
          // If this was the first account and we're auto-activating, close the overlay entirely
          if (this.accounts.length === 0) {
            this.closeAccountManager();
          } else {
            this.showAccountManager();
          }
        }, 1500);
      } else {
        // Surface clearer guidance for common causes
        const err = (result && result.error) ? String(result.error) : '';
        if (err.toLowerCase().includes('locked')) {
          errorDiv.textContent = 'Wallet is locked. Please unlock first.';
        } else if (err.toLowerCase().includes('derive')) {
          errorDiv.textContent = 'Could not derive keys. Check the username and master password.';
        } else {
          errorDiv.textContent = result.error || 'Failed to import account';
        }
      }
    });

    // Private keys import
    document.getElementById('import-keys-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const username = document.getElementById('username-keys').value;
      const keys = {
        posting: document.getElementById('posting-key').value,
        active: document.getElementById('active-key').value,
        memo: document.getElementById('memo-key').value
      };
      
      // Remove empty keys
      Object.keys(keys).forEach(key => {
        if (!keys[key]) delete keys[key];
      });
      
      const errorDiv = document.getElementById('error-message');
      const successDiv = document.getElementById('success-message');
      
      errorDiv.textContent = '';
      successDiv.textContent = '';
      
      const result = await window.api.account.add(username, keys);
      
      if (result.success) {
        successDiv.textContent = `Account ${username} added successfully!`;
        
        // Auto-set as active account if it's the first account or if explicitly requested
        if (this.accounts.length === 0) {
          try {
            await window.api.account.setActive(username);
            successDiv.textContent += ' (Set as active account)';
            
            // Update current account in renderer
            window.currentAccount = username;
            if (window.updateAccountDisplay) {
              window.updateAccountDisplay();
            }
            
            // Dispatch event to notify the main app
            const event = new CustomEvent('account-activated', { 
              detail: { username } 
            });
            window.dispatchEvent(event);
          } catch (error) {
            console.warn('Failed to auto-set active account:', error);
          }
        }
        
        setTimeout(() => {
          // If this was the first account and we're auto-activating, close the overlay entirely
          if (this.accounts.length === 0) {
            this.closeAccountManager();
          } else {
            this.showAccountManager();
          }
        }, 1500);
      } else {
        errorDiv.innerHTML = result.error || 'Failed to add account';
        // If the error is about locked accounts, add an unlock link
        if (result.error && result.error.includes('unlock')) {
          errorDiv.innerHTML += ' <a href="#" id="unlock-link" style="color: #4fc3f7;">Click here to unlock</a>';
          const self = this;
          setTimeout(() => {
            const unlockLink = document.getElementById('unlock-link');
            if (unlockLink) {
              unlockLink.onclick = function(e) {
                e.preventDefault();
                self.showUnlock();
              };
            }
          }, 100);
        }
      }
    });
  }

  /**
   * Show account manager
   */
  async showAccountManager() {
    await this.loadAccounts();
    
    // Store reference to this for use in event handlers
    const self = this;
    
    const accountsList = this.accounts.map(account => `
      <div class="account-card ${account.username === this.activeAccount ? 'active' : ''}" data-username="${account.username}">
        <div class="account-header">
          <div class="account-avatar">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="12" cy="8" r="5" fill="currentColor"/>
              <path d="M20 21a8 8 0 1 0-16 0" fill="currentColor"/>
            </svg>
          </div>
          <div class="account-details">
            <h4 class="account-name">${account.username}</h4>
            ${account.username === this.activeAccount ? 
              '<div class="status-badge active-status">Active Account</div>' : 
              '<div class="status-badge">Inactive</div>'
            }
          </div>
          ${account.username === this.activeAccount ? 
            '<div class="active-indicator"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M20 6L9 17L4 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>' : 
            ''
          }
        </div>
        
        <div class="account-keys">
          ${account.hasPosting ? '<span class="key-badge posting">Posting</span>' : ''}
          ${account.hasActive ? '<span class="key-badge active">Active</span>' : ''}
          ${account.hasMemo ? '<span class="key-badge memo">Memo</span>' : ''}
          ${account.hasOwner ? '<span class="key-badge owner">Owner</span>' : ''}
        </div>
        
        <div class="account-actions">
          ${account.username !== this.activeAccount ? 
            `<button class="btn btn-outline set-active-btn" data-username="${account.username}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M20 6L9 17L4 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              Set Active
            </button>` : ''
          }
          <button class="btn btn-ghost edit-btn" data-username="${account.username}" title="Edit Account">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="m18.5 2.5 a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <button class="btn btn-ghost btn-danger remove-btn" data-username="${account.username}" title="Remove Account">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M3 6h18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      </div>
    `).join('');

    this.container.innerHTML = `
      <div class="auth-container">
        <div class="auth-header">
          <div class="auth-title">
            <div class="auth-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 12C14.7614 12 17 9.76142 17 7C17 4.23858 14.7614 2 12 2C9.23858 2 7 4.23858 7 7C7 9.76142 9.23858 12 12 12Z" fill="currentColor"/>
                <path d="M12 14C7.58172 14 4 17.5817 4 22H20C20 17.5817 16.4183 14 12 14Z" fill="currentColor"/>
              </svg>
            </div>
            <h2>Account Manager</h2>
          </div>
          <div class="auth-header-actions">
            <button class="btn-icon" id="lock-btn" title="Lock Wallet">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M6 10V8C6 5.79086 7.79086 4 10 4H14C16.2091 4 18 5.79086 18 8V10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                <rect x="4" y="10" width="16" height="10" rx="2" fill="currentColor"/>
              </svg>
            </button>
            <button class="btn-icon" id="close-btn" title="Close">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                <path d="M6 6L18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>
            </button>
          </div>
        </div>
        
        <div class="accounts-section">
          <div class="section-title">
            <h3>Your Accounts</h3>
            <span class="account-count">${this.accounts.length} account${this.accounts.length !== 1 ? 's' : ''}</span>
          </div>
          
          <div class="accounts-grid">
            ${accountsList || '<div class="empty-state"><div class="empty-icon">👤</div><p>No accounts added yet</p><span>Add your first account to get started</span></div>'}
          </div>
        </div>
        
        <div class="accounts-section wallet-session">
          <div class="section-title">
            <h3>Wallet Session</h3>
          </div>
          <div class="wallet-session__scale">
            <label for="wallet-lock-range" class="wallet-session__label">Wallet lock time</label>
            <input id="wallet-lock-range" class="wallet-session__range" type="range" min="0" max="8" step="1">
            <div class="wallet-session__ticks">
              <span>1m</span><span>5m</span><span>10m</span><span>30m</span><span>1h</span><span>3h</span><span>6h</span><span>12h</span><span>24h</span>
            </div>
            <div id="wallet-lock-desc" class="wallet-session__desc"></div>
          </div>
          <div class="wallet-session__flags">
            <label class="flag">
              <input id="wallet-lock-mode" type="checkbox"> Inactivity-based timeout
            </label>
            <label class="flag">
              <input id="wallet-lock-on-close" type="checkbox"> Lock when window closes
            </label>
          </div>
        </div>

        <div class="auth-actions">
          <button class="btn btn-primary" id="add-account-btn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 5V19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              <path d="M5 12H19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
            Add Account
          </button>
          <button class="btn btn-secondary" id="export-import-btn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M14 2H6C4.89543 2 4 2.89543 4 4V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V8L14 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M14 2V8H20" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M16 13H8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              <path d="M16 17H8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              <path d="M10 9H8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
            Export/Import
          </button>
          <button class="btn btn-danger" id="reset-btn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M3 6H5H21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              <path d="M8 6V4C8 2.89543 8.89543 2 10 2H14C15.1046 2 16 2.89543 16 4V6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              <path d="M19 6V20C19 21.1046 18.1046 22 17 22H7C5.89543 22 5 21.1046 5 20V6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
            Reset All
          </button>
        </div>
      </div>
    `;

    // Initialize wallet lock UI with current settings
    try {
      const s = await window.api.invoke('settings:get-all');
      const mapIndexToMs = [1,5,10,30,60,180,360,720,1440].map(m=>m*60*1000);
      const range = document.getElementById('wallet-lock-range');
      const mode = document.getElementById('wallet-lock-mode');
      const onClose = document.getElementById('wallet-lock-on-close');
      const desc = document.getElementById('wallet-lock-desc');
      const toHuman = (ms) => {
        const m = Math.round(ms/60000);
        if (m < 60) return `${m} minute${m===1?'':'s'}`;
        const h = Math.round(m/60);
        return `${h} hour${h===1?'':'s'}`;
      };
      const updateDesc = () => {
        const ms = mapIndexToMs[Number(range.value)] || (15*60*1000);
        const modeTxt = (mode && mode.checked) ? 'of inactivity' : 'continuous';
        if (desc) desc.textContent = `Locks after ${toHuman(ms)} (${modeTxt})`;
      };
      if (range) {
        const idx = Math.max(0, mapIndexToMs.findIndex(ms => ms === (s.walletLock?.durationMs || (15*60*1000))));
        range.value = idx === -1 ? '2' : String(idx);
        updateDesc();
        range.oninput = async () => {
          const ms = mapIndexToMs[Number(range.value)] || (15*60*1000);
          await window.api.invoke('settings:set', { key: 'walletLock.durationMs', value: ms });
          updateDesc();
        };
      }
      if (mode) {
        mode.checked = (s.walletLock?.mode || 'inactivity') === 'inactivity';
        mode.onchange = async () => {
          await window.api.invoke('settings:set', { key: 'walletLock.mode', value: mode.checked ? 'inactivity' : 'continuous' });
          updateDesc();
        };
      }
      if (onClose) {
        onClose.checked = !!(s.walletLock?.lockOnWindowClose);
        onClose.onchange = async () => {
          await window.api.invoke('settings:set', { key: 'walletLock.lockOnWindowClose', value: !!onClose.checked });
        };
      }
    } catch (e) {
      console.warn('Failed to init wallet lock UI:', e);
    }

    // Use a simple approach - direct onclick assignment
    document.getElementById('lock-btn').onclick = function() {
      console.log('Lock button clicked');
      self.lock();
    };
    
    document.getElementById('close-btn').onclick = function() {
      console.log('Close button clicked');
      self.closeAccountManager();
    };
    
    document.getElementById('add-account-btn').onclick = function() {
      console.log('Add account button clicked');
      self.showAddAccount();
    };
    
    document.getElementById('export-import-btn').onclick = function() {
      console.log('Export/Import button clicked');
      self.showExportImport();
    };
    
    document.getElementById('reset-btn').onclick = function() {
      console.log('Reset button clicked');
      self.resetAll();
    };
    
    // Account action buttons
    document.querySelectorAll('.set-active-btn').forEach(btn => {
      btn.onclick = function() {
        console.log('Set active clicked for:', this.dataset.username);
        self.setActiveAccount(this.dataset.username);
      };
    });
    
    document.querySelectorAll('.edit-btn').forEach(btn => {
      btn.onclick = function() {
        console.log('Edit clicked for:', this.dataset.username);
        self.showEditAccount(this.dataset.username);
      };
    });
    
    document.querySelectorAll('.remove-btn').forEach(btn => {
      btn.onclick = function() {
        console.log('Remove clicked for:', this.dataset.username);
        self.removeAccount(this.dataset.username);
      };
    });
  }

  /**
   * Show edit account screen
   */
  async showEditAccount(username) {
    const account = this.accounts.find(a => a.username === username);
    if (!account) return;

    this.container.innerHTML = `
      <div class="auth-container">
        <h2>Edit Account: ${username}</h2>
        
        <div class="back-button-container">
          <button class="btn btn-sm" id="back-button">← Back to Accounts</button>
        </div>
        
        <div class="account-keys-status">
          <h3>Current Keys</h3>
          <div class="key-status-list">
            <div class="key-status ${account.hasPosting ? 'has-key' : 'no-key'}">
              <span>Posting Key</span>
              <span>${account.hasPosting ? '✓ Present' : '✗ Missing'}</span>
            </div>
            <div class="key-status ${account.hasActive ? 'has-key' : 'no-key'}">
              <span>Active Key</span>
              <span>${account.hasActive ? '✓ Present' : '✗ Missing'}</span>
            </div>
            <div class="key-status ${account.hasMemo ? 'has-key' : 'no-key'}">
              <span>Memo Key</span>
              <span>${account.hasMemo ? '✓ Present' : '✗ Missing'}</span>
            </div>
          </div>
        </div>
        
        <form id="update-keys-form">
          <h3>Add or Update Keys</h3>
          <p class="hint">Enter only the keys you want to add or update. Leave blank to keep existing.</p>
          
          <div class="form-group">
            <label for="posting-key">Posting Key ${account.hasPosting ? '(replace optional)' : ''}</label>
            <input type="password" id="posting-key" name="posting-key" placeholder="Leave blank to keep current">
          </div>
          
          <div class="form-group">
            <label for="active-key">Active Key ${account.hasActive ? '(replace optional)' : ''}</label>
            <input type="password" id="active-key" name="active-key" placeholder="Leave blank to keep current">
          </div>
          
          <div class="form-group">
            <label for="memo-key">Memo Key ${account.hasMemo ? '(replace optional)' : ''}</label>
            <input type="password" id="memo-key" name="memo-key" placeholder="Leave blank to keep current">
          </div>
          
          <button type="submit" class="btn btn-primary">Update Keys</button>
        </form>

        <hr>

        <div class="accounts-section">
          <h3>Remove Keys</h3>
          <p class="hint">Remove individual keys without deleting the account.</p>
          <div class="account-keys">
            <button class="btn btn-ghost btn-danger" id="delete-posting" ${account.hasPosting ? '' : 'disabled'}>Delete Posting Key</button>
            <button class="btn btn-ghost btn-danger" id="delete-active" ${account.hasActive ? '' : 'disabled'}>Delete Active Key</button>
            <button class="btn btn-ghost btn-danger" id="delete-memo" ${account.hasMemo ? '' : 'disabled'}>Delete Memo Key</button>
          </div>
        </div>

        <hr>

        <div class="accounts-section">
          <h3>Automation</h3>
          <p class="hint">Allow background automation with this account. Stores the posting key in settings for unattended operations.</p>
          <button class="btn btn-warning" id="enable-automation">Enable Automation with @${username}</button>
        </form>
        
        <div id="error-message" class="error-message"></div>
        <div id="success-message" class="success-message"></div>
      </div>
    `;

    // Back button
    document.getElementById('back-button').addEventListener('click', () => {
      this.showAccountManager();
    });

    // Update keys form
    const form = document.getElementById('update-keys-form');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const keys = {};
        
        const postingVal = document.getElementById('posting-key')?.value || '';
        const activeVal = document.getElementById('active-key')?.value || '';
        const memoVal = document.getElementById('memo-key')?.value || '';
        if (postingVal) keys.posting = postingVal;
        if (activeVal) keys.active = activeVal;
        if (memoVal) keys.memo = memoVal;
        
        
        if (Object.keys(keys).length === 0) {
          document.getElementById('error-message').textContent = 'Please enter at least one key';
          return;
        }
        
        const errorDiv = document.getElementById('error-message');
        const successDiv = document.getElementById('success-message');
        
        errorDiv.textContent = '';
        successDiv.textContent = '';
        
        const result = await window.api.account.add(username, keys);
        
        if (result.success) {
          successDiv.textContent = 'Keys updated successfully!';
          setTimeout(() => {
            this.showAccountManager();
          }, 1500);
        } else {
          errorDiv.textContent = result.error || 'Failed to update keys';
        }
      });
    }

    // Delete individual keys
    const bindDelete = (id, key) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('click', async () => {
        if (!confirm(`Delete ${key} key from ${username}?`)) return;
        try {
          const res = await window.api.invoke('account:deleteKey', username, key);
          if (res && res.success) {
            this.showEditAccount(username);
          } else {
            alert(res.error || 'Failed to delete key');
          }
        } catch (e) {
          alert(e.message || 'Failed to delete key');
        }
      });
    };
    bindDelete('delete-posting', 'posting');
    bindDelete('delete-active', 'active');
    bindDelete('delete-memo', 'memo');

    // Enable automation (store posting key in settings.json securely)
    const enableAuto = document.getElementById('enable-automation');
    if (enableAuto) {
      enableAuto.addEventListener('click', async () => {
        if (!confirm('Store posting key in settings for background automation?')) return;
        try {
          const res = await window.api.invoke('account:exportPostingForAutomation', username);
          if (res && res.success) {
            alert('Automation enabled. Posting key stored for background operations.');
          } else {
            alert(res.error || 'Failed to enable automation');
          }
        } catch (e) {
          alert(e.message || 'Failed to enable automation');
        }
      });
    }
  }

  /**
   * Load accounts
   */
  async loadAccounts() {
    this.accounts = await window.api.account.list();
    const activeAccount = await window.api.account.getActive();
    if (activeAccount) {
      this.activeAccount = activeAccount.username;
    }
  }

  /**
   * Set active account
   */
  async setActiveAccount(username) {
    try {
      console.log('Setting active account:', username);
      const result = await window.api.account.setActive(username);
      if (result.success) {
        await this.loadAccounts();
        this.showAccountManager();
      } else {
        console.error('Failed to set active account:', result.error);
        alert(`Failed to set active account: ${result.error}`);
      }
    } catch (error) {
      console.error('Error setting active account:', error);
      alert(`Error: ${error.message}`);
    }
  }

  /**
   * Remove account
   */
  async removeAccount(username) {
    if (!confirm(`Remove account ${username}? This cannot be undone.`)) {
      return;
    }
    
    try {
      console.log('Removing account:', username);
      const result = await window.api.account.remove(username);
      if (result.success) {
        await this.loadAccounts();
        this.showAccountManager();
      } else {
        console.error('Failed to remove account:', result.error);
        alert(`Failed to remove account: ${result.error}`);
      }
    } catch (error) {
      console.error('Error removing account:', error);
      alert(`Error: ${error.message}`);
    }
  }

  /**
   * Lock accounts
   */
  async lock() {
    try {
      console.log('Locking accounts');
      await window.api.auth.lock();
    } catch (error) {
      console.error('Error locking accounts:', error);
      alert(`Error: ${error.message}`);
    }
  }

  /**
   * Show add account dialog
   */
  showAddAccount() {
    try {
      console.log('Showing add account dialog');
      this.showAccountImport();
    } catch (error) {
      console.error('Error showing add account:', error);
      alert(`Error: ${error.message}`);
    }
  }

  /**
   * Show export/import screen
   */
  showExportImport() {
    this.container.innerHTML = `
      <div class="auth-container">
        <h2>Export/Import Accounts</h2>
        
        <div class="back-button-container">
          <button class="btn btn-sm" id="back-button">← Back to Accounts</button>
        </div>
        
        <div class="export-section">
          <h3>Export Account</h3>
          <form id="export-form">
            <div class="form-group">
              <label for="export-account">Select Account</label>
              <select id="export-account" required>
                <option value="">Choose account...</option>
                ${this.accounts.map(a => `<option value="${a.username}">${a.username}</option>`).join('')}
              </select>
            </div>
            
            <div class="form-group">
              <label for="export-pin">Export PIN (protects the export file)</label>
              <input type="password" id="export-pin" minlength="4" required>
            </div>
            
            <button type="submit" class="btn btn-primary">Export Account</button>
          </form>
          
          <div id="export-result" style="display: none;">
            <h4>Export Data</h4>
            <textarea id="export-data" readonly rows="10"></textarea>
            <button class="btn btn-sm" id="copy-export">Copy to Clipboard</button>
          </div>
        </div>
        
        <hr>
        
        <div class="import-section">
          <h3>Import Account</h3>
          <form id="import-form">
            <div class="form-group">
              <label for="import-data">Export Data</label>
              <textarea id="import-data" rows="10" required></textarea>
            </div>
            
            <div class="form-group">
              <label for="import-pin">Import PIN</label>
              <input type="password" id="import-pin" minlength="4" required>
            </div>
            
            <button type="submit" class="btn btn-primary">Import Account</button>
          </form>
        </div>
        
        <div id="error-message" class="error-message"></div>
        <div id="success-message" class="success-message"></div>
      </div>
    `;

    // Back button
    document.getElementById('back-button').addEventListener('click', () => {
      this.showAccountManager();
    });

    // Export form
    document.getElementById('export-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const username = document.getElementById('export-account').value;
      const exportPin = document.getElementById('export-pin').value;
      
      const result = await window.api.account.export(username, exportPin);
      
      if (result.success) {
        document.getElementById('export-result').style.display = 'block';
        document.getElementById('export-data').value = JSON.stringify(result.exportData, null, 2);
      } else {
        document.getElementById('error-message').textContent = result.error || 'Export failed';
      }
    });

    // Copy button
    document.getElementById('copy-export').addEventListener('click', () => {
      const textarea = document.getElementById('export-data');
      textarea.select();
      document.execCommand('copy');
      document.getElementById('success-message').textContent = 'Copied to clipboard!';
      setTimeout(() => {
        document.getElementById('success-message').textContent = '';
      }, 2000);
    });

    // Import form
    document.getElementById('import-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const importData = document.getElementById('import-data').value;
      const importPin = document.getElementById('import-pin').value;
      
      try {
        const exportData = JSON.parse(importData);
        const result = await window.api.account.import(exportData, importPin);
        
        if (result.success) {
          document.getElementById('success-message').textContent = `Imported accounts: ${result.usernames.join(', ')}`;
          setTimeout(() => {
            this.showAccountManager();
          }, 2000);
        } else {
          document.getElementById('error-message').textContent = result.error || 'Import failed';
        }
      } catch (error) {
        document.getElementById('error-message').textContent = 'Invalid export data format';
      }
    });
  }

  /**
   * Show session expired message
   */
  showSessionExpired() {
    const overlay = document.createElement('div');
    overlay.className = 'session-expired-overlay';
    overlay.innerHTML = `
      <div class="session-expired-dialog">
        <h3>Session Expired</h3>
        <p>Your session has expired for security. Please unlock to continue.</p>
        <button class="btn btn-primary" onclick="this.parentElement.parentElement.remove()">OK</button>
      </div>
    `;
    document.body.appendChild(overlay);
    
    this.showUnlock();
  }

  /**
   * Update active account display
   */
  updateActiveAccountDisplay() {
    // Update any UI elements that show the active account
    const event = new CustomEvent('active-account-changed', { 
      detail: { username: this.activeAccount } 
    });
    window.dispatchEvent(event);
  }

  /**
   * Close account manager and return to app
   */
  closeAccountManager() {
    const authContainer = document.getElementById('auth-container');
    const app = document.getElementById('app');
    
    if (!authContainer || !app) return;
    
    // Clear the auth container content first to prevent any lingering event handlers
    authContainer.innerHTML = '';
    
    // Hide auth container and reset overlay styles (now embedded in content area)
    authContainer.style.display = 'none';
    authContainer.style.position = 'relative';
    authContainer.style.top = '';
    authContainer.style.left = '';
    authContainer.style.right = '';
    authContainer.style.bottom = '';
    authContainer.style.zIndex = '';
    authContainer.style.background = '';
    authContainer.style.backdropFilter = '';
    authContainer.style.webkitBackdropFilter = '';
    
    // Restore app visibility and interaction
    app.style.display = 'block';
    app.style.opacity = '1';
    app.style.pointerEvents = 'auto';
    app.style.filter = '';
    app.style.transform = '';
    
    // Remove any modal backdrop classes that might be lingering
    document.body.classList.remove('modal-open');
    document.documentElement.classList.remove('modal-open');
    
    // Clear any modal backdrops that might exist
    const existingBackdrops = document.querySelectorAll('.modal-backdrop, .auth-backdrop');
    existingBackdrops.forEach(backdrop => backdrop.remove());
    
    // Force a repaint to ensure all styles are applied
    authContainer.offsetHeight; // Trigger reflow
    
    console.log('Account manager closed and styles cleaned up');
  }

  /**
   * Reset all accounts and PIN
   */
  async resetAll() {
    if (!confirm('This will remove ALL accounts and reset your PIN. Are you absolutely sure?')) {
      return;
    }
    
    if (!confirm('This action cannot be undone. Please confirm again.')) {
      return;
    }
    
    try {
      console.log('Resetting all accounts and PIN');
      
      // Request main process to clear the store
      const result = await window.api.auth.resetAll();
      
      if (result.success) {
        // Reload the app to start fresh
        window.location.reload();
      } else {
        alert('Failed to reset: ' + (result.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error resetting:', error);
      alert(`Error resetting: ${error.message}`);
    }
  }
}

// Create global instance
window.authComponent = new AuthComponent();
console.log('Auth component created:', window.authComponent);