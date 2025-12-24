const fs = require('fs-extra');
const path = require('path');
const sharp = require('sharp');


class CacheService {
  constructor() {
    this.cacheDir = process.env.CACHE_DIR || './cache';
    this.imageDir = path.join(this.cacheDir, 'images');
    this.tableDir = path.join(this.cacheDir, 'tables');
    
    // 确保缓存目录存在
    fs.ensureDirSync(this.imageDir);
    fs.ensureDirSync(this.tableDir);

    this.stats = {
      totalImages: 0,
      totalSize: 0,
      lastCleanup: null
    };
    
    this.updateStats();
  }

/**
   * 保存图片到缓存
   */
  async saveImage(key, buffer, mimeType = 'image/png') {
    const extension = this.getExtensionFromMimeType(mimeType);
    const originalPath = path.join(this.imageDir, `${key}${extension}`);
    
    // 保存原始图片
    await fs.writeFile(originalPath, buffer);
    
    // 生成缩略图
    await this.generateThumbnail(key, buffer, extension);
    
    // 更新统计信息
    await this.updateStats();
    
    return {
      key,
      originalPath,
      thumbnailPath: path.join(this.imageDir, `${key}_thumb${extension}`),
      size: buffer.length,
      mimeType,
      createdAt: new Date().toISOString()
    };
  }

  /**
   * 从base64字符串保存图片
   */
  async saveImageFromBase64(key, base64Data, mimeType = 'image/png') {
    const buffer = Buffer.from(base64Data, 'base64');
    return this.saveImage(key, buffer, mimeType);
  }

  /**
   * 从buffer保存图片
   */
  async saveImageFromBuffer(buffer, mimeType = 'image/png') {
    const key = require('uuid').v4();
    return this.saveImage(key, buffer, mimeType);
  }

  /**
   * 生成缩略图
   */
  async generateThumbnail(key, buffer, extension) {
    try {
      const thumbnailPath = path.join(this.imageDir, `${key}_thumb${extension}`);
      
      await sharp(buffer)
        .resize(200, 200, { fit: 'inside' })
        .toFile(thumbnailPath);
      
      return thumbnailPath;
    } catch (error) {
      console.warn('Failed to generate thumbnail:', error);
      return null;
    }
  }

  /**
   * 获取图片路径
   */
  getImagePath(key, size = 'original') {
    const files = fs.readdirSync(this.imageDir);
    const pattern = size === 'thumb' ? `${key}_thumb.` : `${key}.`;
    
    for (const file of files) {
      if (file.includes(pattern)) {
        return path.join(this.imageDir, file);
      }
    }
    
    return null;
  }

  /**
   * 获取图片信息
   */
  getImageInfo(key) {
    const originalPath = this.getImagePath(key, 'original');
    const thumbPath = this.getImagePath(key, 'thumb');
    
    if (!originalPath || !fs.existsSync(originalPath)) {
      return null;
    }
    
    const stats = fs.statSync(originalPath);
    
    return {
      key,
      originalUrl: `/api/cache/image/${key}`,
      thumbnailUrl: thumbPath ? `/api/cache/image/${key}?size=thumb` : null,
      size: stats.size,
      createdAt: stats.birthtime,
      modifiedAt: stats.mtime,
      path: originalPath
    };
  }

  async saveTable(key, buffer, isCSV = true) {
    const extension = isCSV ? '.csv' : '.xlsx';
    const tablePath = path.join(this.tableDir, `${key}${extension}`);
    await fs.writeFile(tablePath, buffer);
    return tablePath;
  }

  getTablePath(key) {
    const csvPath = path.join(this.tableDir, `${key}.csv`);
    const xlsxPath = path.join(this.tableDir, `${key}.xlsx`);
    
    if (fs.existsSync(csvPath)) return csvPath;
    if (fs.existsSync(xlsxPath)) return xlsxPath;
    
    return null;
  }

  /**
   * 根据MIME类型获取文件扩展名
   */
  getExtensionFromMimeType(mimeType) {
    const map = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/gif': '.gif',
      'image/webp': '.webp'
    };
    
    return map[mimeType] || '.png';
  }

  /**
   * 更新缓存统计信息
   */
  async updateStats() {
    try {
      const files = await fs.readdir(this.imageDir);
      let totalSize = 0;
      
      for (const file of files) {
        if (!file.includes('_thumb')) { // 不统计缩略图
          const filePath = path.join(this.imageDir, file);
          const stats = await fs.stat(filePath);
          totalSize += stats.size;
        }
      }
      
      this.stats = {
        totalImages: files.filter(f => !f.includes('_thumb')).length,
        totalSize,
        lastUpdated: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error updating cache stats:', error);
    }
  }

  /**
   * 获取缓存统计
   */
  getStats() {
    return {
      ...this.stats,
      cacheDir: this.cacheDir,
      imageDir: this.imageDir,
      enabled: process.env.ENABLE_CACHE === 'true'
    };
  }

    /**
   * 删除特定key的图片
   */
  async deleteImage(key) {
    const originalPath = this.getImagePath(key, 'original');
    const thumbPath = this.getImagePath(key, 'thumb');
    
    const deleted = [];
    
    if (originalPath && fs.existsSync(originalPath)) {
      await fs.unlink(originalPath);
      deleted.push('original');
    }
    
    if (thumbPath && fs.existsSync(thumbPath)) {
      await fs.unlink(thumbPath);
      deleted.push('thumbnail');
    }
    
    await this.updateStats();
    
    return {
      success: deleted.length > 0,
      deleted,
      key,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * 清理旧文件
   */
  async cleanupOldFiles(maxAgeHours = 24) {
    const now = Date.now();
    const maxAge = maxAgeHours * 60 * 60 * 1000;
    const deletedFiles = [];
    let freedSpace = 0;
    
    try {
      const files = await fs.readdir(this.imageDir);
      
      for (const file of files) {
        const filePath = path.join(this.imageDir, file);
        const stats = await fs.stat(filePath);
        
        if (now - stats.mtimeMs > maxAge) {
          const fileSize = stats.size;
          await fs.unlink(filePath);
          
          deletedFiles.push(file);
          freedSpace += fileSize;
        }
      }
      
      await this.updateStats();
      
      return {
        deletedCount: deletedFiles.length,
        freedSpace,
        deletedFiles,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      console.error('Error during cache cleanup:', error);
      throw error;
    }
  }
}

module.exports = new CacheService();