export function toKebabCasing(name: string) {
  if (!name) return '';

  return name.replace(/([a-z0-9][A-Z])/g, (match: string, $1: string) => {
    return $1.charAt(0) + '-' + $1.charAt(1).toLowerCase()
  });
}