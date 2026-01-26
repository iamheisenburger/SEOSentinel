import { ConvexHttpClient } from 'convex/browser';
import { api } from './convex/_generated/api.js';

const client = new ConvexHttpClient('https://wary-starfish-773.convex.cloud');

console.log('Testing autopilotCron (this is what the scheduled cron will execute)...\n');

try {
  const result = await client.action(api.actions.pipeline.autopilotCron, {});
  console.log('✅ autopilotCron executed successfully!');
  console.log('Result:', JSON.stringify(result, null, 2));
} catch (err) {
  console.error('❌ Error:', err.message);
  if (err.message.includes('timeout')) {
    console.log('Note: Timeout may indicate the function is running (article generation takes time)');
  }
}
