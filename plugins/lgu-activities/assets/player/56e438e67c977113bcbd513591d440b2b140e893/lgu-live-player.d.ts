// Type declarations for the built bundle (`dist/player/lgu-live-player.js`). Written by hand, kept in
// step with `app/player/bundle.ts` by `tests/player-surface.test.ts`, and copied beside the bundle by
// `npm run player:build`. A host that compiles the source instead gets the real types from `app/player/index.ts`.

export type Locale = 'el' | 'en';
export type LiveStreamStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';
export type LivePhase = 'lobby' | 'prepare' | 'open' | 'closed' | 'reveal' | 'finished' | 'cancelled';

/**
 * How the player reaches LGU. `url` is exactly what LGU's own client would fetch — always a root-relative
 * path on the LGU origin (`/api/v1/live/<id>?lang=el`, `/api/v1/live/<id>/stream?after=3&lang=el`,
 * `/api/audio?…`, `/media/<theme>/<file>`); `init` is the request LGU's client sends (method, headers,
 * JSON body, signal, `cache: 'no-store'` on the stream). The host attaches the credential it holds; the
 * player never holds one. `assetUrl` gives the address an element may load a public file from by itself
 * (`/learning-assets/…`, `/question-assets/…`, `/brand/…`).
 */
export type PlayerTransport = {
  fetch(url: string, init: RequestInit): Promise<Response>;
  assetUrl(path: string): string;
};

/** An error the player reports: the server's own status and code when the API answered, a localised message in every case. */
export type PlayerError = { status: number | null; code: string | null; message: string };

/** The live session as the server describes it to this participant. The shape is LGU's `LiveSessionView`; these are its stable fields. */
export type LiveSessionView = {
  id: string; eventId: string; eventTitle: string; topicId: string; themeTitle: string; language: Locale;
  phase: LivePhase; phaseVersion: number; questionIndex: number; questionCount: number;
  openedAt: number | null; deadline: number | null; serverTime: number; lastSeq: number;
  role: 'host' | 'participant'; hostNickname: string;
  answered: number; eligible: number;
  me: { participantId: string; kind: 'account' | 'guest'; userId: string | null; joinedPhaseVersion: number; removed: boolean } | null;
  [field: string]: unknown;
};

export type LivePlayerProps = {
  /** The live session to join the room of; entering it is the host's business before mounting. */
  sessionId: string;
  locale: Locale;
  transport: PlayerTransport;
  /** The audience view: the same screen with nothing personal and nothing to press. */
  spectator?: boolean;
  /** The narration controls beside a question that has clips (default true). */
  audio?: boolean;
  /** «Έξοδος» / «Τέλος»: what leaving means on the host's page. Without it the screen shows no way out. */
  onLeave?: () => void;
  onSession?: (session: LiveSessionView) => void;
  onConnection?: (status: LiveStreamStatus) => void;
  onError?: (error: PlayerError) => void;
  /** Added to the player's outer element. */
  className?: string;
};

export type MountedLivePlayer = {
  update(next: Partial<LivePlayerProps>): void;
  unmount(): void;
};

/** Mounts the live player into an element the host owns and hands back its controls. */
export declare function mountLivePlayer(element: Element, props: LivePlayerProps): MountedLivePlayer;

/** A transport for a host that proxies LGU under a prefix of its own origin, with public files served from `assets` (the prefix itself when absent). */
export declare function proxyTransport(options: { base: string; assets?: string; credentials?: RequestCredentials }): PlayerTransport;

/** LGU's own transport: the browser's fetch and the deployed origin. Only meaningful on an LGU page. */
export declare const webTransport: PlayerTransport;

/** Leaving on purpose, as LGU's own screen does it: ends the room's credential on the server. */
export declare function leaveLiveRoom(transport: PlayerTransport, sessionId: string, locale: Locale): Promise<{ left: boolean }>;

/** The LGU application version the bundle was built from. */
export declare const PLAYER_VERSION: string;
