/**
 * SPK Drive Auxiliary Files Fix
 * 
 * This patch improves the display of auxiliary/hidden files in SPK Drive
 * by showing them in a simple list format instead of broken thumbnails
 */

// Add this CSS to properly style auxiliary files
const auxiliaryStyles = `
  .auxiliary-section {
    margin-top: 2rem;
    padding: 1rem;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 8px;
  }
  
  .auxiliary-section .section-header {
    font-size: 1.1rem;
    font-weight: 600;
    margin-bottom: 1rem;
    color: #888;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  
  .auxiliary-section .section-header::before {
    content: '👁️';
    opacity: 0.5;
  }
  
  .auxiliary-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  
  .auxiliary-item {
    display: flex;
    align-items: center;
    padding: 0.75rem;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 4px;
    transition: background 0.2s;
    cursor: pointer;
    font-size: 0.9rem;
  }
  
  .auxiliary-item:hover {
    background: rgba(0, 0, 0, 0.4);
  }
  
  .auxiliary-item .file-info {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex: 1;
  }
  
  .auxiliary-item .file-icon {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.6;
  }
  
  .auxiliary-item .file-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  .auxiliary-item .file-type {
    font-size: 0.8rem;
    color: #666;
    text-transform: uppercase;
    padding: 0.125rem 0.5rem;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 3px;
  }
  
  .auxiliary-item .file-size {
    font-size: 0.8rem;
    color: #888;
    min-width: 80px;
    text-align: right;
  }
  
  .hidden-files-toggle {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    background: transparent;
    border: 1px solid #444;
    border-radius: 4px;
    color: #888;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .hidden-files-toggle:hover {
    border-color: #666;
    color: #aaa;
  }
  
  .hidden-files-toggle.active {
    background: rgba(255, 255, 255, 0.1);
    border-color: #888;
    color: #fff;
  }
  
  .hidden-files-count {
    font-size: 0.85rem;
    padding: 0.125rem 0.5rem;
    background: rgba(255, 255, 255, 0.15);
    border-radius: 12px;
  }
`;

// Function to identify auxiliary file type
function getAuxiliaryFileType(file) {
  const fullName = file.name + (file.ext ? '.' + file.ext : '');
  const lowerName = fullName.toLowerCase();
  
  // Video-related auxiliary files
  if (lowerName.includes('_poster.')) return 'poster';
  if (lowerName.endsWith('.ts')) return 'segment';
  if (lowerName.endsWith('.m3u8')) return 'playlist';
  if (lowerName.includes('_thumb')) return 'thumb';
  if (lowerName.includes('thumbnail')) return 'thumb';
  
  // Check if it's a thumbnail for a video
  if (file.isAuxiliary) {
    const ext = file.ext?.toLowerCase();
    if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
      return 'thumb';
    }
  }
  
  return 'aux';
}

// Function to get icon for auxiliary file type
function getAuxiliaryFileIcon(type) {
  const icons = {
    'poster': '🎬',
    'segment': '📹',
    'playlist': '📋',
    'thumb': '🖼️',
    'aux': '📎'
  };
  return icons[type] || '📄';
}

// Enhanced Vue component template for auxiliary files section
const auxiliaryFilesTemplate = `
  <!-- Hidden Files Toggle in toolbar -->
  <button 
    class="hidden-files-toggle"
    :class="{ active: showAuxiliary }"
    @click="showAuxiliary = !showAuxiliary"
    title="Toggle hidden files"
  >
    <span>👁️</span>
    <span>Hidden Files</span>
    <span class="hidden-files-count">{{ auxiliaryFiles.length }}</span>
  </button>

  <!-- Hidden Files Section (at bottom of file list) -->
  <div v-if="showAuxiliary && auxiliaryFiles.length > 0" class="auxiliary-section">
    <div class="section-header">
      Hidden Files
      <span style="font-size: 0.9rem; color: #666;">
        (thumbnails, video segments, and other auxiliary files)
      </span>
    </div>
    
    <div class="auxiliary-list">
      <div 
        v-for="file in sortedAuxiliaryFiles"
        :key="file.cid"
        class="auxiliary-item"
        @click="openAuxiliaryFile(file)"
        :title="file.cid"
      >
        <div class="file-info">
          <span class="file-icon">{{ getAuxiliaryFileIcon(getAuxiliaryFileType(file)) }}</span>
          <span class="file-name">{{ file.name }}{{ file.ext ? '.' + file.ext : '' }}</span>
          <span class="file-type">{{ getAuxiliaryFileType(file) }}</span>
          <span class="file-size">{{ formatFileSize(file.size) }}</span>
        </div>
      </div>
    </div>
  </div>
`;

// Vue methods to add for auxiliary files
const auxiliaryMethods = {
  getAuxiliaryFileType,
  getAuxiliaryFileIcon,
  
  openAuxiliaryFile(file) {
    // Open in IPFS gateway
    const url = `https://ipfs.dlux.io/ipfs/${file.cid}`;
    window.open(url, '_blank');
  },
  
  get sortedAuxiliaryFiles() {
    // Sort auxiliary files by type and name
    return this.auxiliaryFiles.slice().sort((a, b) => {
      const typeA = this.getAuxiliaryFileType(a);
      const typeB = this.getAuxiliaryFileType(b);
      
      if (typeA !== typeB) {
        // Sort by type first
        const typeOrder = ['thumb', 'poster', 'playlist', 'segment', 'aux'];
        return typeOrder.indexOf(typeA) - typeOrder.indexOf(typeB);
      }
      
      // Then by name
      const nameA = a.name + (a.ext ? '.' + a.ext : '');
      const nameB = b.name + (b.ext ? '.' + b.ext : '');
      return nameA.localeCompare(nameB);
    });
  }
};

// Function to apply the fix to SPK Drive Advanced
function applyAuxiliaryFilesFix() {
  // Add styles
  const styleElement = document.createElement('style');
  styleElement.textContent = auxiliaryStyles;
  document.head.appendChild(styleElement);
  
  console.log('[SPK Drive] Auxiliary files fix applied - hidden files will now display as a simple list');
}

// Export for use in SPK Drive
export {
  applyAuxiliaryFilesFix,
  auxiliaryFilesTemplate,
  auxiliaryMethods,
  getAuxiliaryFileType,
  getAuxiliaryFileIcon
};