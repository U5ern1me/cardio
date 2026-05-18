import { z } from "zod";
import {
  MAX_SUPPORTED_PROTOCOL_VERSION,
  MIN_SUPPORTED_PROTOCOL_VERSION,
  SERVER_ERROR_CODES,
  type ServerErrorCode,
} from "../../src/shared/protocolContracts.js";

export const sessionLifecycleSchema = z.enum([
  "LOBBY",
  "ACTIVE",
  "COMPLETED",
  "IDLE_EMPTY",
  "ENDED",
]);

const messageIdSchema = z.string().min(8).max(128);
const requestIdSchema = z.string().min(8).max(128);
const protocolVersionSchema = z
  .number()
  .int()
  .min(MIN_SUPPORTED_PROTOCOL_VERSION)
  .max(MAX_SUPPORTED_PROTOCOL_VERSION);
const expectedStateVersionSchema = z.number().int().nonnegative();
const sessionCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-F0-9]{4}$/);
const tokenSchema = z.string().min(20).max(2048);
const playerNameSchema = z.string().trim().min(1).max(20);

const gameTypeSchema = z.enum([
  "LITERATURE",
  "COUP",
  "SECRET_HITLER",
  "HANABI",
  "LOVE_LETTER",
  "SPADES",
]);

const literatureCardSchema = z
  .object({
    suit: z.string().min(1).max(24),
    rank: z.string().min(1).max(24),
  })
  .strict();

const standardCardSchema = z
  .object({
    rank: z.string().min(1).max(24),
    suit: z.string().min(1).max(24),
  })
  .strict();

const clientEnvelopeFields = {
  protocolVersion: protocolVersionSchema.optional(),
  requestId: requestIdSchema.optional(),
};

function withClientEnvelope<T extends z.ZodRawShape>(shape: T) {
  return z
    .object({
      ...shape,
      ...clientEnvelopeFields,
    })
    .strict();
}

const createSessionSchema = withClientEnvelope({
  type: z.literal("CREATE_SESSION"),
  gameType: gameTypeSchema,
  messageId: messageIdSchema.optional(),
});

const joinSessionSchema = withClientEnvelope({
  type: z.literal("JOIN_SESSION"),
  sessionId: sessionCodeSchema,
  inviteToken: tokenSchema.optional(),
  reconnectToken: tokenSchema.optional(),
  joinAs: z.enum(["PLAYER", "SPECTATOR"]).optional(),
  messageId: messageIdSchema.optional(),
}).superRefine((value, ctx) => {
  if (!value.inviteToken && !value.reconnectToken) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "JOIN_SESSION requires inviteToken or reconnectToken.",
      path: ["inviteToken"],
    });
  }
});

const joinLobbySchema = withClientEnvelope({
  type: z.literal("JOIN_LOBBY"),
  sessionToken: tokenSchema,
  player: z
    .object({
      name: playerNameSchema,
      team: z.enum(["TEAM_A", "TEAM_B"]).optional(),
      seatIndex: z.number().int().min(0).max(31).optional(),
    })
    .strict(),
  messageId: messageIdSchema,
});

const startGameSchema = withClientEnvelope({
  type: z.literal("START_GAME"),
  test: z.boolean().optional(),
  messageId: messageIdSchema,
  expectedStateVersion: expectedStateVersionSchema.optional(),
});

const askCardSchema = withClientEnvelope({
  type: z.literal("ASK_CARD"),
  targetId: z.string().min(1).max(64),
  card: literatureCardSchema,
  askerId: z.string().min(1).max(64).optional(),
  messageId: messageIdSchema,
  expectedStateVersion: expectedStateVersionSchema.optional(),
});

const claimBookSchema = withClientEnvelope({
  type: z.literal("CLAIM_BOOK"),
  halfSuit: z.string().min(1).max(64),
  claimerId: z.string().min(1).max(64).optional(),
  messageId: messageIdSchema,
  expectedStateVersion: expectedStateVersionSchema.optional(),
});

const coupActionSchema = withClientEnvelope({
  type: z.literal("COUP_ACTION"),
  actionType: z.string().min(1).max(64),
  targetId: z.string().min(1).max(64).optional(),
  roleClaimed: z.string().min(1).max(64).optional(),
  influenceIndex: z.number().int().min(0).max(3).optional(),
  selectedRoles: z.array(z.string().min(1).max(64)).max(6).optional(),
  timestamp: z.number().int().nonnegative().optional(),
  messageId: messageIdSchema,
  expectedStateVersion: expectedStateVersionSchema.optional(),
});

