#!/usr/bin/env python3
"""
完整的图片服务测试脚本
测试从图片生成到显示的整个流程
"""
import requests
import time
import json
import uuid
import sys
from io import BytesIO

API_BASE_URL = "http://localhost:2983"

def print_header(title):
    """打印测试标题"""
    print(f"\n{'='*60}")
    print(f"🔍 {title}")
    print(f"{'='*60}")

def print_test_result(test_name, success, details=""):
    """打印测试结果"""
    status = "✅ 通过" if success else "❌ 失败"
    print(f"📋 {test_name}: {status}")
    if details:
        print(f"   详情: {details}")
    return success

def test_backend_health():
    """测试后端健康状态"""
    print_header("后端健康检查")
    
    try:
        response = requests.get(f"{API_BASE_URL}/api/health", timeout=5)
        if response.status_code == 200:
            data = response.json()
            print(f"✅ 后端服务正常运行")
            print(f"   服务: {data.get('service', 'Unknown')}")
            print(f"   时间: {data.get('timestamp', 'Unknown')}")
            return True
        else:
            print(f"❌ 后端服务异常: HTTP {response.status_code}")
            return False
    except requests.exceptions.ConnectionError:
        print(f"❌ 无法连接到后端服务 (http://{API_BASE_URL})")
        print(f"   请确保后端服务正在运行在端口 2983")
        return False
    except Exception as e:
        print(f"❌ 连接异常: {e}")
        return False

def test_cache_directory():
    """测试缓存目录和文件"""
    print_header("缓存目录检查")
    
    try:
        # 检查缓存调试接口
        response = requests.get(f"{API_BASE_URL}/api/debug/cache", timeout=5)
        if response.status_code == 200:
            cache_data = response.json()
            
            print(f"✅ 缓存目录信息:")
            print(f"   缓存目录: {cache_data.get('cacheDir', 'Unknown')}")
            print(f"   图片目录: {cache_data.get('imagesDir', 'Unknown')}")
            print(f"   文件数量: {cache_data.get('fileCount', 0)}")
            
            # 显示前几个文件
            files = cache_data.get('files', [])
            if files:
                print(f"   最近文件:")
                for i, file_info in enumerate(files[:3]):
                    size_kb = file_info.get('size', 0) / 1024
                    modified = file_info.get('modified', 'Unknown')
                    print(f"     {i+1}. {file_info.get('file')} ({size_kb:.1f}KB, {modified})")
            
            if len(files) > 3:
                print(f"     ... 还有 {len(files) - 3} 个文件")
                
            return True
        else:
            print(f"❌ 缓存目录检查失败: HTTP {response.status_code}")
            return False
            
    except requests.exceptions.ConnectionError:
        print(f"❌ 无法连接到缓存调试接口")
        return False
    except Exception as e:
        print(f"❌ 缓存目录检查异常: {e}")
        return False

def test_image_request_patterns():
    """测试图片请求的各种模式"""
    print_header("图片请求模式测试")
    
    # 测试用例
    test_cases = [
        {
            "name": "不存在的图片Key",
            "key": f"nonexistent-{int(time.time())}",
            "expected_status": 404,
            "description": "应该返回404"
        },
        {
            "name": "格式化的UUID Key",
            "key": str(uuid.uuid4()),
            "expected_status": 404,
            "description": "应该返回404"
        },
        {
            "name": "包含特殊字符的Key",
            "key": "test@#$%^&*()",
            "expected_status": 404,
            "description": "应该返回404"
        },
        {
            "name": "空Key",
            "key": "",
            "expected_status": 404,
            "description": "应该返回404"
        }
    ]
    
    passed_tests = 0
    total_tests = len(test_cases)
    
    for i, case in enumerate(test_cases, 1):
        print(f"\n  测试 {i}/{total_tests}: {case['name']}")
        print(f"    Key: {case['key']}")
        print(f"    期望: {case['expected_status']}")
        
        try:
            url = f"{API_BASE_URL}/api/cache/image/{case['key']}"
            response = requests.head(url, timeout=5)
            
            if response.status_code == case['expected_status']:
                print(f"    ✅ 状态码正确: {response.status_code}")
                
                # 检查响应头信息
                if 'X-Image-Size' in response.headers:
                    print(f"    📊 图片大小: {response.headers['X-Image-Size']} bytes")
                if 'X-Image-Path' in response.headers:
                    print(f"    📁 图片路径: {response.headers['X-Image-Path']}")
                    
                passed_tests += 1
            else:
                print(f"    ❌ 状态码错误: 期望 {case['expected_status']}, 得到 {response.status_code}")
                
        except requests.exceptions.RequestException as e:
            print(f"    ❌ 请求异常: {e}")
        except Exception as e:
            print(f"    ❌ 其他异常: {e}")
    
    print(f"\n📊 图片请求测试结果: {passed_tests}/{total_tests} 通过")
    return passed_tests == total_tests

