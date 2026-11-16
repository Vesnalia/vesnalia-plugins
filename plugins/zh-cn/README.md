# bb 简体中文语言包

为 bb 的菜单、设置、状态、提示和内置 plugin 面板添加简体中文，保留 project、thread、workspace、Git、API 等开发术语。

社区首发：**0.1.0**。针对 **bb 0.49.0** 整理，要求 bb >=0.49、Plugin SDK >=0.6.132。

## 安装

社区市场上架后，搜索“简体中文语言包”或“Chinese”。也可以从公开 Git 仓库安装指定版本：

```powershell
bb plugin install git:https://github.com/YuuseiP/bb-plugin-zh-cn.git@v0.1.0
```

安装后自动翻译界面。停用和重新启用：

```powershell
bb plugin disable zh-cn
bb plugin enable zh-cn
```

## 翻译范围

- 5,914 条中文译文，保留 228 条术语；原文来自 bb 0.49.0 及本次收集的内置面板。
- 动态文案保留名称、路径、数字和占位符；分页、表单步骤、账号历史等文案按场景区分。
- 聊天正文、代码、终端、用户输入和已识别的自定义标题保持原文。
- 停用后恢复插件修改过的界面文案，不修改 bb 安装文件。

翻译在本机运行，不需要翻译 API、额外账号或付费服务。运行时通过官方 contentScripts API 读取和更新界面文字及辅助属性，不发送网络请求。

词典对应已收集的版本。后续 bb 版本、其他第三方 plugin、原生系统对话框及原样显示的 CLI 输出可能仍有英文。本项目是社区维护的非官方语言包。

## 参与改进

发现漏译或表达不自然时，提交原文、出现位置和建议译法；截图应隐去私人信息。修改译文时保留技术术语和动态占位符，明确说明上下文。

- `dictionary.json`：实际使用的词典。
- `template-rules.json`：复数、固定选项和数量单位规则。
- `context-rules.json`：同文异义的场景规则。
- `l10n/translations.json`：公开审校表，保留原文、译文及场景，供社区查阅。

首版译稿由 Claude Sonnet 与 GPT 协助完成，经过上下文复核；欢迎中文使用者继续改善措辞。

## 开发

使用 Node.js 和 npm 安装依赖；构建需要已安装的 bb CLI：

```powershell
npm ci --ignore-scripts
npm run typecheck
npm run build
npm test
```

测试覆盖占位符、动态名称、复数、上下文区分、DOM 更新、用户内容排除、事件保留、停用恢复和实际编译产物挂载。

## English

Simplified Chinese interface translations for bb, with developer terms such as project, thread, Git and API preserved. Translations run locally, cover menus, settings and built-in panels, and can be reversed by disabling the plugin. Community maintained; tested against bb 0.49.0. No translation service or account is required.

## License

MIT. Original bb UI strings and product names belong to their respective owners.
