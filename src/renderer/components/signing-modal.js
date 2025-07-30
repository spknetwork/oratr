// Transaction Signing Modal Component

class SigningModal {
    constructor() {
        this.modal = null;
        this.currentRequest = null;
        this.autoSignEnabled = false;
        this.loadAutoSignPreference();
    }

    init() {
        // Create modal HTML with custom styling
        const modalHTML = `
            <div id="signingModal" class="signing-modal" style="display: none;">
                <div class="signing-modal-backdrop"></div>
                <div class="signing-modal-dialog">
                    <div class="signing-modal-content">
                        <div class="signing-modal-header">
                            <h5 class="signing-modal-title">
                                Transaction Signature Required
                            </h5>
                        </div>
                        <div class="signing-modal-body">
                            <div class="signing-alert">
                                Please review and sign this transaction
                            </div>
                            
                            <div class="transaction-details">
                                <h6>Transaction Type:</h6>
                                <p id="txType" class="text-muted"></p>
                                
                                <h6>Operation Details:</h6>
                                <pre id="txDetails" class="code-block"></pre>
                                
                                <h6>Required Key:</h6>
                                <p id="txKeyType" class="text-muted"></p>
                                
                                <h6>Account:</h6>
                                <p id="txAccount" class="text-muted"></p>
                            </div>
                            
                            <div class="form-check">
                                <input type="checkbox" id="autoSignCheckbox">
                                <label for="autoSignCheckbox">
                                    Automatically sign similar transactions
                                </label>
                            </div>
                            
                            <div class="signing-modal-actions">
                                <button type="button" class="btn btn-secondary" onclick="signingModal.reject()">
                                    Cancel
                                </button>
                                <button type="button" class="btn btn-primary" onclick="signingModal.approve()">
                                    Sign & Broadcast
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // Add modal to page
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        
        // Store modal element reference
        this.modalElement = document.getElementById('signingModal');
        
        // Add custom styles
        this.addModalStyles();
        
        // Add backdrop click handler
        const backdrop = this.modalElement.querySelector('.signing-modal-backdrop');
        backdrop.addEventListener('click', () => {
            this.reject();
        });
        
        // Add auto-sign preferences modal
        this.addAutoSignPreferencesModal();
    }

    addModalStyles() {
        const styles = `
            <style>
                .signing-modal {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    z-index: 10000;
                }
                
                .signing-modal-backdrop {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.8);
                }
                
                .signing-modal-dialog {
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    max-width: 600px;
                    width: 90%;
                }
                
                .signing-modal-content {
                    background: #2a2a2a;
                    border-radius: 8px;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
                    color: #fff;
                }
                
                .signing-modal-header {
                    padding: 20px;
                    border-bottom: 1px solid #444;
                }
                
                .signing-modal-title {
                    margin: 0;
                    font-size: 20px;
                }
                
                .signing-modal-body {
                    padding: 20px;
                }
                
                .signing-alert {
                    background: #17a2b8;
                    color: white;
                    padding: 12px 16px;
                    border-radius: 4px;
                    margin-bottom: 20px;
                }
                
                .transaction-details {
                    margin-bottom: 20px;
                }
                
                .transaction-details h6 {
                    color: #ddd;
                    margin-bottom: 8px;
                    margin-top: 16px;
                }
                
                .transaction-details h6:first-child {
                    margin-top: 0;
                }
                
                .transaction-details p {
                    margin: 0;
                    color: #999;
                }
                
                .transaction-details pre {
                    background: #1a1a1a;
                    padding: 12px;
                    border-radius: 4px;
                    overflow-x: auto;
                    font-size: 12px;
                    color: #0f0;
                    border: 1px solid #333;
                }
                
                .form-check {
                    margin: 20px 0;
                }
                
                .form-check input[type="checkbox"] {
                    margin-right: 8px;
                }
                
                .signing-modal-actions {
                    display: flex;
                    justify-content: space-between;
                    gap: 10px;
                }
                
                .text-muted {
                    color: #999 !important;
                }
            </style>
        `;
        
        document.head.insertAdjacentHTML('beforeend', styles);
    }

    showModal() {
        if (this.modalElement) {
            this.modalElement.style.display = 'block';
        }
    }

    hideModal() {
        if (this.modalElement) {
            this.modalElement.style.display = 'none';
        }
    }

    addAutoSignPreferencesModal() {
        const prefsHTML = `
            <div id="autoSignPrefsModal" class="signing-modal" style="display: none;">
                <div class="signing-modal-backdrop"></div>
                <div class="signing-modal-dialog">
                    <div class="signing-modal-content">
                        <div class="signing-modal-header">
                            <h5 class="signing-modal-title">
                                Auto-Sign Preferences
                            </h5>
                        </div>
                        <div class="signing-modal-body">
                            <h6>Allowed Operations:</h6>
                            <div class="allowed-operations">
                                <div class="form-check">
                                    <input type="checkbox" id="autoSignTransfer" disabled>
                                    <label class="form-check-label" for="autoSignTransfer">
                                        Token Transfers (Never auto-sign)
                                    </label>
                                </div>
                                <div class="form-check">
                                    <input type="checkbox" id="autoSignContract">
                                    <label for="autoSignContract">
                                        Storage Contracts
                                    </label>
                                </div>
                                <div class="form-check">
                                    <input type="checkbox" id="autoSignUpload">
                                    <label for="autoSignUpload">
                                        File Uploads
                                    </label>
                                </div>
                                <div class="form-check">
                                    <input type="checkbox" id="autoSignValidator">
                                    <label for="autoSignValidator">
                                        Validator Operations
                                    </label>
                                </div>
                            </div>
                            
