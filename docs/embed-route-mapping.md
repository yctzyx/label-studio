# Label Studio 嵌入路由映射（主应用菜单配置参考）

主应用通过无界嵌入 Label Studio 时，可将以下路径配置到主应用菜单中。

## 一、基础 URL 说明

| 部署方式 | LS 基础 URL 示例 |
|----------|------------------|
| 方式 A（首屏直连 LS） | `http://LS地址:8080` |
| 方式 B（全部走网关） | `https://主平台域名/api/label-studio` 或 `https://主平台域名/label-studio` |

**嵌入入口前缀**：`/embed`（无界加载子应用时，pathname 需包含 `/embed`）

---

## 二、独立设置功能映射

### 1. 设置（主应用菜单推荐入口）

| 菜单名称 | 完整路径 | 示例 |
|----------|----------|------|
| 设置 | `{LS_BASE}/embed/settings` | `http://localhost:8080/embed/settings` |

访问后自动跳转到账户与设置页（个人资料、快捷键、邮件偏好、API 令牌等）。

### 2. 组织设置（人员组织管理）

| 菜单名称 | 完整路径 | 示例 |
|----------|----------|------|
| 组织设置 | `{LS_BASE}/embed/organization` | `http://localhost:8080/embed/organization` |

### 3. 账户与设置（用户级，直链）

| 菜单名称 | 完整路径 | 示例 |
|----------|----------|------|
| 账户与设置 | `{LS_BASE}/embed/user/account` | `http://localhost:8080/embed/user/account` |

**子路径**（可选）：
- `{LS_BASE}/embed/user/account/personal-info` - 个人资料
- `{LS_BASE}/embed/user/account/hotkeys` - 快捷键
- `{LS_BASE}/embed/user/account/email-preferences` - 邮件偏好
- `{LS_BASE}/embed/user/account/membership-info` - 成员信息

### 4. 项目设置（项目级）

项目设置需指定项目 ID，无法作为「独立全局入口」：

| 菜单名称 | 完整路径 | 说明 |
|----------|----------|------|
| 项目设置 | `{LS_BASE}/embed/projects/{projectId}/settings` | 通用、标注界面、模型、预测、云存储、Webhooks 等 |

---

## 三、主应用菜单配置示例

若主应用希望增加一个「设置」菜单项，指向 Label Studio 的账户与设置：

```javascript
// 主应用菜单配置示例
const LS_BASE = process.env.LS_EMBED_URL || 'http://localhost:8080';

const menuItems = [
  // ... 其他菜单
  {
    label: '设置',
    path: `${LS_BASE}/embed/settings`,
    // 示例：http://localhost:8080/embed/settings
  },
  {
    label: '组织管理',
    path: `${LS_BASE}/embed/organization`,
    // 示例：http://localhost:8080/embed/organization
  },
];
```

**无界配置**：子应用 url 通常为 `{LS_BASE}/embed/`，主应用内跳转时使用完整 path。

---

## 四、路径速查表

| 功能 | LS 内部 path | 完整 URL（embed） |
|------|--------------|-------------------|
| **设置** | `/settings` | `{LS_BASE}/embed/settings` |
| 组织设置 | `/organization` | `{LS_BASE}/embed/organization` |
| 账户与设置 | `/user/account` | `{LS_BASE}/embed/user/account` |
| 项目列表 | `/projects` | `{LS_BASE}/embed/projects` |
| 我的任务（标注/审核/验收） | `/my-tasks` | `{LS_BASE}/embed/my-tasks` |
| 项目数据管理 | `/projects/{id}/data` | `{LS_BASE}/embed/projects/{id}/data` |
| 项目设置 | `/projects/{id}/settings` | `{LS_BASE}/embed/projects/{id}/settings` |
| 首页 | `/` | `{LS_BASE}/embed/` |

---

## 五、推荐

- **独立设置入口**：使用 `{LS_BASE}/embed/settings`，对应「账户与设置」，适合放在主应用菜单。示例：`http://localhost:8080/embed/settings`
- **组织管理入口**：使用 `{LS_BASE}/embed/organization`，对应「人员组织管理」。示例：`http://localhost:8080/embed/organization`
- **项目设置**：继续通过项目卡片三点菜单进入，或从项目详情页提供「设置」入口，路径为 `{LS_BASE}/embed/projects/{projectId}/settings`。
