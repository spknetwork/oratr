// Override the complex upload function with a simple one
window.startFinalUpload = async function() {
    const uploadMethod = document.querySelector('input[name="upload-method"]:checked')?.value;
    if (!uploadMethod) {
        showNotification('Please select an upload method', 'error');
        return;
    }
    
    // Hide upload method selection, show upload progress
    document.getElementById('upload-method-selection').style.display = 'none';
    document.getElementById('upload-logs-container').style.display = 'block';
    
    const uploadContainer = document.getElementById('upload-logs');
    const progressFill = document.getElementById('upload-progress-fill');
    const progressText = document.getElementById('upload-progress-text');
    
    uploadContainer.innerHTML = '';
    
    function addUploadLog(message, type = 'info') {
        const logEntry = document.createElement('div');
        logEntry.className = `log-entry log-${type}`;
        logEntry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
        uploadContainer.appendChild(logEntry);
        uploadContainer.scrollTop = uploadContainer.scrollHeight;
    }
    
    try {
        addUploadLog('Starting upload to SPK Network...', 'info');
        
        // Get files to upload
        const filesToUpload = [];
        for (const [filename, file] of ipfsReadyFiles) {
            filesToUpload.push(file);
        }
        if (selectedThumbnail) {
            filesToUpload.push(selectedThumbnail.file);
        }
        
        addUploadLog(`Preparing to upload ${filesToUpload.length} files...`, 'info');
        
        // For now, just upload to IPFS directly
        let uploadedCount = 0;
        const uploadedFiles = {};
        
        for (const file of filesToUpload) {
            addUploadLog(`Uploading ${file.name}...`, 'info');
            
            try {
                const buffer = await file.arrayBuffer();
                const result = await window.api.invoke('ipfs:addFile', {
                    name: file.name,
                    data: Array.from(new Uint8Array(buffer))
                });
                
                if (result.success) {
                    uploadedFiles[file.name] = result.cid;
                    uploadedCount++;
                    addUploadLog(`✓ ${file.name} → ${result.cid}`, 'success');
                    
                    // Update progress
                    const progress = Math.round((uploadedCount / filesToUpload.length) * 100);
                    progressFill.style.width = `${progress}%`;
                    progressText.textContent = `${uploadedCount}/${filesToUpload.length} files uploaded`;
                } else {
                    addUploadLog(`✗ Failed to upload ${file.name}: ${result.error}`, 'error');
                }
            } catch (error) {
                addUploadLog(`✗ Error uploading ${file.name}: ${error.message}`, 'error');
            }
        }
        
        if (uploadedCount === filesToUpload.length) {
            addUploadLog('All files uploaded successfully!', 'success');
            
            // Show the master playlist URL
            const masterCid = uploadedFiles['master.m3u8'];
            if (masterCid) {
                addUploadLog(`Master playlist URL: https://ipfs.dlux.io/ipfs/${masterCid}`, 'success');
                
                // Create clickable link
                const linkEntry = document.createElement('div');
                linkEntry.className = 'log-entry log-success';
                linkEntry.innerHTML = `[${new Date().toLocaleTimeString()}] View your video: <a href="https://ipfs.dlux.io/ipfs/${masterCid}" target="_blank">https://ipfs.dlux.io/ipfs/${masterCid}</a>`;
                uploadContainer.appendChild(linkEntry);
            }
            
            progressFill.style.width = '100%';
            progressText.textContent = 'Upload complete!';
            showNotification('Video uploaded successfully!', 'success');
            
            // Show completion actions
            setTimeout(() => {
                const completionActions = document.getElementById('upload-completion-actions');
                if (completionActions) {
                    completionActions.style.display = 'block';
                }
            }, 1000);
        } else {
            throw new Error(`Only ${uploadedCount}/${filesToUpload.length} files uploaded successfully`);
        }
        
    } catch (error) {
        addUploadLog(`Upload failed: ${error.message}`, 'error');
        showNotification('Upload failed: ' + error.message, 'error');
    }
};