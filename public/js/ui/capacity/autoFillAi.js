// Optional AI filling control: uses the upstream AI-last control's styles.
import { html, Icon, Tooltip } from '../components.js';
import { t } from '../../../../shared/i18n.js';

export function autoFillAiOption(room, myId) {
  if (!room || room.mode === 'solo') return null;
  return { on: room.autoFillAi === true, editable: room.hostId != null && room.hostId === myId && !room.inMatch };
}

export function AutoFillAiToggle({ room, myId, busy, onToggle }) {
  const option = autoFillAiOption(room, myId);
  if (!option) return null;
  return html`<div class="ailast">
    <${Tooltip} text=${t('开始模拟时，用 AI 队友补齐空位至同盟人数上限')}>
      <button type="button" role="checkbox" aria-checked=${option.on ? 'true' : 'false'}
          class=${`dpick__opt ailast__opt${option.on ? ' is-active' : ''}`} disabled=${!option.editable || !!busy}
          onClick=${() => option.editable && onToggle(!option.on)}>
        <${Icon} name="check" class=${option.on ? 'is-on' : ''} />${t('自动用 AI 填满房间')}
      </button>
    <//>
    ${option.editable ? null : html`<span class="t-dim">${t('由创建者设置')}</span>`}
  </div>`;
}
