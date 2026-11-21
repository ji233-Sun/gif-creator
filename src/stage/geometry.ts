import { Matrix3, type Mesh, Vector3 } from 'three';

const MIN_RELATIVE_AREA_SQUARED = (64 * Number.EPSILON) ** 2;

function hasArea(ab: Vector3, ac: Vector3) {
  const scale = Math.max(Math.hypot(ab.x, ab.y, ab.z), Math.hypot(ac.x, ac.y, ac.z));
  if (!Number.isFinite(scale) || scale === 0) return false;
  const relativeAreaSquared = ab.divideScalar(scale).cross(ac.divideScalar(scale)).lengthSq();
  return Number.isFinite(relativeAreaSquared) && relativeAreaSquared > MIN_RELATIVE_AREA_SQUARED;
}

/** GLTFLoader converts triangle strips/fans to triangle lists. */
export function hasRenderableTriangle(mesh: Mesh) {
  const { index, drawRange } = mesh.geometry;
  const positions = mesh.geometry.getAttribute('position');
  if (!positions || positions.itemSize < 3 || positions.count < 3) return false;
  const end = Math.min(index?.count ?? positions.count, drawRange.start + drawRange.count);
  const linear = new Matrix3().setFromMatrix4(mesh.matrixWorld);
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  const valid = (vertex: number) => Number.isInteger(vertex) && vertex >= 0 && vertex < positions.count;
  for (let offset = drawRange.start; offset + 2 < end; offset += 3) {
    const i = index ? index.getX(offset) : offset;
    const j = index ? index.getX(offset + 1) : offset + 1;
    const k = index ? index.getX(offset + 2) : offset + 2;
    if (!valid(i) || !valid(j) || !valid(k)) continue;
    // Require a face in the authored mesh; skinning roundoff alone must
    // not turn collinear source vertices into a valid preview surface.
    a.fromBufferAttribute(positions, i);
    b.fromBufferAttribute(positions, j).sub(a);
    c.fromBufferAttribute(positions, k).sub(a);
    if (!hasArea(b, c)) continue;
    mesh.getVertexPosition(i, a);
    // Transform the posed edges, not the vertices: translation does not
    // affect area and can lose precision before the subtraction.
    mesh.getVertexPosition(j, b).sub(a).applyMatrix3(linear);
    mesh.getVertexPosition(k, c).sub(a).applyMatrix3(linear);
    if (hasArea(b, c)) return true;
  }
  return false;
}
