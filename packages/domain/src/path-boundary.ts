const hasUnsafePathSegment = (value: string): boolean => {
  if (/\p{Cc}/u.test(value) || value.includes('\\')) return true;

  const segments = value.split('/');
  return segments.some((segment, index) => {
    if (segment === '..' || segment === '.') return true;
    return segment === '' && index !== segments.length - 1;
  });
};

export const isKnowledgePathChanged = (
  repoPath: string,
  changedPath: string,
): boolean => {
  if (hasUnsafePathSegment(changedPath)) return false;
  if (changedPath === repoPath) return true;
  return changedPath.startsWith(repoPath);
};
