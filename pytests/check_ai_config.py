#!/usr/bin/env python3
"""
检查AI服务配置的测试脚本
"""
import requests
import os
import time

API_BASE_URL = "http://localhost:2983"

def test_ai_api():
    """测试AI API配置"""
    print("🔍 检查AI服务配置...")
    
    # 1. 检查后端服务状态
    try:
        response = requests.get(f"{API_BASE_URL}/api/health", timeout=5)
        if response.status_code == 200:
            print("✅ 后端服务正常运行")
        else:
            print(f"❌ 后端服务异常: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ 无法连接到后端: {e}")
        return False
    
    # 2. 检查环境变量 (模拟检查)
    print("\n🔍 检查AI API配置:")
    print("   请确保以下环境变量已设置:")
    print("   - AIHUBMIX_API_KEY=你的API密钥")
    print("   - CACHE_DIR=./cache")
    print("   - UPLOAD_DIR=./uploads")
    
    # 3. 测试简单的流式请求
    print("\n🔍 测试AI生图功能...")
    
    test_prompt = "A simple red circle, minimalist style"
    
    try:
        payload = {"paperText": test_prompt}
        response = requests.post(
            f"{API_BASE_URL}/api/generate/stream", 
            json=payload, 
            stream=True, 
            timeout=60
        )
        
        if response.status_code == 200:
            print("✅ 流式请求成功")
            
            chunk_count = 0
            image_count = 0
            text_content = []
            
            for line in response.iter_lines():
                if line:
                    try:
                        line_str = line.decode('utf-8')
                        if line_str.startswith('data: '):
                            chunk_count += 1
                            data_str = line_str[6:]
                            chunk_data = eval(data_str)  # 简单解析
                            
                            chunk_type = chunk_data.get('type')
                            if chunk_type == 'connected':
                                print("  📡 连接建立")
                            elif chunk_type == 'text':
                                text = chunk_data.get('content', '')
                                if text:
                                    text_content.append(text)
                            elif chunk_type == 'image':
                                image_count += 1
                                print(f"  🎨 收到图片 {image_count}")
                            elif chunk_type == 'error':
                                print(f"  ❌ AI错误: {chunk_data.get('error')}")
                            elif chunk_type == 'complete':
                                print("  ✅ 生成完成")
                    except:
                        continue
            
            print(f"\n📊 测试结果:")
            print(f"   数据块数: {chunk_count}")
            print(f"   图片数量: {image_count}")
            
            if image_count == 0:
                print("\n❌ 没有收到图片，可能的问题:")
                print("   1. AIHUBMIX_API_KEY 未设置或无效")
                print("   2. API配额已用完")
                print("   3. 网络连接问题")
                print("   4. 图片保存失败")
                return False
            else:
                print("✅ AI生图功能正常")
                return True
                
        else:
            print(f"❌ 流式请求失败: {response.status_code}")
            return False
            
    except Exception as e:
        print(f"❌ 测试异常: {e}")
        return False

def main():
    print("🚀 开始AI服务配置检查")
    print("=" * 50)
    
    success = test_ai_api()
    
    if success:
        print("\n🎉 AI服务配置正常")
    else:
        print("\n⚠️ AI服务配置有问题")
    
    return success

if __name__ == "__main__":
    main()