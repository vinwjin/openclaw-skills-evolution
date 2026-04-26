const PLACEHOLDER_CONTENT_PATTERNS = [
  /<!--\s*Add detailed steps based on session content\s*-->/i,
  /<!--\s*Add any important notes or caveats\s*-->/i,
  /Brief description of the approach used in this session\./i,
  /\bNo reusable workflow here\b/i
];

const LOW_VALUE_TEXT_PATTERNS = [
  /^a new session was started via \/new or \/reset/i,
  /^hello[,!\s].*help me with coding/i,
  /^\/tools\b/i,
  /^\s*system:/i,
  /\b(smoke|live|provider|payload)_ready\b/i,
  /\bsecrets?_reloader_degraded\b/i,
  /\bsecret resolution\b/i,
  /write a dream diary entry/i,
  /请回复[:：]/i
];

function assessSkillQuality(doc) {
  const name = String(doc?.name || '').trim();
  const description = String(doc?.description || '').trim();
  const content = String(doc?.content || '').trim();
  const triggers = Array.isArray(doc?.triggers) ? doc.triggers : [];
  const actions = Array.isArray(doc?.actions) ? doc.actions : [];
  const reasons = [];

  if (!name) reasons.push('missing name');
  if (!content) reasons.push('missing content');
  if (content && content.length < 80) reasons.push('content too short');
  if (/Skill extracted from session:/i.test(description)) reasons.push('generated placeholder description');
  if (actions.length === 1 && String(actions[0]).trim().toLowerCase() === 'summary') reasons.push('placeholder action only');
  if (PLACEHOLDER_CONTENT_PATTERNS.some(pattern => pattern.test(content))) reasons.push('placeholder content');
  if (matchesLowValueText(name) || matchesLowValueText(description) || triggers.some(matchesLowValueText)) {
    reasons.push('low-value or infrastructure-noise topic');
  }

  return {
    reusable: reasons.length === 0,
    reasons
  };
}

function isReusableSkillDoc(doc) {
  return assessSkillQuality(doc).reusable;
}

function filterReusableSkillDocs(docs) {
  const reusable = [];
  const excluded = [];

  for (const doc of docs) {
    const quality = assessSkillQuality(doc);
    if (quality.reusable) {
      reusable.push(doc);
    } else {
      excluded.push({ doc, reasons: quality.reasons });
    }
  }

  return { reusable, excluded };
}

function matchesLowValueText(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  return LOW_VALUE_TEXT_PATTERNS.some(pattern => pattern.test(text));
}

module.exports = {
  assessSkillQuality,
  filterReusableSkillDocs,
  isReusableSkillDoc
};
