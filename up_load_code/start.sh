#!/bin/bash
conda activate fraud1.0
# 日志目录
LOG_DIR="/app/zihao/anti_fraud/screen/up_load_code/logs"
# 按日期命名日志文件
LOG_FILE="${LOG_DIR}/$(date +%Y-%m-%d).log"

# 后台启动服务
nohup python service.py > ${LOG_FILE} 2>&1 &
echo "服务启动成功，进程PID：$!"
echo "日志路径：${LOG_FILE}"
