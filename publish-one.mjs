import { ConvexHttpClient } from 'convex/browser';
import { api } from './convex/_generated/api.js';

const client = new ConvexHttpClient('https://wary-starfish-773.convex.cloud');

const siteId = 'jh732ef22mtzdpscfjv3252kq57wy5pt';
const articleId = 'j5726fgv41p4tt9vszy5m7je6d7x5f97';

try {
  const result = await client.action(api.publisher.publishArticle, { siteId, articleId });
  console.log('Published:', result);
} catch (err) {
  console.error('Error:', err);
}



