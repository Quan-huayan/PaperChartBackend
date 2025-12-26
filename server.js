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
        const filePath = req.file.path;
        const result = await pdfService.extractPDF(filePath);

        let fullText = "";
        if (result.elements && Array.isArray(result.elements)) {
            fullText = result.elements
                .filter(el => el.Text || el.text)
                .map(el => el.Text || el.text)
                .join('\n');
        }
        const textForAI = fullText.length > 100 ? fullText : (result.text || "");

        // 💡 关键唯一性修改：调用专门的文本分析方法，而不是生图方法
        let finalSummary = "（未生成总结）";
        let finalPrompt = "";
        let finalAuthors = [];
        let finalKeywords = [];

        if (textForAI && textForAI.length > 0) {
            // 只进行文本处理
            const aiRawResponse = await aiService.generateAcademicPrompt(textForAI);
            const parts = aiRawResponse.split('###');
            
            if (parts.length >= 2) {
                finalSummary = parts[0].replace(/Summary:/i, '').trim();
                finalPrompt = parts[1].replace(/Prompt:/i, '').trim();
            }
            if (parts.length >= 3) {
                const authorsStr = parts[2].replace(/Authors:/i, '').trim();
                finalAuthors = authorsStr.split(/,|，/).map(s => s.trim()).filter(s => s);
            }
            if (parts.length >= 4) {
                const keywordsStr = parts[3].replace(/Keywords:/i, '').trim();
                finalKeywords = keywordsStr.split(/,|，/).map(s => s.trim()).filter(s => s);
            }
        }

        await fs.unlink(filePath);

        // 返回 JSON，其中 generatedPrompt 将由前端交给第二个接口
        res.json({
            text: finalSummary, 
            generatedPrompt: finalPrompt + "\n\n生图时请参考一下论文摘要：\n\n" + finalSummary,
            metadata: {
                ...result.metadata,
                title: result.metadata?.title || req.file.originalname,
                authors: finalAuthors,
                keywords: finalKeywords
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
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

// 修复后的图片获取路由 - 合并重复的路由
app.get('/api/cache/image/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const { size = 'original' } = req.query;
    
    console.log(`[Image Request] Key: ${key}, Size: ${size}`);
    
    const imagePath = cacheService.getImagePath(key, size);
    
    if (!imagePath) {
      console.log(`[Image Request] Image not found for key: ${key}`);
      return res.status(404).json({ error: 'Image not found', key });
    }

    // 检查文件是否存在
    if (!fs.existsSync(imagePath)) {
      console.log(`[Image Request] File does not exist: ${imagePath}`);
      return res.status(404).json({ error: 'Image file not found on disk', key });
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
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    console.log(`[Image Request] Serving image: ${imagePath}`);
    res.sendFile(path.resolve(imagePath));
  } catch (error) {
    console.error('Get image error:', error);
    res.status(500).json({ error: 'Failed to get image', message: error.message });
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

app.get('/api/debug/cache', (req, res) => {
  try {
    const cacheDir = process.env.CACHE_DIR || './cache';
    const imagesDir = path.join(cacheDir, 'images');
    
    if (!fs.existsSync(cacheDir)) {
      return res.json({ 
        error: 'Cache directory does not exist',
        cacheDir,
        imagesDir 
      });
    }
    
    const files = fs.readdirSync(imagesDir);
    const fileStats = files.map(file => {
      const filePath = path.join(imagesDir, file);
      const stats = fs.statSync(filePath);
      return {
        file,
        size: stats.size,
        modified: stats.mtime
      };
    });
    
    res.json({
      cacheDir,
      imagesDir,
      fileCount: files.length,
      files: fileStats
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
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
/**
 * 修改后的流式生成接口
 * 支持：论文文本 -> 自动 Prompt 优化 -> 流式生图
 */
/**
 * 修改后的流式生成接口 (带详细 Shell 日志)
 * 支持：论文文本 -> 自动 Prompt 优化 -> 流式生图
 */
app.post('/api/generate/stream', async (req, res) => {
    const requestId = uuidv4().substring(0, 8);
    try {
        const { paperText } = req.body; // 此时 paperText 已经是优化过的 Prompt

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Access-Control-Allow-Origin', '*');
        
        res.write('event: connected\n');
        res.write(`data: ${JSON.stringify({ status: 'connected' })}\n\n`);

        // 💡 调用并发生图逻辑，内部屏蔽思考文本
        const result = await aiService.generateFromPaper(paperText, (chunk) => {
            if (chunk.type === 'image') {
                res.write('event: image\n');
                res.write(`data: ${JSON.stringify({
                    key: chunk.key,
                    url: `/api/cache/image/${chunk.key}`
                })}\n\n`);
            } else if (chunk.type === 'error') {
                res.write('event: error\n');
                res.write(`data: ${JSON.stringify({ error: chunk.error })}\n\n`);
            }
        });

        res.write('event: complete\n');
        res.write(`data: ${JSON.stringify({ status: 'complete' })}\n\n`);
        res.end();
    } catch (error) {
        if (!res.headersSent) res.status(500).end();
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