#!/usr/bin/env python3
"""
详细的流式响应诊断脚本
专门检查图片生成成功但前端接收失败的问题
"""
import requests
import time
import json
import os
from pathlib import Path

API_BASE_URL = "http://localhost:2983"

def print_section(title):
    print(f"\n{'='*60}")
    print(f"🔍 {title}")
    print(f"{'='*60}")

def check_cache_files():
    """检查缓存文件夹中的图片文件"""
    print_section("缓存文件检查")
    
    cache_dir = Path("./cache/images")
    
    if not cache_dir.exists():
        print("❌ 缓存目录不存在: ./cache/images")
        return False
    
    files = list(cache_dir.glob("*"))
    print(f"✅ 缓存目录存在: {cache_dir.absolute()}")
    print(f"📁 文件数量: {len(files)}")
    
    if files:
        print("\n📋 现有图片文件:")
        for file in files:
            size_kb = file.stat().st_size / 1024
            modified = time.ctime(file.stat().st_mtime)
            print(f"   📄 {file.name} ({size_kb:.1f}KB, {modified})")
    else:
        print("⚠️  缓存目录为空")
    
    return True

def test_stream_response_detailed():
    """详细测试流式响应"""
    print_section("流式响应详细分析")
    
    test_prompt = "A simple red circle with black border, minimalist style"
    
    try:
        payload = {"paperText": test_prompt}
        print(f"📝 发送测试提示词: {test_prompt}")
        
        response = requests.post(
            f"{API_BASE_URL}/api/generate/stream", 
            json=payload, 
            stream=True, 
            timeout=90
        )
        
        if response.status_code != 200:
            print(f"❌ 请求失败: HTTP {response.status_code}")
            return False
        
        print(f"✅ 请求成功，开始接收流式数据...")
        
        # 详细分析流式响应
        raw_data_chunks = []
        parsed_events = []
        image_events = []
        error_events = []
        
        for line_num, line in enumerate(response.iter_lines(), 1):
            if line:
                try:
                    line_str = line.decode('utf-8')
                    raw_data_chunks.append(line_str)
                    
                    if line_str.startswith('data: '):
                        data_str = line_str[6:]  # 移除 'data: ' 前缀
                        
                        try:
                            chunk_data = json.loads(data_str)
                            parsed_events.append(chunk_data)
                            
                            chunk_type = chunk_data.get('type')
                            
                            if chunk_type == 'image':
                                image_events.append({
                                    'line_num': line_num,
                                    'data': chunk_data,
                                    'raw_line': line_str
                                })
                                print(f"  📸 [行{line_num}] 收到图片事件:")
                                print(f"      Type: {chunk_data.get('type')}")
                                print(f"      Key: {chunk_data.get('key')}")
                                print(f"      URL: {chunk_data.get('url')}")
                                
                                # 测试图片URL是否可以访问
                                image_url = chunk_data.get('url')
                                if image_url:
                                    full_url = f"{API_BASE_URL}{image_url}"
                                    try:
                                        img_response = requests.head(full_url, timeout=5)
                                        print(f"      🌐 图片URL访问测试: {img_response.status_code}")
                                        
                                        if img_response.status_code == 200:
                                            content_length = img_response.headers.get('content-length', 'Unknown')
                                            print(f"      ✅ 图片可访问 ({content_length} bytes)")
                                        else:
                                            print(f"      ❌ 图片URL返回: {img_response.status_code}")
                                    except Exception as e:
                                        print(f"      ❌ 图片URL测试失败: {e}")
                                        
                            elif chunk_type == 'error':
                                error_events.append({
                                    'line_num': line_num,
                                    'data': chunk_data
                                })
                                print(f"  ❌ [行{line_num}] 错误事件: {chunk_data}")
                            elif chunk_type == 'connected':
                                print(f"  🔗 [行{line_num}] 连接建立")
                            elif chunk_type == 'text':
                                content = chunk_data.get('content', '')
                                if len(content) > 20:
                                    print(f"  💬 [行{line_num}] 文本: {content[:50]}...")
                                else:
                                    print(f"  💬 [行{line_num}] 文本: {content}")
                            else:
                                print(f"  📋 [行{line_num}] 其他事件: {chunk_type}")
                                
                        except json.JSONDecodeError as e:
                            print(f"  ⚠️  [行{line_num}] JSON解析失败: {data_str[:50]}...")
                            print(f"      错误: {e}")
                            
                except Exception as e:
                    print(f"  ❌ [行{line_num}] 处理行时出错: {e}")
                    continue
        
        # 统计结果
        print(f"\n📊 流式响应统计:")
        print(f"   总行数: {len(raw_data_chunks)}")
        print(f"   成功解析的事件: {len(parsed_events)}")
        print(f"   图片事件: {len(image_events)}")
        print(f"   错误事件: {len(error_events)}")
        
        if image_events:
            print(f"\n🎨 图片事件详情:")
            for i, img_event in enumerate(image_events, 1):
                print(f"   图片 {i}: Key={img_event['data'].get('key')}, URL={img_event['data'].get('url')}")
                
                # 验证图片文件是否存在
                key = img_event['data'].get('key')
                if key:
                    cache_dir = Path("./cache/images")
                    image_files = list(cache_dir.glob(f"{key}*"))
                    if image_files:
                        print(f"      ✅ 对应文件存在: {image_files[0].name}")
                    else:
                        print(f"      ❌ 对应文件不存在，key={key}")
        
        if error_events:
            print(f"\n❌ 错误事件详情:")
            for err_event in error_events:
                print(f"   错误: {err_event['data'].get('error')}")
        
        # 返回结果
        success = len(image_events) > 0 and len(error_events) == 0
        
        if success:
            print(f"\n✅ 流式响应分析完成 - 图片传输正常")
        else:
            print(f"\n❌ 流式响应分析完成 - 发现问题")
            
        return success
        
    except requests.exceptions.Timeout:
        print("⏰ 流式请求超时")
        return False
    except Exception as e:
        print(f"❌ 测试异常: {e}")
        return False

