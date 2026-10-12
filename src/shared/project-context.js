'use strict';
// Project documentation is untrusted reference material, never instructions.
// Keep credentials out of both persisted memory and provider requests.
function redact(value) {
  return String(value || '')
    .replace(/-----BEGIN [^-]*(?:PRIVATE KEY|CERTIFICATE)-----[\s\S]*?-----END [^-]+-----/g, '[redacted]')
    .replace(/\b(?:sk-or-v1-|sk-ant-|sk-proj-|sk-|ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{12,}/g, '[redacted]')
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/\b(?:postgres(?:ql)?|redis|mongodb(?:\+srv)?):\/\/[^\s"'`]+/gi, '[redacted connection]')
    .replace(/^.*\b(?:password|passwd|secret|api[_ -]?key|access[_ -]?token|authorization|bearer|private[_ -]?key)\b\s*["']?\s*[:=]\s*\S+.*$/gim, '[redacted credential line]');
}
module.exports = { redact };
