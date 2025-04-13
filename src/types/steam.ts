export interface GameInfo {
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

export interface OwnedGamesResponse {
    game_count: number;
    games: GameInfo[];
}

export interface SteamGamesApiResponse {
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

// Raw player data from Steam API (GetPlayerSummaries)
export interface SteamPlayerSummary {
    steamid: string;
    communityvisibilitystate: number; // 1 - Private, 3 - Public, etc.
    profilestate: number;
    personaname: string; // Display Name
    profileurl: string;
    avatar: string; // Small avatar URL
    avatarmedium: string; // Medium avatar URL
    avatarfull: string; // Full avatar URL
    avatarhash: string;
    lastlogoff: number; // Unix timestamp
    personastate: number; // 0 - Offline, 1 - Online, 2 - Busy, etc.
    realname?: string; // Optional real name
    primaryclanid?: string;
    timecreated?: number; // Unix timestamp
    personastateflags?: number;
    loccountrycode?: string;
    locstatecode?: string;
    loccityid?: number;
}

export interface PlayerSummariesResponse {
    players: SteamPlayerSummary[];
}

export interface SteamUserApiResponse { // Top-level structure for user info API
    response: PlayerSummariesResponse;
}

export interface SteamUserInfo {
    steamId: string;
    personaName: string; // Nickname
    profileUrl: string;
    avatarIconUrl: string; // Small
    avatarMediumUrl: string; // Medium
    avatarFullUrl: string; // Full
    personaState: number; // Raw state number
    visibilityState: number; // Raw visibility number
    lastLogoff?: Date; // Date object or undefined if never logged off/unavailable
    timeCreated?: Date; // Date object or undefined
    realName?: string; // Optional
  }