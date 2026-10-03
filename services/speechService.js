// Speech provider seam (server side).
//
// MVP: speech recognition and synthesis both run in the browser (Web Speech API),
// so the server only advertises which provider the client should use.
//
// To plug in a better provider later (e.g. a streaming STT or a neural TTS):
//   1. Implement transcribe() / synthesize() below with that provider's SDK, keeping the API key
//      in an environment variable (never in the frontend).
//   2. Return its name from getSpeechConfig().
//   3. Add a matching client provider in public/js/voice/ and register it in voiceService.js.
const { AppError } = require('../middleware/errors');

function getSpeechConfig() {
  return { provider: 'browser', serverSideStt: false, serverSideTts: false };
}

async function transcribe(/* audioBuffer, { language } */) {
  throw new AppError(501, 'not_configured', 'Server-side speech recognition is not enabled. The app currently uses your browser.');
}

async function synthesize(/* text, { voice, rate } */) {
  throw new AppError(501, 'not_configured', 'Server-side speech synthesis is not enabled. The app currently uses your browser.');
}

module.exports = { getSpeechConfig, transcribe, synthesize };