def test_stream_generation_flow():
    """测试流式生成完整流程"""
    print_header("流式生成流程测试")
    
    # 使用一个简单的测试提示词
    test_prompt = "A simple scientific diagram showing DNA structure, professional medical illustration style, clean and educational"
    
    print(f"📝 测试提示词: {test_prompt[:50]}...")
    
    try:
        # 发送流式生成请求
        payload = {"paperText": test_prompt}
        
        print("📡 发送流式生成请求...")
        response = requests.post(
            f"{API_BASE_URL}/api/generate/stream", 
            json=payload, 
            stream=True, 
            timeout=120  # 2分钟超时
        )
        
        if response.status_code != 200:
            print(f"❌ 流式请求失败: HTTP {response.status_code}")
            try:
                error_data = response.json()
                print(f"   错误信息: {error_data}")
            except:
                pass
            return False
        
        print(f"✅ 流式请求成功，状态码: {response.status_code}")
        
        # 处理流式响应
        chunk_count = 0
        image_count = 0
        text_content = []
        images_data = []
        error_occurred = False
        
        print("🔄 开始接收流式数据...")
        
        for line in response.iter_lines():
            if line:
                try:
                    line_str = line.decode('utf-8')
                    if line_str.startswith('data: '):
                        chunk_count += 1
                        data_str = line_str[6:]  # 移除 'data: ' 前缀
                        chunk_data = json.loads(data_str)
                        
                        chunk_type = chunk_data.get('type')
                        
                        if chunk_type == 'connected':
                            print("  📡 连接建立")
                        elif chunk_type == 'text':
                            text_chunk = chunk_data.get('content', '')
                            if text_chunk:
                                text_content.append(text_chunk)
                                if len(text_chunk) > 10:  # 只打印较长的文本块
                                    print(f"  💬 收到文本: {text_chunk[:30]}...")
                        elif chunk_type == 'image':
                            image_count += 1
                            image_key = chunk_data.get('key')
                            image_url = chunk_data.get('url')
                            full_url = f"{API_BASE_URL}{image_url}"
                            
                            print(f"  🎨 收到图片 {image_count}:")
                            print(f"     Key: {image_key}")
                            print(f"     URL: {image_url}")
                            print(f"     完整URL: {full_url}")
                            
                            # 测试图片是否可访问
                            try:
                                img_response = requests.head(full_url, timeout=10)
                                print(f"     📋 图片访问状态: {img_response.status_code}")
                                
                                if img_response.status_code == 200:
                                    print(f"     ✅ 图片可正常访问")
                                    # 尝试获取图片内容
                                    img_content_response = requests.get(full_url, timeout=10)
                                    if img_content_response.status_code == 200:
                                        img_size = len(img_content_response.content)
                                        print(f"     📦 图片大小: {img_size} bytes")
                                        
                                        images_data.append({
                                            'key': image_key,
                                            'url': image_url,
                                            'full_url': full_url,
                                            'size': img_size,
                                            'status': 'accessible'
                                        })
                                    else:
                                        print(f"     ❌ 获取图片内容失败: {img_content_response.status_code}")
                                        images_data.append({
                                            'key': image_key,
                                            'url': image_url,
                                            'full_url': full_url,
                                            'status': 'content_error'
                                        })
                                else:
                                    print(f"     ❌ 图片不可访问: {img_response.status_code}")
                                    images_data.append({
                                        'key': image_key,
                                        'url': image_url,
                                        'full_url': full_url,
                                        'status': 'not_accessible'
                                    })
                            except Exception as e:
                                print(f"     ❌ 图片访问异常: {e}")
                                images_data.append({
                                    'key': image_key,
                                    'url': image_url,
                                    'full_url': full_url,
                                    'status': 'access_error',
                                    'error': str(e)
                                })
                        elif chunk_type == 'error':
                            print(f"  ⚠️ 流式错误: {chunk_data.get('error', 'Unknown error')}")
                            error_occurred = True
                        elif chunk_type == 'complete':
                            print(f"  ✅ 生成完成")
                        elif chunk_type == 'final':
                            print(f"  🏁 最终汇总")
                            
                except json.JSONDecodeError as e:
                    print(f"  ⚠️ JSON解析错误: {e}")
                    continue
                except Exception as e:
                    print(f"  ⚠️ 数据处理异常: {e}")
                    continue
        
        # 打印统计信息
        print(f"\n📊 流式响应统计:")
        print(f"   总数据块数: {chunk_count}")
        print(f"   图片数量: {image_count}")
        print(f"   错误发生: {'是' if error_occurred else '否'}")
        
        if text_content:
            full_text = ''.join(text_content)
            print(f"   文本内容长度: {len(full_text)} 字符")
        
        # 统计图片状态
        if images_data:
            accessible_count = sum(1 for img in images_data if img['status'] == 'accessible')
            print(f"   可访问图片: {accessible_count}/{len(images_data)}")
            
            for i, img in enumerate(images_data, 1):
                status_icon = "✅" if img['status'] == 'accessible' else "❌"
                print(f"   {status_icon} 图片 {i}: {img['status']} ({img.get('size', 0)} bytes)")
        
        return image_count > 0 and not error_occurred
        
    except requests.exceptions.Timeout:
        print("⏰ 流式请求超时")
        return False
    except Exception as e:
        print(f"❌ 流式请求异常: {e}")
        return False

