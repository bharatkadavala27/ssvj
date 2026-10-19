import 'dotenv/config';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name} (see .env.example)`);
  return value;
}

const list = (value) =>
  (value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const env = {
  port: Number(process.env.PORT) || 4000,
  mongoUri: required('MONGODB_URI'),
  dnsServers: list(process.env.DNS_SERVERS),
  adminKey: process.env.ADMIN_KEY || '',
  sessionSecret: required('SESSION_SECRET'),
  corsOrigins: list(process.env.CORS_ORIGINS),
  isProd: process.env.NODE_ENV === 'production',
  // Testing mode: return the login code to the app (only while SMS_PROVIDER=console, i.e. no SMS set up).
  showOtp: process.env.SHOW_OTP === 'true',
  sms: {
    provider: process.env.SMS_PROVIDER || 'console',
    fast2smsKey: process.env.FAST2SMS_API_KEY || '',
    msg91AuthKey: process.env.MSG91_AUTH_KEY || '',
    msg91TemplateId: process.env.MSG91_TEMPLATE_ID || '',
    twilioSid: process.env.TWILIO_ACCOUNT_SID || '',
    twilioToken: process.env.TWILIO_AUTH_TOKEN || '',
    twilioFrom: process.env.TWILIO_FROM || '',
  },
  cloudinary: {
    url: process.env.CLOUDINARY_URL || '',
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
  },
};
