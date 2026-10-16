const windowsDrivePath = /^[A-Za-z]:/;
const uriLikePath = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const encodedPathMarker = /%(?:2e|2f|5c)/i;

export const isSafePackagePath = (value: string): boolean => {
  if (value.length === 0 || value.includes('\\') || value.includes('\0')) return false;
  if (value.startsWith('/') || value.startsWith('./')) return false;
  if (windowsDrivePath.test(value) || uriLikePath.test(value)) return false;
  if (encodedPathMarker.test(value)) return false;

  return !value.split('/').some(
    (part) => part === '' || part === '.' || part === '..' || /\p{Cc}/u.test(part),
  );
};

export const comparePackagePaths = (left: string, right: string): number =>
  Buffer.from(left, 'utf8').compare(Buffer.from(right, 'utf8'));
