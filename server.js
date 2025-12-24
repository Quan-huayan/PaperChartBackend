require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const { Readable } = require('stream');
const AIHUBMIX_API_KEY = process.env.AIHUBMIX_API_KEY;

const pdfService = require('./services/pdfService');
const cacheService = require('./services/cacheService');
const aiService = require('./services/aiService');

const app = express();
const PORT = process.env.PORT || 2983;

// 确保目录存在
fs.ensureDirSync(process.env.UPLOAD_DIR || './uploads');
fs.ensureDirSync(path.join(process.env.CACHE_DIR || './cache', 'images'));
fs.ensureDirSync(path.join(process.env.CACHE_DIR || './cache', 'tables'));

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

// 配置 Multer 用于文件上传
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, process.env.UPLOAD_DIR || './uploads');
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('只支持 PDF 文件'), false);
    }
  }
});

// 路由
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 提取 PDF 文本、表格和图片
app.post('/api/extract', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请上传 PDF 文件' });
    }

    const filePath = req.file.path;
    const result = await pdfService.extractPDF(filePath);
    
    // 删除临时文件
    await fs.unlink(filePath);
    
    res.json(result);
  } catch (error) {
    console.error('提取失败:', error);
    res.status(500).json({ 
      error: '提取失败', 
      message: error.message 
    });
  }
});

// OCR PDF 文件
app.post('/api/ocr', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请上传 PDF 文件' });
    }

    const filePath = req.file.path;
    const result = await pdfService.ocrPDF(filePath);
    
    // 删除临时文件
    await fs.unlink(filePath);
    
    res.json(result);
  } catch (error) {
    console.error('OCR 失败:', error);
    res.status(500).json({ 
      error: 'OCR 失败', 
      message: error.message 
    });
  }
});

// 获取缓存的图片
app.get('/api/cache/image/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const imagePath = cacheService.getImagePath(key);
    
    if (!imagePath) {
      return res.status(404).json({ error: '图片不存在' });
    }
    
    res.sendFile(imagePath);
  } catch (error) {
    console.error('获取图片失败:', error);
    res.status(500).json({ error: '获取图片失败' });
  }
});

// 获取缓存的表格
app.get('/api/cache/table/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const tablePath = cacheService.getTablePath(key);
    
    if (!tablePath) {
      return res.status(404).json({ error: '表格不存在' });
    }
    
    const ext = path.extname(tablePath).toLowerCase();
    if (ext === '.csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.sendFile(tablePath);
    } else {
      res.download(tablePath);
    }
  } catch (error) {
    console.error('获取表格失败:', error);
    res.status(500).json({ error: '获取表格失败' });
  }
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'PDF Extract API' 
  });
});

// 错误处理中间件
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: '文件太大，请上传小于50MB的文件' });
    }
    return res.status(400).json({ error: err.message });
  }
  
  console.error('服务器错误:', err);
  res.status(500).json({ error: '服务器内部错误' });
});

// 流式生成内容（支持文本和图片）
app.get('/api/generate/stream', async (req, res) => {
  try {
    const { 
      prompt, 
      modality = 'TEXT_AND_IMAGE',
      aspectRatio = '1:1',
      imageSize = '1k',
      temperature = 0.7,
      maxTokens = 2048 
    } = req.query;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    if (prompt.length > (process.env.MAX_TEXT_LENGTH || 5000)) {
      return res.status(400).json({ error: 'Prompt too long' });
    }

    // 设置响应头为SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    
    // 立即发送连接成功事件
    res.write('event: connected\n');
    res.write(`data: ${JSON.stringify({ 
      status: 'connected', 
      timestamp: new Date().toISOString(),
      requestId: Date.now()
    })}\n\n`);

    // 开始流式生成
    const result = await aiService.streamGenerateContent({
      prompt,
      modality,
      aspectRatio,
      imageSize,
      temperature,
      maxTokens
    }, (chunk) => {
      console.log(`${JSON.stringify({chunk: chunk})}`);
      // 根据chunk类型发送不同的事件
      switch (chunk.type) {
        case 'text':
          res.write('event: text\n');
          res.write(`data: ${JSON.stringify({
            content: chunk.content,
            accumulated: chunk.accumulated || '',
            chunkIndex: chunk.chunkIndex || 0
          })}\n\n`);
          break;
          
        case 'image':
          res.write('event: image\n');
          res.write(`data: ${JSON.stringify({
            key: chunk.key,
            url: `/api/cache/image/${chunk.key}`,
            timestamp: chunk.timestamp
          })}\n\n`);
          break;
          
        case 'image_keys':
          res.write('event: images\n');
          res.write(`data: ${JSON.stringify({
            keys: chunk.keys,
            count: chunk.count
          })}\n\n`);
          break;
          
        case 'error':
          res.write('event: error\n');
          res.write(`data: ${JSON.stringify({
            error: chunk.error,
            timestamp: new Date().toISOString()
          })}\n\n`);
          break;
          
        case 'completion':
          res.write('event: complete\n');
          res.write(`data: ${JSON.stringify({
            status: 'complete',
            success: chunk.success,
            textLength: chunk.textLength || 0,
            imageCount: chunk.imageCount || 0,
            totalChunks: chunk.totalChunks || 0
          })}\n\n`);
          break;
      }
    });

    // 发送最终完成事件
    res.write('event: final\n');
    res.write(`data: ${JSON.stringify({
      status: 'final',
      text: result.text,
      cacheKeys: result.cacheKeys,
      success: result.success,
      timestamp: new Date().toISOString()
    })}\n\n`);
    
    res.end();
    
  } catch (error) {
    console.error('Generation error:', error);
    
    if (!res.headersSent) {
      return res.status(500).json({ 
        error: 'Generation failed', 
        message: error.message 
      });
    } else {
      // 如果已经开始流式响应，发送错误事件
      res.write('event: error\n');
      res.write(`data: ${JSON.stringify({ 
        error: error.message,
        timestamp: new Date().toISOString()
      })}\n\n`);
      
      res.write('event: final\n');
      res.write(`data: ${JSON.stringify({
        status: 'error',
        error: error.message
      })}\n\n`);
      
      res.end();
    }
  }
});

