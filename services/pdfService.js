const {
  ServicePrincipalCredentials,
  PDFServices,
  MimeType,
  ExtractPDFParams,
  ExtractElementType,
  ExtractPDFJob,
  ExtractPDFResult,
  ExtractRenditionsElementType,
  OCRJob,
  OCRParams,
  OCRSupportedLocale,
  OCRSupportedType,
  OCRResult,
  TableStructureType,
  SDKError,
  ServiceUsageError,
  ServiceApiError
} = require("@adobe/pdfservices-node-sdk");
const fs = require("fs-extra");
const path = require("path");
const AdmZip = require("adm-zip");
const { v4: uuidv4 } = require("uuid");
const cacheService = require("./cacheService");

class PDFService {
  constructor() {
    // 验证环境变量
    if (!process.env.PDF_SERVICES_CLIENT_ID || !process.env.PDF_SERVICES_CLIENT_SECRET) {
      throw new Error('请设置 PDF_SERVICES_CLIENT_ID 和 PDF_SERVICES_CLIENT_SECRET 环境变量');
    }

    const credentials = new ServicePrincipalCredentials({
      clientId: process.env.PDF_SERVICES_CLIENT_ID,
      clientSecret: process.env.PDF_SERVICES_CLIENT_SECRET
    });

    this.pdfServices = new PDFServices({ credentials });
  }

  async extractPDF(filePath) {
    let readStream;
    try {
      // 上传 PDF 文件
      readStream = fs.createReadStream(filePath);
      const inputAsset = await this.pdfServices.upload({
        readStream,
        mimeType: MimeType.PDF
      });

      // 创建提取参数
      const params = new ExtractPDFParams({
        elementsToExtract: [ExtractElementType.TEXT, ExtractElementType.TABLES],
        elementsToExtractRenditions: [ExtractRenditionsElementType.FIGURES, ExtractRenditionsElementType.TABLES],
        getStylingInfo: true,
        addCharInfo: true,
        tableStructureType: TableStructureType.CSV
      });

      // 创建并提交任务
      const job = new ExtractPDFJob({ inputAsset, params });
      const pollingURL = await this.pdfServices.submit({ job });
      
      const pdfServicesResponse = await this.pdfServices.getJobResult({
        pollingURL,
        resultType: ExtractPDFResult
      });

      // 获取结果
      const resultAsset = pdfServicesResponse.result.resource;
      const streamAsset = await this.pdfServices.getContent({ asset: resultAsset });

      // 保存 ZIP 文件
      const tempZipPath = path.join(__dirname, '../temp', `extract-${uuidv4()}.zip`);
      await fs.ensureDir(path.dirname(tempZipPath));
      
      const writeStream = fs.createWriteStream(tempZipPath);
      await new Promise((resolve, reject) => {
        streamAsset.readStream.pipe(writeStream)
          .on('finish', resolve)
          .on('error', reject);
      });

      // 解压并处理内容
      const result = await this.processExtractResult(tempZipPath);
      
      // 清理临时文件
      await fs.unlink(tempZipPath);
      
      return result;
      
    } catch (err) {
      this.handleError(err);
    } finally {
      readStream?.destroy();
    }
  }

