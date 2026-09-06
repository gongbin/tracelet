export function Icon({ d, size = 20, stroke = 1.5, className, color, fill }: { d: string; size?: number; stroke?: number; className?: string; color?: string; /** 实心图标（如 GitHub 标志）：用 currentColor 填充而不是描边 */ fill?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? (color ?? 'currentColor') : 'none'} stroke={fill ? 'none' : (color ?? 'currentColor')} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={d} />
    </svg>
  );
}
