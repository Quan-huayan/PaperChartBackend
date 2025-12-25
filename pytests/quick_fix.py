#!/usr/bin/env python3
"""
快速修复脚本 - 基于诊断结果自动修复
"""
import requests
import time
import json
from pathlib import Path

API_BASE_URL = "http://localhost:2983"

def quick_test_and_fix():
    """快速测试并提供修复建议"""
    print("🚀 快速诊断和修复建议")
    print("=" * 50)
    
    # 1. 检查缓存文件
    cache_dir = Path("./cache/images")
    if cache_dir.exists():
        files = list(cache_dir.glob("*"))
        if files:
            print(f"✅ 发现 {len(files)} 个缓存图片文件")
            
            # 测试第一个文件的访问
            first_file = files[0]
            key = first_file.stem
            test_url = f"{API_BASE_URL}/api/cache/image/{key}"
            
            try:
                response = requests.head(test_url, timeout=5)
                if response.status_code == 200:
                    print(f"✅ 图片URL可正常访问: {test_url}")
                    print("🎯 问题可能在前端流式数据解析")
                    print("\n🔧 修复建议:")
                    print("1. 检查前端 render_safe_image 函数")
                    print("2. 检查流式数据的JSON解析")
                    print("3. 确保前端正确处理 image 类型事件")
                    
                else:
                    print(f"❌ 图片URL访问失败: {response.status_code}")
                    print("🎯 问题在图片路径映射")
                    print("\n🔧 修复建议:")
                    print("1. 检查 cacheService.js 的 getImagePath 方法")
                    print("2. 添加详细的路径映射日志")
                    print("3. 确保文件名和key的匹配逻辑")
                    
            except Exception as e:
                print(f"❌ URL测试异常: {e}")
                
        else:
            print("❌ 缓存目录为空")
    else:
        print("❌ 缓存目录不存在")
    
    # 2. 测试流式响应
    print(f"\n🔍 测试流式响应...")
    try:
        payload = {"paperText": "A red circle, simple style"}
        response = requests.post(
            f"{API_BASE_URL}/api/generate/stream", 
            json=payload, 
            stream=True, 
            timeout=60
        )
        
        if response.status_code == 200:
            image_count = 0
            for line in response.iter_lines():
                if line:
                    try:
                        line_str = line.decode('utf-8')
                        if line_str.startswith('data: '):
                            data_str = line_str[6:]
                            chunk_data = json.loads(data_str)
                            
                            if chunk_data.get('type') == 'image':
                                image_count += 1
                                print(f"✅ 流式响应中有图片事件")
                                
                                # 测试图片URL
                                url = chunk_data.get('url')
                                if url:
                                    full_url = f"{API_BASE_URL}{url}"
                                    try:
                                        img_response = requests.head(full_url, timeout=5)
                                        if img_response.status_code == 200:
                                            print(f"✅ 图片URL可访问: {full_url}")
                                        else:
                                            print(f"❌ 图片URL失败: {img_response.status_code}")
                                    except Exception as e:
                                        print(f"❌ 图片URL测试异常: {e}")
                                        
                    except:
                        continue
            
            if image_count == 0:
                print("❌ 流式响应中没有图片事件")
                print("🎯 问题在AI服务图片生成或响应")
                print("\n🔧 修复建议:")
                print("1. 检查 aiService.js 中的 handleImageData 方法")
                print("2. 确保图片事件正确发送给前端")
                print("3. 检查缓存服务的 saveImage 方法")
            else:
                print(f"✅ 流式响应中有 {image_count} 个图片事件")
                
        else:
            print(f"❌ 流式请求失败: {response.status_code}")
            
    except Exception as e:
        print(f"❌ 流式测试异常: {e}")

def main():
    print("基于您的情况（图片已生成但前端未接收）")
    print("这通常是流式响应数据传输问题")
    print("")
    
    quick_test_and_fix()
    
    print(f"\n" + "="*50)
    print("📋 总结:")
    print("✅ 图片生成: 正常")
    print("❌ 前端接收: 失败")
    print("🎯 问题位置: 流式响应数据传输")
    print("")
    print("🔧 下一步:")
    print("1. 运行完整诊断: python3 stream_debug_diagnostic.py")
    print("2. 根据诊断结果修复相应组件")
    print("3. 重启服务并重新测试")

if __name__ == "__main__":
    main()