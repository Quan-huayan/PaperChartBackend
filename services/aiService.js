const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const cacheService = require('./cacheService');

class AIService {
  constructor() {
    this.apiKey = process.env.AIHUBMIX_API_KEY;
    this.baseURL = 'https://aihubmix.com/gemini/v1beta/models/gemini-3-pro-image-preview:streamGenerateContent';
    this.llmBaseURL = 'https://api.aihubmix.com/v1';
    
    if (!this.apiKey) {
      console.warn('⚠️ AIHUBMIX_API_KEY not set. AI features will not work.');
    }
  }

  // Phase 1: 文本分析 (保持不变)
  async generateAcademicPrompt(paperText) {
    console.log("🚀 [Phase 1] AI 学术分析开始...");
    if (!this.apiKey) throw new Error('API Key missing');

    try {
        const response = await axios.post(`${this.llmBaseURL}/chat/completions`, {
            model: "deepseek-chat", 
            messages: [
                { 
                    role: "system", 
                    content: `你是一个专业学术科研助手。请分析论文正文，输出以下4个部分，每个部分之间严格用 "###" 分隔，内容不要包含编号：
Summary: 详细学术摘要(200-400字)。
Prompt: 一段高质量英文生图指令(Subject + Style + Rendering)。
Authors: 作者列表，仅逗号分隔。
Keywords: 5个核心关键词，仅逗号分隔。` 
                },
                { role: "user", content: `论文内容：${paperText.substring(0, 50000)}` }
            ],
            temperature: 0.7
        }, {
            headers: { 'Authorization': `Bearer ${this.apiKey}` },
            timeout: 60000 
        });
        return response.data.choices[0].message.content.trim();
    } catch (error) {
        console.error("❌ [Phase 1] 失败:", error.message);
        return "Summary: 失败###Prompt: A futuristic sci-fi lab###Authors: Unkown###Keywords: Error";
    }
  }

  // Phase 2: 核心工作流
async generateFromPaper(paperText, onChunk) {
    // 拦截器：只允许图片和错误流出，绝对屏蔽文本
    const wrappedOnChunk = (chunk) => {
        if (chunk.type === 'image' || chunk.type === 'error') {
            onChunk(chunk);
        }
    };

    // 并发启动 4 个生成任务
    const tasks = Array(4).fill(0).map((_, i) => 
        this.streamGenerateContent({
            prompt: paperText, // 这里的 paperText 是 Stage 1 生成的精炼 Prompt
            modality: 'TEXT_AND_IMAGE',
            aspectRatio: '1:1',
            imageSize: '1k'
        }, wrappedOnChunk).catch(err => {
            console.error(`Task ${i} 失败:`, err.message);
            return { success: false };
        })
    );

    const results = await Promise.all(tasks);
    const allKeys = results.flatMap(r => r.cacheKeys || []);
    return { success: true, cacheKeys: allKeys };
}

