/** 첫 로딩. 사이드바가 뜨기 전이라 셸 없이 혼자 선다. */
export function Splash({ message = "불러오는 중…" }: { message?: string }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        color: "var(--ink-3)",
        fontSize: 13,
      }}
    >
      {message}
    </div>
  );
}
