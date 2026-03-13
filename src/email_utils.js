function normalizeEmailAddress(email) {
  if (typeof email !== 'string') throw new Error('invalid_email');
  email = email.trim().toLowerCase();
  if (email.length < 6 || email.length > 254) throw new Error('invalid_email');
  if (/\s/.test(email)) throw new Error('invalid_email');

  const at = email.indexOf('@');
  if (at <= 0 || at !== email.lastIndexOf('@') || at >= email.length - 3) throw new Error('invalid_email');

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);

  if (!local || local.length > 64) throw new Error('invalid_email');
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) throw new Error('invalid_email');
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) throw new Error('invalid_email');

  if (!domain || domain.length < 3 || domain.includes('..')) throw new Error('invalid_email');
  if (domain.startsWith('.') || domain.endsWith('.')) throw new Error('invalid_email');

  const labels = domain.split('.');
  if (labels.length < 2) throw new Error('invalid_email');
  for (const label of labels) {
    if (!label || label.length > 63) throw new Error('invalid_email');
    if (label.startsWith('-') || label.endsWith('-')) throw new Error('invalid_email');
    if (!/^[a-z0-9-]+$/.test(label)) throw new Error('invalid_email');
  }

  const tld = labels[labels.length - 1];
  if (tld.length < 2 || !/[a-z]/.test(tld)) throw new Error('invalid_email');

  return email;
}

module.exports = { normalizeEmailAddress };
