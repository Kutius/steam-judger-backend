import type { AxiosError } from 'axios'
import type { FormattedGameInfo, GameInfo, SteamGamesApiResponse, SteamUserApiResponse, SteamUserInfo } from '../types/steam'
import axios from 'axios'

// --- Internal Helper Function: Fetch Raw Game Data ---
async function getOwnedSteamGames(apiKey: string, steamId: string): Promise<GameInfo[]> {
  const apiUrl = 'https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/'
  const params = new URLSearchParams({
    key: apiKey,
    steamid: steamId,
    format: 'json',
    include_appinfo: 'true',
    include_played_free_games: 'true',
  })

  try {
    console.log(`Fetching games for Steam ID: ${steamId}...`)
    const response = await axios.get<SteamGamesApiResponse>(`${apiUrl}?${params.toString()}`)

    if (response.data && response.data.response && response.data.response.games) {
      const ownedGames = response.data.response
      console.log(`Successfully fetched ${ownedGames.game_count} games for Steam ID: ${steamId}.`)
      // Sort raw games alphabetically before formatting
      return ownedGames.games.sort((a, b) => a.name.localeCompare(b.name))
    }
    else if (response.data && response.data.response && Object.keys(response.data.response).length === 0) {
      console.warn(`Warning: Received an empty response for Steam ID ${steamId}. Profile might be private or ID/key invalid.`)
      return [] // Return empty array for private profiles or invalid IDs
    }
    else {
      console.error('Error: Unexpected response structure from Steam API:', response.data)
      throw new Error('Unexpected response structure from Steam API.')
    }
  }
  catch (error) {
    console.error(`Error fetching Steam games for Steam ID ${steamId}:`)
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError
      if (axiosError.response) {
        console.error(`Status: ${axiosError.response.status}`)
        console.error('Data:', axiosError.response.data)
        // Handle specific errors like 401 Unauthorized (bad API key) or 403 Forbidden
        if (axiosError.response.status === 401 || axiosError.response.status === 403) {
          throw new Error(`Steam API request failed with status ${axiosError.response.status}. Check API key or permissions.`)
        }
      }
      else if (axiosError.request) {
        console.error('No response received:', axiosError.request)
      }
      else {
        console.error('Error Message:', axiosError.message)
      }
    }
    else {
      console.error('An unexpected error occurred:', error)
    }
    // Re-throw the error so the caller function knows something went wrong
    throw error
  }
}

// --- Internal Helper Function: Format Game Data ---
function formatGameData(rawGames: GameInfo[]): FormattedGameInfo[] {
  return rawGames.map((game) => {
    const hoursPlayed = (game.playtime_forever / 60).toFixed(1)
    const lastPlayedDate = game.rtime_last_played > 0
      ? new Date(game.rtime_last_played * 1000).toLocaleDateString() // Consider using a more robust date formatting library if needed
      : 'Never'
    const iconUrl = game.img_icon_url
      ? `https://media.steampowered.com/steamcommunity/public/images/apps/${game.appid}/${game.img_icon_url}.jpg`
      : 'No Icon URL Available'

    const formattedGame: FormattedGameInfo = {
      appId: game.appid,
      name: game.name,
      playtimeHours: `${hoursPlayed} hours`,
      lastPlayed: lastPlayedDate,
      iconUrl,
    }
    return formattedGame
  })
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
    throw new Error('Both apiKey and steamId are required.')
  }

  try {
    // 1. Fetch raw game data using the internal helper
    const rawGames = await getOwnedSteamGames(apiKey, steamId)

    // If rawGames is empty (e.g., private profile), formatData will correctly return []
    // 2. Format the data using the internal helper
    const formattedGames = formatGameData(rawGames)

    console.log(`Successfully formatted ${formattedGames.length} games for Steam ID ${steamId}.`)
    return formattedGames
  }
  catch (error) {
    // Log the error originated from fetching or formatting
    console.error(`Failed to get formatted games for Steam ID ${steamId}.`)
    // Re-throw the error to allow the caller to handle it
    throw error // The specific error from getOwnedSteamGames or formatGameData will be propagated
  }
}