def test_frontend_compatibility():
    """测试前端兼容性"""
    print_header("前端兼容性测试")
    
    print("🔍 检查前端所需的关键API端点...")
    
    endpoints_to_test = [
        {
            "name": "健康检查",
            "url": "/api/health",
            "method": "GET"
        },
        {
            "name": "缓存调试",
            "url": "/api/debug/cache", 
            "method": "GET"
        }
    ]
    
    passed = 0
    total = len(endpoints_to_test)
    
    for endpoint in endpoints_to_test:
        try:
            url = f"{API_BASE_URL}{endpoint['url']}"
            if endpoint['method'] == 'GET':
                response = requests.get(url, timeout=5)
            
            if response.status_code == 200:
                print(f"  ✅ {endpoint['name']}: 正常")
                passed += 1
            else:
                print(f"  ❌ {endpoint['name']}: 状态码 {response.status_code}")
                
        except Exception as e:
            print(f"  ❌ {endpoint['name']}: 异常 - {e}")
    
    print(f"\n📊 前端兼容性测试: {passed}/{total} 通过")
    return passed == total

def generate_test_report(results):
    """生成测试报告"""
    print_header("测试报告")
    
    total_tests = len(results)
    passed_tests = sum(1 for result in results.values() if result)
    
    print(f"📊 总体统计:")
    print(f"   总测试数: {total_tests}")
    print(f"   通过测试: {passed_tests}")
    print(f"   失败测试: {total_tests - passed_tests}")
    print(f"   通过率: {passed_tests/total_tests*100:.1f}%")
    
    print(f"\n📋 详细结果:")
    for test_name, result in results.items():
        status = "✅ 通过" if result else "❌ 失败"
        print(f"   {status} {test_name}")
    
    if passed_tests == total_tests:
        print(f"\n🎉 所有测试通过！图片服务完全正常运行")
        print(f"🚀 可以开始正常使用系统了")
    elif passed_tests >= total_tests * 0.8:
        print(f"\n✅ 大部分测试通过，系统基本正常")
        print(f"⚠️ 建议检查失败的测试项")
    else:
        print(f"\n⚠️ 多个测试失败，需要立即修复")
        print(f"🔧 请检查后端服务和配置")
    
    return passed_tests == total_tests

def main():
    """主测试函数"""
    print("🚀 开始完整图片服务测试")
    print("⏰ 开始时间:", time.strftime("%Y-%m-%d %H:%M:%S"))
    
    # 定义所有测试
    tests = [
        ("后端健康检查", test_backend_health),
        ("缓存目录检查", test_cache_directory),
        ("图片请求模式测试", test_image_request_patterns),
        ("流式生成流程测试", test_stream_generation_flow),
        ("前端兼容性测试", test_frontend_compatibility),
    ]
    
    results = {}
    
    # 执行所有测试
    for test_name, test_func in tests:
        try:
            results[test_name] = test_func()
        except Exception as e:
            print(f"❌ 测试 '{test_name}' 发生异常: {e}")
            results[test_name] = False
    
    # 生成测试报告
    all_passed = generate_test_report(results)
    
    print(f"\n⏰ 结束时间:", time.strftime("%Y-%m-%d %H:%M:%S"))
    
    # 返回退出码
    return 0 if all_passed else 1

if __name__ == "__main__":
    try:
        exit_code = main()
        sys.exit(exit_code)
    except KeyboardInterrupt:
        print("\n\n⚠️ 测试被用户中断")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ 测试脚本异常: {e}")
        sys.exit(1)