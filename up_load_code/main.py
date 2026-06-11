# code/main.py
import os
import json
import time
import shutil
from datetime import datetime
from tqdm import tqdm
from config import BASE_LOCAL_PATH, IMAGES_SUBDIR, RESULTS_SUBDIR, NO_TAG_SUBDIR
from vl_tag import process_single_image
from uploader import load_last_timestamp, save_timestamp, get_new_files, upload_batch

# 配置常量
MAX_RECORDS_PER_JSONL = 1000
MAX_RETRIES = 2  # 最大重试次数 (总共尝试 1 + MAX_RETRIES 次)

def main():
    print("="*50)
    print("启动反诈数据自动打标与上传任务")
    print("="*50)
    
    # 1. 获取上次时间戳
    last_ts = load_last_timestamp()
    print(f"上次运行时间: {datetime.fromtimestamp(last_ts) if last_ts > 0 else '首次运行'}")
    
    # 2. 确定本次任务的日期前缀 (用于本地归档文件夹和 S3 文件夹分类)
    date_prefix = datetime.now().strftime("%Y-%m-%d")
    
    # 定义当天的归档目录路径
    # 结构: BASE_LOCAL_PATH / YYYY-MM-DD / images
    #       BASE_LOCAL_PATH / YYYY-MM-DD / results
    #       BASE_LOCAL_PATH / YYYY-MM-DD / no_tag_images
    daily_base_dir = os.path.join(BASE_LOCAL_PATH, date_prefix)
    daily_img_dir = os.path.join(daily_base_dir, IMAGES_SUBDIR)
    daily_res_dir = os.path.join(daily_base_dir, RESULTS_SUBDIR)
    daily_no_tag_dir = os.path.join(daily_base_dir, NO_TAG_SUBDIR)
    
    # 确保归档目录存在
    os.makedirs(daily_img_dir, exist_ok=True)
    os.makedirs(daily_res_dir, exist_ok=True)
    os.makedirs(daily_no_tag_dir, exist_ok=True)
    
    # 3. 扫描新的图片文件
    # 注意：get_new_files 扫描的是原始图片存放区 (例如 BASE_LOCAL_PATH/images)
    # 假设原始图片在 BASE_LOCAL_PATH/images 下
    new_images = get_new_files(IMAGES_SUBDIR, last_ts)
    print(f"发现 {len(new_images)} 张新图片")
    
    success_count = 0
    skip_count = 0
    fail_count = 0
    
    # 用于收集待上传的文件路径 (相对于 BASE_LOCAL_PATH)
    # 这些路径将指向移动后的新位置: date_prefix/images/xxx.jpg 或 date_prefix/results/xxx.jsonl
    images_to_upload = []
    jsonl_files_to_upload = []
    
    # JSONL 文件管理变量
    current_jsonl_path = None
    current_jsonl_handle = None
    current_record_count = 0
    jsonl_file_index = 0 # 用于区分同一天内的多个 JSONL 文件
    
    def close_current_jsonl():
        nonlocal current_jsonl_handle, current_jsonl_path, current_record_count
        if current_jsonl_handle:
            current_jsonl_handle.close()
            current_jsonl_handle = None
            if current_jsonl_path:
                # 记录相对于 BASE_LOCAL_PATH 的路径，用于后续上传
                rel_path = os.path.relpath(current_jsonl_path, BASE_LOCAL_PATH)
                jsonl_files_to_upload.append(rel_path)
                print(f"JSONL 文件已关闭并加入上传队列: {rel_path} ({current_record_count} 条记录)")
            current_jsonl_path = None
            current_record_count = 0

    def open_new_jsonl():
        nonlocal current_jsonl_path, current_jsonl_handle, current_record_count, jsonl_file_index
        # 生成 JSONL 文件名: tags_000.jsonl
        jsonl_filename = f"tags_{jsonl_file_index:03d}.jsonl"
        
        # 修正存放位置为: BASE_LOCAL_PATH/日期/results/
        # daily_res_dir 已经在上面定义为 os.path.join(BASE_LOCAL_PATH, date_prefix, RESULTS_SUBDIR)
        jsonl_full_dir = daily_res_dir
        os.makedirs(jsonl_full_dir, exist_ok=True)
        
        current_jsonl_path = os.path.join(jsonl_full_dir, jsonl_filename)
        current_jsonl_handle = open(current_jsonl_path, 'a', encoding='utf-8')
        current_record_count = 0
        jsonl_file_index += 1
        print(f"创建新 JSONL 文件: {os.path.relpath(current_jsonl_path, BASE_LOCAL_PATH)}")

    try:
        if new_images:
            print("开始打标、移动归档与整理...")
            for img_rel_path in tqdm(new_images, desc="Processing"):
                # img_rel_path 是相对于 BASE_LOCAL_PATH 的原始路径，例如 "images/abc.jpg"
                img_full_path = os.path.join(BASE_LOCAL_PATH, img_rel_path)
                
                if not os.path.exists(img_full_path):
                    print(f"警告: 文件不存在跳过 {img_full_path}")
                    skip_count += 1
                    continue

                # --- 需求1: 重试机制 ---
                result = None
                for attempt in range(MAX_RETRIES + 1):
                    try:
                        result = process_single_image(img_full_path)
                        # 如果返回 None (非可疑) 或 status 为 success，则跳出重试循环
                        if result is None or (isinstance(result, dict) and result.get("status") == "success"):
                            break
                        else:
                            # 如果是其他异常状态，视为失败并重试
                            raise Exception(f"打标返回状态异常: {result.get('status')}")
                    except Exception as e:
                        if attempt < MAX_RETRIES:
                            print(f"打标失败 (尝试 {attempt + 1}/{MAX_RETRIES + 1}): {img_rel_path}, 错误: {e}")
                            time.sleep(1) # 重试前等待
                        else:
                            print(f"打标最终失败: {img_rel_path}, 错误: {e}")
                            result = {"status": "failed", "data": {"error": str(e)}}

                # 处理结果
                # 情况 A: 非可疑图片 (None) -> 移动到 no_tag_images 文件夹
                if result is None:
                    filename = os.path.basename(img_rel_path)
                    target_no_tag_path = os.path.join(daily_no_tag_dir, filename)
                    
                    try:
                        # 只有当源路径和目标路径不同时才移动
                        if os.path.abspath(img_full_path) != os.path.abspath(target_no_tag_path):
                            shutil.move(img_full_path, target_no_tag_path)
                        skip_count += 1
                    except Exception as e:
                        print(f"移动非可疑图片失败 {img_full_path} -> {target_no_tag_path}: {e}")
                        fail_count += 1
                    continue
                
                # 情况 B: 打标失败
                if not isinstance(result, dict) or result.get("status") != "success":
                    fail_count += 1
                    continue
                
                # 情况 C: 打标成功
                tag_data = result["data"]
                success_count += 1
                
                # --- 需求2: 移动图片到 BASE_LOCAL_PATH/日期/images ---
                filename = os.path.basename(img_rel_path)
                target_img_path = os.path.join(daily_img_dir, filename)
                
                try:
                    # 只有当源路径和目标路径不同时才移动
                    if os.path.abspath(img_full_path) != os.path.abspath(target_img_path):
                        shutil.move(img_full_path, target_img_path)
                    
                    # 记录移动后的相对路径用于上传
                    # 新路径结构: date_prefix/images/filename
                    new_img_rel_path = os.path.join(date_prefix, IMAGES_SUBDIR, filename)
                    images_to_upload.append(new_img_rel_path)
                    
                except Exception as e:
                    print(f"移动图片失败 {img_full_path} -> {target_img_path}: {e}")
                    fail_count += 1
                    continue

                # 2. 构建 JSONL 记录
                # source_image 记录归档后的相对路径，方便追溯
                output_record = {
                    "source_image": new_img_rel_path,
                    "process_time": datetime.now().isoformat(),
                    "tag_result": tag_data
                }
                
                # 3. 写入 JSONL (标签数据归档到 BASE_LOCAL_PATH/日期/results)
                if current_jsonl_handle is None or current_record_count >= MAX_RECORDS_PER_JSONL:
                    if current_record_count >= MAX_RECORDS_PER_JSONL:
                        close_current_jsonl()
                    if current_jsonl_handle is None:
                        open_new_jsonl()
                
                # 写入一行 JSON
                if current_jsonl_handle:
                    current_jsonl_handle.write(json.dumps(output_record, ensure_ascii=False) + '\n')
                    current_record_count += 1
                    
                    # 如果刚好满1000条，立即关闭并打开新的
                    if current_record_count >= MAX_RECORDS_PER_JSONL:
                        close_current_jsonl()

    finally:
        # 确保最后一个 JSONL 文件被正确关闭
        close_current_jsonl()

    # 4. 上传文件到 S3
    print("-"*50)
    print(f"处理总结:")
    print(f"成功打标并归档: {success_count}")
    print(f"非可疑跳过: {skip_count}")
    print(f"打标失败: {fail_count}")
    print(f"待上传图片: {len(images_to_upload)}")
    print(f"待上传 JSONL: {len(jsonl_files_to_upload)}")
    
    if images_to_upload or jsonl_files_to_upload:
        print("开始上传到 S3...")
        
        # 上传新图片 (打标成功的，已移动到 date_prefix/images)
        if images_to_upload:
            # images_to_upload 包含如: "2023-10-27/images/abc.jpg"
            # 我们希望 S3 上也是这个路径结构。
            # 假设 upload_batch(file_list, prefix) 会将文件上传到 bucket/prefix/...
            # 如果 prefix 为空，则上传到 bucket/2023-10-27/images/abc.jpg
            img_succ, img_fail = upload_batch(images_to_upload, "")
            print(f"图片上传: 成功 {img_succ}, 失败 {img_fail}")
        
        # 上传新 JSONL 文件
        if jsonl_files_to_upload:
            # jsonl_files_to_upload 包含如: "2023-10-27/results/tags_000.jsonl"
            # 同样传入空 prefix，保持目录结构
            res_succ, res_fail = upload_batch(jsonl_files_to_upload, "")
            print(f"JSONL 上传: 成功 {res_succ}, 失败 {res_fail}")
    else:
        print("无新数据需要上传。")

    # 5. 更新的时间戳
    current_ts = datetime.now().timestamp()
    save_timestamp(current_ts)
    
    print("="*50)
    print("任务完成")
    print("="*50)

if __name__ == "__main__":
    main()
