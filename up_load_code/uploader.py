import os
import sys
import json
import boto3
from datetime import datetime
from botocore.client import Config
from config import (
    SOURCE_ENDPOINT, ACCESS_KEY, SECRET_KEY, TARGET_BUCKET, 
    TIMESTAMP_FILE, BASE_LOCAL_PATH
)

# ================= 配置区域 =================
# S3 桶下的固定根目录前缀
S3_ROOT_PREFIX = "anti_fraud"

# 全局 S3 客户端
s3_client = None

def init_s3():
    """初始化 S3 客户端"""
    global s3_client
    if s3_client is None:
        s3_client = boto3.client(
            's3',
            endpoint_url=SOURCE_ENDPOINT,
            aws_access_key_id=ACCESS_KEY,
            aws_secret_access_key=SECRET_KEY,
            region_name='default',
            config=Config(signature_version='s3v4', s3={'addressing_style': 'path'})
        )

def load_last_timestamp():
    """加载上次运行时间戳"""
    if os.path.exists(TIMESTAMP_FILE):
        try:
            with open(TIMESTAMP_FILE, 'r') as f:
                return json.load(f).get('last_upload_time', 0)
        except:
            pass
    return 0

def save_timestamp(timestamp):
    """保存当前时间戳"""
    try:
        with open(TIMESTAMP_FILE, 'w') as f:
            json.dump({'last_upload_time': timestamp}, f)
    except Exception as e:
        print(f"保存时间戳失败: {e}")

def get_new_files(subdir, last_timestamp):
    """
    获取 subdir 下修改时间晚于 last_timestamp 的文件相对路径列表
    返回的是相对于 BASE_LOCAL_PATH 的路径
    """
    full_dir = os.path.join(BASE_LOCAL_PATH, subdir)
    if not os.path.exists(full_dir):
        return []
    
    new_files = []
    for root, dirs, files in os.walk(full_dir):
        for file in files:
            file_path = os.path.join(root, file)
            if os.path.getmtime(file_path) > last_timestamp:
                # 返回相对于 BASE_LOCAL_PATH 的路径，例如 "2026-05-14/subdir/abc.png"
                rel_path = os.path.relpath(file_path, BASE_LOCAL_PATH)
                new_files.append(rel_path)
    return new_files

def upload_file(local_rel_path, dynamic_prefix):
    """
    上传单个文件到 S3，保留目录结构
    local_rel_path: 相对于 BASE_LOCAL_PATH 的路径 (e.g., 2026-05-14/sub/img.png)
    dynamic_prefix: S3 上的第二层前缀 (是指定的文件夹名 或 当前日期)
    
    最终 S3 Key 结构: S3_ROOT_PREFIX / dynamic_prefix / <subdir内部相对路径>
    """
    init_s3()
    local_full_path = os.path.join(BASE_LOCAL_PATH, local_rel_path)
    
    # 关键修改：计算文件相对于“当前正在处理的子目录”的路径
    # 例如: local_rel_path = "2026-05-14/images/test.png", dynamic_prefix = "2026-05-14"
    # 我们希望提取出 "images/test.png"
    
    # 注意：local_rel_path 的开头部分就是 dynamic_prefix (因为我们是针对 target_subdir 扫描的)
    # 所以我们可以简单地移除开头的 prefix 部分，或者重新计算相对路径
    
    # 方法：构建子目录的完整路径，然后求相对路径
    subdir_full_path = os.path.join(BASE_LOCAL_PATH, dynamic_prefix)
    
    # 计算文件在子目录内部的相对路径 (例如: images/test.png 或 test.png)
    inner_rel_path = os.path.relpath(local_full_path, subdir_full_path)
    
    # S3 Key 结构: anti_fraud / 2026-05-14 / images / test.png
    s3_key = f"{S3_ROOT_PREFIX}/{dynamic_prefix}/{inner_rel_path}"
    
    # 确保路径分隔符统一为正斜杠，并清理可能的双斜杠
    s3_key = s3_key.replace("\\", "/")
    while "//" in s3_key:
        s3_key = s3_key.replace("//", "/")
        
    try:
        with open(local_full_path, 'rb') as f:
            s3_client.put_object(Bucket=TARGET_BUCKET, Key=s3_key, Body=f.read())
        # print(f"成功上传: {s3_key}") # 调试用
        return True
    except Exception as e:
        print(f"上传失败 [{local_rel_path}]: {e}")
        return False

