# code/vl_tag.py
import json
import re
import base64
import requests
from config import VL_API_URL, VL_API_KEY, VL_MODEL

# ================= Prompts =================

PROMPT_CHECK = """
你是一个网页截图审核专家，请你分析用户提供的图片是否出现以下任意特征：
- 直接涉及资金交易（充值、转账、收款）
- 包含赌博/色情/毒品等违法关键词
- 出现高收益承诺等诈骗话术
- 含有非官方联系方式（个人银行账户、非企业认证社交账号）

如果输入图片出现上述任意一种特征，那么回答 Y，否则回答 N。
**特别注意**
-识别伪装内容（如谐音词、隐蔽符号等）
-对卡通/素描等非真人内容同样敏感
-非中文内容也需要检测

你只需要回答“Y”或者“N”，无需解释。
如果无法确定。默认回答“N”。
"""

PROMPT_TAG = """
**角色与任务：** 你是一名专业的反诈分析专家。请分析一张涉嫌**黄赌毒、诈骗等非法活动**的网页截图，**聚焦提取可直接用于反诈行动的关键要素**（如资金账户、联系方式、核心违法证据、关键网址），输出精简的JSON。

**提取要求 (只抓重点)：**

1.  **核心违法与诈骗特征 (定性关键)：**
    *   **主要违法类型：** 必填。选填项：`赌博`/`诈骗`/`色情`/`毒品`/`网址分发`/`其他违法`。**可多选**。
    *   **诈骗类型 (如适用)：** 选填项：`刷单`/`贷款`/`杀猪盘`/`投资`/`冒充`/`中奖`/`虚假购物`/`ETC`/`其他`。**可多选**。
    *   **关键诈骗话术 (原文引用)：** 直接复制最具欺诈性、诱导性的1-3句原文。如“稳赚不赔”、“高额返利”、“安全账户”、“系统异常需转账”等。
    *   **显著诱导承诺 (原文引用)：** 如"永久有效"、"100%防失联"、"自动回复最新地址"等。**可多选，务必原文！**

2.  **资金与收款信息 (止付核心)：**
    *   **收款账户信息 (原文引用)：** **必填**。完整提取所有可见账户信息，若页面未提供则填写`["未提供"]`。
    *   **充值/支付按钮描述：** 描述核心操作入口。选填。

3.  **联系方式与引流信息 (追踪线索)：**
    *   **客服联系方式 (原文引用)：** **必填**。提取所有可见联系方式，**新增防失邮箱类型**：
        *   格式：`邮箱 - 自动回复地址：xxx@gmail.com`
    *   **APP下载信息：** **必填**。若无相关信息，`app_name`填`"未提供"`。
    *   **网站/域名信息 (封堵目标)：** **必填**。

4.  **其他高价值信息 (辅助研判)：**
    *   **反侦查提示 (原文引用)：** **必填数组**（网址分发类核心特征）。提取：
        *   地址更新声明（如"旧地址即将关闭"）
        *   最新地址链接（如"最新地址1，点击继续访问"）
        *   访问要求（如"请使用Chrome浏览器"）
    *   **显著异常特征：** 特殊要求如浏览器限制等（如"请使用谷歌浏览器访问"）。选填。

**输出示例 (精简JSON)：**
=== 示例开始（仅展示格式） ===
```json
{
  "core_illegal_info": {
    "main_illegal_types": ["网址分发", "诈骗"],
    "fraud_types": ["刷单", "投资"],
    "key_fraud_phrases": ["高额返利，日赚千元！", "旧地址即将关闭，请务必重新收藏本地址！"],
    "enticement_phrases": ["包赔包赚，稳赢！", "永久域名"]
  },
  "financial_info": {
    "payment_accounts": [
          "银行卡 - 户名：李四 账号：621700****5678 开户行：建设银行深圳分行",
          "微信 - 收款账号：wxid_zhangsan",
          "虚拟货币 - BTC地址：1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2"
    ],
    "recharge_buttons": "页面中部‘立即充值’按钮"
  },
  "contact_tracking_info": {
    "customer_contacts": [
      "QQ - 客服：888888",
      "微信群 - 群二维码（截图中部）",
      "Telegram - @illegalgroup",
      "邮箱 - 自动回复地址：gg51888888@gmail.com"
    ],
    "app_download": {
      "app_name": "幸运彩票",
      "download_link": "https://down.xxx123.com/app.apk",
      "qrcode_desc": "APP下载二维码（页面底部）"
    },
    "website_domain": {
      "visible_url": "https://www.abc-bet.com/index.html",
      "core_domain": "abc-bet.com",
      "promo_name": "皇冠体育投注"
    }
  },
  "critical_notes": {
    "anti_detection_hints": ["最新访问地址：abc456.com [请收藏]", "最新地址1，点击继续访问"],
    "salient_anomalies": ""
  }
}
```
=== 示例结束 ===

*   **必填项：**
    *   `core_illegal_info.main_illegal_types` (至少1项)
    *   `financial_info.payment_accounts` (至少1个账户信息)
    *   `contact_tracking_info.customer_contacts` (至少1个联系方式)
    *   `contact_tracking_info.app_download.app_name` 或 `contact_tracking_info.app_download.download_link` 或 `contact_tracking_info.app_download.qrcode_desc` (APP信息至少有一项)
    *   `contact_tracking_info.website_domain.core_domain` 或 `contact_tracking_info.website_domain.visible_url` 或 `contact_tracking_info.website_domain.promo_name` (网站信息至少有一项)
*   **空值处理：**
    *   必填项必须有值（数组至少1项，字符串非空）。
    *   非必填项（如 `fraud_types`, `enticement_phrases`, `recharge_buttons`, `anti_detection_hints`, `salient_anomalies`）如果**无相关信息，可完全省略该字段**。
*   **原文引用：** `key_fraud_phrases`, `enticement_phrases`, `payment_accounts`, `customer_contacts` 中的详细信息**必须直接引用原文**。
*   **不确定信息：** 在对应字符串**末尾**标注 `[疑似]` 或 `[待确认]`。
*   **简洁描述：** `recharge_buttons`, `app_download.qrcode_desc`, `salient_anomalies` 等字段用**最简洁语言描述**。

**规则：**
1. 所有数据**必须**来自用户输入，禁止引用示例内容。
2. 缺失字段直接省略（不输出该字段）。
3. 模糊信息标注 `[不完整]`，疑似信息标注 `[疑似]`。

**（请开始分析，并严格按此精简JSON结构输出）**"""