  // Phase 3: 底层流式生成 (关键修复区域)
  async streamGenerateContent(options, onChunk) {
    if (!this.apiKey) throw new Error('API Key Config Missing');

    const { prompt, modality, aspectRatio, imageSize } = options;

    const requestBody = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { aspectRatio, imageSize }
      }
    };

    try {
      console.log("🎨 [Phase 2] 发起生图请求...");
      const response = await axios({
        method: 'POST',
        url: this.baseURL,
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
          'Accept': 'text/event-stream'
        },
        data: requestBody,
        responseType: 'stream',
        timeout: 300000 
      });

      return new Promise((resolve, reject) => {
        let buffer = '';
        let responseText = '';
        const cacheKeys = [];
        let chunkCount = 0;
        
        // 💡 关键修复：任务队列，用于追踪所有未完成的异步操作（如保存图片）
        const pendingTasks = [];

        response.data.on('data', (chunk) => {
          chunkCount++;
          buffer += chunk.toString();
          
          // 传递 pendingTasks 数组进去，让内部把异步任务推入队列
          const processed = this.processStreamBuffer(buffer, onChunk, cacheKeys, pendingTasks);
          
          if (processed.text) {
            responseText += processed.text;
            onChunk({ type: 'text', content: processed.text });
          }
          buffer = processed.remainingBuffer;
        });

        response.data.on('end', async () => {
          try {
            // 处理残留 Buffer
            if (buffer.trim()) {
              const processed = this.processStreamBuffer(buffer, onChunk, cacheKeys, pendingTasks);
              if (processed.text) {
                 responseText += processed.text;
                 onChunk({ type: 'text', content: processed.text });
              }
              // 尝试终极解析
              const finalData = this.tryParseCompleteJSON(buffer);
              if (finalData) {
                 // 处理完整响应中的图片
                 const task = this.processCompleteResponse(finalData, cacheKeys, onChunk);
                 pendingTasks.push(task);
              }
            }

            // 💡 关键等待：必须等待所有图片保存任务完成！
            // 之前的 Bug 就是因为没等这一步，直接 resolve 了，导致图片事件没发出去
            if (pendingTasks.length > 0) {
                console.log(`⏳ 等待 ${pendingTasks.length} 个图片保存任务完成...`);
                await Promise.all(pendingTasks);
                console.log(`✅ 所有图片保存完毕`);
            }

            // 发送完成信号
            onChunk({ type: 'completion', success: true, imageCount: cacheKeys.length });
            resolve({ text: responseText, cacheKeys, success: true });

          } catch (error) {
            reject(new Error(`Final processing error: ${error.message}`));
          }
        });

        response.data.on('error', (err) => reject(err));
      });
      
    } catch (error) {
      if (error.response) console.error("API Error Data:", error.response.data);
      throw error;
    }
  }

  // --- 辅助方法 (增加 pendingTasks 支持) ---

  processStreamBuffer(buffer, onChunk, cacheKeys, pendingTasks) {
    let remainingBuffer = buffer;
    let extractedText = '';
    
    // 简单的 JSON 提取逻辑 (寻找配对的 {})
    let startIndex = buffer.indexOf('{');
    while (startIndex !== -1) {
      let braceCount = 0;
      let endIndex = -1;
      let inString = false;
      
      for (let i = startIndex; i < buffer.length; i++) {
        if (buffer[i] === '"' && buffer[i-1] !== '\\') inString = !inString;
        if (!inString) {
          if (buffer[i] === '{') braceCount++;
          if (buffer[i] === '}') braceCount--;
          if (braceCount === 0) { endIndex = i; break; }
        }
      }

      if (endIndex !== -1) {
        const jsonStr = buffer.substring(startIndex, endIndex + 1);
        try {
          const jsonData = JSON.parse(jsonStr);
          const content = this.extractContentFromJSON(jsonData);
          
          if (content.text) extractedText += content.text;
          
          if (content.imageData) {
            // 💡 这是一个异步任务，把它推入队列
            const task = this.handleImageData(content.imageData, cacheKeys)
              .then(imageKey => {
                console.log(`📸 图片保存成功 (Async): ${imageKey}`);
                onChunk({ type: 'image', key: imageKey, timestamp: new Date().toISOString() });
              })
              .catch(err => console.error("图片保存失败:", err));
            
            if (pendingTasks) pendingTasks.push(task);
          }
          
          // 移动 buffer 指针
          remainingBuffer = buffer.substring(endIndex + 1);
          startIndex = remainingBuffer.indexOf('{'); // 继续找下一个
          // 更新 buffer 以便下一次循环使用正确的索引基础
          buffer = remainingBuffer; 
          continue; 

        } catch (e) {
          // 解析失败可能是 JSON 不完整，跳出等待更多数据
          break;
        }
      } else {
        break; // 没有找到闭合括号
      }
    }
    
    return { text: extractedText, remainingBuffer };
  }

  extractContentFromJSON(jsonData) {
    const result = { text: '', imageData: null };
    // 适配 Gemini API 结构
    const parts = jsonData.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if (part.text) result.text += part.text;
      if (part.inlineData) result.imageData = part.inlineData; // { mimeType, data }
    }
    return result;
  }

  async processCompleteResponse(data, cacheKeys, onChunk) {
    // 递归查找所有 inlineData
    const findImages = (obj) => {
        if (!obj) return [];
        if (obj.mimeType && obj.data) return [obj];
        if (Array.isArray(obj)) return obj.flatMap(findImages);
        if (typeof obj === 'object') return Object.values(obj).flatMap(findImages);
        return [];
    };

    const images = findImages(data);
    for (const img of images) {
        try {
            const key = await this.handleImageData(img, cacheKeys);
            onChunk({ type: 'image', key: key });
        } catch (e) { console.error(e); }
    }
  }

  async handleImageData(inlineData, cacheKeys) {
    const buffer = Buffer.from(inlineData.data, 'base64');
    const key = uuidv4();
    await cacheService.saveImage(key, buffer, inlineData.mimeType);
    cacheKeys.push(key);
    return key;
  }

  tryParseCompleteJSON(str) { try { return JSON.parse(str); } catch { return null; } }
}

module.exports = new AIService();