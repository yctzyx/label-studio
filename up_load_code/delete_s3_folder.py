import sys
import boto3
from botocore.client import Config
from config import (
    SOURCE_ENDPOINT, ACCESS_KEY, SECRET_KEY, TARGET_BUCKET
)

# ================= 配置区域 =================
# 默认根前缀，如果命令行没给完整路径，会自动拼在前面
DEFAULT_ROOT_PREFIX = "anti_fraud"

def init_s3():
    """初始化 S3 客户端"""
    return boto3.client(
        's3',
        endpoint_url=SOURCE_ENDPOINT,
        aws_access_key_id=ACCESS_KEY,
        aws_secret_access_key=SECRET_KEY,
        region_name='default',
        config=Config(signature_version='s3v4', s3={'addressing_style': 'path'})
    )

def delete_folder_recursively(target_prefix):
    """
    递归删除指定前缀下的所有文件和文件夹本身
    """
    s3_client = init_s3()
    
    # 确保前缀以 / 结尾，防止误删同名文件（如 anti_fraud_file）
    if not target_prefix.endswith('/'):
        safe_prefix = target_prefix + '/'
    else:
        safe_prefix = target_prefix
        
    print(f"🎯 目标 Bucket: {TARGET_BUCKET}")
    print(f"🎯 目标前缀: {safe_prefix}")
    print("-" * 30)
    
    total_deleted = 0
    continuation_token = None
    
    try:
        while True:
            # 1. 列出当前页的对象
            params = {
                "Bucket": TARGET_BUCKET,
                "Prefix": safe_prefix,
                "MaxKeys": 1000  # S3 单次最大删除数量
            }
            if continuation_token:
                params["ContinuationToken"] = continuation_token
                
            response = s3_client.list_objects_v2(**params)
            
            # 如果没有内容，说明删完了或者本来就是空的
            if 'Contents' not in response or not response['Contents']:
                break
                
            # 2. 提取 Key 列表
            objects_to_delete = [{'Key': obj['Key']} for obj in response['Contents']]
            
            # 3. 执行批量删除
            delete_response = s3_client.delete_objects(
                Bucket=TARGET_BUCKET,
                Delete={
                    'Objects': objects_to_delete,
                    'Quiet': True
                }
            )
            
            # 统计成功删除的数量
            if 'Deleted' in delete_response:
                count = len(delete_response['Deleted'])
                total_deleted += count
                print(f"🗑️  已删除一批: {count} 个对象 (累计: {total_deleted})")
                
            # 检查是否有错误
            if 'Errors' in delete_response and delete_response['Errors']:
                print("❌ 部分删除失败:")
                for err in delete_response['Errors']:
                    print(f"   Key: {err['Key']}, Code: {err['Code']}, Message: {err['Message']}")
            
            # 4. 处理分页
            if response.get('IsTruncated'):
                continuation_token = response['NextContinuationToken']
            else:
                break
                
    except Exception as e:
        print(f"❌ 发生严重错误: {e}")
        return False

    print("-" * 30)
    print(f"✅ 删除完成。共删除 {total_deleted} 个对象。")
    print(f"💡 提示: S3 中空文件夹会自动消失，无需额外操作。")
    return True

def main():
    print("S3 指定文件夹彻底删除工具")
    print("=" * 30)
    
    # 1. 确定要删除的路径
    if len(sys.argv) > 1:
        user_input = sys.argv[1]
        # 如果用户输入的是完整路径（包含 anti_fraud），直接使用
        # 如果用户输入的是子文件夹（如 2026-05-14），则拼接根前缀
        if user_input.startswith(DEFAULT_ROOT_PREFIX):
            target_path = user_input
        else:
            target_path = f"{DEFAULT_ROOT_PREFIX}/{user_input}"
    else:
        # 交互式输入
        user_input = input(f"请输入要删除的文件夹路径 (默认根前缀: {DEFAULT_ROOT_PREFIX}/): ").strip()
        if not user_input:
            print("❌ 未输入路径，退出。")
            return
        if user_input.startswith(DEFAULT_ROOT_PREFIX):
            target_path = user_input
        else:
            target_path = f"{DEFAULT_ROOT_PREFIX}/{user_input}"

    # 2. 预览确认
    print(f"\n⚠️  即将删除路径: {target_path}/ 下的所有内容")
    confirm = input("请输入 'DELETE' 确认执行: ")
    
    if confirm != 'DELETE':
        print("❌ 操作已取消。")
        return
        
    # 3. 执行删除
    delete_folder_recursively(target_path)

if __name__ == "__main__":
    main()
