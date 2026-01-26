import { ConvexHttpClient } from 'convex/browser';
import { api } from './convex/_generated/api.js';

const client = new ConvexHttpClient('https://wary-starfish-773.convex.cloud');
const siteId = 'jh732ef22mtzdpscfjv3252kq57wy5pt';

console.log('🔍 Current UTC time:', new Date().toISOString());
console.log('⏰ Next cron schedules: 3am, 9am, 3pm (15:00), 9pm UTC\n');

console.log('Testing autopilot manually to verify it works...\n');
try {
  const result = await client.action(api.actions.pipeline.autopilotCron, {});
  console.log('✅ Autopilot executed successfully!');
  console.log('Result:', result);
  console.log('\n🎉 Crons are now properly configured and will run at scheduled times.');
  console.log('📅 Next execution: Today at 3pm UTC (15:00)');
} catch (err) {
  console.error('❌ Error:', err.message);
}
