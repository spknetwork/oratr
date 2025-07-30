/**
 * File API polyfill for Node.js
 * Provides File and Blob classes compatible with spk-js expectations
 */

const { Blob } = require('buffer');

/**
 * File class implementation for Node.js
 * Extends Blob with file-specific properties
 */
class File extends Blob {
  constructor(fileBits, fileName, options = {}) {
    super(fileBits, options);
    
    this.name = fileName;
    this.lastModified = options.lastModified || Date.now();
    this.lastModifiedDate = new Date(this.lastModified);
    this.webkitRelativePath = '';
  }
}

// Export for use in Node.js environment
module.exports = { File, Blob };

// Make available globally if not already defined
if (typeof global.File === 'undefined') {
  global.File = File;
}

if (typeof global.Blob === 'undefined') {
  global.Blob = Blob;
}