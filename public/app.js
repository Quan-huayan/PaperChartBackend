class AIGenerator {
    constructor() {
        this.apiBaseUrl = window.location.origin;
        this.eventSource = null;
        this.isGenerating = false;
        this.currentGenerationId = null;
        this.startTime = null;
        this.textContent = '';
        this.images = [];
        this.history = JSON.parse(localStorage.getItem('ai_generation_history') || '[]');
        
        this.initElements();
        this.bindEvents();
        this.loadHistory();
        this.updateStatus();
        this.checkConnection();
    }

    initElements() {
        this.elements = {
            prompt: document.getElementById('prompt'),
            modality: document.getElementById('modality'),
            aspectRatio: document.getElementById('aspectRatio'),
            imageSize: document.getElementById('imageSize'),
            temperature: document.getElementById('temperature'),
            tempValue: document.getElementById('tempValue'),
            charCount: document.getElementById('charCount'),
            generateBtn: document.getElementById('generateBtn'),
            stopBtn: document.getElementById('stopBtn'),
            clearBtn: document.getElementById('clearBtn'),
            exportBtn: document.getElementById('exportBtn'),
            copyTextBtn: document.getElementById('copyTextBtn'),
            streamMessages: document.getElementById('streamMessages'),
            textOutput: document.getElementById('textOutput'),
            imageGrid: document.getElementById('imageGrid'),
            imageStats: document.getElementById('imageStats'),
            progressContainer: document.getElementById('progressContainer'),
            progressFill: document.getElementById('progressFill'),
            progressText: document.getElementById('progressText'),
            progressDetails: document.getElementById('progressDetails'),
            historyList: document.getElementById('historyList'),
            statusIndicator: document.getElementById('statusIndicator'),
            connectionStatus: document.getElementById('connectionStatus'),
            cacheStatus: document.getElementById('cacheStatus'),
            detailPanel: document.getElementById('detailPanel'),
            detailId: document.getElementById('detailId'),
            detailStartTime: document.getElementById('detailStartTime'),
            detailDuration: document.getElementById('detailDuration'),
            detailCacheKeys: document.getElementById('detailCacheKeys'),
            detailStatus: document.getElementById('detailStatus'),
            modal: document.getElementById('imageModal'),
            modalClose: document.getElementById('modalClose'),
            modalImage: document.getElementById('modalImage'),
            modalInfo: document.getElementById('modalInfo'),
            downloadBtn: document.getElementById('downloadBtn'),
            shareBtn: document.getElementById('shareBtn'),
            toastContainer: document.getElementById('toastContainer')
        };
    }

    bindEvents() {
        // 提示词输入监听
        this.elements.prompt.addEventListener('input', () => {
            const length = this.elements.prompt.value.length;
            this.elements.charCount.textContent = length;
            
            if (length > 5000) {
                this.elements.charCount.style.color = '#ef4444';
            } else if (length > 4000) {
                this.elements.charCount.style.color = '#f59e0b';
            } else {
                this.elements.charCount.style.color = '#6b7280';
            }
        });

        // 温度滑块
        this.elements.temperature.addEventListener('input', () => {
            this.elements.tempValue.textContent = this.elements.temperature.value;
        });

        // 生成按钮
        this.elements.generateBtn.addEventListener('click', () => this.startGeneration());

        // 停止按钮
        this.elements.stopBtn.addEventListener('click', () => this.stopGeneration());

        // 清空按钮
        this.elements.clearBtn.addEventListener('click', () => this.clearResults());

        // 导出按钮
        this.elements.exportBtn.addEventListener('click', () => this.exportResults());

        // 复制文本按钮
        this.elements.copyTextBtn.addEventListener('click', () => this.copyText());

        // 模态框
        this.elements.modalClose.addEventListener('click', () => this.hideModal());
        this.elements.modal.addEventListener('click', (e) => {
            if (e.target === this.elements.modal) {
                this.hideModal();
            }
        });

        // 下载和分享按钮
        this.elements.downloadBtn.addEventListener('click', () => this.downloadImage());
        this.elements.shareBtn.addEventListener('click', () => this.shareImage());

        // 键盘快捷键
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'Enter') {
                e.preventDefault();
                this.startGeneration();
            }
            if (e.key === 'Escape') {
                this.stopGeneration();
                this.hideModal();
            }
        });

        // 连接状态检查
        setInterval(() => this.checkConnection(), 30000);
    }

    async startGeneration() {
        if (this.isGenerating) {
            this.showToast('请等待当前生成完成', 'warning');
            return;
        }

        const prompt = this.elements.prompt.value.trim();
        if (!prompt) {
            this.showToast('请输入提示词', 'error');
            return;
        }

        if (prompt.length > 5000) {
            this.showToast('提示词过长，请缩短到5000字符以内', 'error');
            return;
        }

        this.resetResults();
        this.isGenerating = true;
        this.currentGenerationId = Date.now().toString();
        this.startTime = Date.now();
        
        this.updateUIForGeneration(true);
        this.updateDetails();
        
        const requestParams = new URLSearchParams({
            prompt,
            modality: this.elements.modality.value,
            aspectRatio: this.elements.aspectRatio.value,
            imageSize: this.elements.imageSize.value,
            temperature: parseFloat(this.elements.temperature.value),
            maxTokens: 2048
        });

        try {
            this.eventSource = new EventSource(`${this.apiBaseUrl}/api/generate/stream?${requestParams.toString()}&`);
            
            this.eventSource.onopen = () => {
                this.addMessage('已连接到服务器，开始生成...', 'info');
                this.updateProgress(10, '正在发送请求...');
            };

            this.eventSource.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleStreamEvent(data);
                } catch (error) {
                    console.error('解析事件数据失败:', error);
                }
            };

            this.eventSource.addEventListener('connected', (event) => {
            const data = JSON.parse(event.data);
            this.addMessage('服务器连接成功', 'success');
            this.updateProgress(20, '正在准备生成...');
            });

            this.eventSource.addEventListener('text', (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleTextChunk(data.content, data.accumulated);
            } catch (error) {
                console.error('解析文本事件失败:', error);
            }
            });

            this.eventSource.addEventListener('image', (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleImageChunk(data);
            } catch (error) {
                console.error('解析图片事件失败:', error);
            }
            });

            this.eventSource.addEventListener('images', (event) => {
            try {
                const data = JSON.parse(event.data);
                this.addMessage(`生成了 ${data.count} 张图片`, 'image');
            } catch (error) {
                console.error('解析图片列表事件失败:', error);
            }
            });

            this.eventSource.addEventListener('complete', (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleCompletion(data);
            } catch (error) {
                console.error('解析完成事件失败:', error);
            }
            });

            this.eventSource.addEventListener('final', (event) => {
            try {
                const data = JSON.parse(event.data);
                this.addMessage('流式传输完成', 'success');
                this.updateDetails();
            } catch (error) {
                console.error('解析最终事件失败:', error);
            }
            });

            this.eventSource.onerror = (error) => {
                this.handleError('连接中断，请重试');
                this.stopGeneration();
            };

        } catch (error) {
            this.handleError(error.message);
            this.stopGeneration();
        }
    }

    handleStreamEvent(data) {
        switch (data.type) {
            case 'text':
                this.handleTextChunk(data.content);
                break;
            case 'image':
                this.handleImageChunk(data);
                break;
            case 'error':
                this.handleError(data.error);
                break;
            default:
                console.log('Unknown event type:', data.type);
        }
    }

    // 更新handleTextChunk方法：
    handleTextChunk(text, accumulated = '') {
    this.textContent = accumulated || (this.textContent + text);
    this.elements.textOutput.textContent = this.textContent;
    
    // 显示简短的更新消息
    const preview = text.length > 50 ? text.substring(0, 50) + '...' : text;
    if (preview.trim()) {
        this.addMessage(`文本: ${preview}`, 'text');
    }
    
    // 基于文本长度估算进度
    const progress = Math.min(30 + (this.textContent.length / 50), 80);
    this.updateProgress(progress, '正在生成文本...');
    
    // 滚动到最新内容
    this.elements.textOutput.scrollTop = this.elements.textOutput.scrollHeight;
    }

    handleImageChunk(data) {
        const imageKey = data.key;
        const imageUrl = `${this.apiBaseUrl}${data.url}`;
        
        this.images.push({
            key: imageKey,
            url: imageUrl,
            timestamp: data.timestamp
        });
        
        this.addImageToGrid(imageKey, imageUrl);
        this.updateImageStats();
        
        this.addMessage(`图片生成完成: ${imageKey.substring(0, 8)}...`, 'image');
        this.updateProgress(95, '正在保存图片...');
    }

    handleError(error) {
        this.addMessage(`错误: ${error}`, 'error');
        this.updateProgress(0, `生成失败: ${error}`);
        this.updateStatus('error');
        this.showToast(`生成失败: ${error}`, 'error');
    }

    handleCompletion(data) {
    const duration = Date.now() - this.startTime;
    const durationText = `${(duration / 1000).toFixed(2)}秒`;
    
    this.updateProgress(100, '生成完成！');
    this.addMessage(`生成完成，耗时${durationText}，生成${data.textLength || 0}字符，${data.imageCount || 0}张图片`, 'success');
    
    this.isGenerating = false;
    this.updateUIForGeneration(false);
    this.updateDetails();
    
    // 等待一小段时间后保存到历史记录
    setTimeout(() => {
        this.saveToHistory();
    }, 1000);
    }

    addImageToGrid(key, url) {
        const imageItem = document.createElement('div');
        imageItem.className = 'image-item';
        imageItem.dataset.key = key;
        
        imageItem.innerHTML = `
            <img src="${url}" alt="生成的图片" loading="lazy">
            <div class="image-overlay">
                <div>${key.substring(0, 8)}...</div>
                <div>点击预览</div>
            </div>
        `;
        
        imageItem.addEventListener('click', () => this.showImageModal(key, url));
        this.elements.imageGrid.appendChild(imageItem);
    }

    showImageModal(key, url) {
        this.elements.modalImage.src = url;
        this.elements.modalImage.alt = `生成的图片 ${key}`;
        
        this.elements.modalInfo.innerHTML = `
            <div>键: ${key}</div>
            <div>生成时间: ${new Date().toLocaleString()}</div>
        `;
        
        this.elements.downloadBtn.dataset.key = key;
        this.elements.shareBtn.dataset.key = key;
        
        this.elements.modal.classList.add('show');
        document.body.style.overflow = 'hidden';
    }

    hideModal() {
        this.elements.modal.classList.remove('show');
        document.body.style.overflow = '';
    }

    async downloadImage() {
        const key = this.elements.downloadBtn.dataset.key;
        const imageUrl = `${this.apiBaseUrl}/api/cache/image/${key}`;
        
        try {
            const response = await fetch(imageUrl);
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `ai-generated-${key}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            
            this.showToast('图片下载成功', 'success');
        } catch (error) {
            this.showToast('下载失败', 'error');
        }
    }

    async shareImage() {
        const key = this.elements.shareBtn.dataset.key;
        
        if (navigator.share) {
            try {
                await navigator.share({
                    title: 'AI生成的图片',
                    text: '使用AI图片生成器创建的图片',
                    url: `${this.apiBaseUrl}/api/cache/image/${key}`
                });
                this.showToast('分享成功', 'success');
            } catch (error) {
                console.log('分享取消:', error);
            }
        } else {
            // 复制链接到剪贴板
            const url = `${this.apiBaseUrl}/api/cache/image/${key}`;
            navigator.clipboard.writeText(url).then(() => {
                this.showToast('链接已复制到剪贴板', 'success');
            }).catch(() => {
                this.showToast('复制失败', 'error');
            });
        }
    }

    addMessage(text, type = 'info') {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message message-${type}`;
        messageDiv.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
        
        this.elements.streamMessages.appendChild(messageDiv);
        this.elements.streamMessages.scrollTop = this.elements.streamMessages.scrollHeight;
    }

    updateProgress(percentage, details = '') {
        this.elements.progressFill.style.width = `${percentage}%`;
        this.elements.progressText.textContent = `${Math.round(percentage)}%`;
        this.elements.progressDetails.textContent = details;
    }

    updateUIForGeneration(generating) {
        this.elements.generateBtn.disabled = generating;
        this.elements.stopBtn.disabled = !generating;
        this.elements.progressContainer.style.display = generating ? 'block' : 'none';
        
        const statusDot = this.elements.statusIndicator.querySelector('.status-dot');
        const statusText = this.elements.statusIndicator.querySelector('.status-text');
        
        if (generating) {
            statusDot.style.background = '#f59e0b';
            statusText.textContent = '生成中...';
            statusDot.style.animation = 'pulse 1s infinite';
        } else {
            statusDot.style.background = '#10b981';
            statusText.textContent = '准备就绪';
            statusDot.style.animation = 'pulse 2s infinite';
        }
    }

    updateStatus(status = 'ready') {
        const statusMap = {
            ready: { text: '准备就绪', color: '#10b981' },
            generating: { text: '生成中...', color: '#f59e0b' },
            error: { text: '错误', color: '#ef4444' },
            disconnected: { text: '断开连接', color: '#6b7280' }
        };
        
        const statusInfo = statusMap[status] || statusMap.ready;
        this.elements.statusIndicator.querySelector('.status-dot').style.background = statusInfo.color;
        this.elements.statusIndicator.querySelector('.status-text').textContent = statusInfo.text;
    }

    updateDetails() {
        this.elements.detailId.textContent = this.currentGenerationId || '-';
        this.elements.detailStartTime.textContent = this.startTime 
            ? new Date(this.startTime).toLocaleString() 
            : '-';
        
        if (this.startTime && !this.isGenerating) {
            const duration = Date.now() - this.startTime;
            this.elements.detailDuration.textContent = `${(duration / 1000).toFixed(2)}秒`;
        } else if (this.startTime) {
            const duration = Date.now() - this.startTime;
            this.elements.detailDuration.textContent = `${(duration / 1000).toFixed(2)}秒 (进行中)`;
        } else {
            this.elements.detailDuration.textContent = '-';
        }
        
        this.elements.detailCacheKeys.textContent = this.images.length > 0 
            ? this.images.map(img => img.key.substring(0, 8) + '...').join(', ') 
            : '-';
        
        this.elements.detailStatus.textContent = this.isGenerating ? '生成中' : '就绪';
        this.elements.detailStatus.style.color = this.isGenerating ? '#f59e0b' : '#10b981';
    }

    updateImageStats() {
        const count = this.images.length;
        this.elements.imageStats.textContent = `${count} 张图片`;
    }

    resetResults() {
        this.textContent = '';
        this.images = [];
        this.elements.textOutput.textContent = '';
        this.elements.imageGrid.innerHTML = '';
        this.elements.streamMessages.innerHTML = '';
        this.updateImageStats();
        this.updateProgress(0, '等待开始...');
    }

    clearResults() {
        if (this.isGenerating) {
            this.showToast('请先停止生成', 'warning');
            return;
        }
        
        if (confirm('确定要清空所有生成结果吗？')) {
            this.resetResults();
            this.currentGenerationId = null;
            this.startTime = null;
            this.updateDetails();
            this.showToast('已清空结果', 'success');
        }
    }

    async exportResults() {
        if (this.textContent === '' && this.images.length === 0) {
            this.showToast('没有可导出的内容', 'warning');
            return;
        }

        const exportData = {
            id: this.currentGenerationId,
            timestamp: new Date().toISOString(),
            prompt: this.elements.prompt.value,
            settings: {
                modality: this.elements.modality.value,
                aspectRatio: this.elements.aspectRatio.value,
                imageSize: this.elements.imageSize.value,
                temperature: this.elements.temperature.value
            },
            text: this.textContent,
            images: this.images.map(img => ({
                key: img.key,
                url: img.url
            }))
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ai-generation-${this.currentGenerationId || Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
        this.showToast('导出成功', 'success');
    }

    copyText() {
        if (!this.textContent) {
            this.showToast('没有可复制的文本', 'warning');
            return;
        }

        navigator.clipboard.writeText(this.textContent).then(() => {
            this.showToast('文本已复制到剪贴板', 'success');
        }).catch(() => {
            this.showToast('复制失败', 'error');
        });
    }

    stopGeneration() {
        if (!this.isGenerating) return;
        
        this.isGenerating = false;
        this.updateUIForGeneration(false);
        
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
        
        const duration = Date.now() - this.startTime;
        this.addMessage(`生成已停止，耗时${(duration / 1000).toFixed(2)}秒`, 'warning');
        this.updateProgress(0, '已停止');
        this.updateStatus();
        this.updateDetails();
        
        this.showToast('生成已停止', 'warning');
    }

    async checkConnection() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/health`);
            if (response.ok) {
                this.elements.connectionStatus.textContent = '已连接到服务器';
                this.elements.connectionStatus.style.color = '#10b981';
                return true;
            }
        } catch (error) {
            console.log('连接检查失败:', error);
        }
        
        this.elements.connectionStatus.textContent = '服务器连接失败';
        this.elements.connectionStatus.style.color = '#ef4444';
        return false;
    }

    saveToHistory() {
        if (!this.textContent && this.images.length === 0) return;
        
        const historyItem = {
            id: this.currentGenerationId,
            timestamp: new Date().toISOString(),
            prompt: this.elements.prompt.value.substring(0, 100),
            textPreview: this.textContent.substring(0, 200),
            imageCount: this.images.length,
            data: {
                text: this.textContent,
                images: this.images
            }
        };
        
        this.history.unshift(historyItem);
        if (this.history.length > 50) {
            this.history = this.history.slice(0, 50);
        }
        
        localStorage.setItem('ai_generation_history', JSON.stringify(this.history));
        this.loadHistory();
    }

    loadHistory() {
        this.elements.historyList.innerHTML = '';
        
        if (this.history.length === 0) {
            this.elements.historyList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-clock"></i>
                    <p>暂无历史记录</p>
                </div>
            `;
            return;
        }
        
        this.history.forEach((item, index) => {
            const historyItem = document.createElement('div');
            historyItem.className = 'history-item';
            historyItem.dataset.index = index;
            
            const time = new Date(item.timestamp).toLocaleTimeString();
            const date = new Date(item.timestamp).toLocaleDateString();
            
            historyItem.innerHTML = `
                <div class="history-header">
                    <strong>${date} ${time}</strong>
                </div>
                <div class="history-preview">
                    ${item.prompt}
                </div>
                <div class="history-meta">
                    ${item.imageCount > 0 ? `<i class="fas fa-image"></i> ${item.imageCount} 张图片` : ''}
                    ${item.textPreview ? `<i class="fas fa-font"></i> ${item.textPreview.length} 字符` : ''}
                </div>
            `;
            
            historyItem.addEventListener('click', () => this.loadFromHistory(index));
            this.elements.historyList.appendChild(historyItem);
        });
    }

    loadFromHistory(index) {
        const item = this.history[index];
        if (!item) return;
        
        this.resetResults();
        this.currentGenerationId = item.id;
        this.startTime = new Date(item.timestamp).getTime();
        
        if (item.data.text) {
            this.textContent = item.data.text;
            this.elements.textOutput.textContent = this.textContent;
        }
        
        if (item.data.images) {
            this.images = item.data.images;
            this.images.forEach(img => {
                this.addImageToGrid(img.key, img.url);
            });
            this.updateImageStats();
        }
        
        this.elements.prompt.value = item.prompt;
        this.updateDetails();
        this.showToast('已加载历史记录', 'success');
    }

    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        const icons = {
            success: 'fas fa-check-circle',
            error: 'fas fa-exclamation-circle',
            warning: 'fas fa-exclamation-triangle',
            info: 'fas fa-info-circle'
        };
        
        toast.innerHTML = `
            <i class="${icons[type] || icons.info}"></i>
            <span>${message}</span>
        `;
        
        this.elements.toastContainer.appendChild(toast);
        
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(100px)';
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 300);
        }, 3000);
    }
}

// 页面加载完成后初始化应用
document.addEventListener('DOMContentLoaded', () => {
    window.aiGenerator = new AIGenerator();
    
    // 示例提示词
    const examplePrompts = [
        "a beautiful sunset over mountains, digital art",
        "a futuristic cityscape with flying cars",
        "a cute cat wearing glasses and reading a book",
        "an underwater scene with colorful coral reefs",
        "a magical forest with glowing mushrooms"
    ];
    
    // 随机选择一个示例提示词
    const randomPrompt = examplePrompts[Math.floor(Math.random() * examplePrompts.length)];
    document.getElementById('prompt').placeholder = `输入描述，例如：${randomPrompt}`;
    
    // 显示欢迎信息
    setTimeout(() => {
        window.aiGenerator.showToast('欢迎使用AI图片生成器！', 'success');
    }, 1000);
});