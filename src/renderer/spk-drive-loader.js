/**
 * SPK Drive Loader
 * 
 * This script loads and initializes the SPK Drive integration
 * Add this to index.html to enable SPK Drive
 */

// Function to load SPK Drive
function loadSPKDrive() {
    console.log('Loading SPK Drive integration...');
    
    // Add CSS
    const driveCSS = document.createElement('link');
    driveCSS.rel = 'stylesheet';
    driveCSS.href = './components/spk-drive-integration.css';
    document.head.appendChild(driveCSS);
    
    // Add SPK Drive script - using the simpler version for better compatibility
    const script = document.createElement('script');
    script.src = './components/spk-drive-simple.js';
    script.onload = () => {
        console.log('SPK Drive Simple script loaded');
        
        // Check if we need to refresh immediately
        const driveTab = document.getElementById('drive-tab');
        if (driveTab && driveTab.classList.contains('active') && window.currentAccount && window.isAuthenticated) {
            console.log('Drive tab is active, refreshing files');
            window.refreshFiles();
        }
    };
    document.body.appendChild(script);
}

// Load when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadSPKDrive);
} else {
    // DOM is already loaded
    loadSPKDrive();
}

console.log('SPK Drive loader script initialized');