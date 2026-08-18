/**
 * 아이콘.
 *
 * prototype/index.html 의 <symbol> 정의를 그대로 옮겼다.
 * stroke 기반이라 색은 currentColor 를 따라간다 — 카테고리 색이 그대로 먹는다.
 * 새 아이콘이 필요하면 여기에 24×24 stroke 패스를 더한다.
 */

export const ICON_PATHS: Record<string, string> = {
  "plane": "<path d=\"M4 13l16-8-3 8 3 8z\"/>",
  "cal": "<rect x=\"3\" y=\"5\" width=\"18\" height=\"16\" rx=\"3\"/><path d=\"M3 10h18M8 3v4M16 3v4\"/>",
  "img": "<rect x=\"3\" y=\"4\" width=\"18\" height=\"16\" rx=\"3\"/><circle cx=\"9\" cy=\"10\" r=\"1.8\"/><path d=\"M4 18l5-5 5 4 3-2 3 3\"/>",
  "won": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M8 9l1.8 6L12 10l2.2 5L16 9M7.5 12.5h9\"/>",
  "doc": "<path d=\"M6 3h8l4 4v14H6z\"/><path d=\"M14 3v4h4M9 12h6M9 16h6\"/>",
  "gear": "<path d=\"M4 7h10M18 7h2M4 17h2M10 17h10\"/><circle cx=\"16\" cy=\"7\" r=\"2.2\"/><circle cx=\"8\" cy=\"17\" r=\"2.2\"/>",
  "bed": "<path d=\"M3 18v-9M3 13h18v5M21 18v-4a3 3 0 00-3-3h-7v2\"/><circle cx=\"7\" cy=\"10\" r=\"2\"/>",
  "ticket": "<path d=\"M4 8a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 000 4v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2a2 2 0 000-4z\"/><path d=\"M13 7v10\"/>",
  "pin": "<path d=\"M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z\"/><circle cx=\"12\" cy=\"10\" r=\"2.5\"/>",
  "fork": "<path d=\"M7 3v7a2 2 0 004 0V3M9 12v9M16 3c-1.5 1.5-2 3-2 5s.7 3 2 3.5V21\"/>",
  "bus": "<rect x=\"4\" y=\"4\" width=\"16\" height=\"12\" rx=\"3\"/><path d=\"M4 10h16M7 20v-2M17 20v-2\"/><circle cx=\"8.5\" cy=\"13.5\" r=\"1\"/><circle cx=\"15.5\" cy=\"13.5\" r=\"1\"/>",
  "plus": "<path d=\"M12 5v14M5 12h14\"/>",
  "x": "<path d=\"M6 6l12 12M18 6L6 18\"/>",
  "chev": "<path d=\"M9 6l6 6-6 6\"/>",
  "updown": "<path d=\"M8 9l4-4 4 4M8 15l4 4 4-4\"/>",
  "up": "<path d=\"M12 20V6M6 12l6-6 6 6\"/>",
  "share": "<path d=\"M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7M12 15V4M8 8l4-4 4 4\"/>",
  "folder": "<path d=\"M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z\"/>",
  "clock": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 7v5l3 2\"/>",
  "bulb": "<path d=\"M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9V16h7v-2.1A6 6 0 0012 3z\"/>",
  "check": "<path d=\"M5 13l4 4L19 7\"/>",
  "send": "<path d=\"M21 3L10.5 13.5M21 3l-7 18-3.5-7.5L3 10z\"/>",
  "lock": "<rect x=\"4\" y=\"10\" width=\"16\" height=\"11\" rx=\"3\"/><path d=\"M8 10V7a4 4 0 018 0v3\"/>",
  "fx": "<path d=\"M4 8h13l-3-3M20 16H7l3 3\"/>",
  "sort": "<path d=\"M4 7h16M6 12h12M9 17h6\"/>",
};

export type IconName = keyof typeof ICON_PATHS;

export function Icon({
  name,
  size,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const d = ICON_PATHS[name];
  if (!d) return null;
  return (
    <svg
      className={"ic" + (className ? " " + className : "")}
      viewBox="0 0 24 24"
      style={size ? { width: size, height: size } : undefined}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: d }}
    />
  );
}
