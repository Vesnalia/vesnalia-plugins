// Constants mirrored from xai-org/x-algorithm (home-mixer/params/param.rs,
// synced 2026-09-02). Every number here is a production default from that
// file unless the comment says otherwise. Weights multiply the *predicted
// probability* of an action (or a predicted continuous value such as dwell
// seconds); they never multiply raw engagement counts.

export const WEIGHTS = {
  favorite: 0.5,
  reply: 5.0,
  /** Added to `reply` for ORIGINAL posts from a mutual follow (not replies/reposts). */
  bidirectionalFollowReplyBoost: 15.0,
  retweet: 1.0,
  photoExpand: 0.05,
  videoOpen: 0.07,
  click: 0.4,
  openLink: 0.2,
  profileClick: 0.0,
  vqv: 0.0,
  share: 2.0,
  shareViaDm: 5.0,
  shareViaCopyLink: 20.0,
  dwell: 0.05,
  quote: 5.0,
  quotedClick: 0.05,
  quotedVqv: 0.0,
  followAuthor: 4.0,
  postUnexplored: 0.02,
  /** Multiplies predicted dwell seconds (continuous). */
  contDwellTime: 0.004,
  contClickDwellTime: 0.0,
  notInterested: -43.2,
  blockAuthor: -31.2,
  muteAuthor: -58.8,
  report: -234.0,
  notDwelled: -0.02,
} as const;

export const RANKING = {
  /** Out-of-network posts, and in-network replies/reposts, are multiplied by this. */
  oonWeightFactor: 0.75,
  /** Used instead of oonWeightFactor when the feed is topic-scoped. */
  topicOonWeightFactor: 0.5,
  /** Author diversity: score * ((1 - floor) * decay^k + floor), k = author's prior posts in the slate. */
  authorDiversityDecay: 0.5,
  authorDiversityFloor: 0.25,
  /** Pre-scoring AgeFilter drops posts older than this. */
  maxPostAgeHours: 48,
  /** Cold-start (new-author) boost eligibility. */
  coldStart: {
    impressionThreshold: 1000,
    followerCap: 1000,
    maxPostAgeSecs: 86400,
    slotMin: 15,
    slotMax: 16,
    maxPositionRatio: 0.85,
  },
  /** Video shorter than this never earns the (currently zero-weight) VQV term. */
  minVideoDurationMs: 10_000,
} as const;

export const SOURCES = {
  weights: "home-mixer/params/param.rs",
  scorer: "home-mixer/scorers/ranking_scorer.rs",
  coldStart: "home-mixer/scorers/author_cold_start.rs",
  oonFilter: "home-mixer/filters/oon_retweet_reply_filter.rs",
  ageFilter: "home-mixer/filters/age_filter.rs",
  selfReplyChain: "home-mixer/filters/self_reply_chain_filter.rs",
  dedupConversation: "home-mixer/filters/dedup_conversation_filter.rs",
  vfRegistry: "visibility-filtering/rules/registry.rs",
  copypasta: "botmaker-rules/scarecrow/bot/BBQDuplicateTextProd.bot",
  lowQualityUrl:
    "botmaker-rules/scarecrow/bot/LQ_Tweets_With_LQ_URL_Verdict_At_Mention_To_NonFollower_v2.bot",
  bidirectional: "home-mixer/BIDIRECTIONAL_BOOST_CHANGE.md",
  candidate: "home-mixer/models/candidate.rs",
} as const;

/** Sum of the magnitudes of the negative weights, used by offset_score. */
export const NEGATIVE_SUM =
  -WEIGHTS.notInterested -
  WEIGHTS.blockAuthor -
  WEIGHTS.muteAuthor -
  WEIGHTS.report -
  WEIGHTS.notDwelled;