def test_manual_image_access():
    """手动测试图片访问"""
    print_section("手动图片访问测试")
    
    cache_dir = Path("./cache/images")
    if not cache_dir.exists():
        print("❌ 缓存目录不存在")
        return False
    
    image_files = list(cache_dir.glob("*.png")) + list(cache_dir.glob("*.jpg")) + list(cache_dir.glob("*.jpeg"))
    
    if not image_files:
        print("❌ 没有找到图片文件")
        return False
    
    print(f"📁 找到 {len(image_files)} 个图片文件，测试访问...")
    
    success_count = 0
    for img_file in image_files:
        # 提取key（假设key是文件名去掉扩展名）
        key = img_file.stem
        
        # 构造URL
        test_url = f"{API_BASE_URL}/api/cache/image/{key}"
        
        try:
            response = requests.head(test_url, timeout=5)
            size_kb = img_file.stat().st_size / 1024
            
            if response.status_code == 200:
                print(f"  ✅ {img_file.name} ({size_kb:.1f}KB) - 可访问")
                success_count += 1
            else:
                print(f"  ❌ {img_file.name} ({size_kb:.1f}KB) - 状态码: {response.status_code}")
                
        except Exception as e:
            print(f"  ❌ {img_file.name} - 访问失败: {e}")
    
    print(f"\n📊 手动访问测试结果: {success_count}/{len(image_files)} 成功")
    return success_count == len(image_files)

def check_backend_logs():
    """检查后端启动日志（模拟）"""
    print_section("后端服务检查")
    
    try:
        # 检查健康状态
        response = requests.get(f"{API_BASE_URL}/api/health", timeout=5)
        if response.status_code == 200:
            data = response.json()
            print(f"✅ 后端服务正常运行")
            print(f"   服务: {data.get('service')}")
            print(f"   时间: {data.get('timestamp')}")
        else:
            print(f"❌ 后端服务异常: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ 无法连接到后端: {e}")
        return False
    
    # 检查缓存调试接口
    try:
        response = requests.get(f"{API_BASE_URL}/api/debug/cache", timeout=5)
        if response.status_code == 200:
            cache_data = response.json()
            print(f"✅ 缓存调试接口正常")
            print(f"   文件数量: {cache_data.get('fileCount', 0)}")
        else:
            print(f"❌ 缓存调试接口异常: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ 缓存调试接口访问失败: {e}")
        return False
    
    return True

def generate_diagnosis_report(results):
    """生成诊断报告"""
    print_section("诊断报告")
    
    print("📋 检查结果:")
    for check_name, result in results.items():
        status = "✅ 通过" if result else "❌ 失败"
        print(f"   {status} {check_name}")
    
    # 分析问题
    if not results.get("缓存文件检查", True):
        print("\n❌ 问题分析: 缓存目录不存在或无图片文件")
        print("   解决方案: 检查图片生成流程是否正常")
        
    elif not results.get("流式响应分析", True):
        print("\n❌ 问题分析: 流式响应中图片数据传输失败")
        print("   可能原因:")
        print("   1. 流式响应格式错误")
        print("   2. 图片事件数据不完整")
        print("   3. 前端解析流式数据失败")
        print("   解决方案: 检查aiService.js中的流式响应逻辑")
        
    elif not results.get("手动图片访问", True):
        print("\n❌ 问题分析: 图片文件存在但无法通过API访问")
        print("   可能原因:")
        print("   1. 图片key映射错误")
        print("   2. 缓存服务getImagePath方法有问题")
        print("   解决方案: 检查cacheService.js的getImagePath方法")
        
    elif not results.get("后端服务检查", True):
        print("\n❌ 问题分析: 后端服务或API接口异常")
        print("   解决方案: 重启后端服务")
    
    else:
        print("\n🎉 初步检查正常，请进一步测试前端")

def main():
    """主诊断函数"""
    print("🚀 开始详细流式响应诊断")
    print("⏰ 诊断时间:", time.strftime("%Y-%m-%d %H:%M:%S"))
    
    # 执行所有检查
    checks = [
        ("缓存文件检查", check_cache_files),
        ("后端服务检查", check_backend_logs),
        ("流式响应分析", test_stream_response_detailed),
        ("手动图片访问", test_manual_image_access),
    ]
    
    results = {}
    
    for check_name, check_func in checks:
        try:
            results[check_name] = check_func()
        except Exception as e:
            print(f"❌ 检查 '{check_name}' 发生异常: {e}")
            results[check_name] = False
    
    # 生成诊断报告
    generate_diagnosis_report(results)
    
    return results

if __name__ == "__main__":
    main()