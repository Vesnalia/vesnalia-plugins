import type { BbPluginApi } from '@get-bb/plugin-sdk';
export default function plugin(bb: BbPluginApi) {
  bb.log.info('简体中文语言包已启用；停用插件可恢复英文界面。');
}
