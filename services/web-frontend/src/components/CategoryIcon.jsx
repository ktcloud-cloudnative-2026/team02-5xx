const shapes = {
  전체: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    </>
  ),
  버거: (
    <>
      <path d="M4 10a8 6 0 0 1 16 0ZM3 14h18M4 18h16a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3Z" />
      <path d="M9 7h.01M15 7h.01" />
    </>
  ),
  사이드: (
    <>
      <path d="m5 10 2 11h10l2-11ZM8 10 7 3m5 7V2m4 8 1-7M10 14v3m4-3v3" />
    </>
  ),
  음료: (
    <>
      <path d="m6 8 2 13h8l2-13ZM4 8h16M12 8l2-6h5" />
    </>
  ),
  세트: (
    <>
      <path d="M2 20h20M3 12a5 4 0 0 1 10 0ZM3 15h10M4 18h8m3-10h6l-1 10h-4ZM18 8l1-5h3" />
    </>
  ),
  디저트: (
    <>
      <path d="m7 12 5 10 5-10ZM6 12a4 4 0 0 1 1-7 5 5 0 0 1 10 0 4 4 0 0 1 1 7Z" />
    </>
  ),
};
export default function CategoryIcon({ name }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {Object.hasOwn(shapes, name) ? (
        shapes[name]
      ) : (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M8 12h8m-4-4v8" />
        </>
      )}
    </svg>
  );
}
