
"""
反诈图片打标 API 接口
支持并发处理，输入 base64 图片列表，输出打标结果
"""
import os
import sys
import json
import base64
import asyncio
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Dict, Any, Optional

# 导入现有模块
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vl_tag import check_image, tag_image

# ================= 配置 =================
MAX_CONCURRENT = 5  # 最大并发数
TIMEOUT_PER_IMAGE = 90  # 单张图片处理超时时间(秒)


def validate_input(input_data: List[Dict[str, Any]]) -> tuple[bool, str, List[Dict]]:
    """
    输入参数校验
    
    Returns:
        (is_valid, error_message, cleaned_data)
    """
    if not isinstance(input_data, list):
        return False, "输入必须是列表格式", []
    
    cleaned_items = []
    for idx, item in enumerate(input_data):
        if not isinstance(item, dict):
            return False, f"第{idx}个元素必须是字典格式", []
        
        # 检查必需字段
        required_fields = ["data_type", "id", "data"]
        for field in required_fields:
            if field not in item:
                return False, f"第{idx}个元素缺少必需字段: {field}", []
        
        # 校验 data_type
        if item.get("data_type") != "image":
            return False, f"第{idx}个元素 data_type 必须是 'image'", []
        
        # 校验 base64 数据
        data_str = item.get("data", "")
        if not isinstance(data_str, str) or len(data_str) == 0:
            return False, f"第{idx}个元素 data 必须是非空 base64 字符串", []
        
        # 清理数据
        cleaned_items.append({
            "id": item["id"],
            "data_type": item["data_type"],
            "data": data_str
        })
    
    return True, "", cleaned_items


def process_single_item(item: Dict[str, Any]) -> Dict[str, Any]:
    """
    处理单张图片（同步函数，用于线程池）
    
    Returns:
        {
            "id": "...",
            "is_suspicious": 0/1,
            "tag_result": 字符串,
            "error": None or str
        }
    """
    item_id = item["id"]
    base64_data = item["data"]
    
    result = {
        "id": item_id,
        "is_suspicious": 0,
        "tag_result": "",
        "error": None
    }
    
    try:
        # 1. 初筛判断是否可疑
        is_suspicious = check_image(base64_data)
        
        if not is_suspicious:
            result["is_suspicious"] = 0
            result["tag_result"] = "非涉诈图片"
            return result
        
        result["is_suspicious"] = 1
        
        # 2. 详细打标
        tag_result = tag_image(base64_data)
        
        if isinstance(tag_result, dict) and "error" in tag_result:
            result["error"] = tag_result["error"]
            result["tag_result"] = tag_result["error"]
        else:
            # 将字典转成 JSON 字符串
            result["tag_result"] = json.dumps(tag_result, ensure_ascii=False)
            
    except Exception as e:
        result["error"] = str(e)
        result["tag_result"] = str(e)
    
    return result


def tag_images_concurrent(image_list: List[Dict[str, Any]], 
                          max_concurrent: int = MAX_CONCURRENT) -> Dict[str, Any]:
    """
    并发打标处理
    
    Args:
        image_list: 输入图片列表
        max_concurrent: 最大并发数
    
    Returns:
        {
            "status": 0,
            "result": [...],
            "message": "success"
        }
    """
    # 1. 输入校验
    is_valid, error_msg, cleaned_list = validate_input(image_list)
    if not is_valid:
        return {
            "status": 1,
            "result": [],
            "message": error_msg
        }
    
    if len(cleaned_list) == 0:
        return {
            "status": 0,
            "result": [],
            "message": "no images to process"
        }
    
    # 2. 并发处理
    results = []
    id_to_result = {}
    
    with ThreadPoolExecutor(max_workers=max_concurrent) as executor:
        # 提交所有任务
        future_to_item = {
            executor.submit(process_single_item, item): item 
            for item in cleaned_list
        }
        
        # 收集结果
        for future in as_completed(future_to_item):
            item = future_to_item[future]
            try:
                single_result = future.result(timeout=TIMEOUT_PER_IMAGE)
                id_to_result[single_result["id"]] = single_result
            except Exception as e:
                # 处理超时或其他异常
                item_id = item["id"]
                error_msg = f"处理超时或异常: {str(e)}"
                id_to_result[item_id] = {
                    "id": item_id,
                    "is_suspicious": 0,
                    "tag_result": error_msg,
                    "error": error_msg
                }
    
    # 3. 按输入顺序整理结果
    for item in cleaned_list:
        results.append(id_to_result.get(item["id"], {
            "id": item["id"],
            "is_suspicious": 0,
            "tag_result": "结果丢失",
            "error": "结果丢失"
        }))
    
    return {
        "status": 0,
        "result": results,
        "message": "success"
    }


async def tag_images_async(image_list: List[Dict[str, Any]], 
                          max_concurrent: int = MAX_CONCURRENT) -> Dict[str, Any]:
    """
    异步版本的并发打标（可选）
    """
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        None, 
        tag_images_concurrent, 
        image_list, 
        max_concurrent
    )


def main():
    """
    命令行测试入口
    """
    import argparse
    
    parser = argparse.ArgumentParser(description="反诈图片打标 API")
    parser.add_argument("--test", action="store_true", help="运行测试")
    parser.add_argument("--max-concurrent", type=int, default=MAX_CONCURRENT, 
                        help=f"最大并发数 (默认: {MAX_CONCURRENT})")
    args = parser.parse_args()
    
    if args.test:
        print("="*50)
        print("运行测试...")
        print("="*50)
        
        # 测试数据
        test_input = [
            {
                "data_type": "image",
                "id": "test_001",
                "data": "invalid_base64_data_for_test"
            },
            {
                "data_type": "image", 
                "id": "test_002",
                "data": "another_invalid_base64"
            }
        ]
        
        print(f"\n输入数据: {json.dumps(test_input, ensure_ascii=False, indent=2)}")
        
        result = tag_images_concurrent(test_input, args.max_concurrent)
        
        print(f"\n输出结果: {json.dumps(result, ensure_ascii=False, indent=2)}")
        print("\n测试完成!")
    else:
        print("使用示例:")
        print("  python tag_api.py --test")
        print("\n或在代码中调用:")
        print("  from tag_api import tag_images_concurrent")
        print("  result = tag_images_concurrent(image_list, max_concurrent=5)")


if __name__ == "__main__":
    main()