  async processExtractResult(zipPath) {
    const zip = new AdmZip(zipPath);
    const zipEntries = zip.getEntries();
    
    // 查找 structuredData.json
    const dataEntry = zipEntries.find(entry => entry.entryName === 'structuredData.json');
    if (!dataEntry) {
      throw new Error('未找到 structuredData.json');
    }

    // 解析 JSON 数据
    const structuredData = JSON.parse(dataEntry.getData().toString('utf8'));
    
    // 处理元素，将图片和表格替换为缓存键
    const processedElements = [];
    const imageReferences = [];
    const tableReferences = [];

    for (const element of structuredData.elements) {
      if (element.Path) {
        const entry = zipEntries.find(e => e.entryName === element.Path);
        
        if (entry && element.Path.includes('renditions/figures/')) {
          // 处理图片
          const imageKey = uuidv4();
          const imageBuffer = entry.getData();
          const imagePath = await cacheService.saveImage(imageKey, imageBuffer);
          
          imageReferences.push({
            key: imageKey,
            path: element.Path,
            page: element.Page?.[0] || 1,
            bounds: element.Bounds,
            mimeType: element.MimeType || 'image/png'
          });
          
          processedElements.push({
            type: 'image',
            key: imageKey,
            page: element.Page?.[0] || 1,
            bounds: element.Bounds,
            alt: element.Alt || ''
          });
          
        } else if (entry && element.Path.includes('renditions/tables/')) {
          // 处理表格
          const tableKey = uuidv4();
          const tableBuffer = entry.getData();
          const isCSV = element.Path.endsWith('.csv');
          const tablePath = await cacheService.saveTable(tableKey, tableBuffer, isCSV);
          
          tableReferences.push({
            key: tableKey,
            path: element.Path,
            page: element.Page?.[0] || 1,
            bounds: element.Bounds,
            format: isCSV ? 'csv' : 'xlsx'
          });
          
          processedElements.push({
            type: 'table',
            key: tableKey,
            page: element.Page?.[0] || 1,
            bounds: element.Bounds,
            format: isCSV ? 'csv' : 'xlsx',
            rowCount: element.RowCount,
            columnCount: element.ColumnCount
          });
        } else {
          // 处理文本
          processedElements.push({
            type: 'text',
            text: element.Text || '',
            page: element.Page?.[0] || 1,
            bounds: element.Bounds,
            fontSize: element.FontSize?.[0],
            fontName: element.Font?.[0],
            style: element.Style?.[0]
          });
        }
      } else if (element.Text) {
        // 纯文本元素
        processedElements.push({
          type: 'text',
          text: element.Text,
          page: element.Page?.[0] || 1,
          bounds: element.Bounds,
          fontSize: element.FontSize?.[0],
          fontName: element.Font?.[0],
          style: element.Style?.[0]
        });
      }
    }

    return {
      document: {
        pageCount: structuredData.elements.reduce((max, el) => 
          Math.max(max, (el.Page && el.Page[0]) || 1), 1
        ),
        title: structuredData.document?.title || '',
        author: structuredData.document?.author || ''
      },
      elements: processedElements,
      metadata: {
        totalElements: processedElements.length,
        textElements: processedElements.filter(e => e.type === 'text').length,
        imageElements: processedElements.filter(e => e.type === 'image').length,
        tableElements: processedElements.filter(e => e.type === 'table').length
      }
    };
  }

  async ocrPDF(filePath, options = {}) {
    let readStream;
    try {
      // 上传 PDF 文件
      readStream = fs.createReadStream(filePath);
      const inputAsset = await this.pdfServices.upload({
        readStream,
        mimeType: MimeType.PDF
      });

      // 创建 OCR 参数
      const params = new OCRParams({
        ocrLocale: options.locale || OCRSupportedLocale.EN_US,
        ocrType: options.type || OCRSupportedType.SEARCHABLE_IMAGE_EXACT
      });

      // 创建并提交 OCR 任务
      const job = new OCRJob({ inputAsset, params });
      const pollingURL = await this.pdfServices.submit({ job });
      
      const pdfServicesResponse = await this.pdfServices.getJobResult({
        pollingURL,
        resultType: OCRResult
      });

      // 获取结果
      const resultAsset = pdfServicesResponse.result.asset;
      const streamAsset = await this.pdfServices.getContent({ asset: resultAsset });

      // 保存 OCR 后的 PDF
      const ocrPdfPath = path.join(__dirname, '../temp', `ocr-${uuidv4()}.pdf`);
      await fs.ensureDir(path.dirname(ocrPdfPath));
      
      const writeStream = fs.createWriteStream(ocrPdfPath);
      await new Promise((resolve, reject) => {
        streamAsset.readStream.pipe(writeStream)
          .on('finish', resolve)
          .on('error', reject);
      });

      // 读取 OCR 后的文本
      const extractResult = await this.extractPDF(ocrPdfPath);
      
      // 清理临时文件
      await fs.unlink(ocrPdfPath);
      
      return {
        success: true,
        message: 'OCR 处理完成',
        ocrPdfPath: ocrPdfPath,
        extractedText: extractResult
      };
      
    } catch (err) {
      this.handleError(err);
    } finally {
      readStream?.destroy();
    }
  }

  handleError(err) {
    if (err instanceof SDKError || err instanceof ServiceUsageError || err instanceof ServiceApiError) {
      console.error("Adobe PDF Services 错误:", err);
      throw new Error(`PDF 处理失败: ${err.message}`);
    } else {
      console.error("处理错误:", err);
      throw new Error(`处理失败: ${err.message}`);
    }
  }
}

module.exports = new PDFService();