export interface LttbPoint {
  timestamp: number;
  value: number;
}

/**
 * Largest Triangle Three Buckets downsampling.
 * O(n) — preserves visual shape by keeping the point in each bucket
 * that forms the largest triangle with its neighbors.
 */
export function lttbDownsample(data: LttbPoint[], targetCount: number): LttbPoint[] {
  const len = data.length;
  if (len <= targetCount) return data.slice();
  if (targetCount < 3) return [data[0], data[len - 1]];

  const sampled: LttbPoint[] = [];
  sampled.push(data[0]);

  const bucketSize = (len - 2) / (targetCount - 2);

  let prevSelectedIndex = 0;

  for (let i = 0; i < targetCount - 2; i++) {
    const bucketStart = Math.floor((i) * bucketSize) + 1;
    const bucketEnd = Math.min(Math.floor((i + 1) * bucketSize) + 1, len - 1);

    const nextBucketStart = Math.floor((i + 1) * bucketSize) + 1;
    const nextBucketEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, len - 1);

    let avgX = 0;
    let avgY = 0;
    const nextBucketLen = nextBucketEnd - nextBucketStart;
    if (nextBucketLen > 0) {
      for (let j = nextBucketStart; j < nextBucketEnd; j++) {
        avgX += data[j].timestamp;
        avgY += data[j].value;
      }
      avgX /= nextBucketLen;
      avgY /= nextBucketLen;
    } else {
      avgX = data[len - 1].timestamp;
      avgY = data[len - 1].value;
    }

    const prevX = data[prevSelectedIndex].timestamp;
    const prevY = data[prevSelectedIndex].value;

    let maxArea = -1;
    let selectedIndex = bucketStart;

    for (let j = bucketStart; j < bucketEnd; j++) {
      const area = Math.abs(
        (prevX - avgX) * (data[j].value - prevY) -
        (prevX - data[j].timestamp) * (avgY - prevY)
      );
      if (area > maxArea) {
        maxArea = area;
        selectedIndex = j;
      }
    }

    sampled.push(data[selectedIndex]);
    prevSelectedIndex = selectedIndex;
  }

  sampled.push(data[len - 1]);

  return sampled;
}
