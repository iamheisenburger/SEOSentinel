import { ConvexHttpClient } from 'convex/browser';
import { api } from './convex/_generated/api.js';

const client = new ConvexHttpClient('https://wary-starfish-773.convex.cloud');
const siteId = 'jh732ef22mtzdpscfjv3252kq57wy5pt';

console.log('Setting site to 7 articles/week (1 per day)...\n');

try {
  // Update site with cadencePerWeek
  await client.mutation(api.sites.upsert, {
    id: siteId,
    domain: 'usesubwise.app',
    cadencePerWeek: 7 // 1 article per day
  });
  
  console.log('✅ Site updated to 1 article per day');
  console.log('\nNote: Existing pending jobs will be cancelled automatically');
  console.log('Next article will publish 24 hours after the last one');
} catch (err) {
  console.error('Error:', err.message);
}
