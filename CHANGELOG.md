# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-09-13

### Added
- OpenAI-compatible API proxy for multiple AI providers (DeepSeek, GLM, Kimi, MiniMax, Perplexity, Qwen, Z.ai)
- Web LLM accounts (ChatGPT Web, Doubao Web) with three authentication paths: managed Connect login, browser-cookie import (Windows), manual token
- Universal tool-calling capability via prompt engineering, compatible with Cherry Studio, Cline, Kilo Code
- Model mapping with wildcard support and preferred provider/account routing
- Context management: sliding window, token limits, summarization strategies
- Dashboard with real-time request traffic, token usage, and success rate
- API key management for the local proxy
- Request logs with desensitization
- System tray integration
- 9 UI languages (zh-CN, en-US, zh-TW, ja-JP, ko-KR, es-ES, fr-FR, de-DE, ru-RU)
- Multi-platform builds for Windows (nsis), macOS (dmg/zip), Linux (AppImage/deb)
