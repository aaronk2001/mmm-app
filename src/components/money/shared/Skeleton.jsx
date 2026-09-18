export default function Skeleton({ width = '100%', height = 16, style }) {
  return <div className="m-skeleton" style={{ width, height, ...style }} />;
}
