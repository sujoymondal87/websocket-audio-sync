// Message types
export const MSG = {
  // Client → Server
  JOIN_ROOM: 'join_room',
  LEAVE_ROOM: 'leave_room',
  PING: 'ping',
  AUDIO_COMMAND: 'audio_command',
  SCENE_CHANGE: 'scene_change',

  // Server → Client
  WELCOME: 'welcome',
  ROOM_JOINED: 'room_joined',
  ROOM_STATE: 'room_state',
  PONG: 'pong',
  RELAY: 'relay',
  MEMBER_UPDATE: 'member_update',
  ERROR: 'error',
} as const;

export type Role = 'leader' | 'follower';
export type AudioCommandType = 'play' | 'pause' | 'seek' | 'stop';

export interface BaseMessage {
  type: string;
  roomId?: string;
  seq?: number;
}

export interface JoinRoomMessage extends BaseMessage {
  type: 'join_room';
  roomId: string;
  role: Role;
  clientId: string;
}

export interface PingMessage extends BaseMessage {
  type: 'ping';
  clientTime: number;
}

export interface AudioCommandMessage extends BaseMessage {
  type: 'audio_command';
  roomId: string;
  seq: number;
  command: AudioCommandType;
  blockId: string;
  positionSec: number;
  playbackRate: number;
  executeAtServerMs: number;
}

export interface SceneChangeMessage extends BaseMessage {
  type: 'scene_change';
  roomId: string;
  seq: number;
  blockId: string;
  executeAtServerMs: number;
}

export interface RoomState {
  roomId: string;
  memberCount: number;
  followerCount: number;
  currentBlockId: string | null;
  lastCommand: AudioCommandMessage | null;
  seq: number;
}
