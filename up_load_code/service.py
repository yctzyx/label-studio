
"""
反诈图片打标 API 服务
基于 FastAPI 实现的 Web 服务
"""
import os
import sys
import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional

# 导入打标模块
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tag_api import tag_images_concurrent, MAX_CONCURRENT

# ================= 配置 =================
APP_TITLE = "反诈图片打标 API"
APP_VERSION = "1.0.0"
DEFAULT_HOST = "0.0.0.0"
DEFAULT_PORT = 6661

# ================= FastAPI 应用 =================
app = FastAPI(
    title=APP_TITLE,
    version=APP_VERSION,
    description="支持并发处理的反诈图片打标服务"
)

# ================= 数据模型 =================
class ImageItem(BaseModel):
    data_type: str = Field(..., description="数据类型，必须是 'image'")
    id: str = Field(..., description="图片唯一标识")
    data: str = Field(..., description="Base64 编码的图片数据")

class TagRequest(BaseModel):
    images: List[ImageItem] = Field(..., description="待打标的图片列表")
    max_concurrent: Optional[int] = Field(MAX_CONCURRENT, description="最大并发数")

class TagResultItem(BaseModel):
    id: str
    is_suspicious: int
    tag_result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None

class TagResponse(BaseModel):
    status: int
    result: List[TagResultItem]
    message: str

# ================= 中间件 =================
@app.middleware("http")
async def add_process_time_header(request: Request, call_next):
    """添加响应头"""
    response = await call_next(request)
    response.headers["X-Service"] = "anti-fraud-tagging"
    return response

# ================= 路由 =================

@app.get("/", summary="服务根路径")
async def root():
    """服务健康检查和信息展示"""
    return {
        "service": APP_TITLE,
        "version": APP_VERSION,
        "status": "running",
        "endpoints": {
            "health": "/health",
            "tag": "/api/v1/tag",
            "docs": "/docs"
        }
    }

@app.get("/health", summary="健康检查")
async def health_check():
    """健康检查接口"""
    return {"status": "healthy", "service": APP_TITLE}

@app.post("/api/v1/tag", 
          summary="图片打标接口",
          response_model=TagResponse)
async def tag_images_endpoint(request: TagRequest):
    """
    批量图片打标接口
    
    - **images**: 待打标图片列表
    - **max_concurrent**: 最大并发数（可选，默认 5）
    """
    try:
        # 转换为字典列表
        image_dicts = [item.dict() for item in request.images]
        
        # 调用打标函数
        result = tag_images_concurrent(
            image_dicts, 
            max_concurrent=request.max_concurrent or MAX_CONCURRENT
        )
        
        return JSONResponse(content=result)
        
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={
                "status": 1,
                "result": [],
                "message": f"服务内部错误: {str(e)}"
            }
        )

# ================= 启动服务 =================
def start_service(host: str = DEFAULT_HOST, port: int = DEFAULT_PORT):
    """启动 FastAPI 服务"""
    print(f"="*60)
    print(f"🚀 {APP_TITLE} v{APP_VERSION}")
    print(f"="*60)
    print(f"📡 服务地址: http://{host}:{port}")
    print(f"📚 API 文档: http://{host}:{port}/docs")
    print(f"="*60)
    
    uvicorn.run(
        "service:app",
        host=host,
        port=port,
        reload=False,
        workers=1
    )

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="反诈图片打标 API 服务")
    parser.add_argument("--host", default=DEFAULT_HOST, help="监听地址")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="监听端口")
    
    args = parser.parse_args()
    start_service(args.host, args.port)