/**
 * Fetches basic user information (profile name, avatar, status) for a given Steam ID.
 *
 * @param apiKey Your Steam Web API key.
 * @param steamId The 64-bit Steam ID of the user.
 * @returns A Promise that resolves to a SteamUserInfo object.
 * @throws Throws an error if fetching fails (e.g., network error, invalid API key, user not found, unexpected API response).
 */
export async function getSteamUserInfo(apiKey: string, steamId: string): Promise<SteamUserInfo> {
  if (!apiKey || !steamId) {
    throw new Error('Both apiKey and steamId are required for getting user info.')
  }

  const apiUrl = 'https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/'
  const params = new URLSearchParams({
    key: apiKey,
    steamids: steamId, // Note: parameter name is 'steamids' (plural) even for one ID
    format: 'json',
  })

  try {
    console.log(`Fetching user info for Steam ID: ${steamId}...`)
    const response = await axios.get<SteamUserApiResponse>(`${apiUrl}?${params.toString()}`)

    // --- Response Validation ---
    if (
      !response.data
      || !response.data.response
      || !response.data.response.players
      || !Array.isArray(response.data.response.players)
    ) {
      console.error('Error: Unexpected user info response structure from Steam API:', response.data)
      throw new Error('Unexpected user info response structure from Steam API.')
    }

    if (response.data.response.players.length === 0) {
      console.warn(`Warning: No player data found for Steam ID ${steamId}. User might not exist or ID is invalid.`)
      throw new Error(`User not found for Steam ID ${steamId}.`)
    }

    // --- Data Extraction and Formatting ---
    const rawPlayer = response.data.response.players[0] // Get the first (and only) player object
    console.log(`Successfully fetched user info for ${rawPlayer.personaname} (Steam ID: ${steamId}).`)

    const userInfo: SteamUserInfo = {
      steamId: rawPlayer.steamid,
      personaName: rawPlayer.personaname,
      profileUrl: rawPlayer.profileurl,
      avatarIconUrl: rawPlayer.avatar,
      avatarMediumUrl: rawPlayer.avatarmedium,
      avatarFullUrl: rawPlayer.avatarfull,
      personaState: rawPlayer.personastate,
      visibilityState: rawPlayer.communityvisibilitystate,
      // Convert Unix timestamps to Date objects (handle cases where they might be 0 or undefined)
      lastLogoff: rawPlayer.lastlogoff ? new Date(rawPlayer.lastlogoff * 1000) : undefined,
      timeCreated: rawPlayer.timecreated ? new Date(rawPlayer.timecreated * 1000) : undefined,
      realName: rawPlayer.realname, // Include if present
    }

    return userInfo
  }
  catch (error) {
    // --- Error Handling ---
    console.error(`Error fetching Steam user info for Steam ID ${steamId}:`)
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError
      if (axiosError.response) {
        console.error(`Status: ${axiosError.response.status}`)
        console.error('Data:', axiosError.response.data)
        if (axiosError.response.status === 401 || axiosError.response.status === 403) {
          throw new Error(`Steam API request failed (User Info) with status ${axiosError.response.status}. Check API key.`)
        }
        // Add specific handling if needed, e.g., for rate limits (429)
      }
      else if (axiosError.request) {
        console.error('No response received (User Info):', axiosError.request)
      }
      else {
        // Handle errors thrown from response validation above
        if (error instanceof Error) {
          console.error('Error Message (User Info):', error.message)
        }
        else {
          console.error('Non-Error thrown (User Info):', error)
        }
      }
    }
    else if (error instanceof Error) {
      // Catch errors explicitly thrown within the try block (like "User not found")
      console.error('Caught internal error (User Info):', error.message)
    }
    else {
      console.error('An unexpected error occurred (User Info):', error)
    }
    // Re-throw the error so the caller function knows something went wrong
    throw error
  }
}
