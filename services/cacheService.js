const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class CacheService {
  constructor() {
    this.baseDir = process.env.CACHE_DIR || './cache';
    this.imagesDir = path.join(this.baseDir, 'images');
    this.tablesDir = path.join(this.baseDir, 'tables');
    
    // 确保目录存在
    fs.ensureDirSync(this.imagesDir);
    fs.ensureDirSync(this.tablesDir);
    
    console.log(`[CacheService] 图片缓存目录: ${this.imagesDir}`);
    console.log(`[CacheService] 表格缓存目录: ${this.tablesDir}`);
  }

  /**
   * 保存图片到缓存
   * @param {string} key 图片唯一标识
   * @param {Buffer} buffer 图片数据
   * @param {string} mimeType 图片MIME类型
   * @returns {Promise<string>} 保存的文件路径
   */
  async saveImage(key, buffer, mimeType = 'image/png') {
    try {
      // 根据MIME类型确定文件扩展名
      const extMap = {
        'image/png': '.png',
        'image/jpeg': '.jpg',
        'image/jpg': '.jpg',
        'image/gif': '.gif',
        'image/webp': '.webp'
      };
      
      const extension = extMap[mimeType] || '.png';
      const filename = `${key}${extension}`;
      const filePath = path.join(this.imagesDir, filename);
      
      // 保存文件
      await fs.writeFile(filePath, buffer);
      
      console.log(`[CacheService] 图片已保存: ${filePath} (${buffer.length} 字节)`);
      return filePath;
    } catch (error) {
      console.error('[CacheService] 保存图片失败:', error);
      throw new Error(`Failed to save image: ${error.message}`);
    }
  }

  /**
   * 保存图片从Buffer（兼容aiService.js中的调用）
   * @param {Buffer} buffer 图片数据
   * @param {string} mimeType 图片MIME类型
   * @returns {Promise<string>} 生成的图片key
   */
  async saveImageFromBuffer(buffer, mimeType = 'image/png') {
    try {
      const imageKey = uuidv4();
      await this.saveImage(imageKey, buffer, mimeType);
      return imageKey;
    } catch (error) {
      console.error('[CacheService] 从Buffer保存图片失败:', error);
      throw error;
    }
  }

  /**
   * 根据key获取图片文件路径
   * @param {string} key 图片key
   * @param {string} size 图片尺寸
   * @returns {string|null} 文件路径或null
   */
  getImagePath(key, size = 'original') {
    try {
      // 尝试不同的文件扩展名
      const extensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
      
      for (const ext of extensions) {
        const filename = `${key}${ext}`;
        const filePath = path.join(this.imagesDir, filename);
        
        if (fs.existsSync(filePath)) {
          console.log(`[CacheService] 找到图片: ${filePath}`);
          return filePath;
        }
      }
      
      console.warn(`[CacheService] 图片不存在: ${key}`);
      return null;
    } catch (error) {
      console.error('[CacheService] 获取图片路径失败:', error);
      return null;
    }
  }

  /**
   * 获取图片信息
   * @param {string} key 图片key
   * @returns {Object|null} 图片信息或null
   */
  getImageInfo(key) {
    try {
      const filePath = this.getImagePath(key);
      if (!filePath) return null;
      
      const stats = fs.statSync(filePath);
      return {
        key,
        path: filePath,
        size: stats.size,
        modified: stats.mtime,
        exists: true
      };
    } catch (error) {
      console.error('[CacheService] 获取图片信息失败:', error);
      return null;
    }
  }

  /**
   * 清理过期文件
   * @param {number} maxAgeHours 最大保存时间（小时）
   * @returns {Promise<Object>} 清理结果
   */
  async cleanupOldFiles(maxAgeHours = 24) {
    try {
      const cutoffTime = Date.now() - (maxAgeHours * 60 * 60 * 1000);
      let deletedCount = 0;
      let freedSpace = 0;
      
      // 清理图片文件
      const files = await fs.readdir(this.imagesDir);
      for (const file of files) {
        const filePath = path.join(this.imagesDir, file);
        const stats = fs.statSync(filePath);
        
        if (stats.mtime.getTime() < cutoffTime) {
          await fs.remove(filePath);
          deletedCount++;
          freedSpace += stats.size;
        }
      }
      
      console.log(`[CacheService] 清理完成: 删除 ${deletedCount} 个文件, 释放 ${freedSpace} 字节`);
      
      return {
        deletedCount,
        freedSpace,
        cutoffTime: new Date(cutoffTime).toISOString()
      };
    } catch (error) {
      console.error('[CacheService] 清理文件失败:', error);
      throw error;
    }
  }

  /**
   * 获取缓存统计信息
   * @returns {Object} 统计信息
   */
  getStats() {
    try {
      const imageFiles = fs.readdirSync(this.imagesDir);
      const tableFiles = fs.readdirSync(this.tablesDir);
      
      let totalSize = 0;
      for (const file of imageFiles) {
        const filePath = path.join(this.imagesDir, file);
        if (fs.existsSync(filePath)) {
          const stats = fs.statSync(filePath);
          totalSize += stats.size;
        }
      }
      
      return {
        imageCount: imageFiles.length,
        tableCount: tableFiles.length,
        totalSize,
        totalSizeMB: Math.round(totalSize / (1024 * 1024) * 100) / 100,
        baseDir: this.baseDir,
        imagesDir: this.imagesDir,
        tablesDir: this.tablesDir
      };
    } catch (error) {
      console.error('[CacheService] 获取统计信息失败:', error);
      return {
        error: error.message
      };
    }
  }

  /**
   * 保存表格到缓存
   * @param {string} key 表格key
   * @param {string} content 表格内容
   * @param {string} format 表格格式
   * @returns {Promise<string>} 保存的文件路径
   */
  async saveTable(key, content, format = 'csv') {
    try {
      const filename = `${key}.${format}`;
      const filePath = path.join(this.tablesDir, filename);
      
      await fs.writeFile(filePath, content);
      
      console.log(`[CacheService] 表格已保存: ${filePath}`);
      return filePath;
    } catch (error) {
      console.error('[CacheService] 保存表格失败:', error);
      throw error;
    }
  }

  /**
   * 获取表格文件路径
   * @param {string} key 表格key
   * @returns {string|null} 文件路径或null
   */
  getTablePath(key) {
    try {
      const extensions = ['.csv', '.xlsx', '.xls'];
      
      for (const ext of extensions) {
        const filename = `${key}${ext}`;
        const filePath = path.join(this.tablesDir, filename);
        
        if (fs.existsSync(filePath)) {
          return filePath;
        }
      }
      
      return null;
    } catch (error) {
      console.error('[CacheService] 获取表格路径失败:', error);
      return null;
    }
  }

  /**
   * 调试方法：列出所有缓存文件
   * @returns {Array} 文件列表
   */
  listAllFiles() {
    try {
      const files = [];
      
      // 列出图片文件
      const imageFiles = fs.readdirSync(this.imagesDir);
      for (const file of imageFiles) {
        const filePath = path.join(this.imagesDir, file);
        const stats = fs.statSync(filePath);
        files.push({
          type: 'image',
          filename: file,
          path: filePath,
          size: stats.size,
          modified: stats.mtime
        });
      }
      
      // 列出表格文件
      const tableFiles = fs.readdirSync(this.tablesDir);
      for (const file of tableFiles) {
        const filePath = path.join(this.tablesDir, file);
        const stats = fs.statSync(filePath);
        files.push({
          type: 'table',
          filename: file,
          path: filePath,
          size: stats.size,
          modified: stats.mtime
        });
      }
      
      return files.sort((a, b) => b.modified - a.modified);
    } catch (error) {
      console.error('[CacheService] 列出文件失败:', error);
      return [];
    }
  }

  /**
   * 调试方法：检查特定key的图片是否存在
   * @param {string} key 图片key
   * @returns {Object} 检查结果
   */
  checkImageExists(key) {
    try {
      const extensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
      const results = [];
      
      for (const ext of extensions) {
        const filename = `${key}${ext}`;
        const filePath = path.join(this.imagesDir, filename);
        
        if (fs.existsSync(filePath)) {
          const stats = fs.statSync(filePath);
          results.push({
            filename,
            path: filePath,
            exists: true,
            size: stats.size,
            modified: stats.mtime
          });
        } else {
          results.push({
            filename,
            path: filePath,
            exists: false
          });
        }
      }
      
      const existingFiles = results.filter(r => r.exists);
      return {
        key,
        results,
        exists: existingFiles.length > 0,
        foundFiles: existingFiles
      };
    } catch (error) {
      console.error('[CacheService] 检查图片失败:', error);
      return {
        key,
        error: error.message,
        exists: false
      };
    }
  }

  async getImageBuffer(key) {
    try {
      // 根据你的缓存实现来获取图片Buffer
      // 这里假设你有一个方法可以从缓存中获取图片数据
      const filePath = this.getImagePath(key);
      return await fs.readFile(filePath);
    } catch (error) {
      console.error(`获取图片 ${key} 失败:`, error);
      return null;
    }
  }
  
  async deleteImage(key) {
    try {
      const filePath = this.getImagePath(key);
      await fs.unlink(filePath);
      return true;
    } catch (error) {
      console.error(`删除图片 ${key} 失败:`, error);
      return false;
    }
  }
}

module.exports = new CacheService();