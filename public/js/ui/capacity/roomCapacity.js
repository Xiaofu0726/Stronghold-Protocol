import { useEffect, useRef, useState } from '../../../vendor/hooks.module.js';
import { html, Icon } from '../components.js';
import { ROOM_CAPACITIES } from '../../../../shared/constants.js';
import { t } from '../../../../shared/i18n.js';

/** In-game capacity menu opens above the compact create row. */
export function CapacitySelect({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const trigger = useRef(null);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector('[aria-selected="true"]')?.focus();
    const dismiss = (event) => {
      if (!root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const choose = (n) => { onChange(n); close(); };
  const navigate = (event, index) => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End', 'Escape'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') { close(); return; }
    const count = ROOM_CAPACITIES.length;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1
      : (index + (event.key === 'ArrowUp' ? -1 : 1) + count) % count;
    root.current?.querySelectorAll('[role="option"]')[next]?.focus();
  };
  return html`<div class="capacity-select" ref=${root}
    onBlur=${(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button type="button" class="capacity-select__trigger" ref=${trigger}
      aria-label=${t('同盟人数上限')} aria-haspopup="listbox" aria-expanded=${open} aria-controls="room-capacity-options"
      onClick=${() => setOpen(!open)} onKeyDown=${(event) => {
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); }
      }}>
      <span class="capacity-select__label">${t('同盟席位')}</span>
      <span class="capacity-select__value">${t('{n} 人', { n: value })}</span>
      <${Icon} name="chevronRight" class="capacity-select__arrow" />
    </button>
    ${open ? html`<div id="room-capacity-options" class="capacity-select__menu" role="listbox" aria-label=${t('同盟人数上限')}>
      ${ROOM_CAPACITIES.map((n, index) => html`<button key=${n} type="button" role="option" class="capacity-select__option"
        data-capacity=${n} aria-selected=${n === value} tabIndex=${n === value ? 0 : -1}
        onClick=${() => choose(n)} onKeyDown=${(event) => navigate(event, index)}>
        <span>${t('{n} 人', { n })}</span><${Icon} name="check" />
      </button>`)}
    </div>` : null}
  </div>`;
}