def upload_batch(file_list, dynamic_prefix):
    """批量上传文件"""
    success_count = 0
    fail_count = 0
    for rel_path in file_list:
        if upload_file(rel_path, dynamic_prefix):
            success_count += 1
        else:
            fail_count += 1
    return success_count, fail_count

if __name__ == "__main__":
    print("开始执行上传任务...")
    print(f"S3 Bucket: {TARGET_BUCKET}")
    print(f"S3 Root Prefix: {S3_ROOT_PREFIX}")
    
    # 1. 初始化 S3 客户端
    init_s3()
    
    # 2. 加载上次上传的时间戳
    last_timestamp = load_last_timestamp()
    print(f"上次上传时间戳: {datetime.fromtimestamp(last_timestamp).strftime('%Y-%m-%d %H:%M:%S') if last_timestamp else '无'}")
    
    # 3. 获取当前时间，作为本次运行的截止点
    current_timestamp = datetime.now().timestamp()
    
    # 4. 检查本地基础路径
    if not os.path.exists(BASE_LOCAL_PATH):
        print(f"错误: 本地基础路径不存在: {BASE_LOCAL_PATH}")
        exit(1)

    # 5. 确定要处理的子目录和 S3 动态前缀 (Dynamic Prefix)
    target_subdir = None
    dynamic_prefix = None
    
    # 判断是否有命令行参数指定文件夹
    if len(sys.argv) > 1:
        # 情况 A: 指定了文件夹名称
        specified_dir = sys.argv[1]
        full_path = os.path.join(BASE_LOCAL_PATH, specified_dir)
        
        if os.path.isdir(full_path):
            target_subdir = specified_dir
            dynamic_prefix = specified_dir  # 动态前缀为指定的文件夹名
            print(f"模式: 指定文件夹上传 -> 本地[{specified_dir}] -> S3路径[{S3_ROOT_PREFIX}/{dynamic_prefix}/...]")
        else:
            print(f"错误: 指定的文件夹 '{specified_dir}' 在 {BASE_LOCAL_PATH} 下不存在或不是目录。")
            exit(1)
    else:
        # 情况 B: 未指定，尝试上传“当天日期”命名的文件夹
        today_str = datetime.now().strftime("%Y-%m-%d")
        full_path = os.path.join(BASE_LOCAL_PATH, today_str)
        
        if os.path.isdir(full_path):
            target_subdir = today_str
            dynamic_prefix = today_str  # 动态前缀为当天日期
            print(f"模式: 自动检测当天日期文件夹 -> 本地[{today_str}] -> S3路径[{S3_ROOT_PREFIX}/{dynamic_prefix}/...]")
        else:
            print(f"提示: 未找到名为当天日期 '{today_str}' 的文件夹，且未指定其他文件夹。任务结束。")
            exit(0)

    if not target_subdir:
        print("未确定任何需要上传的目录。")
        exit(0)

    total_success = 0
    total_fail = 0
    
    # 6. 获取新文件并上传
    print(f"\n正在检查子目录: {target_subdir}")
    
    # 获取该目录下所有新文件
    new_files = get_new_files(target_subdir, last_timestamp)
    
    if not new_files:
        print(f"  - {target_subdir}: 无新文件（相对于上次运行时间）")
    else:
        print(f"  - {target_subdir}: 发现 {len(new_files)} 个新文件")
        
        # 批量上传，传入动态前缀
        success, fail = upload_batch(new_files, dynamic_prefix)
        total_success += success
        total_fail += fail
        
        print(f"  - {target_subdir}: 上传成功 {success}, 失败 {fail}")

    # 7. 总结与保存时间戳
    print(f"\n上传任务结束。总计成功: {total_success}, 失败: {total_fail}")
    
    # 更新本地时间戳，记录本次扫描的截止时间
    save_timestamp(current_timestamp)
    print(f"已更新本地时间戳至: {datetime.fromtimestamp(current_timestamp).strftime('%Y-%m-%d %H:%M:%S')}")
