// Envío de correo vía la API REST de Resend (https://resend.com/docs/api-reference/emails/send-email).
// Usa fetch nativo (Node 18+) — no hace falta el SDK de Resend para un solo
// endpoint. Si no hay RESEND_API_KEY configurada, no truena: solo avisa por
// consola, para que el resto del flujo (guardar el historial) no se rompa.
async function sendEmail({ to, bcc, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY no configurada — correo no enviado:', subject);
    return { ok: false, error: 'RESEND_API_KEY no configurada' };
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || 'Catálogo <onboarding@resend.dev>',
      to,
      bcc: bcc && bcc.length ? bcc : undefined,
      subject,
      html
    })
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.warn('[email] Resend respondió con error:', res.status, body);
    return { ok: false, error: `Resend ${res.status}: ${body}` };
  }
  return { ok: true };
}

module.exports = { sendEmail };
