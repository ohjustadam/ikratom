# iKratom — Supabase email templates

Paste these into your Supabase dashboard at:
**Authentication → Email Templates** → for each template type below.

These replace Supabase's generic defaults with branded, on-mission copy that
makes the platform feel like a real product instead of a Supabase project.

---

## 1. Confirm signup

**Subject:** Confirm your iKratom account

**Body (HTML):**

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Confirm your iKratom account</title></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#fafafa;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;">
    <tr><td align="center" style="padding:40px 20px;">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;">
        <tr><td>
          <p style="font-size:24px;font-weight:bold;color:#10b981;margin:0;">
            <span style="color:#10b981;">i</span><span style="color:#fafafa;">Kratom</span>
          </p>
        </td></tr>
        <tr><td style="padding:32px 0 16px 0;">
          <h1 style="font-size:28px;font-weight:bold;color:#fafafa;margin:0;line-height:1.2;">
            Confirm you're real, then we get to work.
          </h1>
        </td></tr>
        <tr><td style="padding:0 0 24px 0;color:#a1a1aa;font-size:15px;line-height:1.6;">
          Click the button below to verify this email is yours. Once you do, we'll walk you through a 60-second setup so we can match you to your specific representatives.
        </td></tr>
        <tr><td style="padding:8px 0 32px 0;">
          <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#10b981;color:#0a0a0a;padding:14px 32px;border-radius:6px;font-weight:bold;font-size:16px;text-decoration:none;">
            Confirm my account →
          </a>
        </td></tr>
        <tr><td style="padding:24px 0 0 0;border-top:1px solid #27272a;color:#52525b;font-size:12px;line-height:1.6;">
          If the button doesn't work, copy this link into your browser:<br>
          <a href="{{ .ConfirmationURL }}" style="color:#10b981;word-break:break-all;">{{ .ConfirmationURL }}</a>
        </td></tr>
        <tr><td style="padding:24px 0 0 0;color:#52525b;font-size:11px;">
          Didn't sign up for iKratom? Ignore this email — no account is created without confirmation.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
```

---

## 2. Reset password

**Subject:** Reset your iKratom password

**Body (HTML):**

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Reset your iKratom password</title></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#fafafa;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;">
    <tr><td align="center" style="padding:40px 20px;">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;">
        <tr><td>
          <p style="font-size:24px;font-weight:bold;color:#10b981;margin:0;">
            <span style="color:#10b981;">i</span><span style="color:#fafafa;">Kratom</span>
          </p>
        </td></tr>
        <tr><td style="padding:32px 0 16px 0;">
          <h1 style="font-size:28px;font-weight:bold;color:#fafafa;margin:0;line-height:1.2;">
            Reset your password
          </h1>
        </td></tr>
        <tr><td style="padding:0 0 24px 0;color:#a1a1aa;font-size:15px;line-height:1.6;">
          Click below to set a new password. The link works for one hour.
        </td></tr>
        <tr><td style="padding:8px 0 32px 0;">
          <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#10b981;color:#0a0a0a;padding:14px 32px;border-radius:6px;font-weight:bold;font-size:16px;text-decoration:none;">
            Set new password →
          </a>
        </td></tr>
        <tr><td style="padding:24px 0 0 0;border-top:1px solid #27272a;color:#52525b;font-size:12px;line-height:1.6;">
          If the button doesn't work, copy this link into your browser:<br>
          <a href="{{ .ConfirmationURL }}" style="color:#10b981;word-break:break-all;">{{ .ConfirmationURL }}</a>
        </td></tr>
        <tr><td style="padding:24px 0 0 0;color:#52525b;font-size:11px;">
          Didn't request this? Someone may have typed your email by accident — no action needed. Your password hasn't changed.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
```

---

## 3. Magic link (only used if you enable magic-link signin later — paste anyway, harmless)

**Subject:** Sign in to iKratom

**Body (HTML):**

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Sign in to iKratom</title></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#fafafa;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;">
    <tr><td align="center" style="padding:40px 20px;">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;">
        <tr><td>
          <p style="font-size:24px;font-weight:bold;color:#10b981;margin:0;">
            <span style="color:#10b981;">i</span><span style="color:#fafafa;">Kratom</span>
          </p>
        </td></tr>
        <tr><td style="padding:32px 0 16px 0;">
          <h1 style="font-size:28px;font-weight:bold;color:#fafafa;margin:0;line-height:1.2;">
            One click and you're in.
          </h1>
        </td></tr>
        <tr><td style="padding:0 0 24px 0;color:#a1a1aa;font-size:15px;line-height:1.6;">
          Click below to sign in to your iKratom account. The link works for one hour and can only be used once.
        </td></tr>
        <tr><td style="padding:8px 0 32px 0;">
          <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#10b981;color:#0a0a0a;padding:14px 32px;border-radius:6px;font-weight:bold;font-size:16px;text-decoration:none;">
            Sign in →
          </a>
        </td></tr>
        <tr><td style="padding:24px 0 0 0;border-top:1px solid #27272a;color:#52525b;font-size:12px;line-height:1.6;">
          If the button doesn't work, copy this link into your browser:<br>
          <a href="{{ .ConfirmationURL }}" style="color:#10b981;word-break:break-all;">{{ .ConfirmationURL }}</a>
        </td></tr>
        <tr><td style="padding:24px 0 0 0;color:#52525b;font-size:11px;">
          Didn't request this? Someone may have entered your email by accident — no action needed. Your account is safe.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
