import type { Vec, Zone } from './maze';
export type GamePhase = 'LOBBY' | 'ROLE_DELIVERY' | 'CLUE_SUBMISSION' | 'INTERROGATION' | 'IMPOSTOR_GUESS' | 'DECISIONS' | 'ESCAPE' | 'REVEAL' | 'RESULTS';
export type EscapeState = 'inactive' | 'starting' | 'active' | 'captured' | 'escaped' | 'timed_out';
export type Input = { x: number; y: number; dash: boolean };
export type PublicPlayer = { id: string; name: string; color: number; connected: boolean; ready: boolean; selected: boolean; clue?: string; answer?: string; delivered: boolean; outcome?: 'SAVE' | 'DROP'; position?: Vec; votes: { trust: number; drop: number } };
export type PublicState = {
  code: string; version: number; mode: 'local' | 'twitch'; phase: GamePhase; round: number; category?: string;
  players: PublicPlayer[]; current?: string; clueCount: number; paused: boolean; hostConnected: boolean; timer: number;
  votingOpen: boolean; twitchConnected: boolean; saved: number; dropped: number; armed?: Zone;
  escape: EscapeState; escapeLeft: number; feedback?: string; result?: string; rematch: boolean;
  reveal?: { word: string; impostor: string; guessed: boolean; guess: string };
};
export type PrivateState = { id: string; realName: string; role?: 'informed' | 'impostor'; word?: string; category?: string; clue: string; locked: boolean; answer: string; guessLocked: boolean; escapeSpent: boolean; ring?: Vec };
export type HostState = { links?: { name: string; url: string }[]; joinUrl: string; broadcastUrl: string; candidates: { id: string; name: string; connected: boolean; ready: boolean; selected: boolean }[] };
export type SimState = { ring?: Vec; input: Input; actor?: Vec };
export type ActorFrame = { id: string; position: Vec; paddle: Vec; active: boolean; riding: boolean; state: string; capture: number; dwell: number };
export type Action = { id: string; version: number; type: string; data?: Record<string, unknown> };