// 批量生成（非流式）
app.post('/api/generate/batch', async (req, res) => {
  try {
    const { 
      prompt, 
      modality = 'TEXT_AND_IMAGE',
      aspectRatio = '1:1',
      imageSize = '1k',
      temperature = 0.7,
      maxTokens = 2048 
    } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const result = await aiService.generateContent({
      prompt,
      modality,
      aspectRatio,
      imageSize,
      temperature,
      maxTokens
    });

    res.json(result);
  } catch (error) {
    console.error('Batch generation error:', error);
    res.status(500).json({ 
      error: 'Generation failed', 
      message: error.message 
    });
  }
});

// 获取缓存的图片
app.get('/api/cache/image/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const { size = 'original' } = req.query;
    
    const imagePath = cacheService.getImagePath(key, size);
    
    if (!imagePath) {
      return res.status(404).json({ error: 'Image not found' });
    }

    // 根据文件扩展名设置Content-Type
    const ext = path.extname(imagePath).toLowerCase();
    const mimeTypes = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp'
    };

    res.setHeader('Content-Type', mimeTypes[ext] || 'image/png');
    res.sendFile(path.resolve(imagePath));
  } catch (error) {
    console.error('Get image error:', error);
    res.status(500).json({ error: 'Failed to get image' });
  }
});

// 获取缓存信息
app.get('/api/cache/info/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const info = cacheService.getImageInfo(key);
    
    if (!info) {
      return res.status(404).json({ error: 'Image not found in cache' });
    }

    res.json(info);
  } catch (error) {
    console.error('Get cache info error:', error);
    res.status(500).json({ error: 'Failed to get cache info' });
  }
});

// 上传图片进行生成（支持多模态输入）
app.post('/api/upload/generate', (req, res) => {
  const bb = busboy({ headers: req.headers });
  let prompt = '';
  let imageBuffer = null;
  let imageMimeType = '';

  bb.on('field', (name, val) => {
    if (name === 'prompt') prompt = val;
  });

  bb.on('file', (name, file, info) => {
    const { filename, mimeType } = info;
    const chunks = [];
    
    file.on('data', (chunk) => {
      chunks.push(chunk);
    });

    file.on('end', () => {
      imageBuffer = Buffer.concat(chunks);
      imageMimeType = mimeType;
    });
  });

  bb.on('close', async () => {
    try {
      if (!prompt && !imageBuffer) {
        return res.status(400).json({ error: 'Either prompt or image is required' });
      }

      // 如果有图片，先保存到缓存
      let imageKey = null;
      if (imageBuffer) {
        imageKey = await cacheService.saveImageFromBuffer(imageBuffer, imageMimeType);
      }

      // 调用AI服务（这里简化为文本生成）
      const result = await aiService.generateContent({
        prompt: prompt || 'Describe this image',
        imageKey: imageKey || undefined,
        modality: 'TEXT'
      });

      res.json({
        ...result,
        uploadedImageKey: imageKey
      });
    } catch (error) {
      console.error('Upload generation error:', error);
      res.status(500).json({ 
        error: 'Generation failed', 
        message: error.message 
      });
    }
  });

  req.pipe(bb);
});

// 清理缓存
app.post('/api/cache/cleanup', async (req, res) => {
  try {
    const { maxAgeHours = 24 } = req.body;
    const result = await cacheService.cleanupOldFiles(maxAgeHours);
    
    res.json({
      success: true,
      message: 'Cache cleanup completed',
      deletedFiles: result.deletedCount,
      freedSpace: result.freedSpace
    });
  } catch (error) {
    console.error('Cache cleanup error:', error);
    res.status(500).json({ error: 'Cache cleanup failed' });
  }
});

// 获取系统状态
app.get('/api/status', async (req, res) => {
  try {
    const cacheStats = cacheService.getStats();
    const systemStats = {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cacheEnabled: process.env.ENABLE_CACHE === 'true',
      maxImageSize: process.env.MAX_IMAGE_SIZE || '1MB',
      maxTextLength: process.env.MAX_TEXT_LENGTH || 5000
    };

    res.json({
      system: systemStats,
      cache: cacheStats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Status error:', error);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

// 404处理
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not found',
    path: req.path,
    method: req.method
  });
});

app.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
  console.log(`上传目录: ${process.env.UPLOAD_DIR || './uploads'}`);
  console.log(`缓存目录: ${process.env.CACHE_DIR || './cache'}`);
  console.log(`🚀 AI Image Generator running on http://localhost:${PORT}`);
  console.log(`📁 Cache directory: ${process.env.CACHE_DIR || './cache'}`);
  console.log(`📁 Upload directory: ${process.env.UPLOAD_DIR || './uploads'}`);
  console.log(`🔑 API Key configured: ${process.env.AIHUBMIX_API_KEY ? 'Yes' : 'No'}`);
});