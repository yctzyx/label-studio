
"""
打标 API 测试客户端示例
"""
import requests
import json
import base64

# 服务地址
API_URL = "http://localhost:6661/api/v1/tag"

def load_image_as_base64(image_path: str) -> str:
    """加载图片并转换为 Base64"""
    with open(image_path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")

def test_tag_api():
    """测试打标 API"""
    image_path1 = "/app/zihao/anti_fraud/screen/2026-05-11/images/00012.my.png"
    image_path2 = "/app/zihao/anti_fraud/screen/2026-05-11/images/000000.ghf82.com.png"
    # 1. 准备测试数据
    test_images = [
        {
            "data_type": "image",
            "id": "test_img_001",
            "data": load_image_as_base64(image_path1)  # 替换为真实图片的 base64
        },
        {
            "data_type": "image", 
            "id": "test_img_002",
            "data": load_image_as_base64(image_path2)
        }
    ]
    
    payload = {
        "images": test_images,
        "max_concurrent": 3
    }
    
    print("="*60)
    print("发送请求到:", API_URL)
    print("="*60)
    print(f"请求体:\n{json.dumps(payload, ensure_ascii=False, indent=2)}")
    
    # 2. 发送请求
    try:
        response = requests.post(
            API_URL,
            json=payload,
            timeout=300
        )
        
        print(f"\n响应状态码: {response.status_code}")
        print(f"响应头: {dict(response.headers)}")
        
        result = response.json()
        print(f"\n响应内容:\n{json.dumps(result, ensure_ascii=False, indent=2)}")
        
        return result
        
    except requests.exceptions.ConnectionError:
        print("❌ 连接失败！请确保服务已启动。")
        print("启动命令: python service.py")
    except Exception as e:
        print(f"❌ 请求出错: {e}")

def test_health_check():
    """测试健康检查接口"""
    health_url = "http://localhost:6661/health"
    try:
        response = requests.get(health_url)
        print(f"健康检查: {response.json()}")
    except Exception as e:
        print(f"健康检查失败: {e}")

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="打标 API 测试客户端")
    parser.add_argument("--health", action="store_true", help="仅测试健康检查")
    parser.add_argument("--url", default=API_URL, help="API 地址")
    
    args = parser.parse_args()
    
    if args.health:
        test_health_check()
    else:
        API_URL = args.url
        test_tag_api()

