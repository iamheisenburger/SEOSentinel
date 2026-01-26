import { ConvexHttpClient } from 'convex/browser';
import { api } from './convex/_generated/api.js';

const client = new ConvexHttpClient('https://wary-starfish-773.convex.cloud');
const siteId = 'jh732ef22mtzdpscfjv3252kq57wy5pt';

console.log('Testing autopilot tick...');
try {
  const result = await client.action(api.actions.pipeline.autopilotTick, { siteId });
  console.log('Autopilot result:', result);
} catch (err) {
  console.error('Error:', err.message);
}
