export interface TrackProps {
  value: number;
  tone?: string;
}

export function Track({ value, tone }: TrackProps) {
  return (
    <span className={tone ? `track track-${tone}` : "track"}>
      <i style={{ width: `${value}%` }} />
    </span>
  );
}
