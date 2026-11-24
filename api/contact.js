// AERPI — form handler (Vercel serverless function)
// Riceve i dati dei form (adesione / contatti) e invia 2 email via Resend:
//  1) notifica all'associazione   2) conferma automatica a chi ha compilato.
// La API key sta SOLO lato server (env var RESEND_API_KEY), mai nel codice pubblico.

// ---- Configurazione (modificabile) ----
const FROM = 'AERPI <noreply@aerpi.org>';        // mittente verificato su Resend
const NOTIFY_TO = ['info@aerpi.org'];             // dove arrivano le richieste (inoltrata su Gmail via Cloudflare Email Routing)
const REPLY_TO_ASSOC = 'info@aerpi.org';
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

// ---- Testi conferma automatica (per lingua) ----
const CONFIRM = {
  it: {
    socioSubject: 'Grazie per la tua richiesta di adesione — AERPI',
    contSubject: 'Abbiamo ricevuto il tuo messaggio — AERPI',
    hi: 'Ciao',
    socioBody: 'grazie per il tuo interesse verso AERPI! Abbiamo ricevuto la tua richiesta di adesione e ti ricontatteremo il prima possibile.',
    contBody: 'grazie per averci scritto! Abbiamo ricevuto il tuo messaggio e ti risponderemo il prima possibile.',
    sign: 'Un caro saluto,\nIl team AERPI'
  },
  en: {
    socioSubject: 'Thank you for your membership request — AERPI',
    contSubject: 'We received your message — AERPI',
    hi: 'Hello',
    socioBody: 'thank you for your interest in AERPI! We have received your membership request and will get back to you as soon as possible.',
    contBody: 'thank you for writing to us! We have received your message and will reply as soon as possible.',
    sign: 'Warm regards,\nThe AERPI team'
  },
  pt: {
    socioSubject: 'Obrigado pelo seu pedido de adesão — AERPI',
    contSubject: 'Recebemos a sua mensagem — AERPI',
    hi: 'Olá',
    socioBody: 'obrigado pelo seu interesse na AERPI! Recebemos o seu pedido de adesão e entraremos em contacto o mais brevemente possível.',
    contBody: 'obrigado por nos ter escrito! Recebemos a sua mensagem e responderemos o mais brevemente possível.',
    sign: 'Um abraço,\nA equipa AERPI'
  }
};

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
}

async function sendEmail(key, payload) {
  try {
    const r = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      return { ok: false, status: r.status, detail };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: String(e) };
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    res.status(500).json({ error: 'not_configured' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  // Honeypot anti-spam: se compilato, fingi successo e non inviare nulla.
  if (body._gotcha) { res.status(200).json({ ok: true }); return; }

  const kind = body.kind === 'socio' ? 'socio' : 'cont';
  const lang = CONFIRM[body.lang] ? body.lang : 'it';
  const skip = new Set(['kind', 'lang', '_gotcha']);
  const fields = Object.entries(body).filter(
    ([k, v]) => !skip.has(k) && String(v == null ? '' : v).trim() !== ''
  );

  const email = String(body.Email || '').trim();
  const nome = String(body.Nome || '').trim();

  // --- Email di notifica all'associazione ---
  const subject = kind === 'socio' ? 'Nuova adesione dal sito — AERPI' : 'Nuovo messaggio dal sito — AERPI';
  const rows = fields.map(([k, v]) =>
    `<tr><td style="padding:5px 14px 5px 0;color:#8A8270;font-size:13px;white-space:nowrap;vertical-align:top;">${esc(k)}</td>` +
    `<td style="padding:5px 0;font-size:14px;color:#14110D;">${esc(String(v)).replace(/\n/g, '<br>')}</td></tr>`
  ).join('');
  const notifyHtml =
    `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;">` +
    `<h2 style="font-size:18px;color:#14110D;border-bottom:2px solid #CE1B24;padding-bottom:8px;">${esc(subject)}</h2>` +
    `<table style="border-collapse:collapse;margin-top:10px;">${rows}</table>` +
    `</div>`;
  const notifyText = fields.map(([k, v]) => `${k}: ${v}`).join('\n');

  const notify = await sendEmail(key, {
    from: FROM,
    to: NOTIFY_TO,
    reply_to: isEmail(email) ? email : REPLY_TO_ASSOC,
    subject: subject,
    html: notifyHtml,
    text: notifyText
  });
  if (!notify.ok) {
    res.status(502).json({ error: 'send_failed', detail: notify.detail });
    return;
  }

  // --- Email di conferma automatica a chi ha compilato ---
  if (isEmail(email)) {
    const c = CONFIRM[lang];
    const cSubject = kind === 'socio' ? c.socioSubject : c.contSubject;
    const cBody = kind === 'socio' ? c.socioBody : c.contBody;
    const greet = c.hi + (nome ? ' ' + nome : '');
    const cHtml =
      `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#14110D;line-height:1.6;">` +
      `<p>${esc(greet)},</p>` +
      `<p>${esc(cBody)}</p>` +
      `<p style="white-space:pre-line;color:#4A4438;">${esc(c.sign)}</p>` +
      `<hr style="border:none;border-top:1px solid #E3DECF;margin:22px 0;">` +
      `<p style="font-size:12px;color:#9a917f;">AERPI — Associazione degli Emiliano‑Romagnoli nella Penisola Iberica · Lisbona<br>https://aerpi.org</p>` +
      `</div>`;
    const cText = `${greet},\n\n${cBody}\n\n${c.sign}\n\n— AERPI · https://aerpi.org`;
    // La conferma è "best effort": se fallisce non blocca la risposta.
    await sendEmail(key, {
      from: FROM,
      to: [email],
      reply_to: REPLY_TO_ASSOC,
      subject: cSubject,
      html: cHtml,
      text: cText
    });
  }

  res.status(200).json({ ok: true });
};
