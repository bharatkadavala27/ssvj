import { env } from '../config/env.js';

/**
 * Sends the login OTP. Provider is chosen by SMS_PROVIDER:
 *  - console  (default, development): prints the code in the server log
 *  - fast2sms: FAST2SMS_API_KEY (OTP route)
 *  - msg91:    MSG91_AUTH_KEY + MSG91_TEMPLATE_ID (OTP template with ##OTP## variable)
 *  - twilio:   TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM
 */
export async function sendOtp(phone, code) {
  const { provider } = env.sms;
  if (provider === 'console') {
    console.log(`[otp] ${phone}: ${code}`);
    return;
  }
  if (provider === 'fast2sms') {
    const url = new URL('https://www.fast2sms.com/dev/bulkV2');
    url.search = new URLSearchParams({ route: 'otp', variables_values: code, numbers: phone, flash: '0' });
    const res = await fetch(url, { headers: { authorization: env.sms.fast2smsKey } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.return === false) throw new Error(`fast2sms: ${body.message || res.status}`);
    return;
  }
  if (provider === 'msg91') {
    const url = new URL('https://control.msg91.com/api/v5/otp');
    url.search = new URLSearchParams({ template_id: env.sms.msg91TemplateId, mobile: `91${phone}`, otp: code });
    const res = await fetch(url, { method: 'POST', headers: { authkey: env.sms.msg91AuthKey } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.type === 'error') throw new Error(`msg91: ${body.message || res.status}`);
    return;
  }
  if (provider === 'twilio') {
    const { twilioSid, twilioToken, twilioFrom } = env.sms;
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64') },
      body: new URLSearchParams({ To: `+91${phone}`, From: twilioFrom, Body: `SSVJ login code: ${code}` }),
    });
    if (!res.ok) throw new Error(`twilio: ${res.status}`);
    return;
  }
  throw new Error(`Unknown SMS_PROVIDER "${provider}"`);
}
