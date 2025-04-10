import axios, { AxiosError } from 'axios';

// --- Interfaces ---

// Raw data from Steam API
interface GameInfo {
  appid: number;
  name: string;
  playtime_forever: number;
  img_icon_url: string;
  img_logo_url: string;
  playtime_windows_forever: number;
  playtime_mac_forever: number;
  playtime_linux_forever: number;
  rtime_last_played: number;
}

interface OwnedGamesResponse {
  game_count: number;
  games: GameInfo[];
}

interface SteamApiResponse {
  response: OwnedGamesResponse;
}

// Formatted data structure (Export this if users of the function need the type)
export interface FormattedGameInfo {
  appId: number;
  name: string;
  playtimeHours: string;
  lastPlayed: string;
  iconUrl: string;
  // Optional: Add playtime breakdown if desired
  // playtimeWindowsHours?: string;
  // playtimeMacHours?: string;
  // playtimeLinuxHours?: string;
}

// --- Internal Helper Function: Fetch Raw Game Data ---
async function getOwnedSteamGames(apiKey: string, steamId: string): Promise<GameInfo[]> {
  const apiUrl = 'https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/';
  const params = new URLSearchParams({
    key: apiKey,
    steamid: steamId,
    format: 'json',
    include_appinfo: 'true',
    include_played_free_games: 'true',
  });

  try {
    console.log(`Fetching games for Steam ID: ${steamId}...`);
    const response = await axios.get<SteamApiResponse>(`${apiUrl}?${params.toString()}`);

    if (response.data && response.data.response && response.data.response.games) {
      const ownedGames = response.data.response;
      console.log(`Successfully fetched ${ownedGames.game_count} games for Steam ID: ${steamId}.`);
      // Sort raw games alphabetically before formatting
      return ownedGames.games.sort((a, b) => a.name.localeCompare(b.name));
    } else if (response.data && response.data.response && Object.keys(response.data.response).length === 0) {
      console.warn(`Warning: Received an empty response for Steam ID ${steamId}. Profile might be private or ID/key invalid.`);
      return []; // Return empty array for private profiles or invalid IDs
    } else {
      console.error('Error: Unexpected response structure from Steam API:', response.data);
      throw new Error('Unexpected response structure from Steam API.');
    }
  } catch (error) {
    console.error(`Error fetching Steam games for Steam ID ${steamId}:`);
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      if (axiosError.response) {
        console.error(`Status: ${axiosError.response.status}`);
        console.error('Data:', axiosError.response.data);
        // Handle specific errors like 401 Unauthorized (bad API key) or 403 Forbidden
        if (axiosError.response.status === 401 || axiosError.response.status === 403) {
          throw new Error(`Steam API request failed with status ${axiosError.response.status}. Check API key or permissions.`);
        }
      } else if (axiosError.request) {
        console.error('No response received:', axiosError.request);
      } else {
        console.error('Error Message:', axiosError.message);
      }
    } else {
      console.error('An unexpected error occurred:', error);
    }
    // Re-throw the error so the caller function knows something went wrong
    throw error;
  }
}

// --- Internal Helper Function: Format Game Data ---
function formatGameData(rawGames: GameInfo[]): FormattedGameInfo[] {
  return rawGames.map(game => {
    const hoursPlayed = (game.playtime_forever / 60).toFixed(1);
    const lastPlayedDate = game.rtime_last_played > 0
      ? new Date(game.rtime_last_played * 1000).toLocaleDateString() // Consider using a more robust date formatting library if needed
      : 'Never';
    const iconUrl = game.img_icon_url
      ? `https://media.steampowered.com/steamcommunity/public/images/apps/${game.appid}/${game.img_icon_url}.jpg`
      : 'No Icon URL Available';

    const formattedGame: FormattedGameInfo = {
      appId: game.appid,
      name: game.name,
      playtimeHours: `${hoursPlayed} hours`,
      lastPlayed: lastPlayedDate,
      iconUrl: iconUrl,
    };
    return formattedGame;
  });
}

// --- Exported Core Function ---

/**
 * Fetches and formats owned game data for a given Steam ID.
 *
 * @param apiKey Your Steam Web API key.
 * @param steamId The 64-bit Steam ID of the user.
 * @returns A Promise that resolves to an array of FormattedGameInfo objects.
 * @throws Throws an error if fetching or processing fails (e.g., network error, invalid API key, unexpected API response).
 */
export async function getFormattedSteamGames(apiKey: string, steamId: string): Promise<FormattedGameInfo[]> {
  if (!apiKey || !steamId) {
    throw new Error('Both apiKey and steamId are required.');
  }

  try {
    // 1. Fetch raw game data using the internal helper
    const rawGames = await getOwnedSteamGames(apiKey, steamId);

    // If rawGames is empty (e.g., private profile), formatData will correctly return []
    // 2. Format the data using the internal helper
    const formattedGames = formatGameData(rawGames);

    console.log(`Successfully formatted ${formattedGames.length} games for Steam ID ${steamId}.`);
    return formattedGames;

  } catch (error) {
    // Log the error originated from fetching or formatting
    console.error(`Failed to get formatted games for Steam ID ${steamId}.`);
    // Re-throw the error to allow the caller to handle it
    throw error; // The specific error from getOwnedSteamGames or formatGameData will be propagated
  }
}

// --- Example Usage (Optional - Keep in a separate file like `example.ts` or `run.ts`) ---
/*
// example.ts
import * as dotenv from 'dotenv';
import { getFormattedSteamGames } from './steamGames'; // Adjust path as needed
import * as fs from 'fs/promises';
import * as path from 'path';

dotenv.config(); // Load .env file

async function runExample() {
  const apiKey = process.env.STEAM_API_KEY;
  const steamId = process.env.STEAM_USER_ID;

  if (!apiKey || !steamId) {
    console.error('Error: STEAM_API_KEY or STEAM_USER_ID is not defined in the .env file.');
    process.exit(1);
  }

  try {
    console.log(`Attempting to fetch games for Steam ID: ${steamId}`);
    const gameData = await getFormattedSteamGames(apiKey, steamId);

    if (gameData.length > 0) {
      console.log(`\nSuccessfully retrieved ${gameData.length} formatted games.`);
      console.log('First game:', gameData[0]);

      // --- Optional: Save the result to a file here ---
      const filename = `steam_games_formatted_${steamId}.json`;
      const filePath = path.join(process.cwd(), filename);
      const jsonData = JSON.stringify(gameData, null, 2);
      try {
        await fs.writeFile(filePath, jsonData, 'utf8');
        console.log(`Formatted game data saved to: ${filePath}`);
      } catch (saveError) {
        console.error(`Error saving formatted game data to file ${filePath}:`, saveError);
      }
      // --- End Optional Save ---

    } else {
      console.log(`No game data returned for Steam ID ${steamId}. Profile might be private or user owns no games.`);
    }

  } catch (error) {
    console.error('\nError during example execution:', error);
    // The error thrown by getFormattedSteamGames will be caught here
  }
}

runExample();
*/