const secretHitlerActionSchema = withClientEnvelope({
  type: z.literal("SECRET_HITLER_ACTION"),
  action: z.string().min(1).max(64),
  targetId: z.string().min(1).max(64).optional(),
  vote: z.enum(["JA", "NEIN"]).optional(),
  policy: z.enum(["LIBERAL", "FASCIST"]).optional(),
  accept: z.boolean().optional(),
  messageId: messageIdSchema,
  expectedStateVersion: expectedStateVersionSchema.optional(),
});

const placeBidSchema = withClientEnvelope({
  type: z.literal("PLACE_BID"),
  bid: z.number().int().min(0).max(13),
  messageId: messageIdSchema,
  expectedStateVersion: expectedStateVersionSchema.optional(),
});

const hanabiPlayCardSchema = withClientEnvelope({
  type: z.literal("PLAY_CARD"),
  cardIndex: z.number().int().min(0).max(20),
  messageId: messageIdSchema,
  expectedStateVersion: expectedStateVersionSchema.optional(),
});

const spadesPlayCardSchema = withClientEnvelope({
  type: z.literal("PLAY_CARD"),
  card: standardCardSchema,
  messageId: messageIdSchema,
  expectedStateVersion: expectedStateVersionSchema.optional(),
});

const loveLetterPlayCardSchema = withClientEnvelope({
  type: z.literal("PLAY_CARD"),
  cardRole: z.string().min(1).max(64),
  targetPlayerId: z.string().min(1).max(64).optional(),
  guessedRole: z.string().min(1).max(64).optional(),
  messageId: messageIdSchema,
  expectedStateVersion: expectedStateVersionSchema.optional(),
});

const discardCardSchema = withClientEnvelope({
  type: z.literal("DISCARD_CARD"),
  cardIndex: z.number().int().min(0).max(20),
  messageId: messageIdSchema,
  expectedStateVersion: expectedStateVersionSchema.optional(),
});

const giveHintSchema = withClientEnvelope({
  type: z.literal("GIVE_HINT"),
  targetPlayerId: z.string().min(1).max(64),
  hintType: z.enum(["COLOR", "RANK"]),
  hintValue: z.union([
    z.enum(["RED", "BLUE", "GREEN", "YELLOW", "WHITE"]),
    z.number().int().min(1).max(5),
  ]),
  messageId: messageIdSchema,
  expectedStateVersion: expectedStateVersionSchema.optional(),
});

const moveCardSchema = withClientEnvelope({
  type: z.literal("MOVE_CARD"),
  cardId: z.string().min(1).max(128).optional(),
  fromIndex: z.number().int().min(0).max(40).optional(),
  toIndex: z.number().int().min(0).max(40).optional(),
  targetPlayerId: z.string().min(1).max(64).optional(),
  messageId: messageIdSchema,
  expectedStateVersion: expectedStateVersionSchema.optional(),
});

const gameActionSchema = withClientEnvelope({
  type: z.literal("GAME_ACTION"),
  actionType: z.string().min(1).max(64).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  messageId: messageIdSchema,
  expectedStateVersion: expectedStateVersionSchema.optional(),
});

const hostActionSchema = withClientEnvelope({
  type: z.literal("HOST_ACTION"),
  action: z.enum(["END_GAME", "KICK_PLAYER", "FORCE_SKIP", "REASSIGN_SEAT"]),
  targetId: z.string().min(1).max(64).optional(),
  transferToken: tokenSchema.optional(),
  messageId: messageIdSchema,
  expectedStateVersion: expectedStateVersionSchema.optional(),
});

const requestSeatTransferSchema = withClientEnvelope({
  type: z.literal("REQUEST_SEAT_TRANSFER"),
  displayName: playerNameSchema.optional(),
  messageId: messageIdSchema,
});

export const clientMessageSchema = z.union([
  createSessionSchema,
  joinSessionSchema,
  joinLobbySchema,
  startGameSchema,
  askCardSchema,
  claimBookSchema,
  coupActionSchema,
  secretHitlerActionSchema,
  placeBidSchema,
  hanabiPlayCardSchema,
  spadesPlayCardSchema,
  loveLetterPlayCardSchema,
  discardCardSchema,
  giveHintSchema,
  moveCardSchema,
  gameActionSchema,
  hostActionSchema,
  requestSeatTransferSchema,
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

export function parseClientMessage(
  input: unknown,
): { ok: true; data: ClientMessage } | { ok: false; error: string } {
  const parsed = clientMessageSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue?.message ?? "Invalid message payload." };
  }
  return { ok: true, data: parsed.data };
}

