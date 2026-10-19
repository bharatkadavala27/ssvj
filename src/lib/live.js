// Server-Sent Events hub: pushes new donations and campaign totals to every open app.

const clients = new Set();
const HEARTBEAT_MS = 25000;

export function subscribe(req, res) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // disable proxy buffering (nginx)
  });
  res.flushHeaders();
  res.write('retry: 5000\n\n');

  const client = { res };
  clients.add(client);
  const beat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);

  req.on('close', () => {
    clearInterval(beat);
    clients.delete(client);
  });
}

export function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const { res } of clients) res.write(payload);
}

export function clientCount() {
  return clients.size;
}
