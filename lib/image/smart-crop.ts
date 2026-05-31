import sharp from "sharp";

/** Pixel values below this count as drawing content (white ≈ 255 is ignored). */
export const CROP_CONTENT_THRESHOLD = 250;

/** Include largest connected components until this fraction of ink area is covered. */
export const CROP_MASSFRACTION = 0.9;

/** Second-largest component must reach this share of the largest to treat the drawing as multi-part. */
const MULTI_PART_SECOND_COMPONENT_RATIO = 0.4;

export type CropBoundingBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type CropToMainContentResult = {
  buffer: Buffer;
  boundingBox: CropBoundingBox;
  preparedWidth: number;
  preparedHeight: number;
};

type ComponentStats = {
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

class UnionFind {
  private parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index);
  }

  find(index: number): number {
    let root = index;
    while (this.parent[root] !== root) {
      root = this.parent[root];
    }

    let current = index;
    while (this.parent[current] !== current) {
      const next = this.parent[current];
      this.parent[current] = root;
      current = next;
    }

    return root;
  }

  union(a: number, b: number) {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) {
      this.parent[rootB] = rootA;
    }
  }
}

function buildContentMask(grayscale: Uint8Array): boolean[] {
  const mask = new Array<boolean>(grayscale.length);
  for (let index = 0; index < grayscale.length; index += 1) {
    mask[index] = grayscale[index] < CROP_CONTENT_THRESHOLD;
  }
  return mask;
}

function connectedComponentStats(content: boolean[], width: number, height: number): ComponentStats[] {
  const pixelCount = width * height;
  const labels = new Int32Array(pixelCount);
  const uf = new UnionFind(pixelCount + 1);
  let nextLabel = 1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!content[index]) {
        continue;
      }

      const neighborLabels: number[] = [];
      if (x > 0 && content[index - 1]) {
        neighborLabels.push(labels[index - 1]);
      }
      if (x > 0 && y > 0 && content[index - width - 1]) {
        neighborLabels.push(labels[index - width - 1]);
      }
      if (y > 0 && content[index - width]) {
        neighborLabels.push(labels[index - width]);
      }
      if (x < width - 1 && y > 0 && content[index - width + 1]) {
        neighborLabels.push(labels[index - width + 1]);
      }

      if (neighborLabels.length === 0) {
        labels[index] = nextLabel;
        nextLabel += 1;
        continue;
      }

      const minLabel = Math.min(...neighborLabels);
      labels[index] = minLabel;
      for (const neighborLabel of neighborLabels) {
        if (neighborLabel !== minLabel) {
          uf.union(minLabel, neighborLabel);
        }
      }
    }
  }

  const statsByRoot = new Map<number, ComponentStats>();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!content[index] || labels[index] === 0) {
        continue;
      }

      const root = uf.find(labels[index]);
      labels[index] = root;
      const existing = statsByRoot.get(root);
      if (existing) {
        existing.area += 1;
        existing.minX = Math.min(existing.minX, x);
        existing.minY = Math.min(existing.minY, y);
        existing.maxX = Math.max(existing.maxX, x);
        existing.maxY = Math.max(existing.maxY, y);
        continue;
      }

      statsByRoot.set(root, {
        area: 1,
        minX: x,
        minY: y,
        maxX: x,
        maxY: y,
      });
    }
  }

  return [...statsByRoot.values()];
}

function componentToBoundingBox(component: ComponentStats): CropBoundingBox {
  return {
    left: component.minX,
    top: component.minY,
    width: component.maxX - component.minX + 1,
    height: component.maxY - component.minY + 1,
  };
}

function bboxFromComponents(components: ComponentStats[], width: number, height: number): CropBoundingBox {
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;

  for (const component of components) {
    minX = Math.min(minX, component.minX);
    minY = Math.min(minY, component.minY);
    maxX = Math.max(maxX, component.maxX);
    maxY = Math.max(maxY, component.maxY);
  }

  return {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

function bboxWithoutSmallIslands(components: ComponentStats[], width: number, height: number): CropBoundingBox | null {
  if (components.length === 0) {
    return null;
  }

  const totalArea = components.reduce((sum, component) => sum + component.area, 0);
  if (totalArea === 0) {
    return null;
  }

  const sorted = [...components].sort((left, right) => right.area - left.area);
  const largest = sorted[0];
  const secondLargest = sorted[1];

  if (!secondLargest || secondLargest.area < largest.area * MULTI_PART_SECOND_COMPONENT_RATIO) {
    return componentToBoundingBox(largest);
  }

  if (largest.area >= CROP_MASSFRACTION * totalArea) {
    return componentToBoundingBox(largest);
  }

  const cutoff = CROP_MASSFRACTION * totalArea;
  let cumulativeArea = 0;
  const selected: ComponentStats[] = [];

  for (const component of sorted) {
    cumulativeArea += component.area;
    selected.push(component);
    if (cumulativeArea >= cutoff) {
      break;
    }
  }

  return bboxFromComponents(selected, width, height);
}

function tightContentBoundingBox(content: boolean[], width: number, height: number): CropBoundingBox | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!content[y * width + x]) {
        continue;
      }

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) {
    return null;
  }

  return {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

export function findMainContentBoundingBox(
  grayscale: Uint8Array,
  width: number,
  height: number,
): CropBoundingBox | null {
  const content = buildContentMask(grayscale);
  const components = connectedComponentStats(content, width, height);
  if (components.length === 0) {
    return null;
  }

  return bboxWithoutSmallIslands(components, width, height) ?? tightContentBoundingBox(content, width, height);
}

export async function cropToMainContent(imageBuffer: Buffer): Promise<CropToMainContentResult> {
  const { data, info } = await sharp(imageBuffer).grayscale().raw().toBuffer({ resolveWithObject: true });
  const width = info.width;
  const height = info.height;

  if (!width || !height) {
    return {
      buffer: imageBuffer,
      boundingBox: { left: 0, top: 0, width: 0, height: 0 },
      preparedWidth: 0,
      preparedHeight: 0,
    };
  }

  const grayscale = data.length === width * height ? data : new Uint8Array(width * height);
  if (grayscale !== data) {
    for (let index = 0; index < width * height; index += 1) {
      grayscale[index] = data[index * info.channels];
    }
  }

  const boundingBox = findMainContentBoundingBox(grayscale, width, height) ?? {
    left: 0,
    top: 0,
    width,
    height,
  };

  const buffer = await sharp(imageBuffer)
    .extract({
      left: boundingBox.left,
      top: boundingBox.top,
      width: boundingBox.width,
      height: boundingBox.height,
    })
    .png()
    .toBuffer();

  return {
    buffer,
    boundingBox,
    preparedWidth: width,
    preparedHeight: height,
  };
}
