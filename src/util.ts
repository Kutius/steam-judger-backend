export function isValidSteamId64(id: string): boolean {
    return /^\d{17}$/.test(id);
}