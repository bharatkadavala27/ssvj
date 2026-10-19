import dns from 'node:dns';
import mongoose from 'mongoose';
import { env } from './env.js';

export async function connectDb() {
  // mongodb+srv needs an SRV lookup; some local resolvers refuse it, so allow overriding DNS servers.
  if (env.dnsServers.length) dns.setServers(env.dnsServers);

  mongoose.set('strictQuery', true);
  await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 20000 });
  const { host, name } = mongoose.connection;
  console.log(`[db] connected to ${name} on ${host}`);
  return mongoose.connection;
}

export function disconnectDb() {
  return mongoose.disconnect();
}
