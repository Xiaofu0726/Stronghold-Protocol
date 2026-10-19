import { useEffect, useRef, useState } from '../../../vendor/hooks.module.js';
import { html, Icon, TierChip, Countdown, Button } from '../components.js';
import { Img, RichText, PlayerAvatar, GIcon } from '../gameComponents.js';
import { richTextPlain } from '../richText.js';
import { sortedPlayers } from '../gameLogic.js';
import { data } from '../../data.js';
import { t } from '../../../../shared/i18n.js';
import { sentText } from '../lang.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** Select a read-only group page while retaining the stage and the viewer's permanent group identity. */
export function choicePage(sp, groupId = null) {
  if (!sp || !sp.groups?.length) return sp;
  const group = sp.groups.find((g) => g.id === groupId) || sp.groups.find((g) => g.id === sp.groupId) || sp.groups[0];
  return { ...sp, ...group, id: sp.id, groupId: group.id };
}

/** Fixed members start on their own page; spectators start on the first unfinished page. */
export function defaultChoiceGroup(sp) {
  return sp?.groups?.find((group) => group.id === sp.ownGroupId)?.id
    ?? sp?.groups?.find((group) => !group.done)?.id ?? sp?.groups?.[0]?.id ?? sp?.groupId ?? null;
}

// Large-room pages receive the upstream card helpers explicitly; no patches or import cycle.
export function createCapacityChoices({ cardPickable, armedCard, spTap, resolveSpCard, pickBusy }) {
  function CapacityChoiceOverlay(props) {
    const { myId, solo, onPick } = props;
    const [view, setView] = useState(null);
    const stageKey = props.sp?.id || `${props.pub?.round}:${props.sp?.family}`;
    const defaultGroupId = defaultChoiceGroup(props.sp);
    const sp = choicePage(props.sp, view?.stageKey === stageKey ? view.groupId : defaultGroupId);
    const pageKey = `${stageKey}:${sp?.groupId || ''}`;
    const busyIdx = props.busyToken ? (props.busyToken.draftId === sp?.id && props.busyToken.groupId === sp?.groupId ? props.busyToken.idx : null)
      : sp?.groupId == null || sp.groupId === sp.ownGroupId ? props.busyIdx ?? null : null;
    const [sel, setSel] = useState(null);
    const selectionPage = useRef(null);
    const armed = selectionPage.current === pageKey ? armedCard(sel, sp, { myId, solo, busyIdx }) : null;
    const own = choicePage(props.sp, defaultGroupId);
    const myTurn = own?.ownGroupId != null && own.groupId === own.ownGroupId && own.turnPid === myId && !own.pickOf.has(myId);
    const lastTurn = useRef({ stageKey, myTurn });
    useEffect(() => {
      if (!view || lastTurn.current.stageKey !== stageKey || (myTurn && !lastTurn.current.myTurn)) {
        setView({ stageKey, groupId: own?.groupId });
        setSel(null);
      }
      lastTurn.current = { stageKey, myTurn };
    }, [stageKey, myTurn, own?.groupId]);
    // a selection whose card cannot be picked any more (taken, the turn moved on, a pick in flight) is dropped
    useEffect(() => { if (sel != null && armed == null) setSel(null); }, [sel, armed]);
    useEffect(() => {
      if (armed == null) return undefined;
      const onKey = (e) => { if (e.key === 'Escape') setSel(null); };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [armed]);
    if (!sp) return null;
    const tap = (idx) => {
      const card = sp.cards.find((c) => c && c.idx === idx);
      const r = spTap(armed, idx, cardPickable(sp, card, { myId, solo, busyIdx }));
      selectionPage.current = pageKey;
      setSel(r.armed);
      if (r.pick != null) onPick(r.pick, { draftId: sp.id, groupId: sp.groupId });
    };
    return html`<${CapacityChoiceView} ...${props} sp=${sp} busyIdx=${busyIdx} armed=${armed} onTap=${tap}
      onGroup=${(groupId) => { setSel(null); setView({ stageKey, groupId }); }}
      onConfirm=${() => { if (armed != null) tap(armed); }} onDisarm=${() => setSel(null)} />`;
  }

  /** Pure grouped-page view, also rendered by UI tests. */
  function CapacityChoiceView({ pub, sp, myId, solo, personal = false, busyIdx = null, total = null, armed = null, onTap = () => {}, onConfirm = () => {}, onDisarm = () => {}, onGroup = () => {} }) {
    if (!sp) return null;
    const fam = data.get('choices')?.families?.[sp.family] || null;
    const rawFam = data.getRaw('choices')?.families?.[sp.family] || null;
    const players = new Map(sortedPlayers(pub).map((p) => [p.playerId, p]));
    const grouped = sp.groups?.length > 1;
    const readonly = sp.groupId != null && sp.ownGroupId !== sp.groupId;
    const myTurn = !readonly && (solo || sp.turnPid === myId);
    const mine = sp.pickOf.get(myId);
    const turnName = players.get(sp.turnPid)?.name || t('队友');
    const special = /_s$/.test(String(sp.family || ''));
    const order = personal || solo ? [] : sp.order;
    const timed = personal ? pub?.deadline > 0 : !solo && !sp.untimed && !sp.done;
    armed = armedCard(armed, sp, { myId, solo, busyIdx });
    const armedCardRec = armed != null ? sp.cards.find((c) => c && c.idx === armed) : null;
    const armedName = armedCardRec ? resolveSpCard(armedCardRec, sp.family).name : null;
    // a press anywhere but a card or the confirm button drops the selection
    const onDown = (e) => {
      if (armed == null) return;
      const t = e.target;
      if (t && typeof t.closest === 'function' && t.closest('.spcard, .spov__confirm')) return;
      onDisarm();
    };
    // the official header (the event's 悬赏决策, video 9:59): 「悬赏决策 |」 with the description and the timing line stacked
    // beside the bar; on the right the player deciding (name over 正在决策…, an hourglass) or 当前轮到你决策, then the
    // countdown. The pick order lives on the team panel (✓ / ••• on the portraits, ui/teamPanel.js spMarks).
    return html`<div class=${cx('spov', armed != null && 'has-armed', personal && 'spov--personal')} role="dialog" aria-label=${personal ? t('教鞭选择') : t('机变阶段')} onPointerDown=${onDown}>
      <div class="spov__veil" aria-hidden="true"></div>
      <div class="spov__inner">
        <header class="spov__head">
          <div class="spov__titles">
            <i class="spov__deco" aria-hidden="true"></i>
            <h2 class=${cx('spov__title', special && 'is-special')}><span class="spov__name">${sentText(sp.name, rawFam?.name, fam?.name) || fam?.name || t('机变')}</span><span class="spov__bar">|</span><span class="spov__desc"><${RichText} text=${sentText(sp.desc, rawFam?.desc, fam?.desc) || fam?.desc || t('选择一项')} /></span></h2>
            <p class="spov__sub">${sp.done && grouped ? (readonly ? t('该组已完成选择') : t('本组已完成，等待其他组')) : timed ? (personal ? t('休整期结束时未选择将自动选定') : t('倒计时结束后仍未选定将自动分配')) : t('选择一项（无时间限制）')}${mine == null && myTurn ? t(' · 点击卡牌选中，再次点击确认') : ''}</p>
          </div>
          <div class="spov__turn">
            ${personal ? html`<span class="spov__turntxt is-mine">${t('从候选中选择一项战术特训')}</span>`
              : sp.done && grouped ? html`<span class="spov__turntxt is-done"><${Icon} name="check" />${readonly ? t('该组已完成选择') : t('本组已完成，等待其他组')}</span>`
              : mine != null ? html`<span class="spov__turntxt is-done"><${Icon} name="check" />${t('已完成选择')}</span>`
              : myTurn ? html`<span class="spov__turntxt is-mine">${t('当前轮到你决策')}</span>`
              : html`<span class="spov__turntxt is-other"><span class="spov__tw"><b>${turnName}</b><small>${t('正在决策…')}</small></span><${Icon} name="hourglass" /></span>`}
            ${armed != null ? html`<${Button} variant="primary" size="lg" icon="check" class="spov__confirm" data-testid="sp-confirm"
                title=${armedName ? t('确认选择「{armedName}」（再次点击卡牌亦可）', { armedName }) : t('确认选择')} onClick=${onConfirm}>${t('确认选择')}<//>` : null}
            ${timed ? html`<${Countdown} deadline=${sp.turnDeadline ?? pub?.deadline} total=${sp.turnSeconds ?? total ?? undefined} size="sm" />` : null}
          </div>
        </header>
        ${grouped ? html`<nav class="spov__groups" aria-label=${t('分组选择')}>
          ${sp.groups.map((group) => {
            const name = players.get(group.turnPid)?.name;
            return html`<button key=${group.id} type="button" class=${cx('spov__group-tab', group.id === sp.groupId && 'is-active', group.id === sp.ownGroupId && 'is-own')}
              style=${`--pool-group-color:${group.color}`} aria-pressed=${String(group.id === sp.groupId)} data-group=${group.id}
              onClick=${() => onGroup(group.id)} title=${group.done ? t('该组已完成选择') : name ? t('{turnName} 正在决策…', { turnName: name }) : t('等待中')}>
              <b>${group.label}</b><span>${t('{group}组', { group: group.label })}${group.id === sp.ownGroupId ? t('（本组）') : ''}</span>
              <span class="num">${group.pickOf.size}/${group.order.length}</span><${Icon} name=${group.done ? 'check' : 'hourglass'} />
            </button>`;
          })}
        </nav>` : null}
        ${readonly && grouped ? html`<p class="spov__readonly" role="status">${t('正在查看{group}组，只有本组成员可以选择', { group: sp.label })}
          ${sp.ownGroupId != null ? html`<button type="button" onClick=${() => onGroup(sp.ownGroupId)}>${t('返回本组')}</button>` : null}</p>` : null}
        ${grouped && order.length ? html`<div class=${cx('spov__order', order.length > 8 && 'spov__order--many')} aria-label=${t('决策顺序')}>
          ${order.map((pid, i) => {
            const p = players.get(pid);
            const picked = sp.pickOf.has(pid);
            const cur = sp.turnPid === pid && !picked;
            const left = p?.status === 'left';
            return html`<div key=${pid} class=${cx('spov__who', cur && 'is-cur', picked && 'is-done', pid === myId && 'is-self')}>
              <span class="spov__idx num">${i + 1}</span>
              <${PlayerAvatar} player=${p || { name: '?' }} size="sm" self=${pid === myId} />
              <span class="spov__wname">${p?.name || t('博士')}</span>
              <span class="spov__wstate">${left ? html`<${Icon} name="exit" />` : picked ? html`<${Icon} name="check" />` : cur ? html`<${Icon} name="hourglass" />` : html`<${Icon} name="dots" />`}</span>
            </div>`;
          })}
        </div>` : null}
        <div class=${cx('spov__grid', sp.cards.length <= 3 && 'spov__grid--3', sp.cards.length > 6 && 'spov__grid--expanded')}
          style=${sp.cards.length > 6 ? `--sp-cols:${Math.min(6, Math.ceil(sp.cards.length / 2))}` : undefined}>
          ${sp.cards.map((card) => {
            const r = resolveSpCard(card, sp.family);
            const taker = card.takenBy ? players.get(card.takenBy) : null;
            const can = cardPickable(sp, card, { myId, solo, busyIdx });
            const busy = pickBusy(busyIdx, card, mine);
            const isArmed = can && armed === card.idx;
            const takerName = taker ? (card.takenBy === myId ? t('你') : taker.name) : null;
            return html`<button key=${card.idx} type="button" class=${cx('spcard', `spcard--${r.kind}`, (card.takenBy || card.soldOut) && 'is-taken', card.takenBy === myId && 'is-mine', can && 'is-pickable', isArmed && 'is-armed', busy && 'is-busy')}
                aria-busy=${busy ? 'true' : undefined} aria-pressed=${can ? String(isArmed) : undefined} disabled=${!can} onClick=${() => can && onTap(card.idx)}
                aria-label=${isArmed ? t('{name}，已选中，再次点击确认', { name: r.name }) : takerName ? t('{name}，{takerName}已选择', { name: r.name, takerName }) : r.name} title=${`${r.name}\n${richTextPlain(r.desc)}`}>
              <span class="spcard__glow" aria-hidden="true"></span>
              <span class="spcard__head">
                <span class="spcard__icon"><${Img} src=${r.icon} fallback=${html`<${GIcon} name=${r.kind === 'bounty' ? 'target' : 'bolt'} />`} /></span>
                <span class="spcard__title">
                  <b class="spcard__name">${r.name}</b>
                  ${r.team || (r.kind === 'bounty' && r.coin) ? html`<span class="spcard__tags">
                    ${r.team ? html`<span class="spcard__tag spcard__tag--team">${t('全队获得')}</span>` : null}
                    ${r.kind === 'bounty' && r.coin ? html`<span class="spcard__tag spcard__tag--coin">${t('赏金 {coin}', { coin: r.coin })}</span>` : null}
                  </span>` : null}
                </span>
              </span>
              <${RichText} text=${r.desc} class="spcard__desc" />
              ${card.soldOut && !taker ? html`<span class="spcard__busy" role="status">${t('库存不足')}</span>` : null}
              ${r.tier ? html`<${TierChip} tier=${r.tier} size="md" class="spcard__tier" />` : null}
              ${taker ? html`<span class="spcard__taker" title=${t('{name} 已选择', { name: taker.name })}><${PlayerAvatar} player=${taker} size="sm" /></span>` : null}
              ${isArmed ? html`<span class="spcard__confirm" role="status"><span class="spcard__cbox"><${Icon} name="check" /></span><b>${t('确认选择')}</b><small>${t('再次点击')}</small></span>` : null}
              ${busy ? html`<span class="spcard__busy" role="status">${t('选择中')}</span>` : null}
            </button>`;
          })}
        </div>
      </div>
    </div>`;
  }

  return { CapacityChoiceOverlay, CapacityChoiceView };
}
