/* 42. Invariant work hoisted, then unrolled
 * Plain pointers may overlap so vectorization is refused, but the invariant product is still hoisted and the loop unrolled.
 */
void scale_by(int *dst, int *src, int f, int n) {
    for (int i = 0; i < n; i++)
        dst[i] = src[i] * (f + 1) * (f + 1);
}
