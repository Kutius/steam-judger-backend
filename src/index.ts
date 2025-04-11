// src/index.ts
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
// Assuming getFormattedSteamGames is in a separate file
import { getFormattedSteamGames, FormattedGameInfo } from './steam'; // Adjust path if needed
import analyzerApp, { MODEL } from './api/ai';

type Bindings = {
  MY_KV: KVNamespace;
  STEAM_API_KEY: string; // Add your Steam API Key secret binding name
  OPENAI_API_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>().basePath('/api');

// Constants
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const KV_KEY_PREFIX = 'steamgames:';

// Helper function for steam ID validation (basic check)
function isValidSteamId64(id: string): boolean {
  return /^\d{17}$/.test(id);
}

app.get('/', (c) => {
  return c.text('Hello Hono! Use /games/:steamid to get game data.');
});

// --- API Endpoint: Get User Game Data ---
app.get('/games/:steamid', async (c) => {
  const steamId = c.req.param('steamid');
  const apiKey = c.env.STEAM_API_KEY;
  const kv = c.env.MY_KV;

  // --- Input Validation ---
  if (!isValidSteamId64(steamId)) {
    throw new HTTPException(400, { message: 'Invalid SteamID format. Please provide a 64-bit SteamID.' });
  }

  if (!apiKey) {
    console.error('STEAM_API_KEY environment variable not set.');
    throw new HTTPException(500, { message: 'Server configuration error: API key missing.' });
  }

  const cacheKey = `${KV_KEY_PREFIX}${steamId}`;

  try {
    // --- 1. Check KV Cache ---
    console.log(`Checking cache for key: ${cacheKey}`);
    const cachedData = await kv.get(cacheKey); // KV returns string | null

    if (cachedData) {
      console.log(`Cache hit for ${steamId}. Returning existing data ID.`);
      // Parse the cached data to get the game count
      const parsedData = JSON.parse(cachedData);
      const gameCount = parsedData.length;
      
      // Requirement: Return the ID (key) of the cached data
      return c.json({
        dataId: cacheKey,
        source: 'cache',
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

    // --- 3. Store Fresh Data in KV ---
    // Even if the user has no games or is private (empty array), cache the result
    // to avoid hitting the API repeatedly for the same outcome.
    const jsonData = JSON.stringify(freshGameData);

    console.log(`Storing ${freshGameData.length} games in KV for ${steamId} with key ${cacheKey} and TTL ${CACHE_TTL_SECONDS}s.`);
    await kv.put(cacheKey, jsonData, {
      expirationTtl: CACHE_TTL_SECONDS,
    });

    // --- 4. Return the ID of the newly stored data ---
    return c.json({
      dataId: cacheKey,
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
  return c.json({ modelName: MODEL, version: 'v1.2.0' });
});

// --- Mount the analyzer routes ---
// All requests starting with /analyze will be handled by analyzerApp
app.route('/analyze', analyzerApp);

export default app;
