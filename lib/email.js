// Envío de correo vía Resend (resend.com) usando su API REST directamente
// (sin el SDK, para no agregar una dependencia extra -- fetch ya es global
// en Node 18+). Necesita la variable de entorno RESEND_API_KEY; si no está
// definida, se registra en consola y no se manda el correo (útil en local).

const RESEND_API_URL = 'https://api.resend.com/emails';

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY no está definido -- no se envió el correo:', subject);
    return { skipped: true };
  }
  const from = process.env.RESEND_FROM_EMAIL || 'TOOLMAINT <onboarding@resend.dev>';

  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend respondió ${res.status}: ${body}`);
  }
  return res.json();
}

module.exports = { sendEmail };
