// Imported first by main.ts: every Date in the server (reports, document dates, day boundaries)
// is Thai time unless the deployment sets TZ explicitly.
process.env.TZ ||= 'Asia/Bangkok';

export {};
