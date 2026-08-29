// AuraPDF Frontend Application JS

document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const smartInvertCheckbox = document.getElementById('smart-invert');
    const dpiSlider = document.getElementById('dpi-slider');
    const dpiVal = document.getElementById('dpi-val');
    const qualitySlider = document.getElementById('quality-slider');
    const qualityVal = document.getElementById('quality-val');
    const brightnessSlider = document.getElementById('brightness-slider');
    const brightnessVal = document.getElementById('brightness-val');
    const threadsSelect = document.getElementById('threads-select');
    const themeSelect = document.getElementById('theme-select');
    
    // Custom Color Elements
    const customColorsPanel = document.getElementById('custom-colors-panel');
    const customBgColor = document.getElementById('custom-bg-color');
    const customTextColor = document.getElementById('custom-text-color');
    const customSatSlider = document.getElementById('custom-sat-slider');
    const customSatVal = document.getElementById('custom-sat-val');
    
    // File Selected Card Elements
    const fileSelectedCard = document.getElementById('file-selected-card');
    const selectedFilename = document.getElementById('selected-filename');
    const selectedFilesize = document.getElementById('selected-filesize');
    const applyAllBtn = document.getElementById('apply-all-btn');
    const changeFileBtn = document.getElementById('change-file-btn');
    
    // Page preview and AI DOM Elements
    const previewPageInput = document.getElementById('preview-page-input');
    
    // Preview Images
    const previewLightImg = document.getElementById('preview-light-img');
    const previewDarkImg = document.getElementById('preview-dark-img');
    const defaultLightSrc = previewLightImg.src;
    const defaultDarkSrc = previewDarkImg.src;
    
    // View Panels
    const uploadSection = document.getElementById('upload-section');
    const processingSection = document.getElementById('processing-section');
    const completedSection = document.getElementById('completed-section');
    
    // Progress Indicators
    const progressCircle = document.getElementById('progress-circle');
    const progressPercent = document.getElementById('progress-percent');
    const progressPageCount = document.getElementById('progress-page-count');
    const statusTitle = document.getElementById('status-title');
    const statusDetail = document.getElementById('status-detail');
    const consoleLog = document.getElementById('console-log');
    
    // Results
    const resFilename = document.getElementById('res-filename');
    const resPages = document.getElementById('res-pages');
    const downloadBtn = document.getElementById('download-btn');
    const convertAnotherBtn = document.getElementById('convert-another-btn');
    
    // PDF Viewer iframe Elements
    const pdfViewerContainer = document.getElementById('pdf-viewer-container');
    const pdfViewerIframe = document.getElementById('pdf-viewer-iframe');
    
    // Auth DOM Elements
    const openLoginBtn = document.getElementById('open-login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const authModal = document.getElementById('auth-modal');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const authModalTitle = document.getElementById('auth-modal-title');
    const authUsernameInput = document.getElementById('auth-username-input');
    const authPasswordInput = document.getElementById('auth-password-input');
    const authSubmitBtn = document.getElementById('auth-submit-btn');
    const authToggleLink = document.getElementById('auth-toggle-link');
    const authToggleMsg = document.getElementById('auth-toggle-msg');
    const authLoggedOut = document.getElementById('auth-logged-out');
    const authLoggedIn = document.getElementById('auth-logged-in');
    const authUsername = document.getElementById('auth-username');
    const userDashboardPanel = document.getElementById('user-dashboard-panel');
    const historyList = document.getElementById('history-list');
    const historyCount = document.getElementById('history-count');

    const sharedList = document.getElementById('shared-list');
    const sharedCount = document.getElementById('shared-count');
    const sharedDashboardPanel = document.getElementById('shared-dashboard-panel');

    
    let currentTaskId = null;
    let uploadFileObject = null;
    let isRegisterMode = false;
    
    // --- Telemetry Plugin for Converter ---
    class ConverterTracker {
        constructor() {
            this.name = 'converter';
            this.status = 'Idle';
            this.progress = '0%';
            this.queuePos = 'N/A';
        }
        gather(metrics) {
            metrics['pd-conv-status'] = this.status;
            metrics['pd-conv-prog'] = this.progress;
            metrics['pd-conv-queue'] = this.queuePos;
        }
        updateState(status, progress, queue) {
            if (status !== undefined) this.status = status;
            if (progress !== undefined) this.progress = progress;
            if (queue !== undefined) this.queuePos = queue;
        }
    }
    
    let converterTracker = null;
    if (window.AuraPerf) {
        converterTracker = new ConverterTracker();
        window.AuraPerf.registerCustomStat({ id: 'pd-conv-status', label: 'Conv. Status', tooltip: 'Current phase of PDF conversion.' });
        window.AuraPerf.registerCustomStat({ id: 'pd-conv-prog', label: 'Conv. Progress', tooltip: 'Percentage converted.' });
        window.AuraPerf.registerCustomStat({ id: 'pd-conv-queue', label: 'Queue Position', tooltip: 'Position in server queue.' });
        window.AuraPerf.core.registerPlugin(converterTracker);
    }
    // --------------------------------------
    
    // Circle progress calculations
    const radius = progressCircle.r.baseVal.value;
    const circumference = 2 * Math.PI * radius;
    
    progressCircle.style.strokeDasharray = `${circumference} ${circumference}`;
    progressCircle.style.strokeDashoffset = circumference;
    
    function setProgress(percent) {
        const offset = circumference - (percent / 100) * circumference;
        progressCircle.style.strokeDashoffset = offset;
        progressPercent.textContent = `${Math.round(percent)}%`;
    }

    // UI Slider Updates
    dpiSlider.addEventListener('input', () => {
        dpiVal.textContent = `${dpiSlider.value} DPI`;
    });

    qualitySlider.addEventListener('input', () => {
        qualityVal.textContent = `${qualitySlider.value}%`;
    });

    brightnessSlider.addEventListener('input', () => {
        brightnessVal.textContent = `${brightnessSlider.value}x`;
    });

    customSatSlider.addEventListener('input', () => {
        customSatVal.textContent = `${customSatSlider.value}x`;
    });

    themeSelect.addEventListener('change', () => {
        if (themeSelect.value === 'custom') {
            customColorsPanel.style.display = 'block';
        } else {
            customColorsPanel.style.display = 'none';
        }
    });

    // Helper: Convert hex color #RRGGBB to {r, g, b}
    function hexToRgb(hex) {
        var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : null;
    }

    // Logging helpers
    function addLog(message, type = 'system') {
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
        consoleLog.appendChild(entry);
        consoleLog.scrollTop = consoleLog.scrollHeight;
    }

    // View switcher
    function switchView(viewName) {
        [uploadSection, processingSection, completedSection].forEach(section => {
            section.classList.remove('active');
        });
        
        if (viewName === 'upload') {
            uploadSection.classList.add('active');
        } else if (viewName === 'processing') {
            processingSection.classList.add('active');
        } else if (viewName === 'completed') {
            completedSection.classList.add('active');
        }
    }

    // Interactive Preview updates
    function updateLivePreview() {
        if (!currentTaskId) return;
        
        const pageNum = parseInt(previewPageInput.value) || 1;
        const smartInvert = smartInvertCheckbox.checked;
        const brightness = brightnessSlider.value;
        const colorMode = themeSelect.value;
        
        let urlParams = `task_id=${currentTaskId}&page_num=${pageNum}&color_mode=${colorMode}&brightness=${brightness}&smart_invert=${smartInvert}&dpi=100`;

        if (colorMode === 'custom') {
            const bgRgb = hexToRgb(customBgColor.value);
            const textRgb = hexToRgb(customTextColor.value);
            const sat = customSatSlider.value;
            
            if (bgRgb) {
                urlParams += `&custom_bg_r=${bgRgb.r}&custom_bg_g=${bgRgb.g}&custom_bg_b=${bgRgb.b}`;
            }
            if (textRgb) {
                urlParams += `&custom_text_r=${textRgb.r}&custom_text_g=${textRgb.g}&custom_text_b=${textRgb.b}`;
            }
            urlParams += `&custom_sat=${sat}`;
        }
        
        // Show local loading state
        previewLightImg.style.opacity = 0.5;
        previewDarkImg.style.opacity = 0.5;
        
        const newLightImg = new Image();
        newLightImg.onload = () => {
            previewLightImg.src = newLightImg.src;
            previewLightImg.style.opacity = 1;
        };
        newLightImg.onerror = () => { previewLightImg.style.opacity = 1; addLog("Error loading original preview.", "system"); };
        newLightImg.src = `/api/preview/render?${urlParams}&preview_type=original`;
        
        const newDarkImg = new Image();
        newDarkImg.onload = () => {
            previewDarkImg.src = newDarkImg.src;
            previewDarkImg.style.opacity = 1;
        };
        newDarkImg.onerror = () => { previewDarkImg.style.opacity = 1; addLog("Error loading dark preview.", "system"); };
        newDarkImg.src = `/api/preview/render?${urlParams}&preview_type=dark`;
    }

    // Attach general preview listeners
    smartInvertCheckbox.addEventListener('change', updateLivePreview);
    brightnessSlider.addEventListener('change', updateLivePreview);
    previewPageInput.addEventListener('change', updateLivePreview);
    previewPageInput.addEventListener('input', updateLivePreview);
    themeSelect.addEventListener('change', updateLivePreview);
    customBgColor.addEventListener('input', updateLivePreview);
    customTextColor.addEventListener('input', updateLivePreview);
    customSatSlider.addEventListener('input', updateLivePreview);

    // Drag and Drop events
    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.add('dragover');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('dragover');
        }, false);
    });

    dropZone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) {
            handleFile(files[0]);
        }
    });

    dropZone.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', () => {
        if (fileInput.files.length > 0) {
            handleFile(fileInput.files[0]);
        }
    });

    // Handle Upload and Preview phase
    function handleFile(file) {
        const ext = file.name.split('.').pop().toLowerCase();
        if (!['pdf', 'epub', 'md'].includes(ext)) {
            alert('Please upload a valid PDF, EPUB, or Markdown document.');
            return;
        }
        
        uploadFileObject = file;
        currentTaskId = null;
        
        // Hide PDF Preview Viewer
        pdfViewerContainer.style.display = 'none';
        pdfViewerIframe.src = '';
        
        // Show upload indicator state
        addLog(`Uploading file context to server: ${file.name}...`);
        
        const uploadFormData = new FormData();
        uploadFormData.append('file', file);
        
        const token = localStorage.getItem('token');
        const headers = {};
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        
        fetch('/api/upload', {
            method: 'POST',
            body: uploadFormData,
            headers: headers
        })
        .then(async res => {
            if (!res.ok) { const txt = await res.text(); throw new Error(txt || 'Upload context initialization failed.'); }
            return res.json();
        })
        .then(data => {
            currentTaskId = data.task_id;
            
            // If it's an EPUB or MD, instantly redirect to the Reader
            if (data.ext === 'epub' || data.ext === 'md') {
                addLog(`Native format detected. Redirecting to Reader...`);
                window.location.href = `/reader-enhanced?task_id=${data.task_id}`;
                return;
            }
            
            // Set slider limits based on actual page count
            previewPageInput.max = data.total_pages;
            if (parseInt(previewPageInput.value) > data.total_pages) {
                previewPageInput.value = data.total_pages;
            }
            
            // Update File Selection UI Card
            selectedFilename.textContent = file.name;
            selectedFilesize.innerHTML = `${(file.size / 1024 / 1024).toFixed(2)} MB &bull; ${data.total_pages} pages`;
            
            dropZone.style.display = 'none';
            fileSelectedCard.style.display = 'block';
            
            addLog(`File context ready on server! Total pages: ${data.total_pages}. Loading page preview...`);
            updateLivePreview();
        })
        .catch(err => {
            addLog(`Error during upload: ${err.message}`, 'system');
            alert(`Upload failed: ${err.message}`);
        });
    }

    // Trigger full conversion
    applyAllBtn.addEventListener('click', () => {
        if (!currentTaskId || !uploadFileObject) return;
        
        switchView('processing');
        setProgress(0);
        consoleLog.innerHTML = '';
        addLog(`Compiling full document in parallel: ${uploadFileObject.name}...`);
        
        const convertFormData = new FormData();
        convertFormData.append('dpi', dpiSlider.value);
        convertFormData.append('quality', qualitySlider.value);
        convertFormData.append('smart_invert', smartInvertCheckbox.checked);
        convertFormData.append('brightness', brightnessSlider.value);
        
        convertFormData.append('color_mode', themeSelect.value);
        convertFormData.append('threads', threadsSelect.value);
        convertFormData.append('fontFamily', document.getElementById('font-family-select') ? document.getElementById('font-family-select').value : 'original');
        convertFormData.append('fontQuality', document.getElementById('font-quality-select') ? document.getElementById('font-quality-select').value : 8);
        convertFormData.append('concurrencyMode', document.getElementById('concurrency-select') ? document.getElementById('concurrency-select').value : 'auto');
        
        if (themeSelect.value === 'custom') {
            const bgRgb = hexToRgb(customBgColor.value);
            const textRgb = hexToRgb(customTextColor.value);
            
            if (bgRgb) {
                convertFormData.append('custom_bg_r', bgRgb.r);
                convertFormData.append('custom_bg_g', bgRgb.g);
                convertFormData.append('custom_bg_b', bgRgb.b);
            }
            if (textRgb) {
                convertFormData.append('custom_text_r', textRgb.r);
                convertFormData.append('custom_text_g', textRgb.g);
                convertFormData.append('custom_text_b', textRgb.b);
            }
            convertFormData.append('custom_sat', customSatSlider.value);
        }
        
        fetch(`/api/convert/${currentTaskId}`, {
            method: 'POST',
            body: convertFormData
        })
        .then(async res => {
            if (!res.ok) { const txt = await res.text(); throw new Error(txt || 'Conversion task launch failed.'); }
            return res.json();
        })
        .then(data => {
            addLog(`Parallel task running on backend! Scheduling status polls...`);
            pollStatus(currentTaskId, uploadFileObject.name);
        })
        .catch(err => {
            addLog(`Launch Error: ${err.message}`, 'system');
            statusTitle.textContent = 'Launch Failed';
            statusDetail.textContent = err.message;
        });
    });

    // Handle Reset/Change File button click
    function resetUploader() {
        fileInput.value = '';
        currentTaskId = null;
        uploadFileObject = null;
        previewLightImg.src = defaultLightSrc;
        previewDarkImg.src = defaultDarkSrc;
        pdfViewerIframe.src = '';
        pdfViewerContainer.style.display = 'none';
        
        fileSelectedCard.style.display = 'none';
        dropZone.style.display = 'flex';
        switchView('upload');
        if (converterTracker) converterTracker.updateState('Idle', '0%', 'N/A');
        loadUserHistory(); loadSharedFiles(); // Reload history log dashboard
    }

    changeFileBtn.addEventListener('click', resetUploader);
    convertAnotherBtn.addEventListener('click', resetUploader);

    // Poll conversion status
    function pollStatus(taskId, filename) {
        let pollCount = 0;
        const maxPolls = 300;
        const intervalId = setInterval(() => {
            pollCount++;
            if (pollCount > maxPolls) {
                clearInterval(intervalId);
                addLog("Status polling timed out after 5 minutes.", "system");
                statusTitle.textContent = 'Timed Out';
                statusDetail.textContent = 'Server took too long to respond.';
                return;
            }
            fetch(`/api/status/${taskId}`)
            .then(async res => {
                if (!res.ok) { const txt = await res.text(); throw new Error(txt || 'Status check failed'); }
                return res.json();
            })
            .then(data => {
                if (data.status === 'pending') {
                    if (converterTracker) converterTracker.updateState('Pending', '0%', data.queue_position);
                    statusTitle.textContent = 'Pending in Queue...';
                    statusDetail.textContent = `Queue position: ${data.queue_position}`;
                    addLog(`In queue (Position ${data.queue_position}). Please wait...`);
                }
                else if (data.status === 'processing') {
                    const progress = data.total > 0 ? (data.progress / data.total) * 100 : 0;
                    if (converterTracker) converterTracker.updateState('Processing', Math.round(progress) + '%', 'Active');
                    statusTitle.textContent = 'Processing PDF...';
                    statusDetail.textContent = `Rendering and mapping pages in parallel`;
                    
                    setProgress(progress);
                    progressPageCount.textContent = `Page ${data.progress} of ${data.total}`;
                    
                    if (data.progress > 0) {
                        addLog(`Processed page ${data.progress}/${data.total}`, 'progress');
                    }
                } 
                else if (data.status === 'completed') {
                    if (converterTracker) converterTracker.updateState('Completed', '100%', 'Done');
                    clearInterval(intervalId);
                    setProgress(100);
                    addLog('Document processing complete!', 'progress');
                    addLog('Finalizing searchable text overlays...');
                    
                    // Show success screen
                    setTimeout(() => {
                        resFilename.textContent = filename;
                        resPages.textContent = data.total;
                        downloadBtn.href = `/api/download-file/${taskId}`;
                        
                        const readerBtn = document.getElementById('open-reader-btn');
                        if (readerBtn) readerBtn.href = `/reader-enhanced?task_id=${taskId}`;
                        
                        // Set PDF.js inline viewer iframe source
                        pdfViewerIframe.src = `/api/download/${taskId}`;
                        pdfViewerContainer.style.display = 'block';
                        
                        switchView('completed');
                    }, 800);
                } 
                else if (data.status === 'failed') {
                    if (converterTracker) converterTracker.updateState('Failed', '0%', 'Error');
                    clearInterval(intervalId);
                    addLog(`Error during conversion: ${data.error}`, 'system');
                    statusTitle.textContent = 'Conversion Failed';
                    statusDetail.textContent = data.error;
                }
            })
            .catch(err => {
                clearInterval(intervalId);
                addLog(`Connection error: ${err.message}`, 'system');
                statusTitle.textContent = 'Connection Lost';
                statusDetail.textContent = 'Failed to fetch task updates';
            });
        }, 1000);
    }

    // ----------------- User Authentication & Dashboard Logic -----------------

    function updateAuthStateUI() {
        const token = localStorage.getItem('token');
        const username = localStorage.getItem('username');
        
        if (token && username) {
            authLoggedOut.style.display = 'none';
            authLoggedIn.style.display = 'inline';
            authUsername.textContent = username;
            loadUserHistory(); loadSharedFiles();
        } else {
            authLoggedOut.style.display = 'inline';
            authLoggedIn.style.display = 'none';
            userDashboardPanel.style.display = 'none';
        }
    }

    
    async function loadSharedFiles() {
        if (!sharedDashboardPanel) return;
        try {
            const res = await fetch('/api/public/shared', {
                headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('token') || '') }
            });
            if (!res.ok) throw new Error('Failed to fetch shared files');
            const data = await res.json();
            
            sharedList.innerHTML = '';
            sharedCount.textContent = `${data.length} files`;
            
            if (data.length === 0) {
                sharedList.innerHTML = `<div style="text-align: center; color: #888; padding: 20px; font-size: 0.9rem;">No shared files available.</div>`;
            } else {
                data.forEach(item => {
                    const row = document.createElement('div');
                    row.style.display = 'flex';
                    row.style.justifyContent = 'space-between';
                    row.style.background = 'rgba(0, 242, 254, 0.05)';
                    row.style.border = '1px solid rgba(0, 242, 254, 0.2)';
                    row.style.borderRadius = '8px';
                    row.style.padding = '10px 14px';
                    row.style.fontSize = '0.85rem';
                    row.style.marginBottom = '8px';
                    row.style.cursor = 'pointer';
                    
                    const isCompatible = item.filename.toLowerCase().match(/\.(pdf|epub|md|txt)$/);
                    const readButtonHtml = isCompatible 
                        ? `<div onclick="window.location.href = 'reader.html?task_id=${item.task_id}';" style="color: #00f2fe; text-decoration: underline; cursor: pointer;">Read</div>`
                        : '';
                        
                    row.innerHTML = `
                        <div style="font-weight: 500; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 150px;" title="${item.filename}">📄 ${item.filename}</div>
                        <div style="display: flex; gap: 15px;">
                            ${readButtonHtml}
                            <div onclick="window.location.href = '/api/download-file/${item.task_id}';" style="color: #4CAF50; text-decoration: underline; cursor: pointer;">Download</div>
                        </div>
                    `;
                    row.style.cursor = 'default';
                    sharedList.appendChild(row);
                });
            }
            sharedDashboardPanel.style.display = 'block';
        } catch (err) {
            console.error('Shared files load failed:', err);
        }
    }

    function loadUserHistory() {
        const token = localStorage.getItem('token');
        if (!token) return;
        
        fetch('/api/history', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        })
        .then(async res => {
            if (!res.ok) { const txt = await res.text(); throw new Error(txt || 'Failed to fetch history log'); }
            return res.json();
        })
        .then(data => {
            historyList.innerHTML = '';
            historyCount.textContent = `${data.length} files`;
            
            if (data.length === 0) {
                historyList.innerHTML = `<div style="text-align: center; color: #888; padding: 20px; font-size: 0.9rem;">No conversions recorded yet.</div>`;
            } else {
                data.forEach(item => {
                    const row = document.createElement('div');
                    row.style.display = 'flex';
                    row.style.justifyContent = 'space-between';
                    row.style.background = 'rgba(255, 255, 255, 0.03)';
                    row.style.border = '1px solid rgba(255, 255, 255, 0.05)';
                    row.style.borderRadius = '8px';
                    row.style.padding = '10px 14px';
                    row.style.fontSize = '0.85rem';
                    
                    const dateStr = new Date(item.created_at * 1000).toLocaleDateString();
                    row.innerHTML = `
                        <div style="font-weight: 500; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 250px;">📄 ${item.filename}</div>
                        <div style="color: var(--text-secondary);">${item.pages_count} pages &bull; ${dateStr}</div>
                    `;
                    historyList.appendChild(row);
                });
            }
            userDashboardPanel.style.display = 'block';
        loadSharedFiles();
        })
        .catch(err => {
            console.error('History load failed:', err);
            addLog(`History load failed: ${err.message}`, 'system');
        });
    }

    // Modal UI events
    openLoginBtn.addEventListener('click', () => {
        authUsernameInput.value = '';
        authPasswordInput.value = '';
        isRegisterMode = false;
        authModalTitle.textContent = '🔑 Sign In';
        authSubmitBtn.textContent = 'Sign In';
        authToggleMsg.textContent = "Don't have an account?";
        authToggleLink.textContent = 'Register here';
        authModal.style.display = 'flex';
    });

    closeModalBtn.addEventListener('click', () => {
        authModal.style.display = 'none';
    });

    authToggleLink.addEventListener('click', (e) => {
        e.preventDefault();
        isRegisterMode = !isRegisterMode;
        if (isRegisterMode) {
            authModalTitle.textContent = '📝 Register';
            authSubmitBtn.textContent = 'Create Account';
            authToggleMsg.textContent = 'Already have an account?';
            authToggleLink.textContent = 'Sign in here';
        } else {
            authModalTitle.textContent = '🔑 Sign In';
            authSubmitBtn.textContent = 'Sign In';
            authToggleMsg.textContent = "Don't have an account?";
            authToggleLink.textContent = 'Register here';
        }
    });

    authSubmitBtn.addEventListener('click', () => {
        const username = authUsernameInput.value.trim();
        const password = authPasswordInput.value;
        
        if (!username || !password) {
            alert('Please enter both username and password.');
            return;
        }
        
        const path = isRegisterMode ? '/api/auth/register' : '/api/auth/login';
        authSubmitBtn.textContent = 'Verifying...';
        authSubmitBtn.disabled = true;
        
        fetch(path, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        })
        .then(async res => {
            if (!res.ok) { const txt = await res.text(); throw new Error(txt || (isRegisterMode ? 'Registration failed.' : 'Invalid credentials.')); }
            return res.json();
        })
        .then(data => {
            localStorage.setItem('token', data.token);
            localStorage.setItem('username', data.username);
            
            if (window.saveUsernameProfile) {
                window.saveUsernameProfile(data.username);
            } else if (window.settingsRepo) {
                window.settingsRepo.set('username', data.username);
                window.currentUsername = data.username;
            }
            
            authModal.style.display = 'none';
            authSubmitBtn.disabled = false;
            
            updateAuthStateUI();
        })
        .catch(err => {
            authSubmitBtn.disabled = false;
            authSubmitBtn.textContent = isRegisterMode ? 'Create Account' : 'Sign In';
            alert(err.message);
        });
    });

    logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('token');
        localStorage.removeItem('username');
        updateAuthStateUI();
    });

    // Initialize Auth UI state on start
    updateAuthStateUI();
});
