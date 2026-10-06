// Pure layout helpers for the dynamic video grid (unit-tested in test/grid-layout.test.js).

export interface GridLayout {
  columns: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
}

/**
 * Pick the column count that gives the largest 16:9 tile that fits the container,
 * the same strategy used by Meet/Zoom style galleries.
 */
export function bestGridLayout(
  count: number,
  width: number,
  height: number,
  gap = 12,
  aspect = 16 / 9,
): GridLayout {
  const tiles = Math.max(1, count);
  let best: GridLayout = { columns: 1, rows: tiles, tileWidth: 0, tileHeight: 0 };
  for (let columns = 1; columns <= tiles; columns++) {
    const rows = Math.ceil(tiles / columns);
    const byWidth = (width - gap * (columns - 1)) / columns;
    const byHeight = ((height - gap * (rows - 1)) / rows) * aspect;
    const tileWidth = Math.max(0, Math.min(byWidth, byHeight));
    if (tileWidth > best.tileWidth)
      best = { columns, rows, tileWidth, tileHeight: tileWidth / aspect };
  }
  return best;
}

/** Tiles per page: fewer on narrow screens so each tile stays legible. */
export function pageSizeFor(width: number): number {
  return width < 640 ? 4 : width < 1100 ? 6 : 9;
}

export function paginate<T>(items: T[], pageSize: number, page: number) {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(Math.max(0, page), pageCount - 1);
  return {
    page: current,
    pageCount,
    items: items.slice(current * pageSize, current * pageSize + pageSize),
  };
}

/**
 * Simulcast layer for a rendered tile. Production webcam encodings are
 * q = 1/4, h = 1/2, f = full resolution, so choose the smallest layer whose width
 * still covers the tile in device pixels. Width 0 means "not rendered".
 */
export function layerForTile(cssWidth: number, devicePixelRatio = 1, sourceWidth = 960) {
  if (cssWidth <= 0) return null;
  const needed = cssWidth * devicePixelRatio;
  if (needed <= (sourceWidth / 4) * 1.1) return 0;
  if (needed <= (sourceWidth / 2) * 1.1) return 1;
  return 2;
}
