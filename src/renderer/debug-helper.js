// Debug helper for Oratr
// Add this to the console to check global state

window.debugSPK = {
    checkAccount: function() {
        console.log('=== Oratr Debug Info ===');
        console.log('window.currentAccount:', window.currentAccount);
        console.log('isAuthenticated:', window.isAuthenticated);
        console.log('refreshFiles exists:', typeof window.refreshFiles === 'function');
        console.log('refreshFiles._patched:', window.refreshFiles?._patched);
        
        // Check if account element shows the account
        const accountEl = document.getElementById('account-name');
        console.log('Account display:', accountEl?.textContent);
        
        // Check current tab
        const activeTab = document.querySelector('.tab-content.active');
        console.log('Active tab:', activeTab?.id);
        
        return {
            account: window.currentAccount,
            authenticated: window.isAuthenticated,
            activeTab: activeTab?.id
        };
    },
    
    testFiles: async function() {
        if (!window.currentAccount) {
            console.error('No account set!');
            return;
        }
        
        console.log('Testing file fetch for:', window.currentAccount);
        try {
            const response = await fetch(`https://spkinstant.hivehoneycomb.com/@${window.currentAccount}`);
            const data = await response.json();
            console.log('API Response:', data);
            console.log('File contracts:', Object.keys(data.file_contracts || {}).length);
            return data;
        } catch (error) {
            console.error('API Error:', error);
        }
    },
    
    refreshDrive: function() {
        console.log('Manually refreshing drive...');
        if (window.refreshFiles) {
            window.refreshFiles();
        } else {
            console.error('refreshFiles not available');
        }
    }
};

console.log('Debug helper loaded. Use window.debugSPK.checkAccount() to check state.');