def encode_image(image_path):
    """将图片编码为Base64"""
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode("utf-8")

def call_api(base64_image, prompt, timeout=60):
    """通用 API 调用函数"""
    headers = {
        "Authorization": VL_API_KEY,
        "Content-Type": "application/json"
    }
    data = {
        "model": VL_MODEL,
        "messages": [
            {"role": "system", "content": prompt},
            {"role": "user", "content": [{"type": "image_url", "image_url": {"url": f"data:image/png;base64,{base64_image}"}}]}
        ],
        "temperature": 0.1,
        "top_p": 0.5
    }
    try:
        response = requests.post(VL_API_URL, headers=headers, json=data, timeout=timeout)
        response.raise_for_status()
        return response.json()["choices"][0]["message"]["content"]
    except Exception as e:
        return e

def check_image(img_base64):
    """初步筛选：返回 True (可疑) 或 False (非可疑)"""
    res = call_api(img_base64, PROMPT_CHECK, timeout=30)
    if isinstance(res, str):
        return res.strip().upper() == "Y"
    return False

def tag_image(img_base64):
    """详细打标：返回解析后的 JSON 字典或错误信息字典"""
    res = call_api(img_base64, PROMPT_TAG, timeout=60)
    
    if isinstance(res, Exception):
        return {"error": str(res)}
    
    try:
        # 尝试清理可能的 markdown 标记
        clean_res = res.replace('```json', '').replace('```', '').strip()
        parsed_json = json.loads(clean_res)
        return parsed_json
    except Exception as e:
        return {"error": "JSON Parse Failed", "raw_response": res}

def process_single_image(img_path):
    """
    处理单张图片：
    1. 编码
    2. 初筛
    3. 如果可疑，详细打标
    4. 返回结果字典:
       - None: 非可疑图片
       - Dict with 'status': 'success', 'data': {...}: 打标成功
       - Dict with 'status': 'failed', 'data': {...}: 打标失败
       - Dict with 'status': 'error', 'data': {...}: 程序异常
    """
    try:
        b64_img = encode_image(img_path)
        
        # 1. 初筛
        if not check_image(b64_img):
            return None # 非可疑图片，跳过
        
        # 2. 详细打标
        tag_result = tag_image(b64_img)
        
        # 检查打标结果是否包含错误
        if isinstance(tag_result, dict) and "error" in tag_result:
            return {
                "status": "failed",
                "data": tag_result
            }
        
        return {
            "status": "success",
            "data": tag_result
        }
    except Exception as e:
        return {
            "status": "error",
            "data": {"error": str(e)}
        }
