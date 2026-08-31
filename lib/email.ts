import 'server-only'

// Sends transactional emails via Resend when RESEND_API_KEY is set.
// Without a key, emails are logged to the server console (dev fallback)
// so verification / reset links can still be used during development.

export async function sendEmail({
  to,
  subject,
  html,
  text,
}: {
  to: string
  subject: string
  html: string
  text: string
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY

  if (!apiKey) {
    console.log(`[email fallback] To: ${to} | Subject: ${subject}\n${text}`)
    return
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM ?? 'Aura <onboarding@resend.dev>',
      to,
      subject,
      html,
      text,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    console.error(`[email] Resend error ${res.status}: ${body}`)
  }
}

export function emailLayout(title: string, body: string, cta: {
  label: string
  url: string
}): string {
  return `
<div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;">
  <div style="width:40px;height:40px;border-radius:10px;background:#111;color:#fff;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:600;line-height:40px;text-align:center;">A</div>
  <h1 style="font-size:20px;color:#111;margin:24px 0 8px;">${title}</h1>
  <p style="font-size:14px;color:#555;line-height:1.6;margin:0 0 24px;">${body}</p>
  <a href="${cta.url}" style="display:inline-block;background:#111;color:#fff;font-size:14px;font-weight:500;padding:10px 20px;border-radius:8px;text-decoration:none;">${cta.label}</a>
  <p style="font-size:12px;color:#999;margin-top:24px;line-height:1.5;">Если кнопка не работает, скопируйте ссылку в браузер:<br/><a href="${cta.url}" style="color:#555;word-break:break-all;">${cta.url}</a></p>
</div>`
}