const serverEnvelopeFields = {
  protocolVersion: protocolVersionSchema.optional(),
  requestId: requestIdSchema.optional(),
  correlationId: requestIdSchema.optional(),
};
const serverEnvelopeWithoutRequestFields = {
  protocolVersion: protocolVersionSchema.optional(),
  correlationId: requestIdSchema.optional(),
};

const stateUpdateSchema = z
  .object({
    type: z.literal("STATE_UPDATE"),
    state: z.unknown(),
    yourPlayerId: z.string().min(1).max(64).nullable().optional(),
    gameType: gameTypeSchema,
    stateVersion: z.number().int().nonnegative(),
    lifecycleState: sessionLifecycleSchema,
    reconnectToken: tokenSchema.optional(),
    inviteToken: tokenSchema.optional(),
    capabilities: z
      .object({
        canPlay: z.boolean(),
        canHostActions: z.boolean(),
      })
      .strict(),
    ...serverEnvelopeFields,
  })
  .strict();

const sessionCreatedEventSchema = z
  .object({
    type: z.literal("SESSION_CREATED"),
    sessionId: sessionCodeSchema,
    gameType: gameTypeSchema,
    inviteToken: tokenSchema,
    sessionToken: tokenSchema,
    ...serverEnvelopeFields,
  })
  .strict();

const sessionJoinedEventSchema = z
  .object({
    type: z.literal("SESSION_JOINED"),
    sessionId: sessionCodeSchema,
    gameType: gameTypeSchema,
    stateVersion: z.number().int().nonnegative(),
    lifecycleState: sessionLifecycleSchema,
    resumed: z.boolean(),
    role: z.enum(["HOST", "PLAYER", "SPECTATOR"]),
    sessionToken: tokenSchema.optional(),
    reconnectToken: tokenSchema.optional(),
    ...serverEnvelopeFields,
  })
  .strict();

const errorEventSchema = z
  .object({
    type: z.literal("ERROR"),
    message: z.string().min(1).max(256),
    ...serverEnvelopeFields,
  })
  .strict();

const seatTransferRequestEventSchema = z
  .object({
    type: z.literal("SEAT_TRANSFER_REQUEST"),
    transferToken: tokenSchema,
    requestedBy: z.string().min(1).max(64),
    requestedAtEpochMs: z.number().int().positive(),
    expiresAtEpochMs: z.number().int().positive(),
    ...serverEnvelopeFields,
  })
  .strict();

const seatTransferGrantedEventSchema = z
  .object({
    type: z.literal("SEAT_TRANSFER_GRANTED"),
    sessionId: sessionCodeSchema,
    targetPlayerId: z.string().min(1).max(64),
    transferToken: tokenSchema,
    reconnectToken: tokenSchema,
    ...serverEnvelopeFields,
  })
  .strict();

const ackEventSchema = z
  .object({
    type: z.literal("ACK"),
    requestId: requestIdSchema,
    ackType: z.enum(["RECEIVED", "APPLIED"]),
    messageType: z.string().min(1).max(64),
    stateVersion: z.number().int().nonnegative().optional(),
    ...serverEnvelopeWithoutRequestFields,
  })
  .strict();

const serverErrorCodes = Object.values(SERVER_ERROR_CODES) as [
  ServerErrorCode,
  ...ServerErrorCode[],
];
const rejectCodeSchema = z.enum(serverErrorCodes);

const rejectEventSchema = z
  .object({
    type: z.literal("REJECT"),
    requestId: requestIdSchema,
    code: rejectCodeSchema,
    message: z.string().min(1).max(256),
    retryable: z.boolean(),
    ...serverEnvelopeWithoutRequestFields,
  })
  .strict();

export const serverEventSchema = z.union([
  stateUpdateSchema,
  sessionCreatedEventSchema,
  sessionJoinedEventSchema,
  errorEventSchema,
  seatTransferRequestEventSchema,
  seatTransferGrantedEventSchema,
  ackEventSchema,
  rejectEventSchema,
]);

export type ServerEvent = z.infer<typeof serverEventSchema>;

export function parseServerEvent(
  input: unknown,
): { ok: true; data: ServerEvent } | { ok: false; error: string } {
  const parsed = serverEventSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: issue?.message ?? "Invalid server event payload.",
    };
  }
  return { ok: true, data: parsed.data };
}
