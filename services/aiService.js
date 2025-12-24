const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const cacheService = require('./cacheService');

class AIService {
  constructor() {
    this.apiKey = process.env.AIHUBMIX_API_KEY;
    this.baseURL = 'https://aihubmix.com/gemini/v1beta/models/gemini-3-pro-image-preview:streamGenerateContent';
    
    if (!this.apiKey) {
      console.warn('⚠️ AIHUBMIX_API_KEY not set. AI features will not work.');
    }
  }

  /**
   * 流式生成内容
   * @param {Object} options 生成选项
   * @param {Function} onChunk 块数据回调
   * @returns {Promise<Object>} 生成结果
   */
  async streamGenerateContent(options, onChunk) {
    if (!this.apiKey) {
      throw new Error('AIHUBMIX_API_KEY not configured');
    }

    const {
      prompt,
      modality = 'TEXT_AND_IMAGE',
      aspectRatio = '1:1',
      imageSize = '1k',
      temperature = 0.7,
      maxTokens = 2048
    } = options;

    // 构建请求体
    const requestBody = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: prompt
            }
          ]
        }
      ],
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
        responseModalities: modality === 'TEXT_AND_IMAGE' 
          ? ['TEXT', 'IMAGE'] 
          : [modality],
        ...(modality.includes('IMAGE') && {
          imageConfig: {
            aspectRatio,
            imageSize
          }
        })
      }
    };

    const headers = {
      'Content-Type': 'application/json',
      'x-goog-api-key': this.apiKey,
      'Accept': 'text/event-stream'
    };

    try {
      const response = await axios({
        method: 'POST',
        url: this.baseURL,
        headers,
        data: requestBody,
        responseType: 'stream',
        timeout: 300000 // 5分钟超时
      });

      return new Promise((resolve, reject) => {
        let buffer = '';
        let responseText = '';
        const cacheKeys = [];
        let isFirstChunk = true;
        let chunkCount = 0;

        response.data.on('data', (chunk) => {
          chunkCount++;
          const chunkStr = chunk.toString();
          buffer += chunkStr;
          
          // 尝试找到JSON对象的开始和结束
          const processed = this.processStreamBuffer(buffer, onChunk, cacheKeys);
          
          if (processed.text) {
            responseText += processed.text;
            onChunk({
              type: 'text',
              content: processed.text,
              accumulated: responseText,
              chunkIndex: chunkCount
            });
          }
          
          // 更新buffer，移除已处理的部分
          buffer = processed.remainingBuffer;
        });

        response.data.on('end', async () => {
          try {
            // 尝试处理剩余的buffer
            if (buffer.trim()) {
              const processed = this.processStreamBuffer(buffer, onChunk, cacheKeys);
              if (processed.text) {
                responseText += processed.text;
                onChunk({
                  type: 'text',
                  content: processed.text,
                  accumulated: responseText,
                  chunkIndex: chunkCount,
                  isFinal: true
                });
              }
              
              // 尝试解析buffer中可能存在的完整JSON
              const finalData = this.tryParseCompleteJSON(buffer);
              if (finalData) {
                const result = await this.processCompleteResponse(finalData, cacheKeys);
                onChunk({
                  type: 'complete',
                  data: result,
                  chunkCount
                });
              }
            }

            // 如果缓存中有图片，在完成事件中发送图片key
            if (cacheKeys.length > 0) {
              onChunk({
                type: 'image_keys',
                keys: cacheKeys,
                count: cacheKeys.length
              });
            }

            // 发送完成事件
            onChunk({
              type: 'completion',
              success: true,
              totalChunks: chunkCount,
              textLength: responseText.length,
              imageCount: cacheKeys.length
            });

            resolve({
              text: responseText,
              cacheKeys,
              success: true,
              totalChunks: chunkCount
            });

          } catch (error) {
            reject(new Error(`Final processing error: ${error.message}`));
          }
        });

        response.data.on('error', (error) => {
          reject(new Error(`Stream error: ${error.message}`));
        });
      });
      
    } catch (error) {
      if (error.response) {
        throw new Error(`API Error: ${error.response.status} - ${error.response.data}`);
      }
      throw error;
    }
  }

  /**
   * 处理流式缓冲区，尝试提取完整的JSON对象
   */
  processStreamBuffer(buffer, onChunk, cacheKeys) {
    let remainingBuffer = buffer;
    let extractedText = '';
    
    // 尝试找到完整的JSON对象（从{开始到}结束）
    const startIndex = buffer.indexOf('{');
    if (startIndex !== -1) {
      // 寻找匹配的结束括号
      let braceCount = 0;
      let inString = false;
      let escapeNext = false;
      let endIndex = -1;
      
      for (let i = startIndex; i < buffer.length; i++) {
        const char = buffer[i];
        
        if (escapeNext) {
          escapeNext = false;
          continue;
        }
        
        if (char === '\\') {
          escapeNext = true;
          continue;
        }
        
        if (char === '"' && !escapeNext) {
          inString = !inString;
          continue;
        }
        
        if (!inString) {
          if (char === '{') {
            braceCount++;
          } else if (char === '}') {
            braceCount--;
            if (braceCount === 0) {
              endIndex = i;
              break;
            }
          }
        }
      }
      
      // 如果找到了完整的JSON对象
      if (endIndex !== -1) {
        const jsonStr = buffer.substring(startIndex, endIndex + 1);
        try {
          const jsonData = JSON.parse(jsonStr);
          
          // 处理解析后的数据
          const processed = this.extractContentFromJSON(jsonData);
          
          if (processed.text) {
            extractedText = processed.text;
          }
          
          if (processed.imageData) {
            // 异步处理图片，不等待
            this.handleImageData(processed.imageData, cacheKeys)
              .then(imageKey => {
                onChunk({
                  type: 'image',
                  key: imageKey,
                  timestamp: new Date().toISOString()
                });
              })
              .catch(err => {
                console.error('Error handling image data:', err);
                onChunk({
                  type: 'error',
                  error: `Failed to save image: ${err.message}`
                });
              });
          }
          
          // 移除已处理的部分
          remainingBuffer = buffer.substring(endIndex + 1);
          
        } catch (parseError) {
          console.warn('Failed to parse JSON chunk:', parseError.message);
          // 如果没有成功解析，保持buffer不变
        }
      }
    }
    
    return {
      text: extractedText,
      remainingBuffer
    };
  }

  /**
   * 尝试解析完整的JSON响应
   */
  tryParseCompleteJSON(buffer) {
    try {
      // 清理buffer：移除可能的空白和无效字符
      const cleaned = buffer.trim();
      if (!cleaned) return null;
      
      // 尝试直接解析
      return JSON.parse(cleaned);
    } catch (error) {
      // 如果不是完整的JSON，尝试修复（如缺少结尾的括号）
      try {
        // 寻找第一个{和最后一个}
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        
        if (start !== -1 && end !== -1 && end > start) {
          const potentialJson = cleaned.substring(start, end + 1);
          return JSON.parse(potentialJson);
        }
      } catch (secondError) {
        return null;
      }
    }
    return null;
  }

  /**
   * 从JSON对象中提取内容
   */
  extractContentFromJSON(jsonData) {
    const result = { text: '', imageData: null };
    
    // Gemini API的典型响应格式
    if (jsonData.candidates && jsonData.candidates.length > 0) {
      for (const candidate of jsonData.candidates) {
        if (candidate.content && candidate.content.parts) {
          for (const part of candidate.content.parts) {
            if (part.text) {
              result.text += part.text;
            } else if (part.inlineData && part.inlineData.data) {
              result.imageData = {
                data: part.inlineData.data,
                mimeType: part.inlineData.mimeType || 'image/png'
              };
            }
          }
        }
      }
    }
    
    // 检查是否有错误
    if (jsonData.promptFeedback && jsonData.promptFeedback.blockReason) {
      throw new Error(`Request blocked: ${jsonData.promptFeedback.blockReason}`);
    }
    
    return result;
  }

  /**
   * 处理完整的API响应
   */
  async processCompleteResponse(completeData, cacheKeys) {
    const result = { text: '', images: [] };
    
    // 递归遍历数据结构，提取所有文本和图片
    const extractRecursive = (obj) => {
      if (!obj || typeof obj !== 'object') return;
      
      if (Array.isArray(obj)) {
        obj.forEach(extractRecursive);
        return;
      }
      
      // 检查是否是文本节点
      if (obj.text) {
        result.text += obj.text;
      }
      
      // 检查是否是图片数据
      if (obj.inlineData && obj.inlineData.data && obj.inlineData.mimeType) {
        const imageData = {
          data: obj.inlineData.data,
          mimeType: obj.inlineData.mimeType
        };
        result.images.push(imageData);
      }
      
      // 递归遍历所有属性
      Object.values(obj).forEach(extractRecursive);
    };
    
    extractRecursive(completeData);
    
    // 处理所有图片
    for (const imageData of result.images) {
      try {
        const imageKey = await this.handleImageData(imageData, cacheKeys);
        result.images = result.images.map(img => 
          img === imageData ? { ...img, key: imageKey } : img
        );
      } catch (error) {
        console.error('Failed to process image:', error);
      }
    }
    
    return result;
  }

  /**
   * 处理图片数据并保存到缓存
   */
  async handleImageData(imageData, cacheKeys) {
    try {
      let base64Data;
      
      // 处理不同的base64格式
      if (imageData.data.startsWith('data:')) {
        base64Data = imageData.data.replace(/^data:image\/\w+;base64,/, '');
      } else {
        base64Data = imageData.data;
      }
      
      const buffer = Buffer.from(base64Data, 'base64');
      
      // 生成唯一key并保存
      const imageKey = uuidv4();
      await cacheService.saveImage(imageKey, buffer, imageData.mimeType);
      
      cacheKeys.push(imageKey);
      return imageKey;
      
    } catch (error) {
      console.error('Error saving image to cache:', error);
      throw error;
    }
  }

  /**
   * 批量生成（非流式） - 等待所有数据返回后处理
   */
  async generateContent(options) {
    return new Promise(async (resolve, reject) => {
      try {
        const chunks = [];
        let completeResponse = null;
        
        const onChunk = (chunk) => {
          chunks.push(chunk);
          
          // 如果收到完成事件，尝试构建完整响应
          if (chunk.type === 'completion' && chunk.success) {
            // 合并所有文本块
            const textChunks = chunks
              .filter(c => c.type === 'text' && c.content)
              .map(c => c.content);
            
            // 收集所有图片key
            const imageChunks = chunks
              .filter(c => c.type === 'image' && c.key)
              .map(c => ({ key: c.key }));
            
            completeResponse = {
              text: textChunks.join(''),
              images: imageChunks,
              chunks: chunks.length,
              success: true
            };
          }
        };
        
        // 启动流式生成
        const result = await this.streamGenerateContent(options, onChunk);
        
        if (completeResponse) {
          resolve(completeResponse);
        } else {
          resolve(result);
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 简化的API调用（用于测试）
   */
  async simpleGenerate(prompt) {
    const requestBody = {
      contents: [
        {
          role: "user",
          parts: [
            {
              text: prompt
            }
          ]
        }
      ],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: {
          aspectRatio: "1:1",
          imageSize: "1k"
        }
      }
    };

    const headers = {
      'Content-Type': 'application/json',
      'x-goog-api-key': this.apiKey
    };

    try {
      const response = await axios.post(this.baseURL, requestBody, { headers });
      
      // 由于是流式API，普通POST可能不适用
      // 这里仅作演示，实际应该使用流式接口
      throw new Error('Please use streamGenerateContent for this API');
      
    } catch (error) {
      if (error.response) {
        throw new Error(`API Error: ${error.response.status} - ${error.response.data}`);
      }
      throw error;
    }
  }

  /**
   * 验证API连接
   */
  async validateConnection() {
    if (!this.apiKey) {
      return { valid: false, error: 'API key not configured' };
    }
    
    try {
      // 发送一个简单的测试请求
      const testResponse = await this.generateContent({
        prompt: 'Say "test"',
        modality: 'TEXT',
        maxTokens: 10
      });
      
      return {
        valid: true,
        reachable: true,
        responseTime: new Date().toISOString(),
        testSuccessful: !!testResponse.text
      };
    } catch (error) {
      return {
        valid: false,
        error: error.message,
        reachable: false
      };
    }
  }
}

module.exports = new AIService();