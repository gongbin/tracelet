let counter = 0;
/** 短随机 ID，足够在单个项目内唯一。 */
export function newId(prefix = 'o'): string {
  counter = (counter + 1) % 1e6;
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rnd}`;
}
