# PRD-A3 部署

## 元信息

| 字段 | 值 |
|---|---|
| 阶段 | A3 |
| 名称 | 部署（GitHub Pages 自动部署） |
| 状态 | **已验收**（2026-08-12） |

## 1. 背景与目标

- **背景**：文档站需要自动部署到 GitHub Pages。
- **目标**：push 到 master 自动触发部署。

## 2. 需求范围

- [x] FR1：GitHub Actions 自动部署工作流
- [x] FR2：base path 配置适配 GitHub Pages

## 5. 验收标准

- [x] AC1：push 到 master 自动部署
- [x] AC2：GitHub Pages 可访问
