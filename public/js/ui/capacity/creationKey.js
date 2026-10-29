import { useState } from '../../../vendor/hooks.module.js';
import { html, confirmDialog, TextField } from '../components.js';
import { toast } from '../toasts.js';
import { t } from '../../../../shared/i18n.js';
import { loadPref, savePref } from '../../store.js';

const PREF = 'roomCreationKey';
const isKey = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{12}$/.test(value);

function KeyField({ onChange }) {
  const [value, setValue] = useState('');
  return html`<${TextField} label=${t('创建凭证 Key')} value=${value} maxLength=${12} autoFocus=${true} modalFocus=${true}
    onInput=${(next) => { setValue(next); onChange(next.trim()); }} />`;
}

/** Only the existing create action is wrapped; joining/spectating by room code is unchanged. */
export async function createWithKey(net, payload) {
  const cached = loadPref(PREF, '');
  if (isKey(cached)) {
    try { return await net.request('room.create', { ...payload, creationKey: cached }); } catch (error) {
      if (error?.detail !== 'ROOM_CREATION_KEY_REQUIRED') throw error;
      savePref(PREF, '');
      toast(t('Key 无效、已删除或已停用，请联系管理员'), 'warn');
    }
  }
  let key = '';
  const confirmed = await confirmDialog({
    title: t('创建凭证 Key'),
    text: html`<p>${t('创建同盟或独立模拟需要管理员发放的 Key。加入已有房间不需要。')}</p>
      <${KeyField} onChange=${(value) => { key = value; }} />`,
  });
  if (!confirmed) return;
  if (!isKey(key)) { toast(t('请输入有效的创建凭证 Key'), 'warn'); return; }
  try {
    const result = await net.request('room.create', { ...payload, creationKey: key });
    savePref(PREF, key);
    return result;
  } catch (error) {
    if (error?.detail !== 'ROOM_CREATION_KEY_REQUIRED') throw error;
    toast(t('Key 无效、已删除或已停用，请联系管理员'), 'warn');
  }
}
