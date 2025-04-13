import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { getFormattedSteamGames, getSteamUserInfo } from './core/steam';
import analyzerApp, { MODEL } from './api/ai';
import type { FormattedGameInfo } from './types/steam';
import { Bindings } from './types/env';
import { initDbConnect } from './db';
import { steamGamesCache } from './db/schema';
import { eq } from 'drizzle-orm';
import { isValidSteamId64 } from './util';

const app = new Hono<{ Bindings: Bindings }>().basePath('/api');

// Constants
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

app.get('/', (c) => {
  return c.text('Hello Hono! Use /games/:steamid to get game data.');
});

// --- API Endpoint: Get User Game Data ---
app.get('/games/:steamid', async (c) => {
  const steamId = c.req.param('steamid');
  const apiKey = c.env.STEAM_API_KEY;
  const d1 = c.env.DB;

  // --- Input Validation ---
  if (!isValidSteamId64(steamId)) {
    throw new HTTPException(400, { message: 'Invalid SteamID format. Please provide a 64-bit SteamID.' });
  }

  if (!apiKey) {
    console.error('STEAM_API_KEY environment variable not set.');
    throw new HTTPException(500, { message: 'Server configuration error: API key missing.' });
  }

  // const cacheKey = `${KV_KEY_PREFIX}${steamId}`;

  const db = initDbConnect(d1);

  try {
    // --- 1. Check D1 Cache ---
    const cacheExpiryThreshold = new Date(Date.now() - CACHE_TTL_SECONDS * 1000);
    console.log(`Checking D1 cache for steamId: ${steamId}, expiry threshold: ${cacheExpiryThreshold.toISOString()}`);

    const cachedResult = await db
      .select()
      .from(steamGamesCache)
      .where(eq(steamGamesCache.steamId, steamId)) // Find matching steamId
      .limit(1);

    if (cachedResult.length > 0 && cachedResult[0].cachedAt > cacheExpiryThreshold) {
      const cachedEntry = cachedResult[0];
      console.log(`D1 Cache hit for ${steamId}. Cached at: ${cachedEntry.cachedAt.toISOString()}`);

      const gameCount = cachedEntry.gameData.length;

      // Requirement: Return the ID (key) of the cached data
      return c.json({
        dataId: steamId,
        source: 'cache-d1',
        gameCount: gameCount,
        message: `Data retrieved from cache. Expires in approximately ${CACHE_TTL_SECONDS} seconds from creation.`
      });
    }

    // --- 2. Cache Miss: Fetch from Steam API ---
    console.log(`Cache miss for ${steamId}. Fetching fresh data from Steam API...`);
    let freshGameData: FormattedGameInfo[];
    try {
      freshGameData = await getFormattedSteamGames(apiKey, steamId);
      // getFormattedSteamGames handles basic logging internally
    } catch (steamError: any) {
      console.error(`Error fetching data from Steam API for ${steamId}:`, steamError.message || steamError);
      // Provide a more specific error if possible (e.g., based on status code if it was an AxiosError)
      // For now, a generic 502 Bad Gateway might be appropriate if Steam API fails
      throw new HTTPException(502, { message: `Failed to fetch data from Steam API: ${steamError.message || 'Unknown error'}` });
    }

    // --- 3. Store Fresh Data in D1 ---
    // Even if the user has no games or is private (empty array), cache the result
    // to avoid hitting the API repeatedly for the same outcome.
    const now = new Date();

    console.log(`Storing/Updating ${freshGameData.length} games in D1 for ${steamId} for ${steamId}. Timestamp: ${now.toISOString()}`);

    await db.insert(steamGamesCache)
      .values({
        steamId: steamId,
        gameData: freshGameData, // Store the stringified JSON
        cachedAt: now,             // Store the current timestamp
      })
      .onConflictDoUpdate({
        target: steamGamesCache.steamId, // Conflict on steamId
        set: {                                  // Update these fields if conflict occurs
          gameData: freshGameData,
          cachedAt: now,
        }
      });

    // --- 4. Return the ID of the newly stored data ---
    return c.json({
      dataId: steamId,
      source: 'api',
      gameCount: freshGameData.length,
      message: `Fetched fresh data from Steam API and stored in cache. Games found: ${freshGameData.length}.`
    });

  } catch (error: any) {
    // Catch KV errors or re-thrown exceptions
    if (error instanceof HTTPException) {
      throw error; // Re-throw Hono's exceptions
    }
    console.error(`Unexpected error processing request for ${steamId}:`, error);
    throw new HTTPException(500, { message: 'An internal server error occurred.' });
  }
});

app.get('/model', (c) => {
  console.log("Request received for /model endpoint.");
  // Return the value of the MODEL constant in a JSON object
  return c.json({ modelName: MODEL, version: 'v1.2.0413' });
});

// --- API Endpoint: Get User Profile Data ---
app.get('/user/:steamid', async (c) => {
  const steamId = c.req.param('steamid'); 
  const apiKey = c.env.STEAM_API_KEY;

  // --- Input Validation ---
  if (!isValidSteamId64(steamId)) {
    throw new HTTPException(400, { message: 'Invalid SteamID format. Please provide a 64-bit SteamID.' });
  }

  if (!apiKey) {
    console.error('STEAM_API_KEY environment variable not set.');
    throw new HTTPException(500, { message: 'Server configuration error: API key missing.' });
  }

  try {
    // Fetch user info from Steam API
    console.log(`Fetching user info for Steam ID: ${steamId}...`);
    const userInfo = await getSteamUserInfo(apiKey, steamId);
    
    // Return user profile data
    return c.json({
      steamId: userInfo.steamId,
      personaName: userInfo.personaName,
      profileUrl: userInfo.profileUrl,
      avatarIconUrl: userInfo.avatarIconUrl,
      avatarMediumUrl: userInfo.avatarMediumUrl,
      avatarFullUrl: userInfo.avatarFullUrl,
      personaState: userInfo.personaState,
      visibilityState: userInfo.visibilityState
    });

  } catch (error: any) {
    // Handle specific errors
    if (error instanceof HTTPException) {
      throw error; // Re-throw Hono's exceptions
    }
    
    console.error(`Error fetching user info for Steam ID ${steamId}:`, error.message || error);
    
    // Determine appropriate error status based on error message
    if (error.message && error.message.includes('User not found')) {
      throw new HTTPException(404, { message: `User not found for Steam ID: ${steamId}` });
    }
    
    throw new HTTPException(502, { message: `Failed to fetch user info from Steam API: ${error.message || 'Unknown error'}` });
  }
});

// --- Mount the analyzer routes ---
// All requests starting with /analyze will be handled by analyzerApp
app.route('/analyze', analyzerApp);

export default app;