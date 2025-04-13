CREATE TABLE `steam_games_cache` (
	`steam_id` text PRIMARY KEY NOT NULL,
	`game_data` text NOT NULL,
	`cached_at` integer NOT NULL
);
