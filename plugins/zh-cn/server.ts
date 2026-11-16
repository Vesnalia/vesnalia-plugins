import type { AliaPluginApi } from '@vesnalia/plugin-sdk';
export default function plugin(alia: AliaPluginApi) {
  alia.log.info('简体中文语言包已启用；停用插件可恢复英文界面。');
}
