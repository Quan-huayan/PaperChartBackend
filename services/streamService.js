const { Transform } = require('stream');

class StreamService {
  /**
   * 创建NDJSON解析流
   */
  createNDJSONParser() {
    let buffer = '';
    
    return new Transform({
      objectMode: true,
      transform(chunk, encoding, callback) {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        
        // 保留最后一行（可能不完整）
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (line.trim()) {
            try {
              const data = JSON.parse(line);
              this.push(data);
            } catch (error) {
              console.error('NDJSON parse error:', error, 'Line:', line);
            }
          }
        }
        
        callback();
      },
      
      flush(callback) {
        if (buffer.trim()) {
          try {
            const data = JSON.parse(buffer);
            this.push(data);
          } catch (error) {
            console.error('Final buffer parse error:', error);
          }
        }
        callback();
      }
    });
  }

  /**
   * 创建事件流转换器
   */
  createEventStreamTransformer() {
    return new Transform({
      objectMode: true,
      transform(data, encoding, callback) {
        try {
          const event = this.formatEvent(data);
          this.push(event);
        } catch (error) {
          console.error('Event transform error:', error);
        }
        callback();
      }
    });
  }

  /**
   * 格式化事件
   */
  formatEvent(data) {
    if (data.error) {
      return `event: error\ndata: ${JSON.stringify(data)}\n\n`;
    } else if (data.complete) {
      return `event: complete\ndata: ${JSON.stringify(data)}\n\n`;
    } else if (data.text) {
      return `event: text\ndata: ${JSON.stringify({
        type: 'text',
        content: data.text,
        timestamp: new Date().toISOString()
      })}\n\n`;
    } else if (data.imageKey) {
      return `event: image\ndata: ${JSON.stringify({
        type: 'image',
        key: data.imageKey,
        url: `/api/cache/image/${data.imageKey}`,
        timestamp: new Date().toISOString()
      })}\n\n`;
    } else {
      return `event: data\ndata: ${JSON.stringify(data)}\n\n`;
    }
  }

  /**
   * 创建SSE响应流
   */
  createSSEResponse(res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    
    return {
      send: (event, data) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      },
      
      sendText: (text) => {
        res.write(`event: text\ndata: ${JSON.stringify({ text })}\n\n`);
      },
      
      sendImage: (key, metadata = {}) => {
        res.write(`event: image\ndata: ${JSON.stringify({
          key,
          url: `/api/cache/image/${key}`,
          ...metadata,
          timestamp: new Date().toISOString()
        })}\n\n`);
      },
      
      sendError: (error) => {
        res.write(`event: error\ndata: ${JSON.stringify({
          error: error.message,
          timestamp: new Date().toISOString()
        })}\n\n`);
      },
      
      complete: (data = {}) => {
        res.write(`event: complete\ndata: ${JSON.stringify({
          status: 'complete',
          timestamp: new Date().toISOString(),
          ...data
        })}\n\n`);
        res.end();
      }
    };
  }

  /**
   * 客户端流式请求处理
   */
  handleClientStream(req, res, handler) {
    const sse = this.createSSEResponse(res);
    
    // 发送连接事件
    sse.send('connected', { 
      status: 'connected', 
      timestamp: new Date().toISOString() 
    });
    
    // 处理请求
    handler(sse).catch(error => {
      sse.sendError(error);
      res.end();
    });
  }
}

module.exports = new StreamService();