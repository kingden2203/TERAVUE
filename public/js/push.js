// Phone alerts (Web Push). One subscription per browser: place + mode + level. No account.
import { t, getLang } from './i18n.js';
import { esc } from './panels.js';

let ctx;
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const u8 = (b64u) => {
  const pad = '='.repeat((4 - (b64u.length % 4)) % 4);
  const raw = atob((b64u + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};
const state = () => ctx.LS.get('push', { on: false, level: 2 });

export function init(c) {
  ctx = c;
  c.handlers['push-on'] = enable;
  c.handlers['push-off'] = disable;
  c.handlers['push-test'] = test;
  c.handlers['push-level'] = (el) => {
    ctx.LS.set('push', { ...state(), level: +el.dataset.v });
    if (state().on) enable(); else ctx.renderAlerts();
  };
}

const post = (path, body) => ctx.api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function enable() {
  if (!isSecureContext) return ctx.toast(t('pushHttps'));
  if (!supported()) return ctx.toast(t('pushUnsupported'));
  const ll = ctx.S.placeLL;
  if (!ll) return ctx.toast(t('pushPickFirst'));
  try {
    if ((await Notification.requestPermission()) !== 'granted') return ctx.toast(t('pushDenied'));
    const reg = await navigator.serviceWorker.ready;
    const { publicKey } = await ctx.api('/api/push/key');
    let sub = await reg.pushManager.getSubscription();
    try {
      sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: u8(publicKey) });
    } catch (err) {
      if (err.name !== 'InvalidStateError') throw err;
    }
    // a subscription made for a different server key cannot be reused
    const cur = sub?.options?.applicationServerKey && btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    if (!sub || (cur && cur !== publicKey)) {
      await sub?.unsubscribe();
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: u8(publicKey) });
    }
    const st = state();
    const name = ctx.S.place?.nearest ? ctx.S.place.nearest.name : `${ll.lat.toFixed(2)}, ${ll.lon.toFixed(2)}`;
    await post('/api/push/subscribe', { subscription: sub.toJSON(), lat: ll.lat, lon: ll.lon, mode: ctx.S.mode, minLevel: st.level, lang: getLang() });
    ctx.LS.set('push', { on: true, level: st.level, name, mode: ctx.S.mode });
    ctx.renderAlerts();
  } catch (err) {
    ctx.toast(`${t('pushFail')} ${err.message || ''}`.trim());
  }
}

async function disable() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await post('/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe();
    }
  } catch { /* ignore */ }
  ctx.LS.set('push', { on: false, level: state().level });
  ctx.toast(t('pushOffDone'));
  ctx.renderAlerts();
}

async function test() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return ctx.toast(t('pushFail'));
    await post('/api/push/test', { endpoint: sub.endpoint });
    ctx.toast(t('pushSent'));
  } catch (err) {
    ctx.toast(err.message || t('pushFail'));
  }
}

export function html() {
  const st = state();
  const lv = (v) => `<button class="${st.level === v ? 'on' : ''}" data-act="push-level" data-v="${v}">${esc(t('lv.' + v))}</button>`;
  const body = !supported() || !isSecureContext
    ? `<p class="note">${esc(t(isSecureContext ? 'pushUnsupported' : 'pushHttps'))}</p>`
    : `<p class="fine">${esc(t('pushLevel'))}</p><div class="seg">${lv(1)}${lv(2)}${lv(3)}</div>
       ${st.on ? `<p class="note ok">✓ ${esc(t('pushActive', { name: st.name || '', mode: t('mode.' + (st.mode || 'general')), lv: t('lv.' + st.level) }))}</p>` : ''}
       <div class="row2"><button class="btn small primary" data-act="push-on">${esc(t('pushOn'))}</button>
       ${st.on ? `<button class="btn small" data-act="push-test">${esc(t('pushTest'))}</button><button class="btn small" data-act="push-off">${esc(t('pushOff'))}</button>` : ''}</div>`;
  return `<div class="pushcard"><h4>🔔 ${esc(t('pushTitle'))}</h4><p class="fine">${esc(t('pushNote'))}</p>${body}</div>`;
}
