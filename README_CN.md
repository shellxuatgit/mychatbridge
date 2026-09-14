# MyChatBridge

<p align="center">
  <img src="build/logo-concept-a-bridge.svg" alt="MyChatBridge Logo" width="128" height="128">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Release-v0.1.0-blue?style=flat-square&logo=github" alt="Release">
  <img src="https://img.shields.io/badge/License-GPL--3.0-blue?style=flat-square" alt="License">
  <br>
  <a href="https://www.electronjs.org/"><img src="https://img.shields.io/badge/Electron-33+-47848F?style=flat-square&logo=electron&logoColor=white" alt="Electron"></a>
  <a href="https://react.dev/"><img src="https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript"></a>
  <img src="https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey?style=flat-square" alt="Platform">
</p>

<p align="center">
  <strong>多平台 AI 服务统一管理工具</strong>
</p>

<p align="center">
  MyChatBridge 通过官方 Web UI 实现对主流 AI 模型的零成本接入。支持 DeepSeek、GLM、Kimi、MiniMax、Qwen、Z.ai 等 Provider，
  可与 Cline、Roo-Code 等工具无缝集成，让任意 OpenAI 兼容客户端开箱即用。
</p>

## ✨ 特性

- **OpenAI 兼容 API**：提供标准 OpenAI 兼容端点，无缝集成
- **多 Provider 支持**：接入 DeepSeek、GLM、Kimi、MiniMax、Perplexity、Qwen、Z.ai 等
- **上下文管理**：滑动窗口、Token 限制、摘要策略
- **工具调用支持**：通过提示工程为所有模型提供通用工具调用能力，兼容 Cherry Studio、Cline、Kilo Code 等客户端
- **模型映射**：通配符模型名映射，支持首选 Provider/账号
- **自定义参数**：自定义 HTTP 头以启用联网搜索、思考模式、深度研究
- **仪表盘监控**：实时请求流量、Token 使用、成功率
- **API Key 管理**：为本地代理生成与管理密钥
- **模型管理**：查看与管理所有 Provider 可用模型
- **请求日志**：详细请求日志，便于调试与分析
- **代理配置**：灵活的代理设置与路由策略
- **系统托盘**：菜单栏快速访问状态
- **多语言**：简体中文 / English
- **专业运维界面**：信息密度优先，等宽数值，扁平直边

## 📥 安装

### 下载

从 GitHub Releases 下载最新版本：

> 仓库地址：https://github.com/shellxuatgit/mychatbridge/releases

### 从源码构建

```bash
git clone https://github.com/shellxuatgit/mychatbridge.git
cd MyChatBridge
npm install
npm run build:win    # Windows
npm run build:mac    # macOS
npm run build:linux  # Linux
```

## ⚠️ 工具调用协议变更

本版本（v0.1.0）将工具调用协议标记从 `<|CHAT2API|tool_calls>` 改为 `<|MYCHATBRIDGE|tool_calls>`。

**已集成 Cline / Roo-Code 的用户**：由于协议标记变更，需更新到对应新版本，否则工具调用解析将不生效。

## 📄 License

GPL-3.0
