/**
 * Modern, clean SVG icons for agent topology nodes.
 * Each icon is a monoline stroke design rendered in white on colored backgrounds.
 */

const iconProps = {
  width: '100%',
  height: '100%',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

/* Master / Orchestrator — hexagonal command center */
function CommandIcon() {
  return (
    <svg {...iconProps}>
      <path d="M12 3l7.5 4.5v9L12 21l-7.5-4.5v-9L12 3z" />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

/* Agent 0 — Lightning bolt (speed / initiator) */
function BoltIcon() {
  return (
    <svg {...iconProps}>
      <path d="M13 2L4.5 13H12l-1 9 8.5-11H12l1-9z" />
    </svg>
  );
}

/* Agent 1 — Magnifying glass (search / research) */
function SearchIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5L21 21" />
    </svg>
  );
}

/* Agent 2 — Code brackets (developer / coder) */
function CodeIcon() {
  return (
    <svg {...iconProps}>
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

/* Agent 3 — Bar chart (analysis / data) */
function AnalyzeIcon() {
  return (
    <svg {...iconProps} strokeWidth={2}>
      <path d="M18 20V10" />
      <path d="M12 20V4" />
      <path d="M6 20v-6" />
    </svg>
  );
}

/* Agent 4 — Flask (testing / experimentation) */
function FlaskIcon() {
  return (
    <svg {...iconProps}>
      <path d="M9 3h6" />
      <path d="M10 3v6.5L4.5 19.5a1 1 0 00.87 1.5h13.26a1 1 0 00.87-1.5L14 9.5V3" />
      <path d="M7.5 15h9" />
    </svg>
  );
}

/* Icon key → component map */
const ICON_MAP = {
  command: CommandIcon,
  bolt: BoltIcon,
  search: SearchIcon,
  code: CodeIcon,
  analyze: AnalyzeIcon,
  flask: FlaskIcon,
};

/**
 * Renders a clean SVG agent icon.
 * @param {{ iconKey: string, size?: number, className?: string }} props
 */
export default function AgentIcon({ iconKey, size = 20, className = '' }) {
  const Icon = ICON_MAP[iconKey];
  if (!Icon) return null;
  return (
    <span
      className={`inline-flex items-center justify-center shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      <Icon />
    </span>
  );
}

export { ICON_MAP };
