# config.py
import os
from datetime import datetime

# ================= S3/Ceph 配置 =================
SOURCE_ENDPOINT = 'http://134.96.176.19:9000'
ACCESS_KEY = 'admin'
SECRET_KEY = 'qMDaMFZ_BMCTz5g6'
TARGET_BUCKET = "vertical-domain-data"

# ================= 本地路径配置 =================
# 基础数据目录
BASE_LOCAL_PATH = "/app/zihao/anti_fraud/screen/"
IMAGES_SUBDIR = "images"
RESULTS_SUBDIR = "results"
NO_TAG_SUBDIR = "no_tag_images"

# 时间戳记录文件路径
TIMESTAMP_FILE = "/app/zihao/anti_fraud/screen/up_load_code/last_upload_timestamp.json"

# ================= 大模型 API 配置 =================
VL_API_URL = "http://134.108.131.30:8017/big-model-java/v1/chat/completions"
VL_API_KEY = "Bearer TELECOM_AI_0E432F9FA11446079F6D_APIKEY"
VL_MODEL = "qwen-vl-large-params-public"

# ================= 辅助函数 =================
def get_daily_base_path():
    """获取基于当前日期的基础路径，例如: /app/zihao/anti_fraud/screen/2023-10-27"""
    today_str = datetime.now().strftime("%Y-%m-%d")
    return os.path.join(BASE_LOCAL_PATH, today_str)

def ensure_daily_dirs():
    """确保当天的 images 和 results 目录存在"""
    daily_path = get_daily_base_path()
    img_dir = os.path.join(daily_path, IMAGES_SUBDIR)
    res_dir = os.path.join(daily_path, RESULTS_SUBDIR)
    os.makedirs(img_dir, exist_ok=True)
    os.makedirs(res_dir, exist_ok=True)
    return img_dir, res_dir

# 确保基础目录存在（原有逻辑）
os.makedirs(os.path.dirname(TIMESTAMP_FILE), exist_ok=True)
os.makedirs(os.path.join(BASE_LOCAL_PATH, IMAGES_SUBDIR), exist_ok=True)
os.makedirs(os.path.join(BASE_LOCAL_PATH, RESULTS_SUBDIR), exist_ok=True)