                            <div class="signing-alert" style="background: #ff9800; margin-top: 20px;">
                                <strong>Security Notice:</strong> Auto-signing bypasses transaction review. 
                                Only enable for operations you trust.
                            </div>
                            
                            <div class="signing-modal-actions">
                                <button type="button" class="btn btn-secondary" onclick="document.getElementById('autoSignPrefsModal').style.display='none'">
                                    Cancel
                                </button>
                                <button type="button" class="btn btn-primary" onclick="signingModal.saveAutoSignPrefs()">
                                    Save Preferences
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', prefsHTML);
        
        // Add backdrop click handler for auto-sign prefs modal
        const prefsModal = document.getElementById('autoSignPrefsModal');
        const prefsBackdrop = prefsModal.querySelector('.signing-modal-backdrop');
        prefsBackdrop.addEventListener('click', () => {
            prefsModal.style.display = 'none';
        });
    }

    async requestSignature(transaction, keyType = 'posting', account = null) {
        return new Promise((resolve, reject) => {
            this.currentRequest = { resolve, reject };
            
            // Check if auto-sign is enabled for this operation type
            const opType = this.getOperationType(transaction);
            if (this.shouldAutoSign(opType)) {
                resolve({ autoSigned: true });
                return;
            }
            
            // Show transaction details
            document.getElementById('txType').textContent = opType;
            document.getElementById('txDetails').textContent = JSON.stringify(transaction.operations || transaction, null, 2);
            document.getElementById('txKeyType').textContent = keyType.toUpperCase();
            document.getElementById('txAccount').textContent = account || window.currentAccount || 'Unknown';
            
            // Reset checkbox
            document.getElementById('autoSignCheckbox').checked = false;
            
            // Show modal
            this.showModal();
        });
    }

    approve() {
        if (this.currentRequest) {
            // Check if auto-sign was enabled
            const autoSign = document.getElementById('autoSignCheckbox').checked;
            if (autoSign) {
                this.enableAutoSignForCurrentType();
            }
            
            this.currentRequest.resolve({ approved: true, autoSign });
            this.currentRequest = null;
            this.hideModal();
        }
    }

    reject() {
        if (this.currentRequest) {
            this.currentRequest.reject(new Error('User rejected transaction'));
            this.currentRequest = null;
            this.hideModal();
        }
    }

    getOperationType(transaction) {
        if (!transaction.operations || !transaction.operations.length) {
            return 'Unknown';
        }
        
        const op = transaction.operations[0];
        const opName = op[0];
        const opData = op[1];
        
        if (opName === 'custom_json') {
            const id = opData.id;
            if (id === 'spkccT_channel_open') return 'Storage Contract';
            if (id === 'spkccT_register_service') return 'Register Storage Node';
            if (id === 'spkccT_register_authority') return 'Register Authority';
            if (id === 'spkccT_validator_burn') return 'Register Validator';
            return `Custom JSON: ${id}`;
        }
        
        return opName;
    }

    shouldAutoSign(opType) {
        if (!this.autoSignEnabled) return false;
        
        const prefs = this.getAutoSignPreferences();
        
        switch (opType) {
            case 'Storage Contract':
                return prefs.contracts;
            case 'File Upload':
                return prefs.uploads;
            case 'Register Validator':
                return prefs.validator;
            default:
                return false;
        }
    }

    enableAutoSignForCurrentType() {
        const opType = document.getElementById('txType').textContent;
        const prefs = this.getAutoSignPreferences();
        
        switch (opType) {
            case 'Storage Contract':
                prefs.contracts = true;
                break;
            case 'File Upload':
                prefs.uploads = true;
                break;
            case 'Register Validator':
                prefs.validator = true;
                break;
        }
        
        this.saveAutoSignPreferences(prefs);
    }

    loadAutoSignPreference() {
        const stored = localStorage.getItem('spk_autosign_enabled');
        this.autoSignEnabled = stored === 'true';
    }

    getAutoSignPreferences() {
        const stored = localStorage.getItem('spk_autosign_prefs');
        return stored ? JSON.parse(stored) : {
            contracts: false,
            uploads: false,
            validator: false
        };
    }

    saveAutoSignPreferences(prefs) {
        localStorage.setItem('spk_autosign_prefs', JSON.stringify(prefs));
    }

    saveAutoSignPrefs() {
        const prefs = {
            contracts: document.getElementById('autoSignContract').checked,
            uploads: document.getElementById('autoSignUpload').checked,
            validator: document.getElementById('autoSignValidator').checked
        };
        
        this.saveAutoSignPreferences(prefs);
        
        // Close modal
        document.getElementById('autoSignPrefsModal').style.display = 'none';
        
        // Show notification if function exists
        if (typeof showNotification === 'function') {
            showNotification('Auto-sign preferences saved', 'success');
        }
    }

    showPreferences() {
        // Load current preferences
        const prefs = this.getAutoSignPreferences();
        document.getElementById('autoSignContract').checked = prefs.contracts;
        document.getElementById('autoSignUpload').checked = prefs.uploads;
        document.getElementById('autoSignValidator').checked = prefs.validator;
        
        // Show modal
        document.getElementById('autoSignPrefsModal').style.display = 'block';
    }
}

// Create global instance
const signingModal = new SigningModal();

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SigningModal;
}