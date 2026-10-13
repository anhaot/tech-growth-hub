/** Only horizontal, deliberate swipes turn a question; vertical reading stays native. */
export function swipeDirection(
  x: number,
  y: number,
  velocityX: number,
): "next" | "prev" | null {
  "worklet";
  if (Math.abs(x) < Math.abs(y) * 1.4) return null;
  const distant = Math.abs(x) >= 56;
  const flick =
    Math.abs(x) >= 24 &&
    Math.abs(velocityX) >= 650 &&
    Math.sign(x) === Math.sign(velocityX);
  if (!distant && !flick) return null;
  return x < 0 ? "next" : "prev";
}