```

---

## 4. Change email confirmation

**Subject:** Confirm your new iKratom email

**Body (HTML):**

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Confirm your new iKratom email</title></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#fafafa;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;">
    <tr><td align="center" style="padding:40px 20px;">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;">
        <tr><td>
          <p style="font-size:24px;font-weight:bold;color:#10b981;margin:0;">
            <span style="color:#10b981;">i</span><span style="color:#fafafa;">Kratom</span>
          </p>
        </td></tr>
        <tr><td style="padding:32px 0 16px 0;">
          <h1 style="font-size:28px;font-weight:bold;color:#fafafa;margin:0;line-height:1.2;">
            Confirm your new email
          </h1>
        </td></tr>
        <tr><td style="padding:0 0 16px 0;color:#a1a1aa;font-size:15px;line-height:1.6;">
          You asked to change your iKratom email to <strong style="color:#fafafa;">{{ .NewEmail }}</strong>. Click below to confirm — the link expires in one hour.
        </td></tr>
        <tr><td style="padding:0 0 24px 0;color:#a1a1aa;font-size:14px;line-height:1.6;">
          Until you confirm, your account stays signed in with your previous email. Nothing changes if you ignore this message.
        </td></tr>
        <tr><td style="padding:8px 0 32px 0;">
          <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#10b981;color:#0a0a0a;padding:14px 32px;border-radius:6px;font-weight:bold;font-size:16px;text-decoration:none;">
            Confirm new email →
          </a>
        </td></tr>
        <tr><td style="padding:24px 0 0 0;border-top:1px solid #27272a;color:#52525b;font-size:12px;line-height:1.6;">
          If the button doesn't work, copy this link into your browser:<br>
          <a href="{{ .ConfirmationURL }}" style="color:#10b981;word-break:break-all;">{{ .ConfirmationURL }}</a>
        </td></tr>
        <tr><td style="padding:24px 0 0 0;color:#52525b;font-size:11px;">
          Didn't request a change? Someone may have access to your iKratom account — sign in immediately and reset your password.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
```

---

## 5. Invite user (only used if you invite someone via Supabase admin tools — paste anyway)

**Subject:** You've been invited to iKratom

**Body (HTML):**

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>You've been invited to iKratom</title></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#fafafa;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;">
    <tr><td align="center" style="padding:40px 20px;">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;">
        <tr><td>
          <p style="font-size:24px;font-weight:bold;color:#10b981;margin:0;">
            <span style="color:#10b981;">i</span><span style="color:#fafafa;">Kratom</span>
          </p>
        </td></tr>
        <tr><td style="padding:32px 0 16px 0;">
          <h1 style="font-size:28px;font-weight:bold;color:#fafafa;margin:0;line-height:1.2;">
            You've been invited to the war room.
          </h1>
        </td></tr>
        <tr><td style="padding:0 0 24px 0;color:#a1a1aa;font-size:15px;line-height:1.6;">
          iKratom is a nonpartisan platform for the kratom community — one-click emails to your legislators, real-time bill tracking, encrypted DMs with other advocates. Click below to accept your invite and finish creating your account.
        </td></tr>
        <tr><td style="padding:8px 0 32px 0;">
          <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#10b981;color:#0a0a0a;padding:14px 32px;border-radius:6px;font-weight:bold;font-size:16px;text-decoration:none;">
            Accept invite →
          </a>
        </td></tr>
        <tr><td style="padding:24px 0 0 0;border-top:1px solid #27272a;color:#52525b;font-size:12px;line-height:1.6;">
          If the button doesn't work, copy this link into your browser:<br>
          <a href="{{ .ConfirmationURL }}" style="color:#10b981;word-break:break-all;">{{ .ConfirmationURL }}</a>
        </td></tr>
        <tr><td style="padding:24px 0 0 0;color:#52525b;font-size:11px;">
          Not expecting an invite? You can ignore this email — no account is created until you click.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
```

---

## How to apply

1. Supabase dashboard → your iKratom project
2. **Authentication → Email Templates**
3. For each template above:
   - Click the template name (e.g. "Confirm signup")
   - Paste the **Subject** into the subject line
   - Paste the **Body (HTML)** into the message editor (HTML tab)
   - Save
4. Verify by triggering a real signup or password reset — emails arrive with the new branding

## Sender name

Same dashboard area:
- **Sender name:** `iKratom`
- **Sender email:** keep as-is for now (Supabase default `noreply@mail.app.supabase.io`). Custom sender domains require SMTP configuration — fine for v1, recommended before scale.

## Optional: Custom SMTP (later)

To send from `noreply@yourdomain.com` instead of the Supabase default:
1. Set up SendGrid/Resend/Postmark account
2. Supabase → Settings → Auth → SMTP Settings
3. Plug in host, port, user, password
4. Verify domain (SPF + DKIM)

Worth doing before ~1000 active users to keep deliverability strong.
