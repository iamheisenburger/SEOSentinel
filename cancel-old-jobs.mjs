import { ConvexHttpClient } from 'convex/browser';
import { api } from './convex/_generated/api.js';

const client = new ConvexHttpClient('https://wary-starfish-773.convex.cloud');

console.log('Cancelling old pending jobs...\n');

try {
  const pending = await client.query(api.jobs.listByStatus, { status: 'pending' });
  console.log(`Found ${pending.length} pending jobs`);
  
  for (const job of pending) {
    await client.mutation(api.jobs.markDone, {
      jobId: job._id,
      result: 'cancelled_cadence_change'
    });
  }
  
  console.log(`✅ Cancelled ${pending.length} old pending jobs`);
  console.log('\nSystem will now publish 1 article per day (24h intervals)');
  console.log('Next article will be scheduled when the next cron runs');
} catch (err) {
  console.error('Error:', err.message);
}
